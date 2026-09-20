export const MODULE_ID = "daggerheart-demiplane-importer";
export const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"] as const;
export type Trait = typeof TRAITS[number];
export type Fields = Record<string, string | boolean | number | null>;
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
export interface ResolvedImportPlan {
  character: ParsedCharacter; resolutions: Resolution[];
  actorData: Record<string, any>; companionData?: Record<string, any>;
  itemSources: Record<string, any>[];
  comparisons: StatComparison[]; issues: Issue[];
  calculatedStats: Record<string, number>;
  systemVersion: string; reviewed: boolean;
}
export interface ImportReport {
  moduleVersion: string; systemVersion: string; sourceFile: string; fingerprint: string;
  createdAt: string; actorUuid?: string; companionUuid?: string;
  items: { name: string; source: string | null; kind: string }[];
  comparisons: StatComparison[]; issues: Issue[];
  reviewedCharacter: ParsedCharacter;
  verifiedStats: Record<string, number>;
  fieldDisposition: Record<string, "imported" | "reported">;
  status: "complete" | "failed"; cleanupFailures?: string[];
}
export type DocumentSource = Record<string, any>;
