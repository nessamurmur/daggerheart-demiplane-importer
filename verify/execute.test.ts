import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { executePlan, reportJSON } from "../src/importer.ts";
import { MODULE_ID, type DocumentSource } from "../src/types.ts";
import { check } from "./check.ts";
import { characterFrom, planFor, sourceItem } from "./fixtures.ts";
import { itemLabel, world, type WorldEvent } from "./world.ts";

/** Creation order executePlan promises: main class, multiclass, subclass, other items, domain cards. */
const rank = (source: DocumentSource) => source.type === "class" ? (source.system?.isMulticlass ? 1 : 0) : source.type === "subclass" ? 2 : source.type === "domainCard" ? 4 : 3;

test("executePlan does not write when the review is unfinished or the user is not a GM", async () => {
  const cases: { reviewed?: boolean; blocking?: boolean; undecided?: boolean; gm?: boolean }[] = [
    { reviewed: false }, { blocking: true }, { undecided: true }, { gm: false },
  ];
  for (const gate of cases) {
    const { runtime, events, bystander } = world({ isGM: gate.gm !== false });
    const plan = planFor(characterFrom());
    if (gate.reviewed === false) plan.reviewed = false;
    if (gate.blocking) plan.issues.push({ code: "required", message: "missing", blocking: true });
    if (gate.undecided) plan.comparisons.push({ path: "system.evasion", label: "Evasion", pdf: 1, calculated: 1, choice: null });
    await assert.rejects(() => executePlan(plan, runtime));
    assert.equal(events.length, 0, JSON.stringify(gate));
    assert.equal(bystander.deleted, false);
    assert.equal(bystander.name, "Existing hero");
  }
});

test("a declined item create deletes only the actor this import created", async () => {
  const { runtime, created, events, bystander } = world({ failAt: 1 });
  const plan = planFor(characterFrom());
  plan.itemSources = [sourceItem("loot", 0)];
  await assert.rejects(() => executePlan(plan, runtime));
  assert.equal(created.length, 1);
  assert.equal(created[0].deleted, true);
  assert.equal(bystander.deleted, false);
  assert.ok(events.some(event => event.op === "delete" && event.id === created[0].id));
  assert.equal(events.some(event => event.id === bystander.id), false);
});

test("executePlan deletes only documents it created, or names the ones it could not", async () => {
  const item = fc.record({
    type: fc.constantFrom("class", "subclass", "domainCard", "loot", "weapon", "ancestry"),
    multiclass: fc.boolean(),
  });
  await check(fc.asyncProperty(
    fc.array(item, { maxLength: 3 }),
    fc.boolean(),
    fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
    async (items, withCompanion, failAt) => {
      const { runtime, events, created, bystander } = world({ failAt });
      const plan = planFor(characterFrom());
      plan.itemSources = items.map((item, index) => sourceItem(item.type, index, { isMulticlass: item.multiclass }));
      if (withCompanion) plan.companionData = { _id: "new-companion", name: "Companion", type: "companion", system: { levelData: { levelups: {} } } };
      const snapshot = structuredClone(bystander);
      try {
        const result = await executePlan(plan, runtime);
        assert.equal(result.report.status, "complete");
        assert.equal(result.actor.flags[MODULE_ID].report, result.report);
        assert.deepEqual(JSON.parse(reportJSON(result.report)), JSON.parse(JSON.stringify(result.report)));
        assert.ok(created.every(actor => actor.deleted === false));
      } catch (error) {
        const failure = error as { importReport?: { status?: string; actorUuid?: string; verifiedStats?: unknown[]; cleanupFailures?: string[] } };
        assert.equal(failure.importReport?.status, "failed");
        assert.equal(failure.importReport?.actorUuid, undefined);
        assert.deepEqual(failure.importReport?.verifiedStats, []);
        const leftovers = (failure.importReport?.cleanupFailures ?? []).join("\n");
        for (const actor of created) assert.ok(actor.deleted || leftovers.includes(actor.uuid), actor.uuid);
      }
      assert.deepEqual(bystander, snapshot);
      for (const event of events) if (event.op !== "createActor") assert.ok(created.some(actor => actor.id === event.id), event.op);
      assert.deepEqual(itemTypes(events), expectedItemOrder(plan.itemSources).slice(0, itemTypes(events).length));
    },
  ), 25);
});

test("executePlan creates the main class before other items and domain cards last", async () => {
  const plan = planFor(characterFrom());
  plan.itemSources = [
    sourceItem("domainCard", 0),
    sourceItem("class", 1, { isMulticlass: true }),
    sourceItem("subclass", 2),
    sourceItem("class", 3, { isMulticlass: false }),
    sourceItem("loot", 4),
  ];
  const { runtime, events, bystander } = world();
  const result = await executePlan(plan, runtime);
  assert.equal(result.report.status, "complete");
  assert.deepEqual(itemTypes(events), ["class:main", "class:multi", "subclass", "loot", "domainCard"]);
  assert.equal(events.filter(event => event.op === "createActor").map(event => event.id).includes(bystander.id), false);
});

function itemTypes(events: WorldEvent[]): string[] {
  return events.filter(event => event.op === "createEmbedded" && event.type === "Item").flatMap(event => (event.detail ?? "").split(",").filter(Boolean));
}

function expectedItemOrder(sources: DocumentSource[]): string[] {
  return sources.map((source, index) => ({ source, index })).sort((a, b) => rank(a.source) - rank(b.source) || a.index - b.index).map(item => itemLabel(item.source));
}
