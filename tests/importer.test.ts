import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustmentEffects, buildPlan, executePlan, foundryRuntime, loadCatalog, makeReport, sanitizeSource } from "../src/importer.ts";
import { resolveEntries } from "../src/core.ts";
import { MODULE_ID, TRAITS } from "../src/types.ts";
import { character, LEVEL_TIERS, mockRuntime } from "./helpers.ts";

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

function levelFourRogue() {
  const fields: Record<string, string> = {
    level: "4", agility: "2", strength: "0", finesse: "3", instinct: "1", presence: "2", knowledge: "1", strength_marked: "Yes", presence_marked: "Yes",
    hp_max: "7", stress_max: "6", evasion: "10", "proficiency.1": "Yes",
    "experience_name.0": "Silver Tongued", "experience_bonus.0": "3", "experience_name.1": "Quick Hands", "experience_bonus.1": "3", "experience_name.2": "Tech Savvy", "experience_bonus.2": "2"
  };
  const documents: Record<string, any> = {}, candidates: any[] = [];
  [1, 1, 1, 2, 3, 4].forEach((level, i) => {
    const uuid = `Compendium.test.Item.card${i}`, name = `Card ${i}`;
    fields[`domain_card_name.0.${i}`] = name; fields[`domain_card_domain.0.${i}`] = "sage";
    documents[uuid] = { name, type: "domainCard", system: { domain: "sage", level, type: "ability", recallCost: 0, inVault: true } };
    candidates.push({ uuid, name, type: "domainCard", pack: "Test", system: { domain: "sage" } });
  });
  const c = character(fields);
  return { c, resolutions: resolveEntries(c, candidates), ...mockRuntime(documents) };
}
const levelFourTaken = { 2: ["t2 hitPoint #1", "t2 trait #1 strength+presence"], 3: ["t2 domainCard #1", "t2 experience #1 exp0+exp1"], 4: [] };

test("higher-level imports record level-up history that Foundry replays to the PDF's stats", async () => {
  const { c, resolutions, runtime } = levelFourRogue();
  const plan = await buildPlan(c, resolutions, runtime);
  assert(!plan.issues.some(i => i.blocking));
  assert.deepEqual(taken(plan), levelFourTaken);
  const levelups = plan.actorData.system.levelData.levelups, none = { proficiency: 0, experiences: {}, domainCards: [] };
  assert.deepEqual(levelups[2].achievements, { proficiency: 1, experiences: { exp2: { name: "Tech Savvy", modifier: 2 } }, domainCards: [] });
  assert.deepEqual([levelups[3].achievements, levelups[4].achievements], [none, none]);
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
});

test("with automatic level-up off, the history is recorded and the PDF's final values are stored", async () => {
  const { c, resolutions, runtime } = levelFourRogue();
  runtime.levelupAuto = false;
  const plan = await buildPlan(c, resolutions, runtime);
  assert.deepEqual(taken(plan), levelFourTaken);
  const s = plan.actorData.system;
  assert.deepEqual([s.traits.strength.value, s.traits.presence.value, s.proficiency, ...Object.values<any>(s.experiences).map(e => e.value)], [0, 2, 2, 3, 3, 2]);
  assert.deepEqual(plan.comparisons.map(x => [x.path, x.pdf, x.calculated]), [["system.resources.hitPoints.max", 7, 6]]);
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

test("no Hit Point, Stress, or Evasion picks are inferred for a stat that other items change in Foundry", async () => {
  const c = character({ level: "3", evasion: "10", hp_max: "7", "proficiency.1": "Yes", armor_name: "Heavy Mail", armor_score: "4", armor_thresholds: "7/15" });
  const { runtime } = mockRuntime();
  const preview = runtime.preview;
  runtime.preview = source => {
    const actor = preview(source);
    if (source.items?.some((i: any) => i.type === "armor")) actor.system.evasion -= 1;
    return actor;
  };
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(selections(plan).map(s => s.type), ["hitPoint"]);
  assert.equal(plan.calculatedStats["system.resources.hitPoints.max"], 7);
  assert.deepEqual(plan.comparisons.map(x => [x.label, x.pdf, x.calculated]), [["Evasion", 10, 9]]);
  assert.match(plan.issues.find(i => i.code === "level-history")!.message, /Evasion: other items change it in Foundry \(class 10, with items 9\)/);
});

test("level 1 characters have no level-up history, even with a marked trait or extra Hit Points", async () => {
  const c = character({ hp_max: "7", agility_marked: "Yes" });
  const { runtime } = mockRuntime();
  const plan = await buildPlan(c, resolveEntries(c, []), runtime);
  assert.deepEqual(plan.actorData.system.levelData.levelups, {});
  assert(!plan.issues.some(i => i.code === "level-history"));
  assert.deepEqual(plan.comparisons.map(x => [x.path, x.pdf, x.calculated]), [["system.resources.hitPoints.max", 7, 6]]);
});
