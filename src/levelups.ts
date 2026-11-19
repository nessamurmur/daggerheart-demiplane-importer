import type { LevelTier, LevelupHistory, LevelupRecord, Trait } from "./types.ts";

/** What a PDF shows about earlier level-ups. */
export interface LevelupEvidence {
  level: number; tiers: LevelTier[]; markedTraits: Trait[];
  experiences: { id: string; name: string; value: number }[];
  /** Each stat whose level-up gains are the PDF value above Foundry's calculation without level-up history. */
  stats: Partial<Record<StatPick, { pdf: number; foundry: number }>>;
  proficiency: number | null;
  domainCards: { name: string; uuid: string; itemUuid: string; level: number | null }[];
  subclasses: { name: string; uuid: string; featureState: number; isMulticlass: boolean }[];
  multiclass: { name: string; uuid: string; itemUuid: string; domain: string | null; subclassUuid: string | null } | null;
}
interface Pick {
  type: string; label: string; data: string[]; secondaryData?: Record<string, string>; itemUuid?: string;
  minLevel: number; tier?: number; cardLevel?: number;
}

/** Level-up options that raise a character stat: option type, label, and the stat key. */
export const STAT_PICKS = [["hitPoint", "Hit Point", "hitPoints"], ["stress", "Stress", "stress"], ["evasion", "Evasion", "evasion"]] as const;
type StatPick = typeof STAT_PICKS[number][0];
export const STARTING_PROFICIENCY = 1;
const STARTING_EXPERIENCE = 2, STARTING_DOMAIN_CARDS = 2;
const FEATURE_STATES = ["", "foundation", "specialization", "mastery"];
/** Foundryborne's level-up dialog disables one of these options in a tier that holds the other. */
const EXCLUSIVE: Record<string, string> = { subclass: "multiclass", multiclass: "subclass" };

export function inferLevelups(e: LevelupEvidence): LevelupHistory {
  const bonuses: LevelupHistory["bonuses"] = { traits: {}, proficiency: 0, experiences: {} };
  if (e.level < 2) return { levelups: {}, bonuses, summary: [], unexplainedSlots: 0, unplaced: [] };
  const tiers = e.tiers.filter(t => t.levels.start >= 2 && t.levels.start <= e.level).sort((a, b) => a.levels.start - b.levels.start);
  const tierAt = (level: number) => tiers.find(t => level >= t.levels.start && level <= t.levels.end);
  const levels = Array.from({ length: e.level - 1 }, (_, i) => i + 2);
  const levelups: Record<string, LevelupRecord> = Object.fromEntries(levels.map(l => [l, { achievements: { experiences: {}, domainCards: [], proficiency: 0 }, selections: [] }]));
  const notes: Record<number, string[]> = Object.fromEntries(levels.map(l => [l, []]));

  const experiences = e.experiences.map((x, i) => ({ ...x, gainedAt: i < 2 ? 1 : null as number | null, base: STARTING_EXPERIENCE }));
  let nextExperience = 2;
  for (const tier of tiers) {
    const start = tier.levels.start, { nr = 0, modifier = STARTING_EXPERIENCE } = tier.initialAchievements.experience ?? {};
    levelups[start].achievements.proficiency = tier.initialAchievements.proficiency ?? 0;
    for (const x of experiences.slice(nextExperience, nextExperience + nr)) {
      levelups[start].achievements.experiences[x.id] = { name: x.name, modifier };
      Object.assign(x, { gainedAt: start, base: modifier });
      notes[start].push(`new experience ${x.name} (+${modifier})`);
    }
    nextExperience += nr;
  }

  const picks: Pick[] = [];
  const repeat = (count: number, pick: Pick) => { for (let i = 0; i < count; i++) picks.push(pick); };
  const current = tierAt(e.level);
  const traitAmount = Object.values(current?.options ?? {}).find(o => o.type === "trait")?.amount || 2;
  for (let i = 0; i < e.markedTraits.length; i += traitAmount) {
    const traits = e.markedTraits.slice(i, i + traitAmount);
    picks.push({ type: "trait", label: `+1 to ${traits.join(" and ")}`, data: traits, minLevel: 2, tier: current?.tier ?? 0 });
  }
  for (const [type, name] of STAT_PICKS) {
    const stat = e.stats[type];
    if (stat) repeat(stat.pdf - stat.foundry, { type, label: `+1 ${name} (PDF ${stat.pdf} vs Foundry ${stat.foundry})`, data: [], minLevel: 2 });
  }
  const raises = experiences.filter(x => x.gainedAt !== null).map(x => ({ ...x, extra: Math.max(0, x.value - x.base) }));
  for (;;) {
    const [a, b] = raises.filter(x => x.extra > 0).sort((x, y) => y.extra - x.extra);
    if (!b) break;
    a.extra--; b.extra--;
    picks.push({ type: "experience", label: `+1 to ${a.name} and ${b.name}`, data: [a.id, b.id], minLevel: Math.max(2, a.gainedAt!, b.gainedAt!) });
  }
  const extraCards = e.domainCards.length - STARTING_DOMAIN_CARDS - levels.reduce((n, l) => n + (tierAt(l)?.domainCardByLevel ?? 0), 0);
  if (extraCards > 0) {
    // Each level's automatic card takes the highest card that level allows; the extras are the lowest cards left over.
    const pool = [...e.domainCards].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
    for (let level = e.level; level >= 1; level--) {
      for (let i = 0; i < (level === 1 ? STARTING_DOMAIN_CARDS : tierAt(level)?.domainCardByLevel ?? 0); i++) {
        const index = pool.findIndex(card => (card.level ?? 0) <= level);
        if (index >= 0) pool.splice(index, 1);
      }
    }
    for (const card of pool.reverse().slice(0, extraCards)) {
      picks.push({ type: "domainCard", label: `extra domain card ${card.name}`, data: [card.uuid], itemUuid: card.itemUuid, minLevel: Math.max(2, card.level ?? 2), cardLevel: card.level ?? undefined });
    }
  }
  if (e.multiclass) {
    const m = e.multiclass, secondaryData: Record<string, string> = {};
    if (m.domain) secondaryData.domain = m.domain;
    if (m.subclassUuid) secondaryData.subclass = m.subclassUuid;
    picks.push({ type: "multiclass", label: `multiclass into ${m.name}`, data: [m.uuid], itemUuid: m.itemUuid, secondaryData, minLevel: 2 });
  }
  if (e.proficiency !== null) {
    const achieved = tiers.reduce((n, t) => n + (t.initialAchievements.proficiency ?? 0), 0);
    repeat(e.proficiency - STARTING_PROFICIENCY - achieved, { type: "proficiency", label: "+1 Proficiency", data: [], minLevel: 2 });
  }
  for (const s of e.subclasses) for (let state = 2; state <= s.featureState; state++) {
    picks.push({ type: "subclass", label: `${s.name} ${FEATURE_STATES[state]}`, data: [s.uuid], secondaryData: { featureState: String(state), isMulticlass: String(s.isMulticlass) }, minLevel: 2 });
  }

  const spent = (level: number) => levelups[level].selections.reduce((n, s) => n + s.minCost, 0);
  const allowed = (p: Pick) => tiers.filter(t => (p.tier === undefined || t.tier === p.tier) && (p.cardLevel === undefined || t.levels.end >= p.cardLevel) && Object.values(t.options).some(o => o.type === p.type));
  const place = (p: Pick): boolean => {
    for (const tier of allowed(p)) {
      const inTier = levels.flatMap(l => levelups[l].selections).filter(s => s.tier === tier.tier);
      if (inTier.some(s => s.type === EXCLUSIVE[p.type])) continue;
      for (const [optionKey, option] of Object.entries(tier.options)) {
        if (option.type !== p.type) continue;
        const used = inTier.filter(s => s.optionKey === optionKey).reduce((n, s) => n + s.minCost, 0);
        if (used + option.minCost > option.checkboxSelections) continue;
        // One option key per level holds one tier: Foundryborne keys a level's choices by option key and checkbox number.
        const level = levels.find(l => l >= Math.max(tier.levels.start, p.minLevel) && spent(l) + option.minCost <= (tierAt(l)?.availableOptions ?? 0) && !levelups[l].selections.some(s => s.optionKey === optionKey && s.tier !== tier.tier));
        if (level === undefined) continue;
        levelups[level].selections.push({
          tier: tier.tier, level, optionKey, type: option.type, checkboxNr: used + 1, minCost: option.minCost,
          ...(option.value != null ? { value: option.value } : {}), ...(option.amount != null ? { amount: option.amount } : {}),
          data: [...p.data],
          ...(p.type === "domainCard" ? { secondaryData: { limit: String(tier.levels.end) } } : p.secondaryData ? { secondaryData: p.secondaryData } : {}),
          ...(p.itemUuid ? { itemUuid: p.itemUuid } : {})
        });
        notes[level].push(p.label);
        return true;
      }
    }
    return false;
  };
  const unplaced: string[] = [];
  const cost = (p: Pick) => Math.max(0, ...allowed(p).flatMap(t => Object.values(t.options)).filter(o => o.type === p.type).map(o => o.minCost));
  // Costly picks go first: one-slot picks spread over the levels would leave no level with two free slots.
  for (const p of picks.sort((a, b) => cost(b) - cost(a) || allowed(a).length - allowed(b).length)) if (!place(p)) unplaced.push(p.label);

  for (const record of Object.values(levelups)) {
    bonuses.proficiency += record.achievements.proficiency;
    for (const s of record.selections) {
      if (s.type === "trait") for (const t of s.data as Trait[]) bonuses.traits[t] = (bonuses.traits[t] ?? 0) + 1;
      if (s.type === "proficiency") bonuses.proficiency += s.value ?? 0;
      if (s.type === "experience") for (const id of s.data) bonuses.experiences[id] = (bonuses.experiences[id] ?? 0) + (s.value ?? 0);
    }
  }
  return {
    levelups, bonuses,
    summary: levels.map(level => ({ level, choices: notes[level] })),
    unexplainedSlots: levels.reduce((n, l) => n + (tierAt(l)?.availableOptions ?? 0) - spent(l), 0),
    unplaced
  };
}
