import { MODULE_ID, TRAITS, type Candidate, type Entry, type Experience, type Fields, type Issue, type ParsedCharacter, type Resolution, type Trait } from "./types.ts";

export function escapeHTML(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function paragraphs(value: string): string {
  return value.trim() ? value.split(/\n\s*\n/).map(p => `<p>${escapeHTML(p).replace(/\n/g, "<br>")}</p>`).join("") : "";
}
export function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’'`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const s = String(value).trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function checked(value: unknown): boolean {
  return value === true || value === 1 || /^(\/?yes|on|true|1)$/i.test(String(value));
}
export function getPath(object: any, path: string): any {
  return path.split(".").reduce((v, k) => v?.[k], object);
}
export function setPath(object: any, path: string, value: any): void {
  const parts = path.split(".");
  if (parts.some(p => ["__proto__", "prototype", "constructor"].includes(p))) throw new Error("Invalid property path");
  let cursor = object;
  for (const p of parts.slice(0, -1)) cursor = cursor[p] ??= {};
  cursor[parts.at(-1)!] = value;
}
export function parseWeapon(traitAndRange: string, damage: string): Partial<Entry> {
  const trait = TRAITS.find(t => traitAndRange.toLowerCase().includes(t));
  const rangeText = traitAndRange.toLowerCase().replace(trait ?? "", "").trim();
  const ranges: Record<string, string> = { melee: "melee", "very close": "veryClose", close: "close", far: "far", "very far": "veryFar" };
  const match = damage.trim().match(/^(\d+)d(4|6|8|10|12|20)\s*([+-]\s*\d+)?\s*(physical|magical|magic)$/i);
  return { trait, range: ranges[rangeText], ...(match ? { dice: `d${match[2]}`, damageBonus: Number((match[3] ?? "0").replace(/\s/g, "")), damageType: match[4].toLowerCase() === "physical" ? "physical" : "magical" } : {}) };
}

/** Form names, rather than page numbers, identify data. Druid exports insert reference pages. */
export function parseFields(fields: Fields, fileName = "character.pdf", fingerprint = ""): ParsedCharacter {
  const handled = new Set<string>();
  const issues: Issue[] = [];
  const value = (key: string) => { if (key in fields) handled.add(key); return fields[key]; };
  const str = (key: string) => String(value(key) ?? "").trim();
  const num = (key: string) => {
    const raw = value(key); const n = finiteNumber(raw);
    if (raw !== null && raw !== undefined && String(raw).trim() && n === null) issues.push({ code: "invalid-number", field: key, message: `${key}: “${raw}” is not a number; review it.` });
    return n;
  };
  const bool = (key: string) => checked(value(key));
  const count = (prefix: string) => Object.keys(fields).filter(k => k.startsWith(prefix + ".") && typeof fields[k] !== "object").reduce((sum, k) => sum + Number(bool(k)), 0);
  const entries: Entry[] = [];
  const add = (kind: Entry["kind"], name: string, description: string, keys: string[], extra: Partial<Entry> = {}) => {
    if (!name.trim()) return;
    entries.push({ id: `entry-${entries.length}`, kind, name: name.trim(), description: description.trim(), fields: keys, include: true, ...extra });
  };
  const name = str("name");
  const classHeader = str("class");
  const className = classHeader.split(/\s+[-–—]\s*/)[0]?.trim() ?? "";
  const classes = new Map<string, string>();
  if (className) classes.set(normalizeName(className), className);
  const subclasses: Entry[] = [];
  for (let i = 1; i <= 3; i++) {
    const subName = str(`subclass_name_${i}`), parent = str(`subclass_class_${i}`) || className;
    const description = str(`subclass_feature_${i}`), spellcastingTrait = str(`subclass_trait_${i}`).toLowerCase();
    const foundation = bool(`subclass_foundation_${i}`), specialization = bool(`subclass_specialization_${i}`), mastery = bool(`subclass_mastery_${i}`);
    if (!subName) continue;
    if (parent) classes.set(normalizeName(parent), parent);
    const previous = subclasses.find(s => normalizeName(s.name) === normalizeName(subName) && normalizeName(s.className ?? "") === normalizeName(parent));
    const state = mastery ? 3 : specialization ? 2 : 1;
    if (previous) { previous.featureState = Math.max(previous.featureState!, state); previous.description += description ? `\n\n${description}` : ""; }
    else subclasses.push({ id: "", kind: "subclass", name: subName, description, className: parent, spellcastingTrait, featureState: state, include: true, fields: [`subclass_name_${i}`, `subclass_class_${i}`, `subclass_feature_${i}`] });
    if (!foundation && !specialization && !mastery) issues.push({ code: "subclass-state", message: `${subName}: no advancement marked; foundation is proposed for review.` });
  }
  [...classes.values()].forEach((n, i) => add("class", n, "", ["class"], { isMulticlass: i > 0, domains: [] }));
  for (const sub of subclasses) add("subclass", sub.name, sub.description, sub.fields, { ...sub, id: `entry-${entries.length}`, isMulticlass: normalizeName(sub.className ?? "") !== normalizeName([...classes.values()][0] ?? "") });
  const ancestryPrimary = str("ancestry_feature_1"), ancestrySecondary = str("ancestry_feature_2");
  add("ancestry", str("ancestry_name"), [ancestryPrimary, ancestrySecondary].filter(Boolean).join("\n\n"), ["ancestry_name", "ancestry_feature_1", "ancestry_feature_2"], { ancestryFeatures: { primary: ancestryPrimary, secondary: ancestrySecondary } });
  add("community", str("community_name"), str("community_feature"), ["community_name", "community_feature"]);
  for (const key of Object.keys(fields).filter(k => /^domain_card_name\.\d+\.\d+$/.test(k))) {
    const suffix = key.slice("domain_card_name".length);
    const cardName = str(key), description = str(`domain_card_feature${suffix}`), domain = str(`domain_card_domain${suffix}`).toLowerCase();
    const cardType = str(`domain_card_type${suffix}`).toLowerCase(), recallCost = num(`domain_card_recall${suffix}`), inVault = bool(`domain_card_archived${suffix}`);
    add("domainCard", cardName, description, [key, `domain_card_feature${suffix}`, `domain_card_domain${suffix}`, `domain_card_type${suffix}`, `domain_card_recall${suffix}`, `domain_card_archived${suffix}`], { domain, cardType, recallCost, inVault, level: null });
  }
  for (const slot of ["primary", "secondary", "inventory0", "inventory1"]) {
    const inventory = slot.startsWith("inventory"), index = slot.at(-1);
    const key = (part: string) => inventory ? `inventory_weapon_${part}.${index}` : `${slot}_weapon_${part}`;
    const weaponName = str(key("name")), traitText = str(key("trait")), damageText = str(key("damage")), description = str(key("feature"));
    const handPrefix = inventory ? `inventory_${Number(index) + 1}` : "active";
    const one = bool(`${handPrefix}_hand_1`), two = bool(`${handPrefix}_hand_2`);
    const secondary = inventory ? bool(`${handPrefix}_secondary`) : slot === "secondary";
    if (inventory) bool(`${handPrefix}_primary`);
    const weapon = parseWeapon(traitText, damageText);
    add("weapon", weaponName, description, [key("name"), key("trait"), key("damage"), key("feature")], { equipped: !inventory, secondary, ...weapon, burden: two ? "twoHanded" : one ? "oneHanded" : undefined });
    if (weaponName && (!weapon.dice || !weapon.trait || !weapon.range)) issues.push({ code: "weapon-details", message: `${weaponName}: incomplete attack data; use a matched item or fill in its attack details.` });
  }
  const armorName = str("armor_name"), armorDescription = str("armor_feature"), armorScore = num("armor_score"), thresholds = str("armor_thresholds");
  const thresholdMatch = thresholds.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (thresholds && !thresholdMatch) issues.push({ code: "armor-thresholds", field: "armor_thresholds", message: `Armor base thresholds “${thresholds}” are malformed; use matched armor or enter the base thresholds.` });
  add("armor", armorName, armorDescription, ["armor_name", "armor_feature", "armor_score", "armor_thresholds"], { equipped: true, armorScore, major: thresholdMatch ? Number(thresholdMatch[1]) : null, severe: thresholdMatch ? Number(thresholdMatch[2]) : null });
  const inventoryText = str("inventory");
  for (const chunk of inventoryText.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) {
    const duplicate = entries.find(e => ["weapon", "armor"].includes(e.kind) && normalizeName(e.name) === normalizeName(chunk));
    if (duplicate) { issues.push({ code: "inventory-duplicate", field: "inventory", message: `“${chunk}” also appears in an equipment slot; a second copy is excluded unless added during review.` }); continue; }
    add("loot", chunk, "", ["inventory"], { inventoryText: true, quantity: 1 });
    if (/^\d+\S/.test(chunk)) issues.push({ code: "inventory-prefix", field: "inventory", message: `Review “${chunk}”: the leading digits may be an export error. No quantity was inferred.` });
  }
  const experiences: Experience[] = [];
  for (const key of Object.keys(fields).filter(k => /^experience_name\.\d+$/.test(k))) {
    const n = str(key), bonus = num(key.replace("_name", "_bonus"));
    if (n) experiences.push({ name: n, value: bonus });
  }
  const classFeatures = Object.keys(fields).filter(k => /^classfeature\.\d+$/.test(k)).map(str).filter(Boolean);
  const hopeFeature = str("hope_feature");
  const biography = { background: "", connections: "", notes: "", details: "" };
  for (const key of Object.keys(fields)) {
    if (handled.has(key)) continue;
    const group = /background|question/i.test(key) ? "background" : /connection/i.test(key) ? "connections" : /notes/i.test(key) ? "notes" : /clothes|eyes|body|color|attitude|details|description|character_pronouns/i.test(key) ? "details" : null;
    if (group) { const content = str(key); if (content) biography[group] += `${key.replace(/[_.]/g, " ")}: ${content}\n`; }
  }
  if (classFeatures.length) biography.notes += `Exported class features:\n${classFeatures.join("\n\n")}\n`;
  if (hopeFeature) biography.notes += `Exported Hope feature:\n${hopeFeature}\n`;
  const character: ParsedCharacter = {
    source: { fileName, fingerprint, fields: structuredClone(fields), handled: [] }, name,
    pronouns: str("pronouns"), heritage: str("heritage"), level: num("level"),
    traits: Object.fromEntries(TRAITS.map(t => [t, num(t)])) as ParsedCharacter["traits"],
    markedTraits: Object.fromEntries(TRAITS.map(t => [t, bool(`${t}_marked`)])) as Record<Trait, boolean>,
    stats: { evasion: num("evasion"), armor: num("armor"), major: num("majorDamage"), severe: num("severeDamage"), hitPoints: num("hp_max"), stress: num("stress_max"), proficiency: count("proficiency") || null },
    resources: { hitPoints: count("hp"), stress: count("stress"), hope: count("hope"), armor: count("armor_slot") },
    gold: { handfuls: count("gold_handful"), bags: count("gold_bag"), chests: Number(bool("gold_chest")) },
    experiences, entries, biography, issues,
    mixedAncestry: { enabled: false, primaryUuid: "", secondaryUuid: "", name: "" },
    companion: { enabled: false, name: "", evasion: null, stressMax: null, stress: 0, attackName: "", damageDice: "d6", damageType: "physical", range: "melee", experiences: [{ name: "", value: null }, { name: "", value: null }], notes: "", training: [] }
  };
  for (const [key, v] of Object.entries(fields)) {
    if (handled.has(key) || v === null || v === false || v === "" || v === "/Off" || String(v).trim() === "") continue;
    issues.push({ code: "unmapped-field", field: key, message: `${key}: ${String(v)} (retained in the import report).` });
  }
  if ((character.level ?? 0) > 1) issues.push({ code: "snapshot", message: "This import is a current-state snapshot. The PDF does not contain a complete history of level-up choices." });
  character.source.handled = [...handled];
  return character;
}

export function candidatesFor(entry: Entry, candidates: Candidate[]): Candidate[] {
  const kinds = entry.inventoryText ? ["weapon", "armor", "loot", "consumable"] : [entry.kind];
  let matches = candidates.filter(c => kinds.includes(c.type) && normalizeName(c.name) === normalizeName(entry.name));
  if (entry.domain) {
    const constrained = matches.filter(c => !c.system?.domain || normalizeName(c.system.domain) === normalizeName(entry.domain!));
    if (constrained.length) matches = constrained;
  }
  if (entry.kind === "weapon" && entry.trait) {
    const constrained = matches.filter(c => !c.system?.attack?.roll?.trait || c.system.attack.roll.trait === entry.trait);
    if (constrained.length) matches = constrained;
  }
  return matches.sort((a, b) => a.pack.localeCompare(b.pack) || a.uuid.localeCompare(b.uuid));
}
export function resolveEntries(character: ParsedCharacter, candidates: Candidate[]): Resolution[] {
  return character.entries.filter(e => e.include).map(entry => {
    let matches = candidatesFor(entry, candidates);
    if (entry.kind === "subclass" && entry.className) {
      const classUuids = candidates.filter(c => c.type === "class" && normalizeName(c.name) === normalizeName(entry.className!)).map(c => c.uuid);
      const linked = matches.filter(c => classUuids.includes(c.system?.linkedClass));
      if (linked.length) matches = linked;
    }
    return { entry, candidates: matches, selected: matches.length === 1 ? matches[0].uuid : matches.length === 0 ? null : undefined };
  });
}

export function validateCharacter(c: ParsedCharacter): Issue[] {
  const issues: Issue[] = [];
  const require = (condition: unknown, message: string) => { if (!condition) issues.push({ code: "required", blocking: true, message }); };
  require(c.name.trim(), "Enter a character name.");
  require(Number.isInteger(c.level) && c.level! >= 1 && c.level! <= 10, "Enter a level from 1 to 10.");
  for (const t of TRAITS) require(Number.isInteger(c.traits[t]), `Enter the ${t} trait (zero is valid).`);
  require(c.entries.some(e => e.kind === "class" && e.include && !e.isMulticlass), "Select a main class.");
  require(c.entries.filter(e => e.kind === "class" && e.include).length <= 2, "Foundryborne supports a main class and one multiclass.");
  require(c.entries.filter(e => e.kind === "class" && e.include && !e.isMulticlass).length === 1, "Choose exactly one main class.");
  c.experiences.forEach(e => require(e.name.trim() && Number.isInteger(e.value), `Enter a bonus for experience “${e.name}”, or remove it.`));
  for (const [key, n] of Object.entries(c.resources)) require(Number.isInteger(n) && n >= 0, `Enter a nonnegative whole number for marked ${key}.`);
  for (const [key, n] of Object.entries(c.gold)) require(Number.isInteger(n) && n >= 0, `Enter a nonnegative whole number for gold ${key}.`);
  for (const [key, n] of Object.entries(c.stats)) require(n === null || Number.isInteger(n) && n >= 0, `Use a nonnegative whole number or leave ${key} blank.`);
  if (c.mixedAncestry.enabled) require(c.mixedAncestry.primaryUuid && c.mixedAncestry.secondaryUuid && c.mixedAncestry.name.trim(), "Choose both ancestry sources and a name for the mixed ancestry.");
  if (c.companion.enabled) {
    const p = c.companion;
    require(p.name.trim(), "Enter a companion name.");
    require(Number.isInteger(p.evasion) && p.evasion! >= 1, "Enter the companion’s evasion.");
    require(Number.isInteger(p.stressMax) && p.stressMax! >= 1, "Enter the companion’s maximum Stress.");
    require(Number.isInteger(p.stress) && p.stress >= 0 && p.stress <= p.stressMax!, "Companion marked Stress must fit its maximum.");
    require(p.attackName.trim(), "Enter the companion’s attack name.");
    p.experiences.forEach(e => require(e.name.trim() && Number.isInteger(e.value), "Enter both companion experiences and their bonuses."));
    require(p.training.length === (c.level ?? 1) - 1, `Record ${Math.max(0, (c.level ?? 1) - 1)} previous companion training choices so they are not granted again.`);
    const trainingLimits: Record<string, number> = { experience: 3, hope: 1, creatureComfort: 1, armored: 1, vicious: 3, stress: 3, bonded: 1, evasion: 3 };
    for (const t of p.training) {
      require(t && t.type in trainingLimits, "Choose a valid companion training option for every previous level.");
      if (t?.type === "vicious") require(["damage", "range"].includes(t.data[0]), "Choose damage or range for Vicious training.");
    }
    for (const [type, max] of Object.entries(trainingLimits)) require(p.training.filter(t => t?.type === type).length <= max, `Companion training “${type}” can be selected at most ${max} times.`);
    const dice = ["d4", "d6", "d8", "d10", "d12", "d20"], ranges = ["melee", "veryClose", "close", "far", "veryFar"];
    require(dice.includes(p.damageDice) && ranges.includes(p.range) && ["physical", "magical"].includes(p.damageType), "Choose valid companion attack details.");
    require(p.evasion! - 2 * p.training.filter(t => t?.type === "evasion").length >= 1, "Companion evasion is too low for the recorded Aware training.");
    require(p.stressMax! - p.training.filter(t => t?.type === "stress").length >= 0, "Companion Stress is too low for the recorded Resilient training.");
    require(dice.indexOf(p.damageDice) >= p.training.filter(t => t?.type === "vicious" && t.data[0] === "damage").length, "Companion damage die is too small for the recorded Vicious training.");
    require(ranges.indexOf(p.range) >= p.training.filter(t => t?.type === "vicious" && t.data[0] === "range").length, "Companion range is too short for the recorded Vicious training.");
  }
  return issues;
}

export function sourceFlags(entry: Entry, uuid: string | null): Record<string, unknown> {
  return { [MODULE_ID]: { originalType: entry.kind, sourceUuid: uuid, sourceFields: entry.fields, original: structuredClone(entry), incomplete: uuid === null } };
}
