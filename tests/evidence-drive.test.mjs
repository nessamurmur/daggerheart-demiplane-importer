import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requiredShots, RUN_META_KEYS } from "../.claude/skills/verify-foundry-importer/scripts/evidence.mjs";

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.claude/skills/verify-foundry-importer/scripts");

test("drive scripts call the stable shot names", () => {
  const importer = fs.readFileSync(path.join(scripts, "import-pdf.mjs"), "utf8");
  const opener = fs.readFileSync(path.join(scripts, "open-importer.mjs"), "utf8");
  const harness = fs.readFileSync(path.join(scripts, "harness.mjs"), "utf8");
  const suite = fs.readFileSync(path.join(scripts, "suite.mjs"), "utf8");
  const fvtt = fs.readFileSync(path.join(scripts, "fvtt.sh"), "utf8");
  for (const slug of ["wizard-upload", "character-answered", "review", "created-actor-sheet"]) {
    assert.match(importer, new RegExp(`shot\\("${slug}"\\)`));
  }
  assert.match(importer, /\["character", "content", "advanced", "notes"\]/);
  assert.match(importer, /shot\(`tab-\$\{id\}`\)/);
  assert.doesNotMatch(importer, /shot\("created"\)/);
  for (const slug of requiredShots("open")) assert.match(opener, new RegExp(`shot\\("${slug}"\\)`));
  assert.match(harness, /shotSpec\(name\)/);
  assert.match(harness, /recordShot\(shots, name\)/);
  assert.doesNotMatch(harness, /padStart/);
  assert.match(suite, /"--journey", j\.id/);
  assert.match(suite, /suite\.json/);
  assert.match(fvtt, /run\.json/);
  for (const key of RUN_META_KEYS) assert.match(fvtt, new RegExp(`"${key}"`));
});
