import { test } from "node:test";
import assert from "node:assert/strict";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdf } from "../src/pdf.ts";

test("rejects non-PDF and corrupted PDF files", async () => {
  await assert.rejects(readPdf(new TextEncoder().encode("not a PDF"), "fake.pdf", pdfjs), /not a PDF/);
  await assert.rejects(readPdf(new TextEncoder().encode("%PDF-1.7\ncorrupt"), "broken.pdf", pdfjs));
});
test("rejects excessively large inputs before parsing", async () => {
  await assert.rejects(readPdf(new Uint8Array(31 * 1024 * 1024), "huge.pdf", pdfjs), /30 MB/);
});
