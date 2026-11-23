import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "scripts/foundry-verify-server.sh");
const CANARY = "canary-secret-value-should-not-print";

function run(command, args, env) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
}

function alive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[0];
    return state !== "Z";
  } catch {
    return false;
  }
}

const clearedSecrets = {
  FOUNDRY_USERNAME: "",
  FOUNDRY_PASSWORD: "",
  FOUNDRY_LICENSE_KEY: "",
  FOUNDRY_ADMIN_KEY: "",
  DEMIPLANE_SAMPLES_URL: "",
  FOUNDRY_VERIFY_TEST_HOLD: "",
};

test("up names every missing Runtime Secret and does not print a secret value", () => {
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-fvtt-"));
  fs.rmSync(verifyRoot, { recursive: true });
  const result = run("bash", [server, "up"], {
    FOUNDRY_VERIFY_ROOT: verifyRoot,
    FOUNDRY_USERNAME: "",
    FOUNDRY_PASSWORD: CANARY,
    FOUNDRY_LICENSE_KEY: "",
    FOUNDRY_ADMIN_KEY: "",
    DEMIPLANE_SAMPLES_URL: "",
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /FoundryVTT-Node-14.370.zip/);
  assert.match(output, /Missing Runtime Secret FOUNDRY_LICENSE_KEY\./);
  assert.doesNotMatch(output, /FOUNDRY_USERNAME/);
  assert.doesNotMatch(output, /FOUNDRY_PASSWORD\./);
  assert.equal(output.includes(CANARY), false);
  assert.equal(fs.existsSync(verifyRoot), false);
});

test("down and status are safe when nothing is running", () => {
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-fvtt-down-"));
  fs.rmSync(verifyRoot, { recursive: true });
  const down = run("bash", [server, "down"], { FOUNDRY_VERIFY_ROOT: verifyRoot });
  assert.equal(down.status, 0, down.stderr);
  assert.match(down.stdout, /no verification server to stop/);
  const status = run("bash", [server, "status"], { FOUNDRY_VERIFY_ROOT: verifyRoot });
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /stopped/);
  assert.equal(fs.existsSync(verifyRoot), false);
});

test("docs point agents at the server hook and the same secret names", () => {
  const guide = fs.readFileSync(path.join(root, "docs/review/cloud-foundry.md"), "utf8");
  assert.match(guide, /FOUNDRY_LICENSE_KEY/);
  assert.match(guide, /FoundryVTT-Node-14.370.zip/);
  assert.match(guide, /foundry-cache-fetch.sh/);
  assert.doesNotMatch(guide, /FOUNDRY_USERNAME/);
  assert.match(guide, /one active server/i);
  assert.match(guide, /render-evidence\.mjs/);
  assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /foundry-verify-server\.sh up/);
  assert.match(fs.readFileSync(path.join(root, "docs/review/evidence-contract.md"), "utf8"), /run\.json/);
});

test("down stops a licence server left by a killed up", async () => {
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-hold-"));
  const child = spawn("bash", [server, "up"], {
    cwd: root,
    env: { ...process.env, ...clearedSecrets, FOUNDRY_VERIFY_ROOT: verifyRoot, FOUNDRY_VERIFY_TEST_HOLD: "1" },
    stdio: "ignore",
  });
  const pidfile = path.join(verifyRoot, "sign.pid");
  let pid = "";
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (fs.existsSync(pidfile)) {
      pid = fs.readFileSync(pidfile, "utf8").trim();
      if (pid && alive(pid)) break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  try {
    assert.ok(alive(pid), "hold server did not start");
    process.kill(child.pid, "SIGKILL");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(alive(pid), true, "the detached licence server must still be running after up is killed");
    const down = run("bash", [server, "down"], { ...clearedSecrets, FOUNDRY_VERIFY_ROOT: verifyRoot });
    assert.equal(down.status, 0, down.stderr);
    assert.equal(alive(pid), false);
    assert.match(down.stdout, /stopped the licence server/);
  } finally {
    if (pid && alive(pid)) process.kill(Number(pid), "SIGKILL");
    if (child.pid && alive(child.pid)) process.kill(child.pid, "SIGKILL");
  }
});

test("up stops a stale licence server and still names a missing secret", () => {
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-stale-"));
  const base = path.join(verifyRoot, "base");
  const child = spawn("python3", ["-c", "import time; time.sleep(60)", `--dataPath=${base}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  try {
    assert.equal(alive(child.pid), true);
    const result = run("bash", [server, "up"], { ...clearedSecrets, FOUNDRY_VERIFY_ROOT: verifyRoot });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing Runtime Secret FOUNDRY_LICENSE_KEY\./);
    assert.match(result.stderr, /FoundryVTT-Node-14.370.zip/);
    assert.equal(alive(child.pid), false);
    assert.match(result.stderr, /stopped a stale licence server/);
  } finally {
    if (alive(child.pid)) process.kill(child.pid, "SIGKILL");
  }
});

test("server script syntax", () => {
  const result = run("bash", ["-n", "scripts/foundry-verify-server.sh"], {});
  assert.equal(result.status, 0, result.stderr);
});
