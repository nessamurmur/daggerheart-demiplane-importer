import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdf } from "../../src/pdf.ts";
import { resolveEntries } from "../../src/core.ts";
import { buildPlan } from "../../src/importer.ts";
import { mockRuntime } from "../helpers.ts";
import type { Candidate, DocumentSource } from "../../src/types.ts";

// Reference data is read from an external upstream checkout, never copied or shipped.
test("private PDFs resolve against an unmodified Foundryborne 2.10.2 source catalog", async t => {
  const reference = process.env.FOUNDRYBORNE_REFERENCE_DIR;
  if (!reference) return t.skip("Set FOUNDRYBORNE_REFERENCE_DIR to an upstream 2.10.2 checkout");
  const system = JSON.parse(await fs.readFile(path.join(reference, "system.json"), "utf8"));
  assert.equal(system.version, "2.10.2");
  const documents: Record<string, DocumentSource> = {}, catalog: Candidate[] = [];
  for (const pack of system.packs.filter((p: any) => p.type === "Item")) {
    const dir = path.join(reference, "src", pack.path.replace(/\.db$/, ""));
    for (const file of await fs.readdir(dir, { recursive: true })) {
      if (!file.endsWith(".json")) continue;
      const doc = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
      if (!doc.system || !doc._id) continue;
      const uuid = `Compendium.daggerheart.${pack.name}.Item.${doc._id}`;
      documents[uuid] = doc;
      catalog.push({ uuid, name: doc.name, type: doc.type, pack: pack.label, system: doc.system });
    }
  }
  const sampleDir = process.env.DEMIPLANE_SAMPLE_DIR ?? path.join(os.homedir(), "Downloads");
  const jen = await readPdf(new Uint8Array(await fs.readFile(path.join(sampleDir, "druid.pdf"))), "druid.pdf", pdfjs);
  for (const exp of jen.experiences) exp.value ??= 0;
  const resolutions = resolveEntries(jen, catalog);
  assert.equal(resolutions.length, 9);
  assert(resolutions.every(r => typeof r.selected === "string"), "Every Jen item should have exactly one installed SRD match");
  const { runtime } = mockRuntime(documents);
  runtime.domains = ["arcana", "blade", "bone", "codex", "grace", "midnight", "sage", "splendor", "valor"];
  const plan = await buildPlan(jen, resolutions, runtime);
  assert.deepEqual(plan.issues.filter(i => i.blocking), []);
  assert(plan.itemSources.filter(s => s.type === "domainCard").every(s => s.system.inVault));
  const shield = plan.itemSources.find(s => s.name === "Round Shield")!;
  const armor = plan.itemSources.find(s => s.type === "armor")!;
  assert.equal(armor.system.armor.max, 3);
  assert.equal(shield.effects.flatMap((e: any) => e.system.changes).filter((c: any) => c.type === "armor").length, 1);
  assert.equal(shield.system.equipped, true);
  assert(plan.issues.some(i => i.code === "armor-base-difference"));
  const ex = await readPdf(new Uint8Array(await fs.readFile(path.join(sampleDir, "ex_ampleton.pdf"))), "ex_ampleton.pdf", pdfjs);
  const missing = resolveEntries(ex, catalog).filter(r => r.selected === null).map(r => r.entry.name);
  for (const name of ["Summoner", "Necromancy", "Power Through Pain", "Blood Spike"]) assert(missing.includes(name));
  assert(resolveEntries(ex, catalog).find(r => r.entry.name === "Twisted Dagger")!.selected);
});
