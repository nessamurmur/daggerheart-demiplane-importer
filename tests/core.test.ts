import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesFor, checked, escapeHTML, finiteNumber, normalizeName, parseFields, resolveEntries, setPath, validateCharacter } from "../src/core.ts";
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
  assert.equal(c.entries.find(e => e.kind === "domainCard")!.inVault, true);
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
  assert(c.issues.some(i => i.code === "snapshot"));
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
