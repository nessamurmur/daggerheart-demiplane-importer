import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustmentEffects, buildPlan, executePlan, loadCatalog, makeReport, sanitizeSource } from "../src/importer.ts";
import { resolveEntries } from "../src/core.ts";
import { MODULE_ID } from "../src/types.ts";
import { character, mockRuntime } from "./helpers.ts";

test("planning is read-only and stat decisions are required", async () => {
  const c = character({ evasion: "8" });
  const { runtime, created } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.equal(created.length, 0);
  assert.equal(plan.comparisons.find(x => x.label === "Evasion")!.calculated, 10);
  assert.equal(plan.comparisons[0].choice, null);
  await assert.rejects(executePlan(plan, runtime), /Complete the review/);
});
test("matched items preserve rules, effects, source identity and character state", async () => {
  const c = character({ primary_weapon_name: "Test Blade", primary_weapon_trait: "Strength Melee", primary_weapon_damage: "1d8 Physical" });
  const uuid = "Compendium.test.Item.weapon";
  const document = { _id: "original", name: "Test Blade", type: "weapon", ownership: { secret: 3 }, folder: "old", system: { equipped: false, secondary: false, burden: "oneHanded", attack: { roll: { trait: "strength" }, damage: { formula: "native" } } }, effects: [{ _id: "effect", system: { changes: [] } }] };
  const { runtime } = mockRuntime({ [uuid]: document });
  const candidates = [{ uuid, name: "Test Blade", type: "weapon", pack: "Test" }];
  const plan = await buildPlan(c, resolveEntries(c, candidates), runtime);
  const weapon = plan.itemSources.find(s => s.type === "weapon")!;
  assert.equal(weapon.system.equipped, true); assert.equal(weapon.system.attack.damage.formula, "native");
  assert.equal(weapon._stats.compendiumSource, uuid); assert.equal(weapon.effects.length, 1);
  assert.equal(weapon.folder, undefined); assert.equal(weapon.ownership, undefined);
  assert.equal(document.system.equipped, false);
});
test("unregistered domains become descriptive features, never an unrelated domain", async () => {
  const c = character({ "domain_card_name.0.0": "Future card", "domain_card_domain.0.0": "future", "domain_card_type.0.0": "spell", "domain_card_recall.0.0": "1" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const card = plan.itemSources.find(s => s.name === "Future card")!;
  assert.equal(card.type, "feature"); assert.equal(card.flags[MODULE_ID].original.domain, "future");
  assert(plan.issues.some(i => i.code === "unsupported-domain"));
});
test("known-domain editable cards require level and recall cost", async () => {
  const c = character({ "domain_card_name.0.0": "Missing details", "domain_card_domain.0.0": "sage" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert(plan.issues.some(i => i.blocking && i.message.includes("card level")));
});
test("multiclass links and feature selection are explicit", async () => {
  const c = character({ level: "5", subclass_name_1: "First Path", subclass_class_1: "Fixture Class", subclass_name_2: "Other Path", subclass_class_2: "Other Class" });
  c.entries.find(e => e.name === "Other Class")!.domains = ["sage"];
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const other = plan.itemSources.find(s => s.name === "Other Class")!, sub = plan.itemSources.find(s => s.name === "Other Path")!;
  assert.equal(other.system.isMulticlass, true);
  assert.equal(sub.system.linkedClass, `Actor.${plan.actorData._id}.Item.${other._id}`);
  assert.deepEqual(plan.actorData.system.levelData.levelups, {});
  assert.equal(plan.actorData.system.levelData.level.current, plan.actorData.system.levelData.level.changed);
});
test("mixed ancestry uses only the selected primary and secondary grants", async () => {
  const c = character(); c.mixedAncestry = { enabled: true, name: "Mixed", primaryUuid: "Item.a", secondaryUuid: "Item.b" };
  const { runtime } = mockRuntime({
    "Item.a": { name: "A", type: "ancestry", system: { features: [{ type: "primary", item: "Item.f1" }, { type: "secondary", item: "Item.discard" }] } },
    "Item.b": { name: "B", type: "ancestry", system: { features: [{ type: "secondary", item: "Item.f2" }] } },
    "Item.f1": { name: "Primary", type: "feature", system: {} }, "Item.f2": { name: "Secondary", type: "feature", system: {} }
  });
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const ancestry = plan.itemSources.find(s => s.type === "ancestry")!;
  assert.equal(ancestry.name, "Mixed"); assert.deepEqual(ancestry.system.features.map((f: any) => f.item), ["Item.f1", "Item.f2"]);
});
test("PDF corrections use differences, including native armor effect data", () => {
  const effects = adjustmentEffects([{ path: "system.evasion", label: "Evasion", pdf: 8, calculated: 10, choice: "pdf" }, { path: "system.armorScore.max", label: "Armor", pdf: 5, calculated: 4, choice: "pdf" }], () => "id");
  assert.equal(effects[0].system.changes[0].value, -2);
  assert.equal(effects[1].system.changes[0].type, "armor");
  assert.equal(effects[1].system.changes[0].value.max, "1");
});
test("failed item creation rolls back only the newly created actor", async () => {
  const c = character(); const { runtime, created } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  const create = runtime.createActor;
  runtime.createActor = async source => { const actor = await create(source); actor.createEmbeddedDocuments = async () => []; return actor; };
  await assert.rejects(executePlan(plan, runtime), /declined to add/);
  assert.equal(created.length, 1); assert.equal(created[0].deleted, true);
});
test("cleanup failure is returned with the exact remaining document", async () => {
  const c = character(); const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  const create = runtime.createActor;
  runtime.createActor = async source => { const actor = await create(source); actor.createEmbeddedDocuments = async () => { throw new Error("offline"); }; actor.delete = async () => { throw new Error("still offline"); }; return actor; };
  await assert.rejects(executePlan(plan, runtime), (e: any) => e.importReport.cleanupFailures.length === 1 && e.message.includes("Cleanup"));
});
test("successful import creates classes first and reports every populated source field", async () => {
  const c = character({ extra: "unknown", "experience_name.0": "Scout", "experience_bonus.0": "0" });
  const { runtime, operations } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  const result = await executePlan(plan, runtime);
  assert.equal(operations[0], "class"); assert.equal(result.report.status, "complete");
  assert.equal(result.report.fieldDisposition.extra, "reported");
  assert.equal(result.actor.system.experiences.exp0.value, 0);
});
test("inaccessible compendiums do not prevent use of accessible content", async () => {
  (globalThis as any).game = { user: {}, items: { contents: [] }, packs: [
    { documentName: "Item", visible: true, title: "Unavailable", getIndex: async () => { throw new Error("denied"); } },
    { documentName: "Item", visible: true, title: "Readable", collection: "test.pack", getIndex: async () => [{ _id: "item", name: "Test", type: "loot" }] }
  ] };
  const catalog = await loadCatalog();
  assert.equal(catalog.candidates.length, 1); assert.equal(catalog.issues[0].code, "pack-unavailable");
  delete (globalThis as any).game;
});
test("GM access is checked at both planning and creation", async () => {
  const c = character(); const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  runtime.isGM = false;
  await assert.rejects(buildPlan(c, [], runtime), /Only a GM/);
  await assert.rejects(executePlan(plan, runtime), /Only a GM/);
});

test("creation detects a doubled shield bonus even when the preview agreed with the PDF", async () => {
  const c = character({ armor: "4" });
  const { runtime, created } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  assert(!plan.comparisons.some(c => c.path === "system.armorScore.max"));
  const create = runtime.createActor;
  runtime.createActor = async source => { const actor = await create(source); actor.system.armorScore.max = 5; return actor; };
  await assert.rejects(executePlan(plan, runtime), /expected 4, got 5/);
  assert.equal(created[0].deleted, true);
});

test("higher-level companion training stores a base that replays to the reviewed snapshot", async () => {
  const c = character({ level: "5" });
  c.companion = { enabled: true, name: "Test companion", evasion: 12, stressMax: 4, stress: 1, attackName: "Bite", damageDice: "d8", damageType: "physical", range: "melee", experiences: [{ name: "Tracking", value: 3 }, { name: "Climbing", value: 3 }], notes: "Reviewed test notes", training: [{ type: "evasion", data: [] }, { type: "stress", data: [] }, { type: "experience", data: [] }, { type: "vicious", data: ["damage"] }] };
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert(!plan.issues.some(i => i.blocking));
  const s = plan.companionData!.system;
  assert.equal(s.evasion + 2, c.companion.evasion);
  assert.equal(s.resources.stress.max + 1, c.companion.stressMax);
  assert.equal(s.experiences.exp0.value + 1, 3);
  assert.equal(s.attack.damage.main.value.dice, "d6");
  assert.equal(Object.keys(s.levelData.levelups).length, 4);
  assert.equal(s.levelData.level.current, 5); assert.equal(s.levelData.level.changed, 5);
  assert(plan.actorData.system.biography.background.includes("Reviewed test notes"));
});

test("unsupported playtest class domains remain recorded without breaking native domain lookups", async () => {
  const c = character({ "domain_card_name.0.0": "Playtest card", "domain_card_domain.0.0": "future" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const main = plan.itemSources.find(s => s.type === "class")!;
  assert.deepEqual(main.system.domains, []);
  assert.deepEqual(main.flags[MODULE_ID].unsupportedDomains, ["future"]);
});

test("reports preserve the reviewed inputs, source values, exclusions and verified numbers", async () => {
  const c = character({ level: "1", name: "Source name" });
  c.name = "Reviewed name";
  c.entries.find(e => e.kind === "ancestry")!.include = false;
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  const { report } = await executePlan(plan, runtime);
  assert.equal(report.reviewedCharacter.name, "Reviewed name");
  assert.equal(report.reviewedCharacter.source.fields.name, "Source name");
  assert.equal(report.fieldDisposition.ancestry_name, "reported");
  assert.equal(report.verifiedStats["system.armorScore.max"], 4);
});
