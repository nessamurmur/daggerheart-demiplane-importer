import type { LevelTier, LevelupHistory, LevelupRecord, LevelupSelection, Trait } from "./types.ts";

/** What a PDF shows about earlier level-ups. */
export interface LevelupEvidence {
  level: number; tiers: LevelTier[]; markedTraits: Trait[];
  experiences: { id: string; name: string; value: number }[];
  /** Each stat whose level-up gains are the PDF value above Foundry's calculation without level-up history. */
  stats: Partial<Record<StatPick, { pdf: number; foundry: number }>>;
  proficiency: number | null;
  domainCards: { name: string; uuid: string; itemUuid: string; level: number | null }[];
  /** Active subclass features that each grant an additional domain card, by name. */
  cardFeatures: string[];
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
export const FEATURE_STATES = ["", "foundation", "specialization", "mastery"];
/** Foundryborne's level-up dialog disables one of these options in a tier that holds the other. */
const EXCLUSIVE: Record<string, string> = { subclass: "multiclass", multiclass: "subclass" };
/** Search steps allowed after first fit leaves picks out. */
const SEARCH_BUDGET = 2_000;

export function inferLevelups(e: LevelupEvidence): LevelupHistory {
  const bonuses: LevelupHistory["bonuses"] = { traits: {}, proficiency: 0, experiences: {} };
  if (e.level < 2) return { levelups: {}, bonuses, summary: [], unexplainedSlots: 0, unplaced: [], subclassCards: [] };
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
    const gained = experiences.slice(nextExperience, nextExperience + nr);
    for (const x of gained) {
      levelups[start].achievements.experiences[x.id] = { name: x.name, modifier };
      Object.assign(x, { gainedAt: start, base: modifier });
      notes[start].push(`new experience ${x.name} (+${modifier})`);
    }
    if (gained.length < nr) notes[start].push(`${nr - gained.length} new experience${nr - gained.length > 1 ? "s" : ""} missing from the PDF`);
    nextExperience += nr;
  }

  const picks: Pick[] = [], unplaced: string[] = [];
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
    if (!b) { if (a) unplaced.push(`+${a.extra} to ${a.name} (no other raised experience to pair with)`); break; }
    a.extra--; b.extra--;
    picks.push({ type: "experience", label: `+1 to ${a.name} and ${b.name}`, data: [a.id, b.id], minLevel: Math.max(2, a.gainedAt!, b.gainedAt!) });
  }
  // The starting cards come first, then each level's automatic card takes the highest card that level allows. Subclass features take the highest cards left over, because an extra-card pick holds only a card of its tier or lower. The extras take the lowest, and any card still left fits no slot.
  const pool = [...e.domainCards].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  for (const level of [1, ...[...levels].reverse()]) {
    for (let i = 0; i < (level === 1 ? STARTING_DOMAIN_CARDS : tierAt(level)?.domainCardByLevel ?? 0); i++) {
      const index = pool.findIndex(card => (card.level ?? 0) <= level);
      if (index < 0) continue;
      const [card] = pool.splice(index, 1);
      if (level > 1) levelups[level].achievements.domainCards.push({ uuid: card.uuid, itemUuid: card.itemUuid });
    }
  }
  const subclassCards = pool.splice(0, e.cardFeatures.length).map((card, i) => `${card.name} (${e.cardFeatures[i]})`);
  const extraCards = e.domainCards.length - STARTING_DOMAIN_CARDS - e.cardFeatures.length - levels.reduce((n, l) => n + (tierAt(l)?.domainCardByLevel ?? 0), 0);
  for (const card of pool.reverse().splice(0, Math.max(0, extraCards))) {
    picks.push({ type: "domainCard", label: `extra domain card ${card.name}`, data: [card.uuid], itemUuid: card.itemUuid, minLevel: Math.max(2, card.level ?? 2), cardLevel: card.level ?? undefined });
  }
  for (const card of pool) unplaced.push(`domain card ${card.name} (no starting, level, or extra-card slot left for it)`);
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
  const freeSlots = () => levels.reduce((n, l) => n + (tierAt(l)?.availableOptions ?? 0) - spent(l), 0);
  const allowed = (p: Pick) => tiers.filter(t => (p.tier === undefined || t.tier === p.tier) && (p.cardLevel === undefined || t.levels.end >= p.cardLevel) && Object.values(t.options).some(o => o.type === p.type));
  /** Each free checkbox for the pick and each level that can take it, as the selection it would record, in first-fit order. */
  const moves = (p: Pick): LevelupSelection[] => allowed(p).flatMap(tier => {
    const inTier = levels.flatMap(l => levelups[l].selections).filter(s => s.tier === tier.tier);
    if (inTier.some(s => s.type === EXCLUSIVE[p.type])) return [];
    return Object.entries(tier.options).filter(([, option]) => option.type === p.type).flatMap(([optionKey, option]) => {
      const used = inTier.filter(s => s.optionKey === optionKey).reduce((n, s) => n + s.minCost, 0);
      if (used + option.minCost > option.checkboxSelections) return [];
      // One option key per level holds one tier: Foundryborne keys a level's choices by option key and checkbox number.
      return levels.filter(l => l >= Math.max(tier.levels.start, p.minLevel) && spent(l) + option.minCost <= (tierAt(l)?.availableOptions ?? 0) && !levelups[l].selections.some(s => s.optionKey === optionKey && s.tier !== tier.tier)).map(level => ({
        tier: tier.tier, level, optionKey, type: option.type, checkboxNr: used + 1, minCost: option.minCost,
        ...(option.value != null ? { value: option.value } : {}), ...(option.amount != null ? { amount: option.amount } : {}),
        data: [...p.data],
        ...(p.type === "domainCard" ? { secondaryData: { limit: String(tier.levels.end) } } : p.secondaryData ? { secondaryData: p.secondaryData } : {}),
        ...(p.itemUuid ? { itemUuid: p.itemUuid } : {})
      }));
    });
  });
  /** At least this many of the picks fit in no layout: they outnumber the free slots, or picks of one type outnumber its free checkboxes from their earliest level on, where a level takes each option key from one tier only. */
  const shortfall = (rest: Pick[]) => {
    const used: Record<string, number> = {};
    for (const s of levels.flatMap(l => levelups[l].selections)) used[`${s.tier} ${s.optionKey}`] = (used[`${s.tier} ${s.optionKey}`] ?? 0) + s.minCost;
    const options = (type: string, level = e.level) => tiers.filter(t => t.levels.start <= level).flatMap(t => Object.entries(t.options).filter(([, o]) => o.type === type)
      .map(([key, o]) => ({ tier: t.tier, key, minCost: o.minCost, free: Math.floor((o.checkboxSelections - (used[`${t.tier} ${key}`] ?? 0)) / o.minCost) })));
    const room = (level: number, type: string) => {
      const open = options(type, level).filter(o => !levelups[level].selections.some(s => s.optionKey === o.key && s.tier !== o.tier));
      const perKey = [...new Set(open.map(o => o.key))].reduce((n, key) => n + Math.max(...open.filter(o => o.key === key).map(o => o.free)), 0);
      return Math.min(perKey, Math.floor(((tierAt(level)?.availableOptions ?? 0) - spent(level)) / Math.min(...open.map(o => o.minCost))));
    };
    const byType = [...new Set(rest.map(p => p.type))].reduce((short, type) => {
      const starts = rest.filter(p => p.type === type).map(p => p.minLevel), rooms = levels.map(l => room(l, type)), total = options(type).reduce((n, o) => n + o.free, 0);
      return short + Math.max(0, ...starts.map(m => starts.filter(x => x >= m).length - Math.min(total, rooms.reduce((n, r, j) => levels[j] >= m ? n + r : n, 0))));
    }, 0);
    return Math.max(byType, rest.length - freeSlots());
  };
  const cost = (p: Pick) => Math.max(0, ...allowed(p).flatMap(t => Object.values(t.options)).filter(o => o.type === p.type).map(o => o.minCost));
  // Costly picks go first: one-slot picks spread over the levels would leave no level with two free slots.
  const order = picks.sort((a, b) => cost(b) - cost(a) || allowed(a).length - allowed(b).length);
  let best: (LevelupSelection | undefined)[] = order.map(p => { const [s] = moves(p); if (s) levelups[s.level].selections.push(s); return s; });
  let most = best.filter(Boolean).length;
  if (most < order.length) {
    let budget = SEARCH_BUDGET;
    // First fit can block a layout that holds more picks, so search every move with backtracking, keeping the layout that holds the most.
    const path: (LevelupSelection | undefined)[] = [];
    const search = (i: number, placed: number) => {
      if (placed + order.length - i - shortfall(order.slice(i)) <= most || budget-- <= 0) return;
      if (i === order.length) { best = [...path]; most = placed; return; }
      for (const s of moves(order[i])) {
        levelups[s.level].selections.push(s); path.push(s);
        search(i + 1, placed + 1);
        path.pop(); levelups[s.level].selections.pop();
      }
      path.push(undefined); search(i + 1, placed); path.pop();
    };
    for (const l of levels) levelups[l].selections = [];
    search(0, 0);
    for (const s of best) if (s) levelups[s.level].selections.push(s);
  }
  order.forEach((p, i) => { const s = best[i]; if (s) notes[s.level].push(p.label); else unplaced.push(`${p.label} (no room in the level tiers)`); });

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
    unexplainedSlots: freeSlots(),
    unplaced, subclassCards
  };
}
