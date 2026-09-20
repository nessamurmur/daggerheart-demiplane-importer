import { MODULE_ID, type Fields, type ParsedCharacter } from "./types.ts";
import { parseFields } from "./core.ts";

/** No PDF viewer or scripting sandbox is instantiated. PDFs never leave the browser. */
export async function readPdf(bytes: Uint8Array, fileName: string, library?: any): Promise<ParsedCharacter> {
  if (bytes.byteLength > 30 * 1024 * 1024) throw new Error("Choose a PDF smaller than 30 MB.");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("This file is not a PDF.");
  const pdfjs = library ?? await import(/* @vite-ignore */ `/modules/${MODULE_ID}/vendor/pdf.mjs`);
  if (!library) pdfjs.GlobalWorkerOptions.workerSrc = `/modules/${MODULE_ID}/vendor/pdf.worker.mjs`;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true, stopAtErrors: true });
  let pdf: any;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 50) throw new Error("This PDF has more than 50 pages. Export the character sheet by itself.");
    const fields: Fields = Object.create(null);
    const conflicts: string[] = [];
    // Some Demiplane biography widgets are orphaned from /AcroForm/Fields.
    // Read the page widgets as well as the canonical field tree.
    const objects = await pdf.getFieldObjects();
    for (const [name, group] of objects instanceof Map ? objects.entries() : Object.entries(objects ?? {})) {
      for (const widget of group as any[]) {
        if (!widget.kidIds?.length) fields[name] = widget.value ?? null;
      }
    }
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const annotations = await page.getAnnotations({ intent: "display" });
      for (const annotation of annotations) {
        if (!annotation.fieldName || !["Tx", "Btn", "Ch"].includes(annotation.fieldType)) continue;
        const val = annotation.fieldValue ?? null;
        const old = fields[annotation.fieldName];
        if (old !== undefined && old !== null && val !== null && String(old) !== String(val)) conflicts.push(annotation.fieldName);
        fields[annotation.fieldName] = val;
      }
      page.cleanup();
    }
    if (!("name" in fields) || !("heritage" in fields) || !("agility" in fields) || !("ancestry_name" in fields)) {
      throw new Error("No supported Demiplane character form was found. Use the original exported PDF; scanned or flattened PDFs are not supported.");
    }
    const digest = globalThis.crypto?.subtle ? await crypto.subtle.digest("SHA-256", await pdf.getData()) : null;
    const fingerprint = digest ? Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, "0")).join("") : pdf.fingerprints?.[0] ?? "";
    const character = parseFields(fields, fileName, fingerprint);
    for (const key of conflicts) character.issues.push({ code: "field-conflict", field: key, message: `${key}: the PDF has conflicting form values; the page widget value is shown for review.` });
    return character;
  } catch (error: any) {
    if (error.name === "PasswordException") throw new Error("This PDF is password-protected. Export an unlocked character sheet.");
    throw error;
  } finally {
    await task.destroy();
  }
}
