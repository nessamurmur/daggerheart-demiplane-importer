import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { escapeHTML, finiteNumber, fitCompanionTraining, normalizeName, paragraphs, parseFields, parseWeapon, setPath, getPath, validateCharacter } from "../src/core.ts";
import { TRAITS } from "../src/types.ts";
import { check } from "./check.ts";
import { characterFrom, sheet } from "./fixtures.ts";

const ascii = { unit: "grapheme-ascii" as const, maxLength: 24 };
const populated = (value: unknown) => value !== null && value !== false && value !== "" && value !== "/Off" && String(value).trim() !== "";

test("populated PDF fields are handled or reported, and the source fields are a clone", async () => {
  const value = fc.oneof(fc.string(ascii), fc.integer({ min: -20, max: 40 }), fc.boolean(), fc.constant(null), fc.constant(""), fc.constant("/Off"), fc.constant("Yes"), fc.constant("0"));
  const key = fc.oneof(
    fc.constantFrom("name", "level", "agility", "inventory", "armor_thresholds", "experience_name.0", "experience_bonus.0", "domain_card_name.0.0", "hp.0", "notes", "class"),
    fc.string({ unit: "grapheme-ascii", minLength: 1, maxLength: 14 }).map(text => text.replace(/[^a-z0-9_]/gi, "x") || "field"),
  );
  await check(fc.property(fc.dictionary(key, value, { maxKeys: 12, noNullPrototype: true }), fields => {
    const input = fields;
    const before = structuredClone(input);
    const character = parseFields(input, "gen.pdf", "fp");
    assert.deepEqual(input, before);
    assert.deepEqual(character.source.fields, input);
    character.source.fields.probe = "mutated";
    assert.equal(Object.hasOwn(input, "probe"), false);
    for (const handled of character.source.handled) assert.ok(handled in input, handled);
    for (const [field, raw] of Object.entries(input)) {
      if (!populated(raw)) continue;
      const handled = character.source.handled.includes(field);
      const reported = character.issues.some(issue => issue.code === "unmapped-field" && issue.field === field);
      assert.ok(handled || reported, `${field}=${JSON.stringify(raw)} was neither handled nor reported`);
    }
  }), 80);
});

test("blank numbers stay unknown and zero stays zero", async () => {
  await check(fc.property(
    fc.oneof(fc.constant(null), fc.constant(undefined), fc.boolean(), fc.stringMatching(/^\s{0,4}$/)),
    blank => { assert.equal(finiteNumber(blank), null); },
  ), 40);
  const decimal = fc.tuple(
    fc.constantFrom("", "+", "-"),
    fc.integer({ min: 0, max: 4000 }),
    fc.option(fc.integer({ min: 0, max: 99 }), { nil: null }),
  ).map(([sign, whole, fraction]) => `${sign}${whole}${fraction === null ? "" : `.${fraction}`}`);
  await check(fc.property(decimal, spelling => { assert.equal(finiteNumber(spelling), Number(spelling)); }), 40);
  await check(fc.property(fc.integer({ min: -100_000, max: 100_000 }), number => { assert.equal(finiteNumber(number), number); }), 20);
  for (const rejected of ["1e2", "0x10", "NaN", "Infinity", "1d6", "1,000", "1.2.3", "+", "--1"]) assert.equal(finiteNumber(rejected), null, rejected);
  assert.equal(finiteNumber(" 0 "), 0);
  assert.equal(finiteNumber(0), 0);
  assert.equal(finiteNumber("0"), 0);
  await check(fc.property(
    fc.constantFrom(...TRAITS),
    fc.oneof(fc.constant(""), fc.constant(" "), fc.constant("0"), fc.constant(0), fc.constant(null), fc.constant("-1"), fc.constant("nope"), fc.constant("1e2")),
    (trait, raw) => { assert.equal(parseFields({ [trait]: raw as never }).traits[trait], finiteNumber(raw)); },
  ), 30);
});

test("escapeHTML leaves no raw markup and paragraphs are escaped text in p tags", async () => {
  const text = fc.string({ ...ascii, maxLength: 60 });
  await check(fc.property(text, value => {
    const escaped = escapeHTML(value);
    for (const [character, entity] of [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]] as const) {
      assert.equal(count(escaped, entity), count(value, character), character);
    }
    const html = paragraphs(value);
    const stripped = html.replaceAll("<p>", "").replaceAll("</p>", "").replaceAll("<br>", "");
    assert.equal(/[<>]/.test(stripped), false, html);
    const expected = value.trim() ? value.split(/\n\s*\n/).map(part => `<p>${escapeHTML(part).replace(/\n/g, "<br>")}</p>`).join("") : "";
    assert.equal(html, expected);
  }), 60);
});

test("setPath round-trips a safe path and rejects prototype paths", async () => {
  const segment = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);
  await check(fc.property(
    fc.array(segment, { minLength: 1, maxLength: 4 }),
    fc.oneof(fc.integer({ min: -5, max: 5 }), fc.string({ maxLength: 8, unit: "grapheme-ascii" }), fc.boolean(), fc.constant(null)),
    (segments, value) => {
      const object: Record<string, unknown> = {};
      const path = segments.join(".");
      setPath(object, path, value);
      assert.equal(getPath(object, path), value);
    },
  ), 40);
  const marker = "dpiFvPolluted";
  try {
    await check(fc.property(fc.constantFrom("__proto__", "constructor", "prototype"), fc.constantFrom(marker, `a.${marker}`, `a.${marker}.b`), (bad, rest) => {
      const object = { safe: 1 };
      const before = structuredClone(object);
      const path = rest.startsWith("a.") ? `${rest.split(".")[0]}.${bad}.${rest.split(".").slice(1).join(".")}` : `${bad}.${rest}`;
      assert.throws(() => setPath(object, path, true), /Invalid property path/);
      assert.throws(() => setPath({}, bad, { [marker]: true }), /Invalid property path/);
      assert.deepEqual(object, before);
      assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, marker), undefined);
    }), 12);
  } finally {
    delete (Object.prototype as Record<string, unknown>)[marker];
  }
});

test("a weapon damage expression keeps its die, signed bonus, and physical or magical type", async () => {
  await check(fc.property(
    fc.integer({ min: 1, max: 12 }),
    fc.constantFrom(4, 6, 8, 10, 12, 20),
    fc.integer({ min: -5, max: 9 }),
    fc.constantFrom("physical", "magical", "magic", "Physical"),
    fc.constantFrom("Agility Close", "Strength Melee", "Finesse Very Far"),
    (diceCount, faces, bonus, kind, traitAndRange) => {
      const signed = bonus === 0 ? "" : bonus > 0 ? `+${bonus}` : String(bonus);
      const parsed = parseWeapon(traitAndRange, `${diceCount}d${faces}${signed} ${kind}`);
      assert.equal(parsed.dice, `d${faces}`);
      assert.equal(parsed.damageBonus, bonus);
      assert.equal(parsed.damageType, kind.toLowerCase() === "physical" ? "physical" : "magical");
      assert.equal(parsed.trait, traitAndRange.split(" ")[0].toLowerCase());
    },
  ), 40);
  assert.equal(parseWeapon("Agility Close", "not dice").dice, undefined);
});

test("domain cards with no loadout mark are all proposed for the loadout", async () => {
  const name = fc.array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"), { minLength: 1, maxLength: 8 }).map(letters => letters.join(""));
  await check(fc.property(fc.array(fc.record({ name, archived: fc.boolean() }), { minLength: 1, maxLength: 4 }), cards => {
    const fields: Record<string, string> = {};
    cards.forEach((card, index) => {
      fields[`domain_card_name.0.${index}`] = card.name;
      fields[`domain_card_archived.0.${index}`] = card.archived ? "Yes" : "Off";
    });
    const parsed = parseFields(fields);
    const got = parsed.entries.filter(entry => entry.kind === "domainCard");
    assert.equal(got.length, cards.length);
    if (cards.every(card => !card.archived)) {
      assert.ok(got.every(entry => entry.inVault === false));
      assert.equal(parsed.issues.filter(issue => issue.code === "loadout-unmarked").length, 1);
    } else {
      assert.equal(parsed.issues.some(issue => issue.code === "loadout-unmarked"), false);
      got.forEach((entry, index) => assert.equal(entry.inVault, !cards[index].archived));
    }
  }), 40);
});

test("normalizeName folds case and drops apostrophes", async () => {
  await check(fc.property(fc.string({ unit: "grapheme", maxLength: 24 }), value => {
    assert.equal(normalizeName(normalizeName(value)), normalizeName(value));
    assert.equal(normalizeName(value), normalizeName(value.toLowerCase()));
    assert.equal(normalizeName(value), normalizeName(value.replace(/[’'`]/g, "")));
    assert.doesNotMatch(normalizeName(value), /[A-Z’'`]/);
  }), 40);
  assert.equal(normalizeName("O'Brien"), normalizeName("OBrien"));
  assert.equal(normalizeName("Agility"), normalizeName("agility"));
  assert.equal(normalizeName("e\u0301"), normalizeName("\u00e9"));
});

test("checked recognizes only the Demiplane on-values", async () => {
  const { checked } = await import("../src/core.ts");
  await check(fc.property(fc.string({ ...ascii, maxLength: 12 }), value => {
    assert.equal(checked(value), /^(\/?yes|on|true|1)$/i.test(value));
  }), 40);
  for (const on of [true, 1, "yes", "/Yes", "ON", "true"]) assert.equal(checked(on), true, String(on));
  for (const off of [false, 0, 2, "no", "Off", "", null, undefined, "yes "]) assert.equal(checked(off), false, String(off));
});

test("companion training length follows the level and keeps the choices that remain", async () => {
  const choice = fc.record({ type: fc.constantFrom("experience", "hope", ""), data: fc.array(fc.constantFrom("damage", "range"), { maxLength: 1 }) });
  await check(fc.property(fc.integer({ min: -2, max: 12 }), fc.array(choice, { maxLength: 8 }), (level, training) => {
    const stored = level < 0 ? null : level;
    const before = JSON.stringify(training);
    const fitted = fitCompanionTraining(training, stored);
    assert.equal(JSON.stringify(training), before);
    assert.equal(fitted.length, Math.max(0, (stored ?? 1) - 1));
    fitted.forEach((item, index) => assert.deepEqual(item, training[index] ?? { type: "", data: [] }));
  }), 40);
});

test("a zero trait validates and a blank trait does not", () => {
  const valid = characterFrom();
  assert.deepEqual(validateCharacter(valid).map(issue => issue.message), []);
  const before = structuredClone(valid);
  validateCharacter(valid);
  assert.deepEqual(valid, before);

  for (const trait of TRAITS) {
    const zeroed = characterFrom();
    zeroed.traits[trait] = 0;
    assert.equal(validateCharacter(zeroed).some(issue => issue.message.includes(trait)), false, trait);
    const blank = characterFrom();
    blank.traits[trait] = null;
    const issues = validateCharacter(blank);
    assert.ok(issues.some(issue => issue.blocking && issue.message.includes(trait)), trait);
  }
  for (const level of [null, 0, 11, 1.5]) {
    const character = characterFrom();
    character.level = level as never;
    assert.ok(validateCharacter(character).some(issue => issue.blocking && /level/i.test(issue.message)), String(level));
  }
  for (const level of [1, 10]) {
    const character = characterFrom();
    character.level = level;
    assert.equal(validateCharacter(character).some(issue => /level/i.test(issue.message)), false, String(level));
  }
  const unnamed = characterFrom();
  unnamed.name = "  ";
  assert.ok(validateCharacter(unnamed).some(issue => issue.blocking && /name/i.test(issue.message)));
  const blankStat = characterFrom();
  blankStat.stats.evasion = null;
  assert.equal(validateCharacter(blankStat).some(issue => issue.message.includes("evasion")), false);
  const negativeStat = characterFrom();
  negativeStat.stats.evasion = -1;
  assert.ok(validateCharacter(negativeStat).some(issue => issue.message.includes("evasion")));
  assert.deepEqual(sheet().strength, "0");
});

function count(haystack: string, needle: string): number {
  let found = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    found++;
    from = at + needle.length;
  }
  return found;
}
