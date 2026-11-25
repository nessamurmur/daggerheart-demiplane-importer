import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { makeReport, reportJSON, adjustmentEffects } from "../src/importer.ts";
import { parseFields } from "../src/core.ts";
import { MODULE_ID, type Fields } from "../src/types.ts";
import { check } from "./check.ts";
import { planFor, sheet } from "./fixtures.ts";

test("every non-blank field is imported or reported exactly once", async () => {
  const mystery = parseFields({ name: "Fixture", mystery: "kept", level: "nope" });
  const disposition = Object.fromEntries(makeReport(planFor(mystery, { issues: mystery.issues }), "0.1.2").fieldDisposition);
  assert.equal(disposition.mystery, "reported");
  assert.equal(disposition.name, "imported");
  assert.equal(disposition.level, "reported");

  const value = fc.oneof(fc.string({ unit: "grapheme-ascii", maxLength: 16 }), fc.integer({ min: 0, max: 5 }), fc.boolean(), fc.constant(null), fc.constant(""));
  const key = fc.constantFrom("name", "level", "agility", "notes", "mystery", "experience_name.0", "experience_bonus.0");
  await check(fc.property(fc.dictionary(key, value, { maxKeys: 8, noNullPrototype: true }), fields => {
    const character = parseFields(fields as Fields, "gen.pdf", "fp");
    const plan = planFor(character, { issues: character.issues });
    const report = makeReport(plan, "0.1.2");
    const recorded = Object.fromEntries(report.fieldDisposition);
    assert.equal(report.fieldDisposition.length, Object.keys(recorded).length);
    for (const [field, raw] of Object.entries(fields)) {
      const blank = raw === null || String(raw).trim() === "";
      if (blank) assert.equal(recorded[field], undefined, field);
      else {
        const expected = character.source.handled.includes(field) && !plan.issues.some(issue => issue.field === field) ? "imported" : "reported";
        assert.equal(recorded[field], expected, field);
      }
    }
  }), 40);
});

test("reportJSON parses back to the report and keeps each field pair on one line", () => {
  const character = parseFields(sheet({ mystery: "kept", "experience_name.0": "Scout", "experience_bonus.0": "0" }), "fixture.pdf", "fp");
  const report = makeReport(planFor(character, { issues: character.issues }), "0.1.2");
  const text = reportJSON(report);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(report)));
  for (const [field, value] of report.reviewedCharacter.source.fields) {
    if (value !== null && typeof value !== "object") assert.ok(text.includes(`[${JSON.stringify(field)}, ${JSON.stringify(value)}]`), field);
  }
  assert.match(text, /\["name", "Fixture"\]/);
  assert.doesNotMatch(text, /\["name",\n/);
});

test("PDF stat adjustments use the signed difference and skip a Foundry choice", async () => {
  await check(fc.property(fc.integer({ min: -3, max: 20 }), fc.integer({ min: -3, max: 20 }), (pdf, calculated) => {
    const evasion = adjustmentEffects([{ path: "system.evasion", label: "Evasion", pdf, calculated, choice: "pdf" }], () => "id");
    assert.equal(evasion.length, 1);
    assert.equal(evasion[0].system.changes[0].value, pdf - calculated);
    assert.equal(evasion[0].flags[MODULE_ID].adjustment.pdf, pdf);
    const armor = adjustmentEffects([{ path: "system.armorScore.max", label: "Armor", pdf, calculated, choice: "pdf" }], () => "id");
    assert.equal(armor[0].system.changes[0].value.max, String(pdf - calculated));
    assert.equal(adjustmentEffects([{ path: "system.evasion", label: "Evasion", pdf, calculated, choice: "foundry" }], () => "id").length, 0);
    assert.equal(adjustmentEffects([{ path: "system.evasion", label: "Evasion", pdf, calculated, choice: null }], () => "id").length, 0);
  }), 30);
});
