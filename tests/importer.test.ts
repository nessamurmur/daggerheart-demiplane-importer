import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustmentEffects, buildPlan, executePlan, foundryRuntime, loadCatalog, makeReport, reportJSON, sanitizeSource } from "../src/importer.ts";
import { resolveEntries } from "../src/core.ts";
import { MODULE_ID, TRAITS } from "../src/types.ts";
import { character, companionCheckboxesTaken, LEVEL_TIERS, mockRuntime } from "./helpers.ts";

const selections = (plan: { actorData: any }): any[] => Object.values<any>(plan.actorData.system.levelData.levelups).flatMap(r => r.selections);
/** What Foundryborne's level-up dialog reads to mark a checkbox as taken: tier, option, and checkbox number, per level. */
const taken = (plan: { actorData: any }) => Object.fromEntries(Object.entries<any>(plan.actorData.system.levelData.levelups).map(([level, r]) => [level, r.selections.map((s: any) => `t${s.tier} ${s.optionKey} #${s.checkboxNr}${s.type === "domainCard" ? "" : ` ${s.data.join("+")}`}`.trim()).sort()]));

test("planning is read-only and stat decisions are required", async () => {
  const c = character({ evasion: "8" });
  const { runtime, created } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.equal(created.length, 0);
  assert.equal(plan.comparisons.find(x => x.label === "Evasion")!.calculated, 10);
  assert.equal(plan.comparisons[0].choice, null);
  await assert.rejects(executePlan(plan, runtime), /Complete the review/);
});

test("Foundry preview uses the constructor's prepared stats without doubling class bonuses", () => {
  const saved = { game: (globalThis as any).game, CONFIG: (globalThis as any).CONFIG };
  class PreparedActor {
    system: any; preparations = 0;
    constructor(source: any) { this.system = structuredClone(source.system); this.prepareData(); }
    prepareData() { this.preparations++; this.system.evasion += 10; this.system.resources.hitPoints.max += 6; }
  }
  try {
    (globalThis as any).game = { system: { version: "2.10.2", settings: { automation: { levelupAuto: false } } }, user: { isGM: true }, modules: new Map([[MODULE_ID, { version: "test" }]]) };
    (globalThis as any).CONFIG = { Actor: { documentClass: PreparedActor }, DH: { DOMAIN: { allDomains: () => ({}) } } };
    const runtime = foundryRuntime();
    assert.equal(runtime.levelupAuto, false);
    const source = { system: { evasion: 0, resources: { hitPoints: { max: 0 } } } };
    const actor = runtime.preview(source);
    assert.equal(actor.preparations, 1);
    assert.equal(actor.system.evasion, 10); assert.equal(actor.system.resources.hitPoints.max, 6);
    assert.equal(source.system.evasion, 0);
    const correction = adjustmentEffects([{ path: "system.evasion", label: "Evasion", pdf: 8, calculated: actor.system.evasion, choice: "pdf" }], () => "effect")[0];
    assert.equal(actor.system.evasion + correction.system.changes[0].value, 8);
  } finally { Object.assign(globalThis, saved); }
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
  const multiclass = selections(plan).find(s => s.type === "multiclass");
  assert.deepEqual({ level: multiclass?.level, tier: multiclass?.tier, checkboxNr: multiclass?.checkboxNr, minCost: multiclass?.minCost, data: multiclass?.data, itemUuid: multiclass?.itemUuid, secondaryData: multiclass?.secondaryData },
    { level: 5, tier: 3, checkboxNr: 1, minCost: 2, data: [sub.system.linkedClass], itemUuid: sub.system.linkedClass, secondaryData: { domain: "sage", subclass: `Actor.${plan.actorData._id}.Item.${sub._id}` } });
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

async function reviewedPlan(c = character(), documents: Record<string, any> = {}) {
  const mock = mockRuntime(documents);
  const candidates = Object.entries(documents).map(([uuid, d]) => ({ uuid, name: d.name, type: d.type, pack: "Test", system: {} }));
  const plan = await buildPlan(c, resolveEntries(c, candidates), mock.runtime);
  assert(!plan.issues.some(i => i.blocking));
  for (const comparison of plan.comparisons) comparison.choice = "foundry";
  plan.reviewed = true;
  return { ...mock, plan };
}
/** A class that grants a feature, as Foundryborne's Druid grants Beastform. */
const grantingClass = {
  "Compendium.test.Item.class": { name: "Fixture Class", type: "class", system: { domains: ["sage"], hitPoints: 6, evasion: 10, features: [{ type: "class", item: "Compendium.test.Item.beastform" }], backgroundQuestions: [], connections: [] } },
  "Compendium.test.Item.beastform": { name: "Beastform", type: "feature", system: { description: "<p>Transform.</p>" } }
};
const companion = (training: { type: string; data: string[] }[] = []) => ({ enabled: true, name: "Test companion", evasion: 12, stressMax: 4, stress: 0, attackName: "Bite", damageDice: "d6", damageType: "physical", range: "melee", experiences: [{ name: "Tracking", value: 2 }, { name: "Climbing", value: 2 }], notes: "", training });

test("a feature that Foundry declines while granting a class fails and rolls back the import, and a retry creates it", async () => {
  const { runtime, created, hooks, plan } = await reviewedPlan(character(), grantingClass);
  hooks.preCreateItem = data => data.name !== "Beastform";
  await assert.rejects(executePlan(plan, runtime), /Foundry declined to add “Beastform”/);
  assert.equal(created[0].deleted, true);
  delete hooks.preCreateItem;
  assert.equal((await executePlan(plan, runtime)).report.status, "complete");
});
test("a declined community feature, linked by a bare UUID as Foundryborne communities are, fails and rolls back the import", async () => {
  const community = {
    "Compendium.test.Item.community": { name: "Fixture Community", type: "community", system: { features: ["Compendium.test.Item.lightfoot"] } },
    "Compendium.test.Item.lightfoot": { name: "Lightfoot", type: "feature", system: { description: "<p>Move quietly.</p>" } }
  };
  const { runtime, created, hooks, plan } = await reviewedPlan(character({ community_name: "Fixture Community" }), community);
  hooks.preCreateItem = data => data.name !== "Lightfoot";
  await assert.rejects(executePlan(plan, runtime), /Foundry declined to add “Lightfoot”, granted by “Fixture Community”/);
  assert.equal(created[0].deleted, true);
  delete hooks.preCreateItem;
  assert.equal((await executePlan(plan, runtime)).report.status, "complete");
});
test("a declined companion link fails the import and removes both actors", async () => {
  const c = character(); c.companion = companion();
  const { runtime, created, hooks, plan } = await reviewedPlan(c);
  hooks.preUpdateActor = (_actor, changes) => !changes.system?.companion;
  await assert.rejects(executePlan(plan, runtime), /declined to link the companion/);
  assert.deepEqual(created.map(a => [a.type, a.deleted]), [["character", true], ["companion", true]]);
});
test("a declined companion training feature fails the import and removes both actors", async () => {
  const c = character({ level: "2" }); c.companion = companion([{ type: "creatureComfort", data: [] }]);
  const { runtime, created, hooks, plan } = await reviewedPlan(c);
  hooks.preCreateItem = data => !data.flags?.[MODULE_ID]?.companionTraining;
  await assert.rejects(executePlan(plan, runtime), /declined/);
  assert.deepEqual(created.map(a => a.deleted), [true, true]);
});
test("a declined biography and marks update fails the import, even when the marks already match", async () => {
  const { runtime, created, hooks, plan } = await reviewedPlan();
  hooks.preUpdateActor = (_actor, changes) => !changes.system?.biography;
  await assert.rejects(executePlan(plan, runtime), /declined/);
  assert.equal(created[0].deleted, true);
});
test("an import whose biography and marks need no change still completes", async () => {
  const { runtime, plan } = await reviewedPlan();
  assert.equal((await executePlan(plan, runtime)).report.status, "complete");
});
test("a declined import report fails the import, and the failure report says why without naming the deleted actor", async () => {
  const { runtime, created, hooks, plan } = await reviewedPlan();
  hooks.preUpdateActor = (_actor, changes) => !changes.flags?.[MODULE_ID]?.report;
  await assert.rejects(executePlan(plan, runtime), (e: any) => {
    assert.match(e.message, /declined/);
    assert.equal(e.importReport.status, "failed"); assert.equal(e.importReport.error, e.message);
    assert.equal(e.importReport.actorUuid, undefined); assert.deepEqual(e.importReport.verifiedStats, []);
    return true;
  });
  assert.equal(created[0].deleted, true);
});
test("a rollback delete that Foundry declines is reported with the actor it left behind", async () => {
  const { runtime, hooks, plan } = await reviewedPlan();
  hooks.preCreateItem = () => false;
  hooks.preDeleteActor = () => false;
  const leftover = `Actor.${plan.actorData._id}`;
  await assert.rejects(executePlan(plan, runtime), (e: any) => {
    assert.equal(e.importReport.cleanupFailures.length, 1); assert(e.importReport.cleanupFailures[0].includes(leftover));
    assert(e.message.includes(`Cleanup could not remove: ${plan.actorData.name} (${leftover})`));
    return true;
  });
});
test("successful import creates classes first and reports every populated source field", async () => {
  const c = character({ extra: "unknown", "experience_name.0": "Scout", "experience_bonus.0": "0" });
  const { runtime, operations } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  const result = await executePlan(plan, runtime);
  assert.equal(operations[0], "class"); assert.equal(result.report.status, "complete");
  assert.equal(Object.fromEntries(result.report.fieldDisposition).extra, "reported");
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

test("companion training marks the checkboxes Foundryborne's companion level-up dialog shows as taken", async () => {
  const c = character({ level: "5" });
  c.companion = { enabled: true, name: "Test companion", evasion: 14, stressMax: 4, stress: 0, attackName: "Bite", damageDice: "d8", damageType: "physical", range: "melee", experiences: [{ name: "Tracking", value: 2 }, { name: "Climbing", value: 2 }], notes: "", training: [{ type: "evasion", data: [] }, { type: "stress", data: [] }, { type: "evasion", data: [] }, { type: "vicious", data: ["damage"] }] };
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(companionCheckboxesTaken(plan.companionData!.system.levelData.levelups), ["vicious #1", "stress #1", "evasion #1", "evasion #2"]);
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
  assert.equal(Object.fromEntries(report.reviewedCharacter.source.fields).name, "Source name");
  assert.equal(Object.fromEntries(report.fieldDisposition).ancestry_name, "reported");
  assert.equal(Object.fromEntries(report.verifiedStats)["system.armorScore.max"], 4);
});

test("the report and source fields saved on the actor match the downloaded report key for key", async () => {
  const c = character({ level: "1", "experience_name.0": "Scout", "experience_bonus.0": "0" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime); plan.reviewed = true;
  const { actor, report } = await executePlan(plan, runtime);
  const downloaded = JSON.parse(JSON.stringify(report, null, 2));
  assert.deepEqual(actor.flags[MODULE_ID].report, downloaded);
  assert.deepEqual(actor.flags[MODULE_ID].sourceFields, downloaded.reviewedCharacter.source.fields);
});

/** A character whose domain cards, named "Card <index>", match compendium cards of the given levels. Other documents are added to the compendium. */
function withCards(fields: Record<string, string>, cardLevels: number[], others: Record<string, any> = {}) {
  const documents: Record<string, any> = { ...others }, candidates: any[] = Object.entries(others).map(([uuid, d]) => ({ uuid, name: d.name, type: d.type, pack: "Test", system: {} }));
  cardLevels.forEach((level, i) => {
    const uuid = `Compendium.test.Item.card${i}`, name = `Card ${i}`;
    fields[`domain_card_name.0.${i}`] = name; fields[`domain_card_domain.0.${i}`] = "sage";
    documents[uuid] = { name, type: "domainCard", system: { domain: "sage", level, type: "ability", recallCost: 0, inVault: true } };
    candidates.push({ uuid, name, type: "domainCard", pack: "Test", system: { domain: "sage" } });
  });
  const c = character(fields);
  return { c, resolutions: resolveEntries(c, candidates), ...mockRuntime(documents) };
}
/** Foundryborne's School of Knowledge, whose feature at each step grants a domain card through its description alone. */
const schoolOfKnowledge = {
  "Compendium.test.Item.knowledge": { name: "Fixture Path", type: "subclass", system: { featureState: 1, features: ["foundation", "specialization", "mastery"].map(type => ({ type, item: `Compendium.test.Item.${type}` })) } },
  ...Object.fromEntries([["foundation", "Prepared"], ["specialization", "Accomplished"], ["mastery", "Brilliant"]].map(([type, name]) => [`Compendium.test.Item.${type}`, { name, type: "feature", system: { description: "<p>Take an additional domain card of your level or lower from a domain you have access to.</p>" } }]))
};
const proficiency = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`proficiency.${i}`, "Yes"]));
function levelFourRogue() {
  return withCards({
    level: "4", agility: "2", strength: "0", finesse: "3", instinct: "1", presence: "2", knowledge: "1", strength_marked: "Yes", presence_marked: "Yes",
    hp_max: "7", stress_max: "6", evasion: "10", "proficiency.1": "Yes",
    "experience_name.0": "Silver Tongued", "experience_bonus.0": "3", "experience_name.1": "Quick Hands", "experience_bonus.1": "3", "experience_name.2": "Tech Savvy", "experience_bonus.2": "2"
  }, [1, 1, 1, 2, 3, 4]);
}
const levelFourTaken = { 2: ["t2 hitPoint #1", "t2 trait #1 strength+presence"], 3: ["t2 domainCard #1", "t2 experience #1 exp0+exp1"], 4: [] };

test("higher-level imports record level-up history that Foundry replays to the PDF's stats", async () => {
  const { c, resolutions, runtime } = levelFourRogue();
  const plan = await buildPlan(c, resolutions, runtime);
  assert(!plan.issues.some(i => i.blocking));
  assert.deepEqual(taken(plan), levelFourTaken);
  const levelups = plan.actorData.system.levelData.levelups;
  const cardName = (x: { uuid: string; itemUuid: string }) => { const s = plan.itemSources.find(s => `Actor.${plan.actorData._id}.Item.${s._id}` === x.itemUuid)!; assert.equal(s._stats.compendiumSource, x.uuid); return s.name; };
  const achieved = (level: number) => ({ ...levelups[level].achievements, domainCards: levelups[level].achievements.domainCards.map(cardName) });
  assert.deepEqual([2, 3, 4].map(achieved), [
    { proficiency: 1, experiences: { exp2: { name: "Tech Savvy", modifier: 2 } }, domainCards: ["Card 3"] },
    { proficiency: 0, experiences: {}, domainCards: ["Card 4"] },
    { proficiency: 0, experiences: {}, domainCards: ["Card 5"] }
  ]);
  const managed = Object.values<any>(levelups).flatMap(r => [...r.achievements.domainCards, ...r.selections.filter((s: any) => s.type === "domainCard").map((s: any) => ({ uuid: s.data[0], itemUuid: s.itemUuid }))]);
  assert.deepEqual(managed.map(cardName).sort(), ["Card 2", "Card 3", "Card 4", "Card 5"]);
  const card = selections(plan).find(s => s.type === "domainCard");
  const item = plan.itemSources.find(s => `Actor.${plan.actorData._id}.Item.${s._id}` === card.itemUuid);
  assert.equal(item?.type, "domainCard");
  assert.deepEqual([card.data, card.secondaryData], [[item._stats.compendiumSource], { limit: "4" }]);
  assert.deepEqual(plan.comparisons, []);
  assert.equal(plan.calculatedStats["system.resources.hitPoints.max"], 7);
  assert.equal(plan.calculatedStats["system.proficiency"], 2);
  const history = plan.issues.find(i => i.code === "level-history");
  assert(history && !history.blocking);
  assert.match(history.message, /Level 2: new experience Tech Savvy \(\+2\), \+1 to strength and presence, \+1 Hit Point \(PDF 7 vs Foundry 6\)\./);
  plan.reviewed = true;
  const { actor, report } = await executePlan(plan, runtime);
  assert.deepEqual(TRAITS.map(t => actor.system.traits[t].value), [2, 0, 3, 1, 2, 1]);
  assert(actor.system.traits.strength.tierMarked && actor.system.traits.presence.tierMarked);
  assert.deepEqual(Object.values<any>(actor.system.experiences).map(e => e.value), [3, 3, 2]);
  assert.equal(report.levelHistory?.unexplainedSlots, 2);
  assert.match(history.message, /Option slots not identified from the PDF: 2\. The matching tier checkboxes stay unmarked, so a later level-up can take them\./);
});

test("with automatic level-up off, the history is recorded and the PDF's final values are stored", async () => {
  const { c, resolutions, runtime } = levelFourRogue();
  runtime.levelupAuto = false;
  const plan = await buildPlan(c, resolutions, runtime);
  assert.deepEqual(taken(plan), levelFourTaken);
  const s = plan.actorData.system;
  assert.deepEqual([s.traits.strength.value, s.traits.presence.value, s.proficiency, ...Object.values<any>(s.experiences).map(e => e.value)], [0, 2, 2, 3, 3, 2]);
  assert.deepEqual(plan.comparisons.map(x => [x.path, x.pdf, x.calculated]), [["system.resources.hitPoints.max", 7, 6]]);
  assert.match(plan.issues.find(i => i.code === "level-history")!.message, /traits, experiences, and Proficiency keep the PDF’s final values, and the stat review decides Hit Points, Stress, and Evasion\./);
});

test("tier 3 history respects each tier's options, checkbox limits, and level slots", async () => {
  const c = character({ level: "6", hp_max: "9", "proficiency.1": "Yes", "proficiency.2": "Yes", "proficiency.3": "Yes", subclass_name_1: "Fixture Path", subclass_class_1: "Fixture Class", subclass_specialization_1: "Yes" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert(!plan.issues.some(i => i.blocking));
  assert.deepEqual(selections(plan).map(s => `t${s.tier} ${s.optionKey} #${s.checkboxNr}`).sort(), ["t2 hitPoint #1", "t2 hitPoint #2", "t3 hitPoint #1", "t3 proficiency #1", "t3 subclass #1"]);
  const levelups = plan.actorData.system.levelData.levelups;
  assert.deepEqual(Object.keys(levelups), ["2", "3", "4", "5", "6"]);
  for (const [level, record] of Object.entries<any>(levelups)) {
    assert(record.selections.reduce((n: number, s: any) => n + s.minCost, 0) <= 2, `level ${level} spends more than its two option slots`);
    for (const s of record.selections) assert(s.level === Number(level) && s.level >= LEVEL_TIERS.find(t => t.tier === s.tier)!.levels.start, `level ${level} holds a tier ${s.tier} option`);
  }
  const sub = plan.itemSources.find(s => s.type === "subclass")!, subclass = selections(plan).find(s => s.type === "subclass");
  assert.deepEqual([subclass.data, subclass.secondaryData], [[`Actor.${plan.actorData._id}.Item.${sub._id}`], { featureState: "2", isMulticlass: "false" }]);
  assert.equal(selections(plan).find(s => s.type === "proficiency").minCost, 2);
  assert.equal(plan.calculatedStats["system.resources.hitPoints.max"], 9);
  assert.equal(plan.calculatedStats["system.proficiency"], 4);
  assert.deepEqual(plan.comparisons, []);
});

test("level-up history follows the tier table of the actor's level-up dialog, including class overrides", async () => {
  const c = character({ level: "3", "proficiency.1": "Yes", "proficiency.2": "Yes" });
  const { runtime } = mockRuntime();
  const preview = runtime.preview;
  runtime.preview = source => {
    const actor = preview(source);
    actor.system.levelupTiers.tiers[2].options.proficiency = { type: "proficiency", checkboxSelections: 1, minCost: 1, value: 1 };
    return actor;
  };
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(selections(plan).filter(s => s.type === "proficiency").map(s => `t${s.tier} level ${s.level} #${s.checkboxNr}`), ["t2 level 2 #1"]);
  assert.equal(plan.calculatedStats["system.proficiency"], 3);
});

test("each Foundry preview receives its own copy of the items, because Foundry's constructor owns its input", async () => {
  const c = character({ armor_name: "Heavy Mail", armor_score: "4", armor_thresholds: "7/15" });
  const { runtime } = mockRuntime();
  const preview = runtime.preview;
  runtime.preview = source => {
    const actor = preview(source);
    if (source.items.some((i: any) => i.type === "armor")) actor.system.evasion -= 1;
    for (const item of source.items) item.type = "consumed";
    return actor;
  };
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.equal(plan.calculatedStats["system.evasion"], 9);
  assert.deepEqual(plan.comparisons.map(x => [x.label, x.pdf, x.calculated]), [["Evasion", 10, 9]]);
});

test("stat picks count only the PDF value above Foundry's calculation, including bonuses from other items", async () => {
  const c = character({ level: "3", evasion: "9", hp_max: "8", "proficiency.1": "Yes", armor_name: "Heavy Mail", armor_score: "4", armor_thresholds: "7/15" });
  const { runtime } = mockRuntime();
  const preview = runtime.preview;
  runtime.preview = source => {
    const actor = preview(source);
    if (source.items?.some((i: any) => i.type === "armor")) actor.system.evasion -= 1;
    if (source.items?.some((i: any) => i.type === "ancestry")) actor.system.resources.hitPoints.max += 1;
    return actor;
  };
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(selections(plan).map(s => s.type), ["hitPoint"]);
  assert.equal(plan.calculatedStats["system.resources.hitPoints.max"], 8);
  assert.equal(plan.calculatedStats["system.evasion"], 9);
  assert.deepEqual(plan.comparisons, []);
  assert.match(plan.issues.find(i => i.code === "level-history")!.message, /Maximum HP: Foundry’s 7 includes \+1 from items other than the class; the PDF’s higher 8 was read as level-up picks/);
});

test("an item penalty is named with its sign when the PDF's stat is above Foundry's", async () => {
  const c = character({ level: "3", evasion: "10", "proficiency.1": "Yes", armor_name: "Heavy Mail", armor_score: "4", armor_thresholds: "7/15" });
  const { runtime } = mockRuntime();
  const preview = runtime.preview;
  runtime.preview = source => {
    const actor = preview(source);
    if (source.items?.some((i: any) => i.type === "armor")) actor.system.evasion -= 1;
    return actor;
  };
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(selections(plan).map(s => s.type), ["evasion"]);
  assert.equal(plan.calculatedStats["system.evasion"], 10);
  const message = plan.issues.find(i => i.code === "level-history")!.message;
  assert.match(message, /Level 2: [^.]*\+1 Evasion \(PDF 10 vs Foundry 9\)\./);
  assert.match(message, /Evasion: Foundry’s 9 includes -1 from items other than the class; the PDF’s higher 10 was read as level-up picks\./);
});

test("two-slot picks are placed before one-slot picks fill the levels they need", async () => {
  for (const [level, profs, cards, expected] of [
    ["6", 4, [1, 1, 2, 3, 4, 5, 6, 6], { 5: ["t3 proficiency #1"], 6: ["t3 domainCard #1", "t3 trait #1 agility+strength"] }],
    ["9", 6, [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9], { 5: ["t3 proficiency #1"], 8: ["t4 proficiency #1"], 9: ["t4 domainCard #1", "t4 trait #1 agility+strength"] }]
  ] as const) {
    const { c, resolutions, runtime } = withCards({ level, agility_marked: "Yes", strength_marked: "Yes", ...proficiency(profs) }, [...cards]);
    const plan = await buildPlan(c, resolutions, runtime);
    assert.deepEqual(Object.fromEntries(Object.entries(taken(plan)).filter(([, choices]) => choices.length)), expected, `level ${level}`);
    assert.deepEqual(plan.levelHistory?.unplaced, [], `level ${level}`);
    assert.equal(plan.calculatedStats["system.proficiency"], profs, `level ${level}`);
  }
});

test("when the first fit leaves a pick out, every pick that fits some legal layout is recorded", async () => {
  const { c, resolutions, runtime } = withCards({
    level: "5", hp_max: "8", stress_max: "8", evasion: "11", ...proficiency(3),
    "experience_name.0": "A", "experience_bonus.0": "3", "experience_name.1": "B", "experience_bonus.1": "3", "experience_name.2": "C", "experience_bonus.2": "2", "experience_name.3": "D", "experience_bonus.3": "2"
  }, [1, 1, 1, 2, 3, 4, 5, 1]);
  const plan = await buildPlan(c, resolutions, runtime);
  assert.deepEqual(plan.levelHistory?.unplaced, []);
  assert.deepEqual(selections(plan).map(s => s.type).sort(), ["domainCard", "domainCard", "evasion", "experience", "hitPoint", "hitPoint", "stress", "stress"]);
  for (const [level, record] of Object.entries<any>(plan.actorData.system.levelData.levelups)) {
    assert(record.selections.reduce((n: number, s: any) => n + s.minCost, 0) <= 2, `level ${level} spends more than its two option slots`);
    for (const s of record.selections) assert(!record.selections.some((x: any) => x.optionKey === s.optionKey && x.tier !== s.tier), `level ${level} holds ${s.optionKey} from two tiers`);
  }
  const boxes = selections(plan).map(s => `t${s.tier} ${s.optionKey} #${s.checkboxNr}`);
  assert.equal(new Set(boxes).size, boxes.length);
  assert.deepEqual(plan.comparisons, []);
});

test("a first fit that stacks both tier-4 trait picks on level 8 is undone, so both experience raises from level 8 on fit", async () => {
  const { c, resolutions, runtime } = withCards({
    level: "9", hp_max: "8", stress_max: "7", evasion: "12", ...proficiency(4), finesse_marked: "Yes", instinct_marked: "Yes", presence_marked: "Yes", knowledge_marked: "Yes",
    subclass_name_1: "Fixture Path", subclass_class_1: "Fixture Class", subclass_specialization_1: "Yes",
    ...Object.fromEntries([5, 3, 2, 2, 4].flatMap((bonus, i) => [[`experience_name.${i}`, `E${i}`], [`experience_bonus.${i}`, String(bonus)]]))
  }, [1, 1, 2, 1, 2, 2, 2, 1, 6, 3, 2, 3]);
  const plan = await buildPlan(c, resolutions, runtime);
  assert.deepEqual(plan.levelHistory?.unplaced, []);
  assert.deepEqual(selections(plan).filter(s => s.type === "trait").map(s => s.level).sort(), [8, 9]);
  assert.deepEqual(plan.comparisons, []);
});

test("marked traits are recorded in the current tier, so Foundry keeps them marked", async () => {
  const c = character({ level: "5", agility: "2", strength: "1", agility_marked: "Yes", strength_marked: "Yes", ...proficiency(3) });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(taken(plan)[5], ["t3 trait #1 agility+strength"]);
  plan.reviewed = true;
  const { actor } = await executePlan(plan, runtime);
  assert.deepEqual([actor.system.traits.agility, actor.system.traits.strength].map(t => [t.value, t.tierMarked]), [[2, true], [1, true]]);
});

test("a multiclass and a subclass upgrade are recorded in different tiers", async () => {
  const c = character({ level: "8", ...proficiency(4), subclass_name_1: "First Path", subclass_class_1: "Fixture Class", subclass_specialization_1: "Yes", subclass_name_2: "Other Path", subclass_class_2: "Other Class" });
  c.entries.find(e => e.name === "Other Class")!.domains = ["sage"];
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const tierOf = (type: string) => selections(plan).filter(s => s.type === type).map(s => s.tier);
  const [multiclass, subclass] = [tierOf("multiclass"), tierOf("subclass")];
  assert.deepEqual([multiclass.length, subclass.length], [1, 1]);
  assert.notEqual(multiclass[0], subclass[0]);
  assert.deepEqual(plan.levelHistory?.unplaced, []);
});

test("a PDF Proficiency below the level's minimum is reported and never stored as a base below 1", async () => {
  const c = character({ level: "3" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.equal(plan.actorData.system.proficiency, 1);
  assert.deepEqual(plan.comparisons.map(x => [x.label, x.pdf, x.calculated]), [["Proficiency", 1, 2]]);
  const issue = plan.issues.find(i => i.code === "proficiency-below-minimum");
  assert(issue && !issue.blocking);
  assert.match(issue.message, /minimum of 2 for level 3/);
});

test("with no Proficiency marked above level 1, the tier achievements are recorded and Foundry's result is proposed", async () => {
  const c = character({ level: "5", "proficiency.0": "" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const levelups = plan.actorData.system.levelData.levelups;
  assert.deepEqual([levelups[2].achievements.proficiency, levelups[5].achievements.proficiency], [1, 1]);
  assert.deepEqual(selections(plan).filter(s => s.type === "proficiency"), []);
  assert.equal(plan.calculatedStats["system.proficiency"], 3);
  assert.match(plan.issues.find(i => i.code === "default-proficiency")!.message, /Proficiency of 3 is proposed/);
  assert(!plan.issues.some(i => i.code === "proficiency-below-minimum"));
});

test("with fewer domain cards than the levels give, the starting cards are never recorded as level-up cards", async () => {
  const { c, resolutions, runtime } = withCards({ level: "4", "proficiency.1": "Yes" }, [1, 1, 2]);
  const plan = await buildPlan(c, resolutions, runtime);
  const recorded = Object.entries<any>(plan.actorData.system.levelData.levelups).flatMap(([level, r]) => r.achievements.domainCards.map((x: any) => `${level}: ${plan.itemSources.find(s => s._stats.compendiumSource === x.uuid)!.name}`));
  assert.deepEqual(recorded, ["4: Card 2"]);
});

test("domain cards from active subclass features are neither level-up picks nor level cards", async () => {
  for (const [level, fields, cards, extraCards, subclassCards] of [
    ["2", {}, [1, 1, 1, 1], [], "Card 3 (Prepared)"],
    ["6", { subclass_specialization_1: "Yes" }, [1, 1, 2, 3, 4, 5, 6, 1, 1], [], "Card 7 (Prepared), Card 8 (Accomplished)"],
    ["6", { subclass_specialization_1: "Yes" }, [1, 1, 2, 3, 4, 5, 6, 1, 1, 1], ["t2 domainCard #1"], "Card 7 (Prepared), Card 8 (Accomplished)"]
  ] as const) {
    const { c, resolutions, runtime } = withCards({ level, subclass_name_1: "Fixture Path", subclass_class_1: "Fixture Class", subclass_foundation_1: "Yes", ...proficiency(Number(level) >= 5 ? 3 : 2), ...fields }, [...cards], schoolOfKnowledge);
    const plan = await buildPlan(c, resolutions, runtime);
    assert(!plan.issues.some(i => i.blocking), `level ${level}`);
    assert.deepEqual(selections(plan).filter(s => s.type === "domainCard").map(s => `t${s.tier} ${s.optionKey} #${s.checkboxNr}`), extraCards, `level ${level}, ${cards.length} cards`);
    const recorded = Object.values<any>(plan.actorData.system.levelData.levelups).flatMap(r => [...r.achievements.domainCards.map((x: any) => x.uuid), ...r.selections.filter((s: any) => s.type === "domainCard").map((s: any) => s.data[0])]);
    for (const name of subclassCards.split(", ").map(x => x.split(" (")[0])) assert(!recorded.includes(plan.itemSources.find(s => s.name === name)!._stats.compendiumSource), `${name} is recorded in the level-up history`);
    assert(plan.issues.find(i => i.code === "level-history")!.message.includes(`Domain cards counted for subclass features, not as level-up picks (which card each feature took is a guess): ${subclassCards}.`), `level ${level}`);
    assert.deepEqual(plan.levelHistory?.unplaced, [], `level ${level}`);
  }
});

test("School of Knowledge's card features are recognized by compendium identity when their description is translated", async () => {
  const srd = (id: string) => `Compendium.daggerheart.subclasses.Item.${id}`;
  const translated = {
    "Compendium.test.Item.knowledge": { name: "Fixture Path", type: "subclass", system: { featureState: 1, features: [{ type: "foundation", item: srd("YS52ZGdce605wNVT") }] } },
    [srd("YS52ZGdce605wNVT")]: { name: "Préparé", type: "feature", system: { description: "<p>Prenez une carte de domaine supplémentaire de votre niveau ou inférieur.</p>" } }
  };
  const { c, resolutions, runtime } = withCards({ level: "2", subclass_name_1: "Fixture Path", subclass_class_1: "Fixture Class", subclass_foundation_1: "Yes", ...proficiency(2) }, [1, 1, 1, 1], translated);
  const plan = await buildPlan(c, resolutions, runtime);
  assert.deepEqual(selections(plan).filter(s => s.type === "domainCard"), []);
  assert.match(plan.issues.find(i => i.code === "level-history")!.message, /not as level-up picks .*: Card 3 \(Préparé\)\./);
});

test("an editable subclass whose PDF text grants a domain card is not read as an extra-card pick", async () => {
  const { c, resolutions, runtime } = withCards({ level: "2", subclass_name_1: "Fixture Path", subclass_class_1: "Fixture Class", subclass_foundation_1: "Yes", subclass_feature_1: "Prepared: Take an additional domain card of your level or lower from a domain you have access to.", ...proficiency(2) }, [1, 1, 1, 1]);
  for (const r of resolutions) if (r.entry.kind === "subclass") r.selected = null;
  const plan = await buildPlan(c, resolutions, runtime);
  assert(!plan.issues.some(i => i.blocking), plan.issues.filter(i => i.blocking).map(i => i.message).join("; "));
  assert.deepEqual(selections(plan).filter(s => s.type === "domainCard"), []);
  assert.match(plan.issues.find(i => i.code === "level-history")!.message, /Card 3 \(Fixture Path feature 1\)/);
});

test("domain cards beyond the starting cards, level cards, and extra-card picks are listed as not recorded", async () => {
  const { c, resolutions, runtime } = withCards({ level: "4", "proficiency.1": "Yes" }, [1, 1, 3, 3, 4, 4]);
  const plan = await buildPlan(c, resolutions, runtime);
  assert.deepEqual(plan.levelHistory?.unplaced, ["domain card Card 5 (no starting, level, or extra-card slot left for it)"]);
  assert.match(plan.issues.find(i => i.code === "level-history")!.message, /These choices from the PDF were not recorded: domain card Card 5 \(no starting, level, or extra-card slot left for it\)\./);
  assert.equal(plan.actorData.flags[MODULE_ID].incompleteHistory, true);
});

test("PDF evidence that cannot be recorded as a level-up choice is listed with its reason", async () => {
  const c = character({ level: "5", ...proficiency(5), "experience_name.0": "Tracking", "experience_bonus.0": "3", "experience_name.1": "Climbing", "experience_bonus.1": "2", "experience_name.2": "Cooking", "experience_bonus.2": "2" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const message = plan.issues.find(i => i.code === "level-history")!.message;
  assert.match(message, /Level 5: 1 new experience missing from the PDF, \+1 Proficiency\./);
  assert.match(message, /These choices from the PDF were not recorded: \+1 to Tracking \(no other raised experience to pair with\), \+1 Proficiency \(no room in the level tiers\)\./);
  assert.equal(plan.actorData.flags[MODULE_ID].incompleteHistory, true);
});

test("level 1 characters have no level-up history, even with a marked trait or extra Hit Points", async () => {
  const c = character({ hp_max: "7", agility_marked: "Yes" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(plan.actorData.system.levelData.levelups, {});
  assert(!plan.issues.some(i => i.code === "level-history"));
  assert.deepEqual(plan.comparisons.map(x => [x.path, x.pdf, x.calculated]), [["system.resources.hitPoints.max", 7, 6]]);
});

test("the downloaded report parses to the report and prints each field pair on one line", async () => {
  const c = character({ "hope.0": "Yes", notes: "a \"quoted\" note\nover two lines" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  const report = makeReport(plan, "test");
  const text = reportJSON(report);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(report)));
  assert.match(text, /\["hope\.0", "Yes"\]/);
  assert.match(text, /\["notes", "a \\"quoted\\" note\\nover two lines"\]/);
});
