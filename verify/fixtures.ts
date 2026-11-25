import { PDFDocument } from "pdf-lib";
import { parseFields } from "../src/core.ts";
import type { Candidate, DocumentSource, Entry, Fields, ParsedCharacter, ResolvedImportPlan } from "../src/types.ts";

export const sheet = (extra: Fields = {}): Fields => ({
  name: "Fixture", heritage: "Testfolk", class: "Fixture Class", level: "1",
  agility: "1", strength: "0", finesse: "0", instinct: "2", presence: "-1", knowledge: "1",
  hp_max: "6", stress_max: "6", evasion: "10", ancestry_name: "Fixture Ancestry", ...extra,
});

export const characterFrom = (extra: Fields = {}): ParsedCharacter => parseFields(sheet(extra), "fixture.pdf", "fp");

export function entry(partial: Pick<Entry, "id" | "kind" | "name"> & Partial<Entry>): Entry {
  return { description: "", fields: [], include: true, ...partial };
}

export function candidate(partial: Pick<Candidate, "uuid" | "name" | "type"> & Partial<Candidate>): Candidate {
  return { pack: "Pack", ...partial };
}

export function planFor(character: ParsedCharacter, extra: Partial<ResolvedImportPlan> = {}): ResolvedImportPlan {
  const reviewed = character;
  reviewed.resources = { hitPoints: 0, stress: 0, hope: 0, armor: 0 };
  return {
    character: reviewed, resolutions: [], actorData: { _id: "new-character", name: reviewed.name, type: "character", system: {} },
    itemSources: [], comparisons: [], issues: [], calculatedStats: {}, systemVersion: "2.10.2", reviewed: true, ...extra,
  };
}

export function sourceItem(type: string, index: number, system: Record<string, unknown> = {}): DocumentSource {
  return { _id: `item-${index}-${type}`, name: `${type} ${index}`, type, system: { features: [], ...system } };
}

/** A one-page AcroForm PDF whose text fields are exactly `values`. Generated in memory; nothing is written to disk. */
export async function formPdf(values: Record<string, string>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  let y = 740;
  for (const [name, value] of Object.entries(values)) {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 36, y, width: 520, height: 16 });
    field.setText(value);
    y = y < 48 ? 740 : y - 22;
  }
  return pdf.save();
}

/** A PDF with `pages` blank pages and the four fields readPdf requires, on page 1. */
export async function pagedPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const page = pdf.getPages()[0];
  for (const [name, value, y] of [["name", "N", 700], ["heritage", "H", 660], ["agility", "1", 620], ["ancestry_name", "A", 580]] as const) {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 36, y, width: 200, height: 16 });
    field.setText(value);
  }
  return pdf.save();
}
