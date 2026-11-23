import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertRunMeta, licenseConflict, licenseSigned, redactSecrets } from "../scripts/foundry-run-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const download = path.join(root, "scripts/foundry-download.py");
const CANARY = "canary-secret-value-should-not-print";

function run(command, args, env) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
}

test("run.json matches the evidence contract and rejects paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-run-meta-"));
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const write = run("node", [
    "scripts/foundry-run-meta.mjs", "write", dir, "20261123-120000-9", "14.370", "2.10.2", "0.1.2", sha,
  ], {});
  assert.equal(write.status, 0, write.stderr);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  assert.deepEqual(assertRunMeta(meta), meta);
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ ...meta, foundry: "14.370-kept" }));
  const again = run("node", [
    "scripts/foundry-run-meta.mjs", "write", dir, "other", "9.9", "0", "0", sha,
  ], {});
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")).foundry, "14.370-kept");
  assert.throws(() => assertRunMeta({ ...meta, headSha: "/home/nj/foundry-verify" }), /must not be a path/);
  assert.equal(licenseSigned(path.join(dir, "missing.json")), false);
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ license: "abc", signature: "signed-token" }));
  assert.equal(licenseSigned(path.join(dir, "license.json")), true);
});

test("licence conflict check ignores the ordinary signature warning and does not echo the log", () => {
  assert.equal(licenseConflict("Software license requires signature."), null);
  assert.equal(licenseConflict("License signature failed for license " + CANARY), "license signature failed");
  const piped = spawnSync("node", ["scripts/foundry-run-meta.mjs", "conflict"], {
    cwd: root,
    encoding: "utf8",
    input: `License signature failed for license ${CANARY}\n`,
  });
  assert.equal(piped.status, 0);
  assert.equal(piped.stdout.trim(), "license signature failed");
  assert.equal(piped.stdout.includes(CANARY), false);
});

test("system zip handling rejects unsafe paths and keeps a matching Foundryborne tree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-zip-"));
  const zip = path.join(dir, "system.zip");
  const build = spawnSync("python3", ["-c", `
import json, sys, zipfile
zip_path, slip_path = sys.argv[1:]
with zipfile.ZipFile(zip_path, "w") as archive:
    archive.writestr("daggerheart/system.json", json.dumps({"id": "daggerheart", "version": "2.10.2"}))
with zipfile.ZipFile(slip_path, "w") as archive:
    archive.writestr("../outside.txt", "nope")
    archive.writestr("daggerheart/system.json", json.dumps({"id": "daggerheart", "version": "2.10.2"}))
`, zip, path.join(dir, "slip.zip")], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const ok = spawnSync("python3", [download, "system-ok", zip, "2.10.2"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const slipped = spawnSync("python3", [download, "extract-system", path.join(dir, "slip.zip"), path.join(dir, "slipped"), "2.10.2"], { encoding: "utf8" });
  assert.notEqual(slipped.status, 0);
  assert.equal(fs.existsSync(path.join(dir, "outside.txt")), false);
  const extracted = spawnSync("python3", [download, "extract-system", zip, path.join(dir, "daggerheart"), "2.10.2"], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "daggerheart/system.json"), "utf8")).version, "2.10.2");
});

test("cache-ok rejects a file that is not the pinned Node archive", () => {
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dpi-cache-")), "FoundryVTT-Node-14.370.zip");
  fs.writeFileSync(dest, "not the archive");
  const result = spawnSync("python3", [download, "cache-ok", dest], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FoundryVTT-Node-14.370.zip/);
  assert.match(result.stderr, /150182237/);
  assert.equal(result.stderr.includes("FOUNDRY_USERNAME"), false);
});

test("Node archive extract uses main.js at the zip root", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-node-zip-"));
  const zip = path.join(dir, "FoundryVTT-Node-14.370.zip");
  const build = spawnSync("python3", ["-c", `
import json, sys, zipfile
zip_path = sys.argv[1]
with zipfile.ZipFile(zip_path, "w") as archive:
    archive.writestr("main.js", "console.log('foundry')\\n")
    archive.writestr("package.json", json.dumps({"release": {"generation": 14, "build": 370}}))
`, zip], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const dest = path.join(dir, "app");
  const extracted = spawnSync("python3", [download, "extract-foundry", zip, dest, "14.370"], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.equal(fs.readFileSync(path.join(dest, "resources/app/main.js"), "utf8").includes("foundry"), true);
  const electron = path.join(dir, "electron.zip");
  spawnSync("python3", ["-c", `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr("resources/app/main.js", "nope\\n")
    archive.writestr("resources/app/package.json", "{}")
`, electron], { encoding: "utf8" });
  const rejected = spawnSync("python3", [download, "extract-foundry", electron, path.join(dir, "electron-app"), "14.370"], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /main.js and package.json at the archive root/);
});

test("timed URL helper does not echo the query string", () => {
  const query = "X-Amz-Signature=super-secret-query";
  const result = spawnSync("bash", ["scripts/foundry-cache-fetch.sh", `https://127.0.0.1:9/foundry.zip?${query}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FOUNDRY_VERIFY_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "dpi-fetch-")) },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(output.includes(query), false);
  assert.equal(output.includes("super-secret-query"), false);
  assert.match(output, /URL was not printed/);
});

test("redact removes every secret, including ones shorter than 8 characters", () => {
  assert.equal(redactSecrets("pw=abc user=xy", { FOUNDRY_PASSWORD: "abc", FOUNDRY_USERNAME: "xy" }), "pw=[redacted] user=[redacted]");
  assert.equal(redactSecrets("hello", { FOUNDRY_PASSWORD: "" }), "hello");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dpi-redact-")), "sign.log");
  fs.writeFileSync(file, "pw=abc\n");
  const result = spawnSync("python3", [download, "redact-file", file], {
    encoding: "utf8",
    env: { ...process.env, FOUNDRY_PASSWORD: "abc" },
  });
  assert.equal(result.status, 0, result.stderr);
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("abc"), false);
  assert.match(text, /\[redacted\]/);
});
