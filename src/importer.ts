import { MODULE_ID, TRAITS, type Candidate, type DocumentSource, type Entry, type ImportReport, type Issue, type LevelupHistory, type ParsedCharacter, type ResolvedImportPlan, type Resolution, type StatComparison } from "./types.ts";
import { escapeHTML, getPath, normalizeName, paragraphs, sourceFlags, validateCharacter } from "./core.ts";
import { FEATURE_STATES, inferLevelups, STARTING_PROFICIENCY, STAT_PICKS, type LevelupEvidence } from "./levelups.ts";

export interface ImportRuntime {
  version: string; moduleVersion: string; domains: string[]; isGM: boolean; levelupAuto: boolean;
  /** Foundryborne's world loadout limit; Infinity when unlimited. */
  maxLoadout: number;
  id(): string;
  getDocument(uuid: string): Promise<any>;
  preview(source: DocumentSource): any;
  createActor(source: DocumentSource): Promise<any>;
  localize(key: string): string;
}
export const STAT_PATHS: Record<string, [string, string]> = {
  evasion: ["system.evasion", "Evasion"], armor: ["system.armorScore.max", "Armor score"],
  major: ["system.damageThresholds.major", "Major threshold"], severe: ["system.damageThresholds.severe", "Severe threshold"],
  hitPoints: ["system.resources.hitPoints.max", "Maximum HP"], stress: ["system.resources.stress.max", "Maximum Stress"],
  proficiency: ["system.proficiency", "Proficiency"]
};
const CLASS_TYPES = ["class", "subclass"];
/** Subclass features that grant a domain card say so only in their description. The SRD's School of Knowledge features
 *  (Prepared, Accomplished, Brilliant) are also known by compendium identity, so a translated compendium still matches. */
const GRANTS_DOMAIN_CARD = /take an additional domain card/gi;
const CARD_FEATURE_SOURCES = new Set(["YS52ZGdce605wNVT", "0wCctRupJAv5hTuE", "2A0HBDxGc4gEARou"].map(id => `Compendium.daggerheart.subclasses.Item.${id}`));
const grantsCard = (text: string) => (text.match(GRANTS_DOMAIN_CARD) ?? []).length;
const clone = <T>(value: T): T => structuredClone(value);
const error = (message: string): Issue => ({ code: "validation", message, blocking: true });
const sourceOf = (document: any): DocumentSource => clone(document.toObject ? document.toObject() : document);

export function sanitizeSource(data: DocumentSource, id: string, uuid: string | null): DocumentSource {
  const source = clone(data);
  for (const key of ["folder", "ownership", "_key", "uuid", "pack", "sort"]) delete source[key];
  source._id = id;
  source._stats = { compendiumSource: uuid?.startsWith("Compendium.") ? uuid : null, duplicateSource: uuid && !uuid.startsWith("Compendium.") ? uuid : null };
  return source;
}

function fallback(entry: Entry, c: ParsedCharacter, runtime: ImportRuntime, issues: Issue[]): DocumentSource {
  let type = entry.asFeature ? "feature" : entry.kind;
  if (type === "domainCard" && !runtime.domains.includes(entry.domain ?? "")) {
    type = "feature";
    issues.push({ code: "unsupported-domain", message: `${entry.name}: “${entry.domain || "unknown"}” is not a registered domain; preserved as an editable feature.` });
  }
  const system: DocumentSource = { description: paragraphs(entry.description), attribution: { source: "User-provided Demiplane PDF" } };
  if (type === "class") {
    if (!entry.isMulticlass && c.stats.hitPoints === null) issues.push(error(`Enter maximum HP for the unmatched class “${entry.name}”.`));
    if (!entry.isMulticlass && c.stats.evasion === null) issues.push(error(`Enter evasion for the unmatched class “${entry.name}”.`));
    Object.assign(system, { domains: entry.domains ?? [], hitPoints: c.stats.hitPoints ?? 1, evasion: c.stats.evasion ?? 0, features: [], isMulticlass: !!entry.isMulticlass, backgroundQuestions: [], connections: [] });
  }
  if (type === "subclass") Object.assign(system, { spellcastingTrait: entry.spellcastingTrait || null, features: [], featureState: entry.featureState ?? 1, isMulticlass: !!entry.isMulticlass });
  if (["ancestry", "community"].includes(type)) system.features = [];
  if (type === "domainCard") {
    if (!Number.isInteger(entry.level) || entry.level! < 1 || entry.level! > 10) issues.push(error(`Enter the card level for “${entry.name}”.`));
    if (!Number.isInteger(entry.recallCost) || entry.recallCost! < 0) issues.push(error(`Enter the Recall Cost for “${entry.name}”.`));
    Object.assign(system, { domain: entry.domain, level: entry.level ?? 1, type: entry.cardType || "ability", recallCost: entry.recallCost ?? 0, inVault: !!entry.inVault });
  }
  if (type === "weapon") {
    if (!entry.trait || !entry.range || !entry.dice || !entry.damageType || !entry.burden) issues.push(error(`Complete the attack and hand requirements for “${entry.name}”, or choose a matching item.`));
    const level = c.level ?? 1;
    Object.assign(system, { equipped: !!entry.equipped, secondary: !!entry.secondary, burden: entry.burden || "oneHanded", tier: level === 1 ? 1 : level < 5 ? 2 : level < 8 ? 3 : 4, attack: {
      _id: runtime.id(), name: "Attack", type: "attack", systemPath: "attack", baseAction: true,
      range: entry.range || "melee", roll: { type: "attack", trait: entry.trait || "strength" },
      damage: { main: { value: { dice: entry.dice || "d6", bonus: entry.damageBonus ?? 0, multiplier: "prof" }, type: [entry.damageType || "physical"], applyTo: "hitPoints" } }
    } });
  }
  if (type === "armor") {
    if ([entry.major, entry.severe, entry.armorScore].some(n => n == null || !Number.isInteger(n) || n < 0)) issues.push(error(`Enter base armor score and thresholds for “${entry.name}”, or choose matching armor.`));
    Object.assign(system, { equipped: !!entry.equipped, armor: { current: 0, max: entry.armorScore ?? 0 }, baseThresholds: { major: entry.major ?? 0, severe: entry.severe ?? 0 } });
  }
  if (["loot", "consumable"].includes(type)) system.quantity = entry.quantity ?? 1;
  if (!entry.description && !["weapon", "armor", "loot"].includes(type)) issues.push({ code: "missing-description", message: `${entry.name}: the PDF supplies no rules text. This editable item needs manual setup.` });
  if (type === "feature" && entry.kind === "domainCard") system.description = `<p>Domain: ${escapeHTML(entry.domain)}. Recall cost: ${entry.recallCost ?? "unknown"}. ${entry.inVault ? "In vault" : "In loadout"}.</p>${system.description}`;
  issues.push({ code: "editable-item", message: `${entry.name}: created from PDF information; descriptive rules are not converted into automated actions.` });
  return { name: entry.name, type, system, effects: [] };
}

/** Feature links are { type, item } on classes, subclasses and ancestries, and bare UUID strings on communities (Foundryborne reads both: `f.item ?? f`). */
const linkedUuid = (link: any): string | undefined => typeof link === "string" ? link : typeof link?.item === "string" ? link.item : link?.item?.uuid;

async function expandGrants(sources: DocumentSource[], runtime: ImportRuntime): Promise<DocumentSource[]> {
  const expanded = clone(sources);
  for (const granter of sources) {
    for (const link of granter.system.features ?? []) {
      const uuid = linkedUuid(link);
      if (!uuid) continue;
      const document = await runtime.getDocument(uuid);
      if (!document) throw new Error(`The linked feature ${uuid} for ${granter.name} is unavailable. Select another content source or create an editable item.`);
      const feature = sanitizeSource(sourceOf(document), runtime.id(), uuid);
      feature.system.granter = { id: granter._id, type: granter.type, multiclass: !!granter.system.isMulticlass, identifier: link.type ?? "" };
      expanded.push(feature);
    }
  }
  return expanded;
}

function biography(c: ParsedCharacter): DocumentSource {
  return {
    background: paragraphs(c.biography.background) + (c.heritage ? `<p><strong>Heritage:</strong> ${escapeHTML(c.heritage)}</p>` : "") + (c.biography.details ? `<h3>Character details</h3>${paragraphs(c.biography.details)}` : "") + (c.biography.notes ? `<h3>Imported notes</h3>${paragraphs(c.biography.notes)}` : "") + (c.companion.enabled && c.companion.notes ? `<h3>${escapeHTML(c.companion.name)}: companion notes</h3>${paragraphs(c.companion.notes)}` : ""),
    connections: paragraphs(c.biography.connections), characteristics: { pronouns: c.pronouns }
  };
}

export async function buildPlan(c: ParsedCharacter, resolutions: Resolution[], runtime: ImportRuntime): Promise<ResolvedImportPlan> {
  if (!runtime.isGM) throw new Error("Only a GM may import characters.");
  const issues = [...c.issues, ...validateCharacter(c)];
  for (const e of c.entries.filter(e => !e.include)) for (const field of e.fields) issues.push({ code: "excluded-item", field, message: `${e.name}: excluded during review; source data retained in the report.` });
  const actorId = runtime.id();
  const sources: DocumentSource[] = [];
  const plan: ResolvedImportPlan = { character: clone(c), resolutions: clone(resolutions), actorData: {}, itemSources: sources, comparisons: [], calculatedStats: {}, issues, systemVersion: runtime.version, reviewed: false };
  for (const resolution of resolutions) {
    const e = resolution.entry;
    if (!e.include) continue;
    if (!e.name.trim()) { issues.push(error("Every included item needs a name.")); continue; }
    if (resolution.selected === undefined) { issues.push(error(`Choose a content source for “${e.name}”.`)); continue; }
    let source: DocumentSource;
    if (resolution.selected) {
      const doc = await runtime.getDocument(resolution.selected);
      if (!doc) { issues.push(error(`The selected source for “${e.name}” is unavailable.`)); continue; }
      source = sourceOf(doc);
      const expectedTypes = e.inventoryText ? ["weapon", "armor", "loot", "consumable"] : [e.kind];
      if (!expectedTypes.includes(source.type)) { issues.push(error(`“${e.name}” has an incompatible selected item type.`)); continue; }
    } else source = fallback(e, c, runtime, issues);
    source = sanitizeSource(source, runtime.id(), resolution.selected);
    source.flags = { ...source.flags, ...sourceFlags(e, resolution.selected) };
    source.flags[MODULE_ID].entryId = e.id;
    // Character state belongs to the PDF; rules and actions belong to the selected item.
    if (["weapon", "armor"].includes(source.type)) source.system.equipped = !!e.equipped;
    if (["loot", "consumable"].includes(source.type)) source.system.quantity = e.quantity ?? 1;
    if (source.type === "domainCard") source.system.inVault = !!e.inVault;
    if (source.type === "class") {
      source.system.isMulticlass = !!e.isMulticlass;
      if (e.isMulticlass) {
        if (e.domains?.length !== 1) issues.push(error(`Select the one domain gained from multiclass “${e.name}”.`));
        else if (!(source.system.domains ?? []).includes(e.domains[0]) && resolution.selected) issues.push(error(`“${e.domains[0]}” is not a domain of ${source.name}.`));
        source.system.domains = e.domains ?? [];
        source.system.features = (source.system.features ?? []).filter((f: any) => f.type !== "hope");
      } else if (!resolution.selected && !e.domains?.length) {
        // Only infer domains actually present on imported cards, and report this explicitly.
        source.system.domains = [...new Set(c.entries.filter(x => x.include && x.kind === "domainCard").map(x => x.domain).filter(Boolean))];
        issues.push({ code: "inferred-domains", message: `${e.name}: only domains visible on imported cards are recorded; review the class’s full domain list.` });
      }
      const unsupported = (source.system.domains ?? []).filter((d: string) => !runtime.domains.includes(d));
      if (unsupported.length) {
        source.system.domains = source.system.domains.filter((d: string) => runtime.domains.includes(d));
        source.flags[MODULE_ID].unsupportedDomains = unsupported;
        source.system.description = (source.system.description ?? "") + `<p>Unregistered domains: ${escapeHTML(unsupported.join(", "))}. Their rules require manual setup.</p>`;
        issues.push({ code: "unsupported-class-domain", message: `${e.name}: unregistered domains (${unsupported.join(", ")}) are preserved as metadata. Register these domains in Foundryborne before using their native advancement options.` });
      }
    }
    if (source.type === "subclass") {
      source.system.featureState = e.featureState ?? 1;
      source.system.isMulticlass = !!e.isMulticlass;
      if (e.spellcastingTrait) source.system.spellcastingTrait = e.spellcastingTrait;
    }
    // Avoid double-counting marked armor across the equipment and bonus armor effects.
    if (source.type === "armor") source.system.armor.current = 0;
    for (const effect of source.effects ?? []) for (const change of effect.system?.changes ?? []) if (change.type === "armor") change.value.current = 0;
    sources.push(source);
  }
  const classes = sources.filter(s => s.type === "class");
  for (const sub of sources.filter(s => s.type === "subclass")) {
    const original: Entry = sub.flags[MODULE_ID].original;
    const parent = classes.find(s => normalizeName(s.flags[MODULE_ID].original.name) === normalizeName(original.className ?? "")) ?? classes.find(s => !!s.system.isMulticlass === !!sub.system.isMulticlass);
    if (!parent) { issues.push(error(`Choose the parent class for ${sub.name}.`)); continue; }
    const expectedUuid = parent._stats.compendiumSource || parent._stats.duplicateSource || `Actor.${actorId}.Item.${parent._id}`;
    // Two publishers may have equivalent classes with different UUIDs. The GM has chosen both explicitly.
    sub.system.linkedClass = expectedUuid;
  }
  if (c.mixedAncestry.enabled && c.mixedAncestry.primaryUuid && c.mixedAncestry.secondaryUuid) {
    const primary = await runtime.getDocument(c.mixedAncestry.primaryUuid), secondary = await runtime.getDocument(c.mixedAncestry.secondaryUuid);
    const a = primary && sourceOf(primary), b = secondary && sourceOf(secondary);
    if (a?.type !== "ancestry" || b?.type !== "ancestry") issues.push(error("Both mixed ancestry sources must be accessible ancestry items."));
    else {
      const links = [a.system.features.find((f: any) => f.type === "primary"), b.system.features.find((f: any) => f.type === "secondary")];
      if (links.some(x => !x)) issues.push(error("The selected ancestries do not provide the requested primary and secondary features."));
      else {
        const combined = sanitizeSource(a, runtime.id(), null);
        combined.name = c.mixedAncestry.name;
        combined.system.features = links;
        combined.flags = { [MODULE_ID]: { mixedAncestry: clone(c.mixedAncestry) } };
        const index = sources.findIndex(s => s.type === "ancestry");
        if (index < 0) sources.push(combined); else sources.splice(index, 1, combined);
      }
    }
  }
  for (const s of sources.filter(s => s.type === "domainCard")) {
    if (!classes.some(k => k.system.domains?.includes(s.system.domain))) issues.push(error(`${s.name}: its domain is not available from the reviewed classes. Update the class domains or choose an editable feature.`));
  }
  const seenCards = new Set<string>();
  for (const s of sources.filter(s => s.type === "domainCard")) {
    if (seenCards.has(normalizeName(s.name))) issues.push(error(`Duplicate card “${s.name}”: exclude one copy.`));
    seenCards.add(normalizeName(s.name));
  }
  const equipment = sources.filter(s => s.system.equipped);
  for (const category of ["armor", "primary", "secondary"]) {
    const count = equipment.filter(s => category === "armor" ? s.type === "armor" : s.type === "weapon" && !!s.system.secondary === (category === "secondary")).length;
    if (count > 1) issues.push(error(`Only one ${category} item can be equipped.`));
  }
  if (equipment.some(s => s.type === "weapon" && !s.system.secondary && s.system.burden === "twoHanded") && equipment.some(s => s.type === "weapon" && s.system.secondary)) issues.push(error("A two-handed primary weapon and a secondary weapon cannot both be equipped."));
  const actorData: DocumentSource = {
    _id: actorId, name: c.name, type: "character",
    system: {
      traits: Object.fromEntries(TRAITS.map(t => [t, { value: c.traits[t] ?? 0, tierMarked: c.markedTraits[t] }])),
      levelData: { level: { current: c.level ?? 1, changed: c.level ?? 1 }, levelups: {} },
      experiences: Object.fromEntries(c.experiences.map((e, i) => [`exp${i}`, { name: e.name, value: e.value ?? 0, description: e.description ?? "", core: i < 2 }])),
      gold: { ...c.gold, coins: 0 }, biography: biography(c),
      resources: { hitPoints: { value: 0, max: null }, stress: { value: 0, max: null }, hope: { value: 0, max: null } },
      proficiency: c.stats.proficiency ?? 1, evasion: 0
    },
    flags: { [MODULE_ID]: { snapshotLevel: c.level, sourceFile: c.source.fileName, fingerprint: c.source.fingerprint, incompleteHistory: (c.level ?? 1) > 1 } }
  };
  plan.actorData = actorData;
  if (issues.some(i => i.blocking)) return plan;
  const previewActor = (items: DocumentSource[]) => runtime.preview({ ...clone(actorData), items: clone(items) });
  let expanded: DocumentSource[];
  try { expanded = await expandGrants(sources, runtime); }
  catch (e) { issues.push(error((e as Error).message)); return plan; }
  // Granted features are created before the cards, so Foundryborne's loadout check sees their bonuses too.
  const limit = runtime.maxLoadout + (previewActor(expanded).system.bonuses.maxLoadout);
  const vaulted = fitLoadout(sources, limit);
  for (const card of expanded.filter(s => s.type === "domainCard")) card.system.inVault = sources.find(s => s._id === card._id)!.system.inVault;
  if (vaulted.length) issues.push({ code: "loadout-limit", message: `Foundryborne’s loadout holds ${limit} domain cards, so ${vaulted.join(", ")} ${vaulted.length === 1 ? "goes" : "go"} to the vault. To vault a different card, go back to the details and check its “In vault” box.` });
  const baseline = previewActor(expanded);
  const { stats, notes } = statEvidence(c, baseline, previewActor(expanded.filter(s => CLASS_TYPES.includes(s.type) || CLASS_TYPES.includes(s.system.granter?.type))));
  const history = inferLevelups(levelupEvidence(c, expanded, baseline, stats, actorId));
  actorData.system.levelData.levelups = history.levelups;
  if (runtime.levelupAuto) {
    for (const [trait, bonus] of Object.entries(history.bonuses.traits)) actorData.system.traits[trait].value -= bonus;
    for (const [id, bonus] of Object.entries(history.bonuses.experiences)) actorData.system.experiences[id].value -= bonus;
  }
  if (c.stats.proficiency !== null) {
    const base = c.stats.proficiency - history.bonuses.proficiency;
    if (runtime.levelupAuto) actorData.system.proficiency = Math.max(STARTING_PROFICIENCY, base);
    if (base < STARTING_PROFICIENCY) issues.push({ code: "proficiency-below-minimum", message: `The PDF shows Proficiency ${c.stats.proficiency}, below the minimum of ${STARTING_PROFICIENCY + history.bonuses.proficiency} for level ${c.level}. Check the PDF’s Proficiency marks.` });
  }
  for (const id of Object.values(history.levelups).flatMap(r => Object.keys(r.achievements.experiences))) actorData.system.experiences[id].core = true;
  actorData.flags[MODULE_ID].incompleteHistory = history.unexplainedSlots > 0 || history.unplaced.length > 0;
  plan.levelHistory = history;
  if (history.summary.length) issues.push(historyIssue(history, notes, runtime.levelupAuto));
  const preview = previewActor(expanded);
  for (const [key, [path, label]] of Object.entries(STAT_PATHS)) {
    const pdf = c.stats[key], calculated = Number(getPath(preview, path));
    if (!Number.isFinite(calculated)) { issues.push(error(`Foundry could not calculate ${label}.`)); continue; }
    plan.calculatedStats[path] = calculated;
    if (pdf !== null && pdf !== undefined && pdf !== calculated) plan.comparisons.push({ path, label, pdf, calculated, choice: null });
  }
  for (const t of TRAITS) {
    const path = `system.traits.${t}.value`, pdf = c.traits[t]!;
    const calculated = Number(getPath(preview, path));
    if (!Number.isFinite(calculated)) { issues.push(error(`Foundry could not calculate the ${t} trait.`)); continue; }
    plan.calculatedStats[path] = calculated;
    if (pdf !== calculated) plan.comparisons.push({ path, label: `${t} trait`, pdf, calculated, choice: null });
  }
  // Item-specific exported values are reported, never silently written over matched rules.
  for (const s of sources.filter(s => s.type === "armor" && s._stats.compendiumSource)) {
    const entry: Entry = s.flags[MODULE_ID].original;
    if (entry.armorScore != null && entry.armorScore !== s.system.armor.max) issues.push({ code: "armor-base-difference", message: `${s.name}: PDF base score ${entry.armorScore}; installed base score ${s.system.armor.max}. The total armor score is reconciled separately, including shield effects.` });
  }
  if (c.companion.enabled) plan.companionData = companionSource(c, runtime, actorId);
  if (c.stats.proficiency === null) issues.push({ code: "default-proficiency", message: `No Proficiency was marked. Foundry’s calculated Proficiency of ${plan.calculatedStats["system.proficiency"]} is proposed; edit it if needed.` });
  return plan;
}

/** Foundryborne vaults a domain card created while the loadout is full, unless the card ignores the limit.
 *  Placing those cards here, in creation order, keeps the review and the report true to the created actor. */
function fitLoadout(sources: DocumentSource[], limit: number): string[] {
  let loadout = 0;
  const vaulted: string[] = [];
  for (const card of sources.filter(s => s.type === "domainCard" && !s.system.inVault)) {
    if (loadout < limit || card.system.loadoutIgnore) loadout++;
    else { card.system.inVault = true; vaulted.push(card.name); }
  }
  return vaulted;
}

/** A level-up gain is the PDF value above Foundry's full calculation. Demiplane sheets usually include the item bonuses
 *  Foundry automates (armor features, ancestry bonuses), so other items do not suppress inference; the note shows their
 *  share so the GM can spot a pick that is really an item bonus Foundry does not model. */
function statEvidence(c: ParsedCharacter, baseline: any, classBaseline: any): { stats: LevelupEvidence["stats"]; notes: string[] } {
  const stats: LevelupEvidence["stats"] = {}, notes: string[] = [];
  for (const [type, , key] of STAT_PICKS) {
    const [path, label] = STAT_PATHS[key], pdf = c.stats[key];
    if (pdf == null) continue;
    const foundry = Number(getPath(baseline, path)), items = foundry - Number(getPath(classBaseline, path));
    stats[type] = { pdf, foundry };
    if (items && pdf > foundry) notes.push(`${label}: Foundry’s ${foundry} includes ${items > 0 ? "+" : ""}${items} from items other than the class; the PDF’s higher ${pdf} was read as level-up picks.`);
  }
  return { stats, notes };
}

/** Reads the items with their granted features, as Foundry will hold them. */
function levelupEvidence(c: ParsedCharacter, items: DocumentSource[], baseline: any, stats: LevelupEvidence["stats"], actorId: string): LevelupEvidence {
  const itemUuid = (s: DocumentSource) => `Actor.${actorId}.Item.${s._id}`;
  const uuid = (s: DocumentSource) => s._stats.compendiumSource || s._stats.duplicateSource || itemUuid(s);
  const multiclass = items.find(s => s.type === "class" && s.system.isMulticlass), multiclassSubclass = items.find(s => s.type === "subclass" && s.system.isMulticlass);
  return {
    level: c.level ?? 1, tiers: Object.values(baseline.system.levelupTiers.tiers), markedTraits: TRAITS.filter(t => c.markedTraits[t]),
    experiences: c.experiences.map((e, i) => ({ id: `exp${i}`, name: e.name, value: e.value ?? 0 })),
    stats,
    proficiency: c.stats.proficiency,
    domainCards: items.filter(s => s.flags?.[MODULE_ID]?.originalType === "domainCard").map(s => ({ name: s.name, uuid: uuid(s), itemUuid: itemUuid(s), level: s.system.level ?? s.flags[MODULE_ID].original.level ?? null })),
    cardFeatures: [
      ...items.filter(f => {
        const granter = items.find(s => s.type === "subclass" && s._id === f.system.granter?.id), state = FEATURE_STATES.indexOf(f.system.granter?.identifier);
        return granter && state > 0 && state <= (granter.system.featureState ?? 1) && (CARD_FEATURE_SOURCES.has(f._stats?.compendiumSource) || grantsCard(f.system.description ?? "") > 0);
      }).map(f => f.name),
      // An editable subclass has no linked features; its PDF feature text lists one entry per unlocked feature.
      ...items.filter(s => s.type === "subclass" && !s.system.features?.length).flatMap(s =>
        Array.from({ length: Math.min(grantsCard(s.system.description ?? ""), s.system.featureState ?? 1) }, (_, i) => `${s.name} feature ${i + 1}`))
    ],
    subclasses: items.filter(s => s.type === "subclass").map(s => ({ name: s.name, uuid: itemUuid(s), featureState: s.system.featureState ?? 1, isMulticlass: !!s.system.isMulticlass })),
    multiclass: multiclass ? { name: multiclass.name, uuid: uuid(multiclass), itemUuid: itemUuid(multiclass), domain: multiclass.system.domains?.[0] ?? null, subclassUuid: multiclassSubclass ? uuid(multiclassSubclass) : null } : null
  };
}

function historyIssue(history: LevelupHistory, notes: string[], levelupAuto: boolean): Issue {
  return { code: "level-history", message: [
    `Level-up history recorded from the PDF. ${history.summary.map(s => `Level ${s.level}: ${s.choices.join(", ") || "no choices identified"}.`).join(" ")}`,
    ...notes,
    history.subclassCards.length ? `Domain cards counted for subclass features, not as level-up picks (which card each feature took is a guess): ${history.subclassCards.join(", ")}.` : "",
    history.unexplainedSlots ? `Option slots not identified from the PDF: ${history.unexplainedSlots}. The matching tier checkboxes stay unmarked, so a later level-up can take them.` : "",
    history.unplaced.length ? `These choices from the PDF were not recorded: ${history.unplaced.join(", ")}.` : "",
    levelupAuto ? "" : "Automatic level-up is off in Foundryborne, so traits, experiences, and Proficiency keep the PDF’s final values, and the stat review decides Hit Points, Stress, and Evasion. The history only marks options as taken."
  ].filter(Boolean).join(" ") };
}

/** Additive effects remain editable and allow future equipment/level changes to take effect. */
export function adjustmentEffects(comparisons: StatComparison[], id: () => string): DocumentSource[] {
  return comparisons.filter(c => c.choice === "pdf").map(c => ({
    _id: id(), name: `PDF import: ${c.label}`, type: "base", img: "icons/magic/life/heart-cross-blue.webp",
    description: `<p>Reviewed import adjustment: PDF ${c.pdf}; installed calculation ${c.calculated}. Remove or edit this effect when the underlying choice is represented elsewhere.</p>`,
    system: { changes: c.path === "system.armorScore.max" ? [{ type: "armor", phase: "initial", priority: 20, value: { max: String(c.pdf - c.calculated), current: 0, damageThresholds: null, interaction: "none" } }] : [{ key: c.path, type: "add", value: c.pdf - c.calculated, phase: "initial", priority: 20 }] },
    flags: { [MODULE_ID]: { adjustment: clone(c) } }, disabled: false, transfer: false
  }));
}

function companionSource(c: ParsedCharacter, runtime: ImportRuntime, partnerId: string): DocumentSource {
  const p = c.companion;
  const sum = (type: string, factor = 1) => p.training.filter(t => t.type === type).length * factor;
  const dice = ["d4", "d6", "d8", "d10", "d12", "d20"], ranges = ["melee", "veryClose", "close", "far", "veryFar"];
  const damageSteps = p.training.filter(t => t.type === "vicious" && t.data[0] === "damage").length;
  const rangeSteps = p.training.filter(t => t.type === "vicious" && t.data[0] === "range").length;
  // Foundryborne's companion level-up dialog has one tier, keyed 2, and numbers its checkboxes from 1.
  const levelups = Object.fromEntries(p.training.map((t, i) => [String(i + 2), { achievements: { experiences: {}, domainCards: [], proficiency: 0 }, selections: [{ ...t, tier: 2, level: i + 2, optionKey: t.type, checkboxNr: p.training.slice(0, i).filter(x => x.type === t.type).length + 1, value: t.type === "evasion" ? 2 : 1, data: t.data, features: [] }] }]));
  return {
    _id: runtime.id(), name: p.name, type: "companion",
    system: {
      partner: `Actor.${partnerId}`, evasion: p.evasion! - sum("evasion", 2),
      resources: { stress: { value: p.stress, max: p.stressMax! - sum("stress") } },
      experiences: Object.fromEntries(p.experiences.map((e, i) => [`exp${i}`, { name: e.name, value: e.value! - sum("experience"), core: i < 2 }])),
      attack: { _id: runtime.id(), name: p.attackName, type: "attack", systemPath: "attack", range: ranges[Math.max(0, ranges.indexOf(p.range) - rangeSteps)], roll: { type: "attack", bonus: 0 }, damage: { main: { type: [p.damageType], applyTo: "hitPoints", value: { dice: dice[Math.max(0, dice.indexOf(p.damageDice) - damageSteps)], multiplier: "prof" } } } },
      levelData: { level: { current: c.level, changed: c.level }, levelups }
    },
    flags: { [MODULE_ID]: { reviewedCompanion: clone(p), snapshotLevel: c.level } }
  };
}

function reviewedCharacter(c: ParsedCharacter): ImportReport["reviewedCharacter"] {
  const reviewed = clone(c);
  return { ...reviewed, source: { ...reviewed.source, fields: Object.entries(reviewed.source.fields) } };
}

/** Indented JSON with each [field, value] pair on one line, so a field reads beside its value. */
export function reportJSON(report: ImportReport): string {
  return JSON.stringify(report, null, 2).replace(/\[\n\s+("(?:[^"\\]|\\.)*"),\n\s+("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)\n\s+\]/g, "[$1, $2]");
}

export function makeReport(plan: ResolvedImportPlan, version: string): ImportReport {
  const c = plan.character;
  return {
    moduleVersion: version, systemVersion: plan.systemVersion, sourceFile: c.source.fileName, fingerprint: c.source.fingerprint,
    createdAt: new Date().toISOString(), status: "complete",
    items: plan.resolutions.map(r => ({ name: r.entry.name, source: r.selected ?? null, kind: r.entry.kind })),
    comparisons: clone(plan.comparisons), issues: clone(plan.issues), levelHistory: clone(plan.levelHistory),
    reviewedCharacter: reviewedCharacter(c), verifiedStats: [],
    fieldDisposition: Object.entries(c.source.fields).filter(([, v]) => v !== null && String(v).trim() !== "").map(([k]) => [k, c.source.handled.includes(k) && !plan.issues.some(i => i.field === k) ? "imported" : "reported"])
  };
}

/** Foundry declines a write without throwing: an update, a delete, or a single create returns undefined. */
function written<T>(result: T | undefined, declined: string): T {
  if (!result) throw new Error(declined);
  return result;
}
/** With diff false Foundry returns the actor even when nothing changes, so undefined can only mean declined. */
const update = async (actor: any, data: DocumentSource, declined: string) => written(await actor.update(data, { diff: false }), declined);
/** A declined embedded document is missing from the creation's result. */
async function createEmbedded(actor: any, type: string, sources: DocumentSource[], declined: string): Promise<any[]> {
  const docs = await actor.createEmbeddedDocuments(type, clone(sources), { keepId: true });
  if (sources.some(s => !docs.some((d: any) => d.id === s._id))) throw new Error(declined);
  return docs;
}

/** Creation is deliberately sequential: failures roll back only this import's documents. */
export async function executePlan(plan: ResolvedImportPlan, runtime: ImportRuntime): Promise<{ actor: any; companion?: any; report: ImportReport }> {
  if (!runtime.isGM) throw new Error("Only a GM may import characters.");
  if (!plan.reviewed || plan.issues.some(i => i.blocking) || plan.comparisons.some(c => !c.choice)) throw new Error("Complete the review and resolve every blocking issue first.");
  const created: any[] = [];
  const report = makeReport(plan, runtime.moduleVersion);
  try {
    // Start with no embedded documents, so the system's pre-create and grant behavior runs normally.
    const actor = written(await runtime.createActor(clone(plan.actorData)), "Foundry declined to create the character.");
    created.push(actor);
    const ordered = [...plan.itemSources].sort((a, b) => rank(a) - rank(b));
    for (const source of ordered) {
      // Foundryborne creates the item's linked features in the same operation.
      const docs = await createEmbedded(actor, "Item", [source], `Foundry declined to add “${source.name}”.`);
      const granted = new Set(docs.map(d => d._stats.compendiumSource ?? d._stats.duplicateSource));
      for (const uuid of (source.system.features ?? []).map(linkedUuid)) {
        if (uuid && !granted.has(uuid)) throw new Error(`Foundry declined to add “${(await runtime.getDocument(uuid))?.name ?? uuid}”, granted by “${source.name}”.`);
      }
    }
    const effects = adjustmentEffects(plan.comparisons, () => runtime.id());
    if (effects.length) await createEmbedded(actor, "ActiveEffect", effects, "Foundry declined an imported stat adjustment.");
    let companion: any;
    if (plan.companionData) {
      companion = written(await runtime.createActor(clone(plan.companionData)), "Foundry declined to create the companion.");
      created.push(companion);
      await update(actor, { "system.companion": companion.uuid }, "Foundry declined to link the companion to the character.");
      report.companionUuid = companion.uuid;
      for (const training of plan.character.companion.training.filter(t => ["creatureComfort", "armored", "bonded"].includes(t.type))) {
        const prefix = `DAGGERHEART.APPLICATIONS.Levelup.actions.${training.type}`, name = runtime.localize(`${prefix}.name`);
        await createEmbedded(actor, "Item", [{ _id: runtime.id(), name, type: "feature", system: { description: paragraphs(runtime.localize(`${prefix}.description`)) }, flags: { [MODULE_ID]: { companionTraining: training.type } } }], `Foundry declined to add the companion training feature “${name}”.`);
      }
    }
    const c = plan.character;
    // Restore biography after class hooks append suggested background questions.
    await update(actor, {
      "system.biography": biography(c),
      "system.resources.hitPoints.value": c.resources.hitPoints,
      "system.resources.stress.value": c.resources.stress,
      "system.resources.hope.value": c.resources.hope
    }, "Foundry declined to restore the biography and marked resources.");
    if (c.resources.armor) await actor.system.updateArmorValue({ value: c.resources.armor });
    for (const [path, calculated] of Object.entries(plan.calculatedStats)) {
      const decision = plan.comparisons.find(s => s.path === path);
      const expected = decision?.choice === "pdf" ? decision.pdf : calculated;
      const actual = Number(getPath(actor, path));
      if (actual !== expected) throw new Error(`${decision?.label ?? path} did not match the review: expected ${expected}, got ${actual}.`);
      report.verifiedStats.push([path, actual]);
    }
    for (const [key, expected] of Object.entries(c.resources)) {
      const path = key === "armor" ? "system.armorScore.value" : `system.resources.${key}.value`;
      if (Number(getPath(actor, path)) !== expected) throw new Error(`The imported ${key} marks do not fit the reviewed character.`);
    }
    report.actorUuid = actor.uuid;
    await update(actor, { [`flags.${MODULE_ID}.report`]: report, [`flags.${MODULE_ID}.sourceFields`]: report.reviewedCharacter.source.fields }, "Foundry declined to save the import report on the character.");
    return { actor, companion, report };
  } catch (error: any) {
    const cleanupFailures: string[] = [];
    for (const document of [...created].reverse()) {
      try { written(await document.delete(), "Foundry declined to delete it."); }
      catch (failure: any) { cleanupFailures.push(`${document.name} (${document.uuid}): ${failure.message}`); }
    }
    // A fresh report, so nothing names a rolled-back document or the values verified on it.
    error.importReport = { ...makeReport(plan, runtime.moduleVersion), status: "failed", error: error.message, cleanupFailures } satisfies ImportReport;
    if (cleanupFailures.length) error.message += ` Cleanup could not remove: ${cleanupFailures.join("; ")}`;
    throw error;
  }
}
function rank(s: DocumentSource): number { return s.type === "class" ? (s.system.isMulticlass ? 1 : 0) : s.type === "subclass" ? 2 : s.type === "domainCard" ? 4 : 3; }

export async function loadCatalog(onProgress: (message: string) => void = () => {}): Promise<{ candidates: Candidate[]; issues: Issue[] }> {
  const candidates: Candidate[] = [], issues: Issue[] = [];
  for (const item of game.items.contents) if (item.isOwner || item.testUserPermission(game.user, "OBSERVER")) candidates.push({ uuid: item.uuid, name: item.name, type: item.type, pack: "World items", system: item.toObject().system });
  for (const pack of game.packs) {
    if (pack.documentName !== "Item" || !pack.visible) continue;
    onProgress(`Reading ${pack.title}…`);
    try {
      const index = await pack.getIndex({ fields: ["type", "system.domain", "system.domains", "system.linkedClass", "system.attack.roll.trait"] });
      for (const item of index) candidates.push({ uuid: item.uuid ?? `Compendium.${pack.collection}.Item.${item._id}`, name: item.name, type: item.type, pack: pack.title, system: item.system });
    } catch { issues.push({ code: "pack-unavailable", message: `${pack.title} could not be read and was excluded from matching.` }); }
  }
  return { candidates, issues };
}

export function foundryRuntime(): ImportRuntime {
  const cache = new Map<string, any>();
  return {
    version: game.system.version, moduleVersion: game.modules.get(MODULE_ID).version, domains: Object.keys(CONFIG.DH.DOMAIN.allDomains()), isGM: game.user.isGM,
    levelupAuto: !!game.system.settings.automation.levelupAuto, maxLoadout: game.system.settings.homebrew.maxLoadout,
    id: () => foundry.utils.randomID(),
    getDocument: async uuid => { if (!cache.has(uuid)) cache.set(uuid, await fromUuid(uuid)); return cache.get(uuid); },
    // Construction already initializes and prepares the document. Calling prepareData
    // again without a reset reapplies Foundryborne's additive class HP and Evasion.
    preview: source => new CONFIG.Actor.documentClass(source, { strict: true }),
    createActor: source => CONFIG.Actor.documentClass.create(source, { keepId: true, renderSheet: false }),
    localize: key => game.i18n.localize(key)
  };
}
