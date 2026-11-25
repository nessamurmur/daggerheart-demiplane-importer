// run.json for render-evidence.mjs, plus small checks the server script shares.
// No network. Never prints licence or account values.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUN_META_KEYS = ["runId", "foundry", "foundryborne", "moduleVersion", "headSha"];
export const SECRET_ENV = ["FOUNDRY_LICENSE_KEY", "FOUNDRY_PASSWORD", "FOUNDRY_USERNAME", "FOUNDRY_ADMIN_KEY", "DEMIPLANE_SAMPLES_URL"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[0-9a-f]{7,40}$/;

const CONFLICTS = [
  [/license signature failed/i, "license signature failed"],
  [/licen[cs]e (?:key )?is currently in use/i, "licence already in use"],
  [/in use on another/i, "licence in use on another host"],
  [/active on another (?:server|host|machine)/i, "licence active on another server"],
];

export function assertRunMeta(input) {
  if (!input || typeof input !== "object") throw new Error("run meta is missing");
  const out = {};
  for (const key of RUN_META_KEYS) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`run meta needs ${key}`);
    if (/[/\\~]/.test(value)) throw new Error(`run meta ${key} must not be a path`);
    out[key] = value.trim();
  }
  if (!SHA.test(out.headSha)) throw new Error("run meta headSha must be a git sha");
  if (!SLUG.test(out.runId)) throw new Error("run meta runId must be a slug");
  return out;
}

export function licenseSigned(file) {
  if (!file || !fs.existsSync(file)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof json.signature === "string" && json.signature.length > 0;
  } catch {
    return false;
  }
}

/** Replace every configured secret, including short ones. Empty values are left alone. Longer values are replaced first. */
export function redactSecrets(text, env = process.env) {
  const values = [];
  for (const name of SECRET_ENV) {
    const secret = env[name] ?? "";
    if (secret.length === 0) continue;
    values.push(secret);
    const stripped = secret.replaceAll("-", "");
    if (stripped.length > 0 && stripped !== secret) values.push(stripped);
  }
  values.sort((a, b) => b.length - a.length);
  let out = String(text ?? "");
  for (const value of values) out = out.replaceAll(value, "[redacted]");
  return out;
}

export function licenseConflict(text) {
  const source = String(text ?? "");
  for (const [pattern, label] of CONFLICTS) {
    if (pattern.test(source)) return label;
  }
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "write") {
    const [evidenceDir, runId, foundry, foundryborne, moduleVersion, headSha] = args;
    if (!evidenceDir) return fail("usage: write <evidenceDir> <runId> <foundry> <foundryborne> <moduleVersion> <headSha>");
    const file = path.join(evidenceDir, "run.json");
    fs.mkdirSync(evidenceDir, { recursive: true });
    if (fs.existsSync(file)) {
      try {
        assertRunMeta(readJson(file));
      } catch (error) {
        return fail(`run.json: ${error.message}`);
      }
      return;
    }
    let meta;
    try {
      meta = assertRunMeta({ runId, foundry, foundryborne, moduleVersion, headSha });
    } catch (error) {
      return fail(error.message);
    }
    fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
    return;
  }
  if (command === "signed") {
    process.exitCode = licenseSigned(args[0]) ? 0 : 1;
    return;
  }
  if (command === "conflict") {
    const label = licenseConflict(fs.readFileSync(0, "utf8"));
    if (!label) {
      process.exitCode = 1;
      return;
    }
    console.log(label);
    return;
  }
  if (command === "release") {
    try {
      const release = readJson(args[0]).release;
      const version = `${release.generation}.${release.build}`;
      if (!/^\d+\.\d+$/.test(version)) return fail("package.json release is not generation.build");
      console.log(version);
    } catch (error) {
      return fail(error.message);
    }
    return;
  }
  if (command === "system" || command === "module") {
    try {
      const version = readJson(args[0]).version;
      if (typeof version !== "string" || !version.trim()) return fail("version missing");
      console.log(version.trim());
    } catch (error) {
      return fail(error.message);
    }
    return;
  }
  fail("usage: foundry-run-meta.mjs write|signed|conflict|release|system|module");
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
