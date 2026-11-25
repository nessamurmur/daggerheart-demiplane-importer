import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { inferLevelups, type LevelupEvidence } from "../src/levelups.ts";
import type { LevelupHistory } from "../src/types.ts";
import { LEVEL_TIERS } from "../tests/helpers.ts";
import { check } from "./check.ts";

/** Foundryborne 2.10.2's default tier table, as recorded in tests/helpers.ts. The check does not open Foundry. */
const evidence = (partial: Partial<LevelupEvidence> & Pick<LevelupEvidence, "level">): LevelupEvidence => ({
  tiers: structuredClone(LEVEL_TIERS), markedTraits: [], experiences: [], stats: {}, proficiency: null,
  domainCards: [], cardFeatures: [], subclasses: [], multiclass: null, ...partial,
});

const recordedCards = (history: LevelupHistory): string[] => Object.values(history.levelups).flatMap(record => [
  ...record.achievements.domainCards.map(card => card.uuid),
  ...record.selections.filter(selection => selection.type === "domainCard").flatMap(selection => selection.data),
]);

test("level 1 records no level-up history", () => {
  const history = inferLevelups(evidence({
    level: 1, markedTraits: ["agility"], proficiency: 3,
    stats: { hitPoint: { pdf: 8, foundry: 6 } },
    domainCards: [{ name: "High", uuid: "high", itemUuid: "item", level: 2 }],
    cardFeatures: ["Prepared"],
  }));
  assert.deepEqual(history, { levelups: {}, bonuses: { traits: {}, proficiency: 0, experiences: {} }, summary: [], unexplainedSlots: 0, unplaced: [], subclassCards: [] });
});

test("level-up selections stay inside the tier's checkbox count and free slots", () => {
  const history = inferLevelups(evidence({ level: 4, stats: { hitPoint: { pdf: 10, foundry: 6 } } }));
  const hitPoints = Object.values(history.levelups).flatMap(record => record.selections).filter(selection => selection.type === "hitPoint");
  assert.ok(hitPoints.reduce((sum, selection) => sum + selection.minCost, 0) <= 2, JSON.stringify(hitPoints));
  assertBudget(evidence({ level: 4, stats: { hitPoint: { pdf: 10, foundry: 6 } } }), history);
});

test("a domain card is recorded at most once, and not below its level", () => {
  const cards = [
    { name: "One", uuid: "u1", itemUuid: "i1", level: 1 },
    { name: "Two", uuid: "u2", itemUuid: "i2", level: 1 },
    { name: "Three", uuid: "u3", itemUuid: "i3", level: 1 },
  ];
  const input = evidence({ level: 3, domainCards: cards });
  const history = inferLevelups(input);
  const used = recordedCards(history);
  assert.equal(new Set(used).size, used.length, used.join(","));
  for (const uuid of used) assert.ok(cards.some(card => card.uuid === uuid));
  const tooHigh = inferLevelups(evidence({ level: 3, domainCards: [{ name: "High", uuid: "high", itemUuid: "item", level: 5 }] }));
  assert.equal(recordedCards(tooHigh).includes("high"), false);
});

test("subclass and multiclass are not both taken in one tier", () => {
  const history = inferLevelups(evidence({
    level: 6,
    subclasses: [{ name: "Path", uuid: "sub-1", featureState: 2, isMulticlass: false }],
    multiclass: { name: "Second", uuid: "class-2", itemUuid: "item-2", domain: "sage", subclassUuid: null },
  }));
  assertExclusive(history);
  const placed = Object.values(history.levelups).flatMap(record => record.selections).map(selection => selection.type);
  assert.ok(placed.includes("subclass") || placed.includes("multiclass"), placed.join(","));
});

test("level-up placement stays inside the default tier budgets for bounded PDF evidence", async () => {
  const card = fc.record({
    name: fc.constantFrom("One", "Two", "Three"),
    uuid: fc.constantFrom("u1", "u2", "u3"),
    itemUuid: fc.constant("item"),
    level: fc.integer({ min: 1, max: 4 }),
  });
  await check(fc.property(
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 6, max: 10 }),
    fc.uniqueArray(card, { maxLength: 3, selector: item => item.uuid }),
    fc.array(fc.constantFrom("agility", "strength", "finesse", "instinct", "presence", "knowledge"), { maxLength: 2 }),
    (level, hitPoints, domainCards, markedTraits) => {
      const input = evidence({ level, markedTraits, domainCards, stats: { hitPoint: { pdf: hitPoints, foundry: 6 } } });
      const before = JSON.stringify(input);
      const history = inferLevelups(input);
      assert.equal(JSON.stringify(input), before);
      assert.deepEqual(history, inferLevelups(JSON.parse(before) as LevelupEvidence));
      if (level < 2) {
        assert.deepEqual(history.levelups, {});
        assert.deepEqual(history.unplaced, []);
        assert.deepEqual(history.subclassCards, []);
        return;
      }
      assertBudget(input, history);
      const used = recordedCards(history);
      assert.equal(new Set(used).size, used.length);
      for (const uuid of used) {
        const source = domainCards.find(item => item.uuid === uuid);
        assert.ok(source);
        for (const [placedLevel, record] of Object.entries(history.levelups)) {
          if (record.achievements.domainCards.some(achievement => achievement.uuid === uuid)) assert.ok((source.level ?? 0) <= Number(placedLevel));
          for (const selection of record.selections) if (selection.type === "domainCard" && selection.data.includes(uuid)) assert.ok(selection.level >= (source.level ?? 2));
        }
      }
    },
  ), 20);
});

function assertBudget(input: LevelupEvidence, history: LevelupHistory): void {
  const tiers = input.tiers.filter(tier => tier.levels.start >= 2 && tier.levels.start <= input.level);
  const tierAt = (level: number) => tiers.find(tier => level >= tier.levels.start && level <= tier.levels.end);
  for (const [level, record] of Object.entries(history.levelups)) {
    const spent = record.selections.reduce((sum, selection) => sum + selection.minCost, 0);
    const tier = tierAt(Number(level));
    assert.ok(Number(level) >= 2 && Number(level) <= input.level, level);
    assert.ok(tier, level);
    assert.ok(spent <= tier.availableOptions, `${level} spent ${spent}`);
  }
  for (const tier of tiers) for (const [optionKey, option] of Object.entries(tier.options)) {
    const used = Object.values(history.levelups).flatMap(record => record.selections)
      .filter(selection => selection.tier === tier.tier && selection.optionKey === optionKey)
      .reduce((sum, selection) => sum + selection.minCost, 0);
    assert.ok(used <= option.checkboxSelections, `${tier.tier} ${optionKey} used ${used}`);
  }
  assertExclusive(history);
}

function assertExclusive(history: LevelupHistory): void {
  const byTier = new Map<number, Set<string>>();
  for (const record of Object.values(history.levelups)) for (const selection of record.selections) {
    const types = byTier.get(selection.tier) ?? new Set<string>();
    types.add(selection.type);
    byTier.set(selection.tier, types);
  }
  for (const [tier, types] of byTier) assert.equal(types.has("subclass") && types.has("multiclass"), false, `tier ${tier}`);
}
