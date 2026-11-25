import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { candidatesFor, normalizeName, resolveEntries } from "../src/core.ts";
import type { Candidate, Entry, ItemKind, Resolution } from "../src/types.ts";
import { check } from "./check.ts";
import { candidate, characterFrom, entry } from "./fixtures.ts";

/** Unmatched identity items wait for the GM. Every other unmatched item stays an editable PDF item. */
const IDENTITY = new Set<ItemKind>(["class", "subclass", "ancestry", "community"]);
const NAMES = ["Alpha", "Beta", "Gamma", "O'Brien"] as const;
const KINDS = ["class", "subclass", "ancestry", "community", "loot", "weapon", "feature", "domainCard"] as const;

test("candidatesFor returns only exact name and kind matches, in pack then uuid order", async () => {
  const row = fc.record({
    name: fc.constantFrom(...NAMES, "alpha", "ALPHA"),
    type: fc.constantFrom(...KINDS),
    pack: fc.constantFrom("A", "B", "World items"),
    domain: fc.constantFrom("", "sage", "arcana"),
    trait: fc.constantFrom("", "agility", "strength"),
    linkedClass: fc.constantFrom("", "class-0"),
  });
  await check(fc.property(
    fc.record({
      name: fc.constantFrom(...NAMES),
      kind: fc.constantFrom(...KINDS),
      inventoryText: fc.boolean(),
      domain: fc.constantFrom("", "sage"),
      trait: fc.constantFrom("", "agility"),
    }),
    fc.array(row, { maxLength: 6 }),
    (wanted, rows) => {
      const subject = entry({
        id: "e0", kind: wanted.kind, name: wanted.name, inventoryText: wanted.inventoryText,
        ...(wanted.domain ? { domain: wanted.domain } : {}),
        ...(wanted.trait ? { trait: wanted.trait } : {}),
      });
      const candidates = rows.map((item, index) => candidate({
        uuid: `c${index}`, name: item.name, type: item.type, pack: item.pack,
        system: { ...(item.domain ? { domain: item.domain } : {}), ...(item.trait ? { attack: { roll: { trait: item.trait } } } : {}), ...(item.linkedClass ? { linkedClass: item.linkedClass } : {}) },
      }));
      const matches = candidatesFor(subject, candidates);
      const kinds = subject.inventoryText ? ["weapon", "armor", "loot", "consumable"] : [subject.kind];
      for (const match of matches) {
        assert.ok(candidates.includes(match));
        assert.equal(normalizeName(match.name), normalizeName(subject.name));
        assert.ok(kinds.includes(match.type), match.type);
      }
      const sorted = [...matches].sort((a, b) => a.pack.localeCompare(b.pack) || a.uuid.localeCompare(b.uuid));
      assert.deepEqual(matches.map(match => match.uuid), sorted.map(match => match.uuid));
      if (subject.domain) {
        const sameName = candidates.filter(item => kinds.includes(item.type) && normalizeName(item.name) === normalizeName(subject.name));
        const agreeing = sameName.filter(item => !item.system?.domain || normalizeName(String(item.system.domain)) === normalizeName(subject.domain!));
        if (agreeing.length) for (const match of matches) assert.ok(!match.system?.domain || normalizeName(String(match.system.domain)) === normalizeName(subject.domain!));
        else assert.deepEqual(matches, [...sameName].sort((a, b) => a.pack.localeCompare(b.pack) || a.uuid.localeCompare(b.uuid)));
      }
    },
  ), 50);

  const rope = entry({ id: "1", kind: "loot", name: "O'Brien", inventoryText: true });
  const matches = candidatesFor(rope, [
    candidate({ uuid: "weapon", name: "Obrien", type: "weapon" }),
    candidate({ uuid: "class", name: "O'Brien", type: "class" }),
    candidate({ uuid: "other", name: "Other", type: "loot" }),
  ]);
  assert.deepEqual(matches.map(match => match.uuid), ["weapon"]);
  assert.deepEqual(candidatesFor(entry({ id: "2", kind: "loot", name: "Alpha" }), [candidate({ uuid: "a", name: "alpha", type: "loot" })]).map(match => match.uuid), ["a"]);
});

test("resolveEntries waits on an identity item, keeps a single match, and preserves the GM's choice", async () => {
  const shape = fc.record({
    kind: fc.constantFrom(...KINDS),
    name: fc.constantFrom(...NAMES),
    className: fc.constantFrom("", ...NAMES),
  });
  await check(fc.property(
    fc.array(shape, { maxLength: 4 }),
    fc.array(fc.record({ name: fc.constantFrom(...NAMES), type: fc.constantFrom(...KINDS), linkedClass: fc.constantFrom("", "c0") }), { maxLength: 5 }),
    fc.boolean(),
    (shapes, rows, keepFirst) => {
      const entries = shapes.map((shape, index) => entry({ id: `e${index}`, kind: shape.kind, name: shape.name, ...(shape.className ? { className: shape.className } : {}) }));
      const candidates: Candidate[] = rows.map((row, index) => candidate({ uuid: `c${index}`, name: row.name, type: row.type, system: row.linkedClass ? { linkedClass: row.linkedClass } : {} }));
      const previous: Resolution[] = keepFirst && entries[0] ? [{ entry: entries[0], candidates: [], selected: "gm-choice", chosenFor: entries[0].name }] : [];
      const character = characterFrom();
      character.entries = entries;
      const resolutions = resolveEntries(character, candidates, previous);
      assert.equal(resolutions.length, entries.length);
      resolutions.forEach((resolution, index) => {
        const item = entries[index];
        assert.equal(resolution.entry, item);
        if (previous[0] && item.id === previous[0].entry.id) {
          assert.equal(resolution.selected, "gm-choice");
          assert.deepEqual(resolution.candidates, []);
          return;
        }
        assert.deepEqual(resolution.candidates, narrowed(item, candidates));
        if (resolution.candidates.length === 1) assert.equal(resolution.selected, resolution.candidates[0].uuid);
        else if (resolution.candidates.length > 1) assert.equal(resolution.selected, undefined);
        else if (IDENTITY.has(item.kind)) assert.equal(resolution.selected, undefined);
        else assert.equal(resolution.selected, null);
      });
    },
  ), 40);

  const missingClass = entry({ id: "class", kind: "class", name: "Missing Class" });
  const missingLoot = entry({ id: "loot", kind: "loot", name: "Missing Token" });
  const character = characterFrom();
  character.entries = [missingClass, missingLoot];
  const [classResolution, lootResolution] = resolveEntries(character, []);
  assert.equal(classResolution.selected, undefined);
  assert.equal(lootResolution.selected, null);

  const twin = entry({ id: "twin", kind: "loot", name: "Rope" });
  character.entries = [twin];
  const ambiguous = resolveEntries(character, [candidate({ uuid: "a", name: "Rope", type: "loot", pack: "A" }), candidate({ uuid: "b", name: "Rope", type: "loot", pack: "B" })]);
  assert.equal(ambiguous[0].selected, undefined);
  assert.equal(ambiguous[0].candidates.length, 2);

  const kept = entry({ id: "kept", kind: "class", name: "Fixture Class" });
  character.entries = [kept];
  const choice = resolveEntries(character, [], [{ entry: kept, candidates: [candidate({ uuid: "old", name: "Other", type: "class" })], selected: "old", chosenFor: "Fixture Class" }]);
  assert.equal(choice[0].selected, "old");
});

function narrowed(item: Entry, candidates: Candidate[]): Candidate[] {
  const base = candidatesFor(item, candidates);
  if (item.kind === "subclass" && item.className) {
    const classUuids = candidates.filter(option => option.type === "class" && normalizeName(option.name) === normalizeName(item.className!)).map(option => option.uuid);
    const linked = base.filter(option => classUuids.includes(String(option.system?.linkedClass ?? "")));
    if (linked.length) return linked;
  }
  return base;
}
