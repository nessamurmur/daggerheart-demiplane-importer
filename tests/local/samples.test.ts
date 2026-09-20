import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdf } from "../../src/pdf.ts";
import { validateCharacter } from "../../src/core.ts";

const directory = process.env.DEMIPLANE_SAMPLE_DIR ?? path.join(os.homedir(), "Downloads");
async function sample(name: string) { return readPdf(new Uint8Array(await fs.readFile(path.join(directory, name))), name, pdfjs); }
test("Jen's original Demiplane PDF", async t => {
  try { await fs.access(path.join(directory, "druid.pdf")); } catch { return t.skip("Local sample not available"); }
  const c = await sample("druid.pdf");
  assert.equal(c.name, "Jen"); assert.equal(c.level, 1);
  assert.deepEqual(c.traits, { agility: 1, strength: 0, finesse: 1, instinct: 2, presence: -1, knowledge: 0 });
  assert.deepEqual(c.resources, { hitPoints: 0, stress: 0, hope: 2, armor: 0 });
  assert.equal(c.entries.length, 9); assert.equal(c.gold.handfuls, 1);
  assert(c.entries.filter(e => e.kind === "domainCard").every(e => e.inVault));
  assert.equal(c.entries.find(e => e.name === "Shortstaff")!.damageBonus, 1);
  assert(c.issues.some(i => i.code === "armor-thresholds"));
  assert.equal(c.experiences.find(e => e.name === "Folk hero")!.value, null);
});
test("Ex Ampleton's original Demiplane PDF", async t => {
  try { await fs.access(path.join(directory, "ex_ampleton.pdf")); } catch { return t.skip("Local sample not available"); }
  const c = await sample("ex_ampleton.pdf");
  assert.equal(c.name, "Ex Ampleton"); assert.equal(c.level, null);
  assert(Object.values(c.traits).every(n => n === 0));
  assert(c.experiences.every(e => e.value === null));
  assert.equal(c.entries.filter(e => e.name === "Twisted Dagger").length, 1);
  assert.equal(c.entries.find(e => e.name === "Necromancy")!.className, "Summoner");
  assert(c.issues.some(i => i.code === "inventory-prefix"));
  assert(validateCharacter(c).some(i => i.message.includes("level")));
});
