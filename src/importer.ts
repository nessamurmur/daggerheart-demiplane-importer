import { MODULE_ID, TRAITS, type Candidate, type DocumentSource, type Entry, type ImportReport, type Issue, type ParsedCharacter, type ResolvedImportPlan, type Resolution, type StatComparison } from "./types.ts";
import { escapeHTML, getPath, normalizeName, paragraphs, sourceFlags, validateCharacter } from "./core.ts";

export interface ImportRuntime {
  version: string; moduleVersion: string; domains: string[]; isGM: boolean;
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

async function expandGrants(sources: DocumentSource[], runtime: ImportRuntime): Promise<DocumentSource[]> {
  const expanded = clone(sources);
  for (const granter of sources) {
    for (const link of granter.system.features ?? []) {
      const uuid = typeof link.item === "string" ? link.item : link.item?.uuid;
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
  for (const [field, name] of Object.entries(c.source.fields)) {
    if (!/^experience_name\.\d+$/.test(field) || !name || c.experiences.some(e => e.fields?.includes(field))) continue;
    for (const key of [field, field.replace("_name", "_bonus")]) issues.push({ code: "excluded-experience", field: key, message: `${name}: experience removed during review; the original PDF value is retained in the report.` });
  }
  const actorId = runtime.id();
  const sources: DocumentSource[] = [];
  const plan: ResolvedImportPlan = { character: clone(c), resolutions: clone(resolutions), actorData: {}, itemSources: sources, comparisons: [], calculatedStats: {}, issues, systemVersion: runtime.version, reviewed: false };
  if ((c.level ?? 1) > 1 && !issues.some(i => i.code === "snapshot")) issues.push({ code: "snapshot", message: "This import is a current-state snapshot. Earlier level-up choices are unavailable; future advancement starts after the imported level." });
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
  let expanded: DocumentSource[];
  try { expanded = await expandGrants(sources, runtime); }
  catch (e) { issues.push(error((e as Error).message)); return plan; }
  const preview = runtime.preview({ ...clone(actorData), items: expanded });
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
  if (c.stats.proficiency === null) issues.push({ code: "default-proficiency", message: "No Proficiency was marked. Foundry’s starting Proficiency of 1 is proposed; edit it if needed." });
  return plan;
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
  const levelups = Object.fromEntries(p.training.map((t, i) => [String(i + 2), { achievements: { experiences: {}, domainCards: [], proficiency: 0 }, selections: [{ ...t, tier: 1, level: i + 2, optionKey: t.type, checkboxNr: p.training.slice(0, i).filter(x => x.type === t.type).length, value: t.type === "evasion" ? 2 : 1, data: t.data, features: [] }] }]));
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

export function makeReport(plan: ResolvedImportPlan, version: string): ImportReport {
  const c = plan.character;
  return {
    moduleVersion: version, systemVersion: plan.systemVersion, sourceFile: c.source.fileName, fingerprint: c.source.fingerprint,
    createdAt: new Date().toISOString(), status: "complete",
    items: plan.resolutions.map(r => ({ name: r.entry.name, source: r.selected ?? null, kind: r.entry.kind })),
    comparisons: clone(plan.comparisons), issues: clone(plan.issues),
    reviewedCharacter: clone(c), verifiedStats: {},
    fieldDisposition: Object.fromEntries(Object.entries(c.source.fields).filter(([, v]) => v !== null && String(v).trim() !== "").map(([k]) => [k, c.source.handled.includes(k) && !plan.issues.some(i => i.field === k) ? "imported" : "reported"]))
  };
}

/** Creation is deliberately sequential: failures roll back only this import's documents. */
export async function executePlan(plan: ResolvedImportPlan, runtime: ImportRuntime): Promise<{ actor: any; companion?: any; report: ImportReport }> {
  if (!runtime.isGM) throw new Error("Only a GM may import characters.");
  if (!plan.reviewed || plan.issues.some(i => i.blocking) || plan.comparisons.some(c => !c.choice)) throw new Error("Complete the review and resolve every blocking issue first.");
  const created: any[] = [];
  const report = makeReport(plan, runtime.moduleVersion);
  try {
    // Start with no embedded documents, so the system's pre-create and grant behavior runs normally.
    const actor = await runtime.createActor(clone(plan.actorData));
    if (!actor) throw new Error("Foundry declined to create the character.");
    created.push(actor);
    const ordered = [...plan.itemSources].sort((a, b) => rank(a) - rank(b));
    for (const source of ordered) {
      const docs = await actor.createEmbeddedDocuments("Item", [clone(source)], { keepId: true });
      if (!docs?.some((d: any) => d.id === source._id)) throw new Error(`Foundry declined to add “${source.name}”.`);
    }
    const effects = adjustmentEffects(plan.comparisons, () => runtime.id());
    if (effects.length) {
      const docs = await actor.createEmbeddedDocuments("ActiveEffect", effects, { keepId: true });
      if (docs.length !== effects.length) throw new Error("Foundry declined an imported stat adjustment.");
    }
    let companion: any;
    if (plan.companionData) {
      companion = await runtime.createActor(clone(plan.companionData));
      if (!companion) throw new Error("Foundry declined to create the companion.");
      created.push(companion);
      await actor.update({ "system.companion": companion.uuid });
      report.companionUuid = companion.uuid;
      for (const training of plan.character.companion.training.filter(t => ["creatureComfort", "armored", "bonded"].includes(t.type))) {
        const prefix = `DAGGERHEART.APPLICATIONS.Levelup.actions.${training.type}`;
        await actor.createEmbeddedDocuments("Item", [{ name: runtime.localize(`${prefix}.name`), type: "feature", system: { description: paragraphs(runtime.localize(`${prefix}.description`)) }, flags: { [MODULE_ID]: { companionTraining: training.type } } }]);
      }
    }
    const c = plan.character;
    // Restore biography after class hooks append suggested background questions.
    await actor.update({
      "system.biography": biography(c),
      "system.resources.hitPoints.value": c.resources.hitPoints,
      "system.resources.stress.value": c.resources.stress,
      "system.resources.hope.value": c.resources.hope
    });
    if (c.resources.armor) await actor.system.updateArmorValue({ value: c.resources.armor });
    for (const [path, calculated] of Object.entries(plan.calculatedStats)) {
      const decision = plan.comparisons.find(s => s.path === path);
      const expected = decision?.choice === "pdf" ? decision.pdf : calculated;
      const actual = Number(getPath(actor, path));
      if (actual !== expected) throw new Error(`${decision?.label ?? path} did not match the review: expected ${expected}, got ${actual}.`);
      report.verifiedStats[path] = actual;
    }
    for (const [key, expected] of Object.entries(c.resources)) {
      const path = key === "armor" ? "system.armorScore.value" : `system.resources.${key}.value`;
      if (Number(getPath(actor, path)) !== expected) throw new Error(`The imported ${key} marks do not fit the reviewed character.`);
    }
    report.actorUuid = actor.uuid;
    await actor.update({ [`flags.${MODULE_ID}.report`]: report, [`flags.${MODULE_ID}.sourceFields`]: c.source.fields });
    return { actor, companion, report };
  } catch (error: any) {
    report.status = "failed";
    report.cleanupFailures = [];
    for (const document of [...created].reverse()) {
      try { await document.delete(); }
      catch (failure: any) { report.cleanupFailures.push(`${document.name} (${document.uuid}): ${failure.message}`); }
    }
    error.importReport = report;
    if (report.cleanupFailures.length) error.message += ` Cleanup could not remove: ${report.cleanupFailures.join("; ")}`;
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
    id: () => foundry.utils.randomID(),
    getDocument: async uuid => { if (!cache.has(uuid)) cache.set(uuid, await fromUuid(uuid)); return cache.get(uuid); },
    // Construction already initializes and prepares the document. Calling prepareData
    // again without a reset reapplies Foundryborne's additive class HP and Evasion.
    preview: source => new CONFIG.Actor.documentClass(source, { strict: true }),
    createActor: source => CONFIG.Actor.documentClass.create(source, { keepId: true, renderSheet: false }),
    localize: key => game.i18n.localize(key)
  };
}
