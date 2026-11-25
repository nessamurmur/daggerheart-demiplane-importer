import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { manifestFindings, manifestViolations, type ManifestTexts } from "./manifest.ts";

const root = process.cwd();
const moduleJson = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const texts = (moduleManifest = moduleJson, packageManifest = packageJson): ManifestTexts => ({
  moduleJson: moduleManifest, packageJson: packageManifest, fileExists: file => fs.existsSync(path.join(root, file)),
});

test("manifest gated properties hold for this repository", () => {
  const violations = manifestViolations(texts());
  assert.deepEqual(violations, [], violations.join("\n"));
  const findings = manifestFindings(moduleJson);
  for (const finding of findings) console.log(`FINDING ${finding}`);
});

test("a download URL that is not this version's ZIP is a violation", () => {
  const broken = structuredClone(moduleJson);
  broken.download = "https://github.com/nessamurmur/daggerheart-demiplane-importer/archive/refs/heads/main.zip";
  const violations = manifestViolations(texts(broken));
  assert.ok(violations.some(violation => violation.startsWith("download ")), violations.join("\n"));
});

test("known finding: compatibility.maximum is present", () => {
  const findings = manifestFindings(moduleJson);
  assert.ok(
    findings.length === 1 && findings[0].includes('compatibility.maximum is "14"'),
    findings.length === 0
      ? 'compat-maximum was cleared. Gate "compatibility.maximum is absent" in verify/manifest.ts and delete this finding.'
      : `compat-maximum counterexample changed: ${findings.join(" | ")}. Update the skill's finding record.`,
  );
});
