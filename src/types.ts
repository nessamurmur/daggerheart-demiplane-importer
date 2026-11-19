export const MODULE_ID = "daggerheart-demiplane-importer";
export const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"] as const;
export type Trait = typeof TRAITS[number];
export type Fields = Record<string, string | boolean | number | null>;
/** PDF field names and document paths contain dots, and Foundry turns dotted keys inside flags into nested objects, so the saved report lists such maps as [key, value] pairs. */
export type FieldPairs = [field: string, value: Fields[string]][];
export type ItemKind = "class" | "subclass" | "ancestry" | "community" | "domainCard" | "weapon" | "armor" | "loot" | "consumable" | "feature";
export interface Issue { code: string; message: string; field?: string; blocking?: boolean; }
export interface Experience { name: string; value: number | null; description?: string; }
export interface Entry {
  id: string; kind: ItemKind; name: string; description: string; fields: string[];
  className?: string; isMulticlass?: boolean; featureState?: number;
  spellcastingTrait?: string; domains?: string[];
  domain?: string; cardType?: string; recallCost?: number | null; level?: number | null;
  equipped?: boolean; secondary?: boolean; inVault?: boolean; quantity?: number;
  trait?: string; range?: string; dice?: string; damageBonus?: number; damageType?: string;
  burden?: string; armorScore?: number | null; major?: number | null; severe?: number | null;
  inventoryText?: boolean; include: boolean; asFeature?: boolean;
  ancestryFeatures?: { primary: string; secondary: string };
}
export interface CompanionInput {
  enabled: boolean; name: string; evasion: number | null; stressMax: number | null;
  stress: number; attackName: string; damageDice: string; damageType: string; range: string;
  experiences: Experience[]; notes: string;
  /** Prior training choices are explicit, never guessed from the partner's level. */
  training: { type: string; data: string[]; tier?: number; value?: number }[];
}
export interface ParsedCharacter {
  source: { fileName: string; fingerprint: string; fields: Fields; handled: string[] };
  name: string; pronouns: string; heritage: string; level: number | null;
  traits: Record<Trait, number | null>; markedTraits: Record<Trait, boolean>;
  stats: Record<string, number | null>;
  resources: { hitPoints: number; stress: number; hope: number; armor: number };
  gold: { handfuls: number; bags: number; chests: number };
  experiences: Experience[]; entries: Entry[];
  biography: { background: string; connections: string; notes: string; details: string };
  mixedAncestry: { enabled: boolean; primaryUuid: string; secondaryUuid: string; name: string };
  companion: CompanionInput;
  issues: Issue[];
}
export interface Candidate {
  uuid: string; name: string; type: string; pack: string;
  system?: Record<string, any>;
}
export interface Resolution {
  entry: Entry; candidates: Candidate[];
  /** undefined = unresolved; null = editable PDF item. */
  selected: string | null | undefined;
}
export interface StatComparison {
  path: string; label: string; pdf: number; calculated: number;
  choice: "foundry" | "pdf" | null;
}
/** One option of a level tier, as Foundryborne's LevelTiers setting stores it. */
export interface LevelOption { type: string; checkboxSelections: number; minCost: number; value?: number | null; amount?: number | null; }
/** One tier of Foundryborne's LevelTiers setting. */
export interface LevelTier {
  tier: number; levels: { start: number; end: number };
  initialAchievements: { experience?: { nr: number; modifier: number }; proficiency?: number | null };
  availableOptions: number; domainCardByLevel: number;
  options: Record<string, LevelOption>;
}
/** A taken level-up checkbox group, in the shape Foundryborne's Actor#levelUp writes. */
export interface LevelupSelection {
  tier: number; level: number; optionKey: string; type: string; checkboxNr: number; minCost: number;
  value?: number; amount?: number; data: string[]; secondaryData?: Record<string, string>; itemUuid?: string;
}
export interface LevelupRecord {
  achievements: { experiences: Record<string, { name: string; modifier: number }>; domainCards: { uuid: string; itemUuid: string }[]; proficiency: number };
  selections: LevelupSelection[];
}
export interface LevelupHistory {
  levelups: Record<string, LevelupRecord>;
  /** What Foundryborne adds from this history when automatic level-up is on. */
  bonuses: { traits: Partial<Record<Trait, number>>; proficiency: number; experiences: Record<string, number> };
  summary: { level: number; choices: string[] }[];
  /** Option slots, counted by cost, that no PDF evidence explains. */
  unexplainedSlots: number;
  /** Choices the PDF implies that could not be recorded, each with its reason. */
  unplaced: string[];
  /** Domain cards that subclass features grant, each with its feature. Level-up history never holds them. */
  subclassCards: string[];
}
export interface ResolvedImportPlan {
  character: ParsedCharacter; resolutions: Resolution[];
  actorData: Record<string, any>; companionData?: Record<string, any>;
  itemSources: Record<string, any>[];
  comparisons: StatComparison[]; issues: Issue[];
  calculatedStats: Record<string, number>;
  levelHistory?: LevelupHistory;
  systemVersion: string; reviewed: boolean;
}
export interface ImportReport {
  moduleVersion: string; systemVersion: string; sourceFile: string; fingerprint: string;
  createdAt: string; actorUuid?: string; companionUuid?: string;
  items: { name: string; source: string | null; kind: string }[];
  comparisons: StatComparison[]; issues: Issue[];
  levelHistory?: LevelupHistory;
  reviewedCharacter: Omit<ParsedCharacter, "source"> & { source: Omit<ParsedCharacter["source"], "fields"> & { fields: FieldPairs } };
  verifiedStats: [path: string, value: number][];
  fieldDisposition: [field: string, disposition: "imported" | "reported"][];
  status: "complete" | "failed"; error?: string; cleanupFailures?: string[];
}
export type DocumentSource = Record<string, any>;
