import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("environment config parses and does not boot Foundry", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, ".cursor/environment.json"), "utf8"));
  for (const key of Object.keys(config)) {
    assert.ok(["name", "user", "build", "chromeExecutablePath", "install"].includes(key), key);
  }
  assert.equal(config.user, "ubuntu");
  assert.equal(config.build.dockerfile, "Dockerfile");
  assert.equal(config.start, undefined);
  assert.equal(config.image, undefined);
  assert.equal(config.snapshot, undefined);
  assert.equal(config.chromeExecutablePath, "/usr/bin/google-chrome");
  assert.match(config.install, /scripts\/cloud-agent-install\.sh/);
  assert.doesNotMatch(config.install, /foundry-verify-server\.sh up/);
  const dockerfile = fs.readFileSync(path.join(root, ".cursor/Dockerfile"), "utf8");
  assert.match(dockerfile, /24\.22\.3/);
  assert.match(dockerfile, /google-chrome-stable/);
  const install = fs.readFileSync(path.join(root, "scripts/cloud-agent-install.sh"), "utf8");
  assert.match(install, /verify-foundry-importer\/scripts/);
  assert.match(install, /package-lock\.json/);
  assert.match(install, /skipping harness install/);
  assert.doesNotMatch(install, /foundry-download\.py/);
  const syntax = spawnSync("bash", ["-n", "scripts/cloud-agent-install.sh"], { cwd: root, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});
