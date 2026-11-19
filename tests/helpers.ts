import { isDeepStrictEqual } from "node:util";
import { getPath, parseFields, setPath } from "../src/core.ts";
import type { ImportRuntime } from "../src/importer.ts";
import type { DocumentSource, ParsedCharacter } from "../src/types.ts";

export function character(extra = {}): ParsedCharacter {
  return parseFields({ name: "Fixture character", heritage: "Testfolk", class: "Fixture Class - Fixture Path", level: "1", agility: "1", strength: "0", finesse: "0", instinct: "2", presence: "-1", knowledge: "1", hp_max: "6", stress_max: "6", evasion: "10", ancestry_name: "Fixture Ancestry", "hope.0": "Yes", "hope.1": "Yes", "proficiency.0": "Yes", ...extra });
}

const option = (type: string, checkboxSelections: number, extra: { minCost?: number; value?: number; amount?: number } = {}) => ({ type, checkboxSelections, minCost: 1, ...extra });
const tier2Options = { trait: option("trait", 3, { amount: 2 }), hitPoint: option("hitPoint", 2, { value: 1 }), stress: option("stress", 2, { value: 1 }), experience: option("experience", 1, { value: 1, amount: 2 }), domainCard: option("domainCard", 1, { amount: 1 }), evasion: option("evasion", 1, { value: 1 }) };
const upperOptions = { ...tier2Options, subclass: option("subclass", 1), proficiency: option("proficiency", 2, { minCost: 2, value: 1 }), multiclass: option("multiclass", 2, { minCost: 2 }) };
const tier = (tier: number, start: number, end: number, options: Record<string, ReturnType<typeof option>>) => ({ tier, levels: { start, end }, initialAchievements: { experience: { nr: 1, modifier: 2 }, proficiency: 1 }, availableOptions: 2, domainCardByLevel: 1, options });
/** Foundryborne 2.10.2's default LevelTiers setting. */
export const LEVEL_TIERS = [tier(2, 2, 4, tier2Options), tier(3, 5, 7, upperOptions), tier(4, 8, 10, upperOptions)];

/** Mirrors Foundryborne's character prepareBaseData, which replays level-up history only when automatic level-up is on. */
function applyLevelups(system: any): void {
  const level = system.levelData.level.current;
  const currentTier = LEVEL_TIERS.find(t => level >= t.levels.start && level <= t.levels.end)?.tier;
  for (const record of Object.values<any>(system.levelData.levelups)) {
    system.proficiency += record.achievements.proficiency;
    for (const s of record.selections) {
      if (s.type === "trait") for (const t of s.data) { system.traits[t].value += 1; system.traits[t].tierMarked = s.tier === currentTier; }
      if (s.type === "hitPoint") system.resources.hitPoints.max += s.value;
      if (s.type === "stress") system.resources.stress.max += s.value;
      if (s.type === "evasion") system.evasion += s.value;
      if (s.type === "proficiency") system.proficiency += s.value;
      if (s.type === "experience") for (const id of s.data) if (system.experiences[id]) system.experiences[id].value += s.value;
    }
  }
}

/** Foundryborne 2.10.2's companion level-up options and their checkbox counts, from its defaultCompanionTier, whose one tier has key 2. */
const COMPANION_OPTIONS = { experience: 3, hope: 1, creatureComfort: 1, armored: 1, vicious: 3, stress: 3, bonded: 1, evasion: 3 };

/** Mirrors DhCompanionLevelup#tiersForRendering: the checkboxes the companion level-up dialog shows as taken. Like Foundryborne, it throws for a selection in an unknown tier. */
export function companionCheckboxesTaken(levelups: Record<string, any>): string[] {
  const selected: Record<string, Record<string, Record<string, unknown>>> = { 2: {} };
  for (const record of Object.values(levelups)) for (const s of record.selections) {
    const tier = selected[s.tier];
    tier[s.optionKey] ??= {};
    tier[s.optionKey][s.checkboxNr] = s;
  }
  return Object.entries(COMPANION_OPTIONS).flatMap(([key, count]) => Array.from({ length: count }, (_, i) => i + 1).filter(n => selected[2][key]?.[n]).map(n => `${key} #${n}`));
}

/** Mirrors Foundryborne's Item.prepareGrantedItems: each linked feature joins its granter's creation. */
function grantedFeatures(granter: DocumentSource, documents: Record<string, DocumentSource>): DocumentSource[] {
  return (granter.system?.features ?? []).map((link: any) => typeof link === "string" ? link : typeof link?.item === "string" ? link.item : link?.item?.uuid).filter(Boolean).map((uuid: string) => ({
    ...structuredClone(documents[uuid]), _id: `granted-${uuid}`,
    _stats: { compendiumSource: uuid.startsWith("Compendium.") ? uuid : null, duplicateSource: uuid.startsWith("Compendium.") ? null : uuid },
    system: { ...structuredClone(documents[uuid].system), granter: { id: granter._id, type: granter.type } }
  }));
}

/** Mirrors Foundry 14's expandObject, which document updates and loads apply inside every flag: each dotted key in a plain object, at any depth, becomes nested objects. Returns a copy, as Foundry stores one. */
function expandObject(value: any): any {
  if (Array.isArray(value)) return value.map(expandObject);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const expanded = {};
  for (const [k, v] of Object.entries(value)) setPath(expanded, k, expandObject(v));
  return expanded;
}

export function mockRuntime(documents: Record<string, DocumentSource> = {}) {
  let serial = 0;
  const created: any[] = [], operations: string[] = [];
  /** Like Foundry's pre-operation hooks: one returning false declines that document's write, and nothing throws. */
  const hooks: Record<string, (...args: any[]) => boolean | void> = {};
  const allowed = (event: string, ...args: any[]) => hooks[event]?.(...args) !== false;
  const runtime: ImportRuntime = {
    version: "2.10.2", moduleVersion: "test", domains: ["sage", "arcana"], isGM: true,
    levelupAuto: true,
    id: () => String(++serial).padStart(16, "0"), localize: key => key,
    getDocument: async uuid => documents[uuid] ? { ...documents[uuid], toObject: () => structuredClone(documents[uuid]) } : null,
    // A deterministic stub isolates planning/transaction tests. Live Foundry verifies actual preparation.
    preview: source => {
      const system = { ...structuredClone(source.system), evasion: 10, armorScore: { max: 4, value: 0 }, damageThresholds: { major: 7, severe: 14 }, resources: { hitPoints: { max: 6, value: 0 }, stress: { max: 6, value: 0 }, hope: { max: 6, value: 2 } } };
      system.levelupTiers = { tiers: Object.fromEntries(structuredClone(LEVEL_TIERS).map(t => [t.tier, t])) };
      if (source.type === "character" && runtime.levelupAuto) applyLevelups(system);
      return { ...source, system };
    },
    // Foundry reports a declined write by its result: a create leaves the document out, an update or delete returns undefined.
    createActor: async source => {
      if (!allowed("preCreateActor", source)) return undefined;
      const actor = runtime.preview(source);
      actor.id = source._id; actor.uuid = `Actor.${source._id}`;
      actor.createEmbeddedDocuments = async (type: string, data: any[]) => {
        const kept = (type === "Item" ? data.flatMap(d => [d, ...grantedFeatures(d, documents)]) : data).filter(d => allowed(`preCreate${type}`, d));
        operations.push(...kept.map(d => d.type));
        return kept.map(d => ({ ...d, id: d._id }));
      };
      actor.update = async (data: Record<string, unknown>, options: { diff?: boolean } = {}) => {
        const changes = {};
        for (const [path, value] of Object.entries(data)) setPath(changes, path, value);
        if (!allowed("preUpdateActor", actor, changes)) return undefined;
        // An update that changes nothing is skipped unless diff is false.
        if (options.diff !== false && Object.entries(data).every(([path, value]) => isDeepStrictEqual(getPath(actor, path), value))) return undefined;
        for (const [path, value] of Object.entries(data)) setPath(actor, path, expandObject(value));
        return actor;
      };
      actor.delete = async () => {
        if (!allowed("preDeleteActor", actor)) return undefined;
        actor.deleted = true; operations.push(`delete:${actor.type}`); return actor;
      };
      created.push(actor); return actor;
    }
  };
  return { runtime, created, operations, hooks };
}
