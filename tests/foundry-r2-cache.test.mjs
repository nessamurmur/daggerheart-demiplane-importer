import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/cloud-agent-install.sh");
const TOKEN = "AKIATEST:secret-test-value";
const BODY = Buffer.from("foundry-node-fixture");
const BODY_SHA = crypto.createHash("sha256").update(BODY).digest("hex");

function writeFakeCurl(bin) {
  const curl = path.join(bin, "curl");
  fs.writeFileSync(curl, `#!/bin/bash
set +x
printf 'called\\n' >> "$CURL_LOG"
cfg=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--config" ]; then
    cfg="$2"
    shift 2
    continue
  fi
  shift
done
if [ -n "$cfg" ] && [ -n "\${CURL_CONFIG_COPY:-}" ]; then
  cp "$cfg" "$CURL_CONFIG_COPY"
fi
python3 - "$cfg" "\${CURL_BODY:-}" <<'PY'
import pathlib, sys
cfg, body = sys.argv[1:]
output = ""
for line in pathlib.Path(cfg).read_text(encoding="utf-8").splitlines():
    if line.startswith("output "):
        output = line.split("=", 1)[1].strip().strip('"')
if not output:
    sys.exit(2)
path = pathlib.Path(output)
path.parent.mkdir(parents=True, exist_ok=True)
if body:
    path.write_bytes(pathlib.Path(body).read_bytes())
else:
    path.write_bytes(b"not-the-archive")
PY
`, { mode: 0o755 });
}

function runCache(env) {
  const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-r2-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-curl-"));
  const curlLog = path.join(bin, "curl.log");
  const configCopy = path.join(bin, "curl-config.txt");
  const bodyFile = path.join(bin, "body");
  writeFakeCurl(bin);
  if (env.body !== undefined) fs.writeFileSync(bodyFile, env.body);
  const result = spawnSync("bash", env.trace ? ["-x", script, "--foundry-cache"] : [script, "--foundry-cache"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FOUNDRY_VERIFY_ROOT: verifyRoot,
      FOUNDRY_R2_TOKEN: env.token ?? "",
      FOUNDRY_R2_ENDPOINT: "https://example.invalid",
      FOUNDRY_R2_BUCKET: "foundry-cache",
      FOUNDRY_R2_KEY: "FoundryVTT-Node-14.370.zip",
      FOUNDRY_NODE_ARCHIVE_BYTES: String(env.bytes ?? BODY.length),
      FOUNDRY_NODE_ARCHIVE_SHA256: env.sha ?? BODY_SHA,
      PATH: `${bin}:${process.env.PATH}`,
      CURL_LOG: curlLog,
      CURL_CONFIG_COPY: configCopy,
      CURL_BODY: env.body !== undefined ? bodyFile : "",
    },
  });
  const dest = path.join(verifyRoot, "cache", "FoundryVTT-Node-14.370.zip");
  return {
    result,
    verifyRoot,
    dest,
    curlCalled: fs.existsSync(curlLog),
    configCopy: fs.existsSync(configCopy) ? fs.readFileSync(configCopy, "utf8") : "",
  };
}

test("defaults pin the R2 account, bucket, and Node archive", () => {
  const text = fs.readFileSync(script, "utf8");
  assert.match(text, /fc29815e85508db8c14ed124b0511b81/);
  assert.match(text, /foundry-cache/);
  assert.match(text, /FoundryVTT-Node-14\.370\.zip/);
  assert.match(text, /150182237/);
  assert.match(text, /e891a46b2878745b38dd8c28e843d763f83e69aa14bdbd3156edd8dafaabe846/);
  assert.match(text, /aws:amz:auto:s3/);
});

test("a missing token logs once and does not download", () => {
  const { result, dest, curlCalled } = runCache({ token: "" });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /FOUNDRY_R2_TOKEN is not set; skipping Foundry archive download/);
  assert.equal(curlCalled, false);
  assert.equal(fs.existsSync(dest), false);
});

test("a cached archive with the right hash skips the download", () => {
  const first = runCache({ token: "" });
  fs.mkdirSync(path.dirname(first.dest), { recursive: true });
  fs.writeFileSync(first.dest, BODY);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-curl-"));
  writeFakeCurl(bin);
  const curlLog = path.join(bin, "curl.log");
  const result = spawnSync("bash", [script, "--foundry-cache"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FOUNDRY_VERIFY_ROOT: first.verifyRoot,
      FOUNDRY_R2_TOKEN: TOKEN,
      FOUNDRY_R2_ENDPOINT: "https://example.invalid",
      FOUNDRY_R2_BUCKET: "foundry-cache",
      FOUNDRY_R2_KEY: "FoundryVTT-Node-14.370.zip",
      FOUNDRY_NODE_ARCHIVE_BYTES: String(BODY.length),
      FOUNDRY_NODE_ARCHIVE_SHA256: BODY_SHA,
      PATH: `${bin}:${process.env.PATH}`,
      CURL_LOG: curlLog,
      CURL_CONFIG_COPY: path.join(bin, "curl-config.txt"),
      CURL_BODY: "",
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /already cached/);
  assert.equal(fs.existsSync(curlLog), false);
  assert.equal(output.includes(TOKEN), false);
  assert.equal(output.includes("secret-test-value"), false);
  assert.equal(fs.readFileSync(first.dest).equals(BODY), true);
});

test("a download with the wrong hash is deleted and fails", () => {
  const { result, dest, verifyRoot, curlCalled, configCopy } = runCache({ token: TOKEN, body: Buffer.from("nope") });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(curlCalled, true);
  assert.match(output, /hash does not match/);
  assert.match(output, /deleted the download/);
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.readdirSync(path.join(verifyRoot, "cache")).length, 0);
  assert.equal(output.includes(TOKEN), false);
  assert.equal(output.includes("secret-test-value"), false);
  assert.match(configCopy, /aws-sigv4 = "aws:amz:auto:s3"/);
  assert.match(configCopy, /user = "AKIATEST:secret-test-value"/);
});

test("a matching download is stored mode 600 and the trace omits the token", () => {
  const { result, dest, configCopy } = runCache({ token: TOKEN, body: BODY, trace: true });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /cached FoundryVTT-Node-14\.370\.zip/);
  assert.equal(fs.readFileSync(dest).equals(BODY), true);
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
  assert.equal(output.includes(TOKEN), false);
  assert.equal(output.includes("secret-test-value"), false);
  assert.match(configCopy, /user = "AKIATEST:secret-test-value"/);
  assert.match(configCopy, /retry = 3/);
});
