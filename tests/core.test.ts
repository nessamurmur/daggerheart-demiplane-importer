import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesFor, checked, escapeHTML, finiteNumber, fitCompanionTraining, normalizeName, parseFields, resolveEntries, setPath, sourceOptions, validateCharacter } from "../src/core.ts";
import { character } from "./helpers.ts";

test("zero, negatives, missing values and malformed numbers remain distinct", () => {
  assert.equal(finiteNumber("0"), 0); assert.equal(finiteNumber("-1"), -1);
  for (const value of ["", " ", null, undefined, "{0} / {1}", "NaN", "1d6", false, "1,000"]) assert.equal(finiteNumber(value), null);
  assert.equal(checked("/Yes"), true); assert.equal(checked("Off"), false);
});
test("parses checkbox marks, not parent fields or empty cards", () => {
  const c = character({ "hp.0": "Yes", "hp.1": "Off", "armor_slot.1.0": "Yes", "domain_card_archived.3.2": "Yes", "domain_card_name.0.0": "Test card", "domain_card_recall.0.0": "0", "domain_card_archived.0.0": "Yes" });
  assert.equal(c.resources.hitPoints, 1); assert.equal(c.resources.armor, 1);
  assert.equal(c.entries.filter(e => e.kind === "domainCard").length, 1);
  assert.equal(c.entries.find(e => e.kind === "domainCard")!.recallCost, 0);
  assert.equal(c.entries.find(e => e.kind === "domainCard")!.inVault, false);
});
test("a marked domain card box puts the card in the loadout, and an unmarked card goes to the vault", () => {
  const c = character({ "domain_card_name.0.0": "Kept card", "domain_card_archived.0.0": "Yes", "domain_card_name.0.1": "Vaulted card", "domain_card_archived.0.1": "Off", "domain_card_archived.0.2": "Yes" });
  assert.deepEqual(c.entries.filter(e => e.kind === "domainCard").map(e => [e.name, e.inVault]), [["Kept card", false], ["Vaulted card", true]]);
  assert(!c.issues.some(i => i.code === "loadout-unmarked"));
});
test("a sheet that marks no domain card proposes every card for the loadout and tells the GM", () => {
  const c = character({ "domain_card_name.0.0": "First card", "domain_card_archived.0.0": "Off", "domain_card_name.0.1": "Second card", "domain_card_archived.0.1": "Off", "domain_card_archived.0.2": "Yes" });
  assert.deepEqual(c.entries.filter(e => e.kind === "domainCard").map(e => e.inVault), [false, false]);
  const notice = c.issues.find(i => i.code === "loadout-unmarked");
  assert(notice && !notice.blocking);
});
test("warns on armor placeholders and inventory duplication without guessing quantities", () => {
  const c = character({ armor_name: "Test Armor", armor_thresholds: "{0} / {1}", inventory: "0Teststaff, Test Armor, Unfamiliar token" });
  assert(c.issues.some(i => i.code === "armor-thresholds"));
  assert(c.issues.some(i => i.code === "inventory-prefix"));
  assert.equal(c.entries.filter(e => e.name === "Test Armor").length, 1);
  assert.equal(c.entries.find(e => e.name === "0Teststaff")!.quantity, 1);
});
test("consolidates repeated subclass tiers while preserving a separate multiclass", () => {
  const c = character({ level: "7", subclass_name_1: "Fixture Path", subclass_class_1: "Fixture Class", subclass_foundation_1: "Yes", subclass_name_2: "Fixture Path", subclass_class_2: "Fixture Class", subclass_specialization_2: "Yes", subclass_name_3: "Another Path", subclass_class_3: "Another Class", subclass_foundation_3: "Yes" });
  assert.equal(c.entries.filter(e => e.kind === "subclass").length, 2);
  assert.equal(c.entries.find(e => e.name === "Fixture Path")!.featureState, 2);
  assert.equal(c.entries.find(e => e.name === "Another Class")!.isMulticlass, true);
});
test("requires missing experience bonuses and essential character values", () => {
  const c = character({ level: "", "experience_name.0": "Storyteller", "experience_bonus.0": "" });
  const errors = validateCharacter(c);
  assert(errors.some(i => i.message.includes("level")));
  assert(errors.some(i => i.message.includes("Storyteller")));
  c.level = 1; c.experiences[0].value = 0;
  assert.deepEqual(validateCharacter(c), []);
});
test("matches apostrophes, but leaves duplicate publishers ambiguous", () => {
  assert.equal(normalizeName(" Nature’s Tongue "), normalizeName("Natures Tongue"));
  const c = character({ "domain_card_name.0.0": "Natures Tongue", "domain_card_domain.0.0": "sage" });
  const card = c.entries.find(e => e.kind === "domainCard")!;
  const candidates = [{ uuid: "Compendium.a.Item.1", name: "Nature’s Tongue", type: "domainCard", pack: "SRD", system: { domain: "sage" } }, { uuid: "Compendium.b.Item.2", name: "Nature's Tongue", type: "domainCard", pack: "Purchased", system: { domain: "sage" } }];
  assert.equal(candidatesFor(card, candidates).length, 2);
  assert.equal(resolveEntries(c, candidates).find(r => r.entry.id === card.id)!.selected, undefined);
});
test("an unmatched class, subclass, ancestry or community waits for the GM; other unmatched items stay editable", () => {
  const c = character({ class: "Summoner", subclass_name_1: "Necromancy", subclass_foundation_1: "Yes", ancestry_name: "Inferis", community_name: "Slyborne", "domain_card_name.0.0": "Blood Spike", "domain_card_domain.0.0": "blood", primary_weapon_name: "Small Revolver", inventory: "0Greatstaff" });
  const candidates = [
    { uuid: "Compendium.srd.Item.infernis", name: "Infernis", type: "ancestry", pack: "Ancestries" },
    { uuid: "Compendium.srd.Item.slyborne", name: "Slyborne", type: "community", pack: "Communities" },
    { uuid: "Compendium.srd.Item.greatstaff", name: "Greatstaff", type: "weapon", pack: "Weapons" }
  ];
  const selected = Object.fromEntries(resolveEntries(c, candidates).map(r => [r.entry.name, r.selected]));
  assert.deepEqual(selected, { Summoner: undefined, Necromancy: undefined, Inferis: undefined, Slyborne: "Compendium.srd.Item.slyborne", "Blood Spike": null, "Small Revolver": null, "0Greatstaff": null });
});
test("with no exact match, the source list puts close names first, nearest first, and only of the entry's type", () => {
  const c = character({ ancestry_name: "Inferis" });
  const ancestry = c.entries.find(e => e.kind === "ancestry")!;
  const candidates = [
    { uuid: "Compendium.srd.Item.faerie", name: "Faerie", type: "ancestry", pack: "Ancestries" },
    { uuid: "Compendium.homebrew.Item.inferi", name: "Inferi", type: "ancestry", pack: "Homebrew" },
    { uuid: "Compendium.srd.Item.clank", name: "Clank", type: "ancestry", pack: "Ancestries" },
    { uuid: "Compendium.srd.Item.infernis", name: "Infernis", type: "ancestry", pack: "Ancestries" },
    { uuid: "Compendium.srd.Item.card", name: "Infernis", type: "domainCard", pack: "Domains" }
  ];
  const list = () => sourceOptions(ancestry, candidates).map(o => [o.candidate.name, o.match]);
  assert.deepEqual(list(), [["Infernis", "suggested"], ["Inferi", "suggested"], ["Clank", null], ["Faerie", null]]);
  ancestry.name = "Infernis";
  assert.deepEqual(list(), [["Infernis", "exact"], ["Clank", null], ["Faerie", null], ["Inferi", null]]);
});
test("a suggestion is at most one edit per four letters away", () => {
  const c = character({ community_name: "Seaborne" });
  const community = c.entries.find(e => e.kind === "community")!;
  const candidates = [
    { uuid: "Compendium.srd.Item.warborne", name: "Warborne", type: "community", pack: "Communities" },
    { uuid: "Compendium.srd.Item.slyborne", name: "Slyborne", type: "community", pack: "Communities" }
  ];
  assert.deepEqual(sourceOptions(community, candidates).map(o => [o.candidate.name, o.match]), [["Slyborne", "suggested"], ["Warborne", null]]);
});
test("inventory text is offered close equipment names, and still defaults to an editable item", () => {
  const c = character({ inventory: "0Greatstaff" });
  const loot = c.entries.find(e => e.inventoryText)!;
  const candidates = [
    { uuid: "Compendium.srd.Item.greatstaff", name: "Greatstaff", type: "weapon", pack: "Weapons" },
    { uuid: "Compendium.srd.Item.rations", name: "Rations", type: "loot", pack: "Loot" },
    { uuid: "Compendium.srd.Item.class", name: "Greatstaff", type: "class", pack: "Classes" }
  ];
  assert.deepEqual(sourceOptions(loot, candidates).map(o => [o.candidate.uuid, o.match]), [["Compendium.srd.Item.greatstaff", "suggested"], ["Compendium.srd.Item.rations", null]]);
  assert.equal(resolveEntries(c, candidates).find(r => r.entry.id === loot.id)!.selected, null);
});
test("unknown populated fields are reported and HTML is escaped", () => {
  const c = character({ extra_special_rule: "Something new", notes: "<img src=x onerror=alert(1)>" });
  assert(c.issues.some(i => i.field === "extra_special_rule"));
  assert(c.biography.notes.includes("<img"));
  assert.equal(escapeHTML("<script>"), "&lt;script&gt;");
  assert.throws(() => setPath({}, "__proto__.polluted", true));
});
test("companion training must be complete, bounded, and consistent", () => {
  const c = character({ level: "3" }); c.companion.enabled = true;
  Object.assign(c.companion, { name: "Test Companion", evasion: 12, stressMax: 4, attackName: "Bite", experiences: [{ name: "Scout", value: 2 }, { name: "Guard", value: 2 }], training: [{ type: "evasion", data: [] }, { type: "stress", data: [] }] });
  assert.deepEqual(validateCharacter(c), []);
  c.companion.training[1].type = "";
  assert(validateCharacter(c).some(i => i.message.includes("training option")));
});
test("companion training follows a level change, keeping choices for the levels that remain", () => {
  const c = character({ level: "4" }); c.companion.enabled = true;
  Object.assign(c.companion, { name: "Test Companion", evasion: 12, stressMax: 4, attackName: "Bite", experiences: [{ name: "Scout", value: 2 }, { name: "Guard", value: 2 }], training: [{ type: "evasion", data: [] }, { type: "experience", data: [] }, { type: "creatureComfort", data: [] }] });
  c.level = 3;
  c.companion.training = fitCompanionTraining(c.companion.training, c.level);
  assert.deepEqual(c.companion.training, [{ type: "evasion", data: [] }, { type: "experience", data: [] }]);
  assert.deepEqual(validateCharacter(c), []);
  c.level = 4;
  c.companion.training = fitCompanionTraining(c.companion.training, c.level);
  assert.deepEqual(c.companion.training, [{ type: "evasion", data: [] }, { type: "experience", data: [] }, { type: "", data: [] }]);
  assert.deepEqual(validateCharacter(c).map(i => i.message), ["Choose a valid companion training option for every previous level."]);
  c.level = 1;
  assert.deepEqual(fitCompanionTraining(c.companion.training, c.level), []);
});

test("a blank level asks only for the level, and keeps recorded companion training", () => {
  const c = character({ level: "4" });
  c.companion.enabled = true;
  c.companion.training = [{ type: "evasion", data: [] }, { type: "hope", data: [] }, { type: "stress", data: [] }];
  c.level = null;
  const messages = validateCharacter(c).map(i => i.message);
  assert(messages.some(m => /level/i.test(m) && !/companion/i.test(m)), messages.join(" | "));
  assert(!messages.some(m => /previous companion training/.test(m)), messages.join(" | "));
  assert.equal(c.companion.training.length, 3);
});

const sources = [
  { uuid: "Compendium.test.Item.dagger", name: "Test Dagger", type: "weapon", pack: "Weapons" },
  { uuid: "Compendium.test.Item.staff", name: "Teststaff", type: "weapon", pack: "Weapons" },
  { uuid: "Compendium.test.Item.armor", name: "Test Armor", type: "armor", pack: "Armors" }
];
const selectedFor = (resolutions: ReturnType<typeof resolveEntries>, name: string) => resolutions.find(r => r.entry.name === name)!.selected;
test("refreshing matches keeps the GM's source choices and matches renamed entries again", () => {
  const c = character({ primary_weapon_name: "Test Dagger", armor_name: "Test Armor", inventory: "0Teststaff" });
  const resolutions = resolveEntries(c, sources);
  assert.equal(selectedFor(resolutions, "Test Dagger"), "Compendium.test.Item.dagger");
  assert.equal(selectedFor(resolutions, "0Teststaff"), null);
  for (const r of resolutions.filter(r => ["Test Dagger", "Test Armor"].includes(r.entry.name))) Object.assign(r, { selected: null, chosenFor: r.entry.name });
  c.entries.find(e => e.name === "0Teststaff")!.name = "Teststaff";
  c.entries.find(e => e.name === "Test Armor")!.name = "Test armor";
  const refreshed = resolveEntries(c, sources, resolutions);
  assert.equal(selectedFor(refreshed, "Test Dagger"), null);
  assert.equal(selectedFor(refreshed, "Teststaff"), "Compendium.test.Item.staff");
  assert.equal(selectedFor(refreshed, "Test armor"), "Compendium.test.Item.armor");
});
test("an excluded entry keeps its source, so including it again restores it", () => {
  const c = character({ primary_weapon_name: "Test Dagger", armor_name: "Test Armor" });
  c.entries.find(e => e.name === "Test Armor")!.include = false;
  const resolutions = resolveEntries(c, sources);
  assert.equal(selectedFor(resolutions, "Test Armor"), "Compendium.test.Item.armor");
  Object.assign(resolutions.find(r => r.entry.name === "Test Dagger")!, { selected: null, chosenFor: "Test Dagger" });
  c.entries.find(e => e.name === "Test Dagger")!.include = false;
  const refreshed = resolveEntries(c, sources, resolutions);
  assert.equal(selectedFor(refreshed, "Test Dagger"), null);
  assert.equal(selectedFor(refreshed, "Test Armor"), "Compendium.test.Item.armor");
});
