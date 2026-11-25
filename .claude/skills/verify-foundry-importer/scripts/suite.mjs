#!/usr/bin/env node
// Run every proven journey against a live verify instance.
// Usage:
//   node suite.mjs --url <URL> --evidence <EVIDENCE> [--only id,id] [--list]
// Reads ../journeys.json. Skips recipe entries. Exit 0 only if every selected journey exits 0.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, "..");
const registry = JSON.parse(fs.readFileSync(path.join(skillRoot, "journeys.json"), "utf8"));
const { values: a } = parseArgs({
  options: {
    url: { type: "string" },
    evidence: { type: "string" },
    only: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

const only = a.only ? new Set(a.only.split(",").map(s => s.trim()).filter(Boolean)) : null;
const runnable = registry.journeys.filter(j => {
  if (j.status !== "proven") return false;
  if (j.kind !== "open" && j.kind !== "import") return false;
  if (only && !only.has(j.id)) return false;
  return true;
});

if (a.list) {
  for (const j of registry.journeys) {
    const mark = j.status === "proven" && (j.kind === "open" || j.kind === "import") ? "RUN" : j.status.toUpperCase();
    console.log(`${mark.padEnd(7)} ${j.id.padEnd(22)} ${j.feature}  ${j.summary}`);
  }
  console.log(`\nSuite would run ${runnable.length} journey(s).`);
  process.exit(0);
}

if (!a.url || !a.evidence) {
  console.error("need --url --evidence (or --list)");
  process.exit(2);
}

const pdfDir = registry.pdfDir.replace(/^~/, process.env.HOME);
const results = [];

for (const j of runnable) {
  console.log(`\n=== ${j.id} (${j.feature}) ===`);
  let cmd, args;
  if (j.kind === "open") {
    cmd = process.execPath;
    args = [path.join(here, "open-importer.mjs"), "--url", a.url, "--evidence", a.evidence];
  } else if (j.kind === "import") {
    const pdf = path.join(pdfDir, j.pdf);
    const answers = path.join(skillRoot, "answers", j.answers);
    if (!fs.existsSync(pdf)) {
      results.push({ id: j.id, ok: false, detail: `missing PDF ${pdf}` });
      console.error(`FAIL missing PDF ${pdf}`);
      continue;
    }
    if (!fs.existsSync(answers)) {
      results.push({ id: j.id, ok: false, detail: `missing answers ${answers}` });
      console.error(`FAIL missing answers ${answers}`);
      continue;
    }
    cmd = process.execPath;
    args = [
      path.join(here, "import-pdf.mjs"),
      "--url", a.url,
      "--evidence", a.evidence,
      "--pdf", pdf,
      "--answers", answers,
    ];
  } else {
    results.push({ id: j.id, ok: false, detail: `unsupported kind ${j.kind}` });
    continue;
  }

  const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
  const ok = r.status === 0;
  results.push({ id: j.id, ok, detail: ok ? "PASS" : `exit ${r.status ?? "signal " + r.signal}` });
  if (!ok) {
    console.error(`FAIL ${j.id}: ${results.at(-1).detail}`);
    break;
  }
}

const failed = results.filter(r => !r.ok);
console.log("\n=== suite summary ===");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}`);
const skippedRecipes = registry.journeys.filter(j => j.status === "recipe").length;
console.log(`ran ${results.length}; failed ${failed.length}; recipe (not run) ${skippedRecipes}`);
fs.mkdirSync(a.evidence, { recursive: true });
fs.writeFileSync(
  path.join(a.evidence, `suite-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.json`),
  JSON.stringify({ pass: failed.length === 0, results, skippedRecipes }, null, 2),
);
process.exit(failed.length ? 1 : 0);
