import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { finiteNumber, parseFields } from "../src/core.ts";
import { readPdf } from "../src/pdf.ts";
import { check } from "./check.ts";
import { formPdf, pagedPdf } from "./fixtures.ts";

test("readPdf returns the form values that were written into the generated PDF", async () => {
  const value = fc.string({ unit: "grapheme-ascii", maxLength: 24 });
  await check(fc.asyncProperty(
    fc.record({
      name: value, heritage: value, ancestry_name: value, extra_note: value,
      agility: fc.constantFrom("", "0", "1", "-1", "2", "nope"),
      level: fc.constantFrom("", "1", "0", "10", "x"),
    }),
    async values => {
      const character = await readPdf(await formPdf(values), "generated.pdf", pdfjs);
      assert.deepEqual(Object.fromEntries(Object.entries(character.source.fields)), Object.fromEntries(Object.entries(values)));
      const parsed = parseFields(character.source.fields, "generated.pdf", character.source.fingerprint);
      assert.equal(character.name, parsed.name);
      assert.equal(character.traits.agility, finiteNumber(values.agility));
      assert.equal(character.level, finiteNumber(values.level));
      for (const issue of parsed.issues) assert.ok(character.issues.some(found => found.code === issue.code && found.field === issue.field));
    },
  ), 8);
});

test("readPdf refuses a PDF over 50 pages or 30 MB and disables document JavaScript", async () => {
  await assert.rejects(readPdf(await pagedPdf(51), "many.pdf", pdfjs), /50 pages/);
  await assert.rejects(readPdf(new Uint8Array(30 * 1024 * 1024 + 1), "big.pdf", pdfjs), /30 MB/);
  await assert.rejects(readPdf(new TextEncoder().encode("not a pdf"), "text.pdf", pdfjs), /not a PDF/);
  let options: { isEvalSupported?: boolean; stopAtErrors?: boolean } | undefined;
  const library = {
    getDocument(received: { isEvalSupported?: boolean; stopAtErrors?: boolean }) {
      options = received;
      const error = new Error("stop");
      error.name = "Stop";
      return { promise: Promise.reject(error), destroy: async () => {} };
    },
  };
  await assert.rejects(readPdf(new TextEncoder().encode("%PDF-1.7\n"), "x.pdf", library), /stop/);
  assert.equal(options?.isEvalSupported, false);
  assert.equal(options?.stopAtErrors, true);
});
