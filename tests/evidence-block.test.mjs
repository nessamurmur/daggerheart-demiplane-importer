import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PRIVACY_NOTE,
  SHOTS,
  consoleNotes,
  parseGitHubRepo,
  recordShot,
  requiredShots,
  runMeta,
  shotFileName,
  validateObservation,
} from "../.claude/skills/verify-foundry-importer/scripts/evidence.mjs";
import { renderFromDir, uploadPngs } from "../.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = path.join(root, ".claude/skills/verify-foundry-importer/scripts");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "abcdef0123456789abcdef0123456789abcdef01";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const OPEN_OBSERVATION = "The Actors sidebar opened one wizard, and opening it again brought that window forward.";
const IMPORT_OBSERVATION = "Review showed the sheet evasion beside the Foundry value, and Create opened the new character sheet.";

function writePng(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
}

function journey(dir, { kind, pass = true, observation, shots, result = {} }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const slug of shots) writePng(path.join(dir, `${slug}.png`));
  fs.writeFileSync(path.join(dir, "observation.txt"), observation ?? (kind === "open" ? OPEN_OBSERVATION : IMPORT_OBSERVATION));
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({
    journey: path.basename(dir),
    kind,
    pass,
    failures: [],
    pageErrors: [],
    pdf: "/home/nj/Downloads/druid.pdf",
    ...result,
  }));
}

function runDir(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-evidence-"));
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({
    runId: "20261123-102400-1",
    foundry: "14.370",
    foundryborne: "2.10.2",
    moduleVersion: "0.1.2",
    headSha: SHA,
  }));
  setup(dir);
  return dir;
}

async function rejected(setup, pattern) {
  const dir = runDir(setup);
  try {
    let called = false;
    await assert.rejects(
      () => renderFromDir(dir, { headSha: SHA, upload: async () => { called = true; return {}; } }),
      pattern,
    );
    assert.equal(called, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("shot file names stay stable and descriptive", () => {
  assert.equal(shotFileName("review"), "review.png");
  assert.equal(shotFileName("created-actor-sheet"), "created-actor-sheet.png");
  assert.equal(shotFileName("review"), "review.png");
  assert.throws(() => shotFileName("01 Review"), /stable slug/);
  const shots = [];
  assert.deepEqual(recordShot(shots, "review"), { slug: "review", file: "review.png", caption: "Review calculated stats" });
  assert.throws(() => recordShot(shots, "review"), /duplicate shot review/);
  assert.deepEqual(requiredShots("import"), [
    "wizard-upload", "tab-character", "tab-content", "tab-advanced", "tab-notes",
    "character-answered", "review", "created-actor-sheet",
  ]);
  assert.deepEqual(requiredShots("open"), ["sidebar-wizard", "reopen-api", "single-window"]);
});

test("run metadata rejects paths and accepts the launch shape", () => {
  const meta = runMeta({
    runId: "20261123-102400-1",
    foundry: "14.370",
    foundryborne: "2.10.2",
    moduleVersion: "0.1.2",
    headSha: SHA,
  });
  assert.equal(meta.foundry, "14.370");
  assert.throws(() => runMeta({ ...meta, headSha: "/home/nj/.git" }), /must not be a path/);
  assert.throws(() => runMeta({ ...meta, runId: "/tmp/run" }), /must not be a path/);
  assert.equal(parseGitHubRepo("git@github.com:nessamurmur/daggerheart-demiplane-importer.git"), "nessamurmur/daggerheart-demiplane-importer");
  assert.equal(parseGitHubRepo("https://github.com/nessamurmur/daggerheart-demiplane-importer"), "nessamurmur/daggerheart-demiplane-importer");
  assert.throws(() => parseGitHubRepo("https://example.com/owner/repo"), /cannot parse/);
});

test("observations stay one public sentence", () => {
  assert.equal(validateObservation(IMPORT_OBSERVATION), null);
  assert.match(validateObservation(""), /empty/);
  assert.match(validateObservation("too short"), /one sentence/);
  assert.match(validateObservation(`${IMPORT_OBSERVATION}\nmore`), /single line/);
  assert.match(validateObservation('{"evasion":8}'), /data dump/);
  assert.match(validateObservation("Imported /home/nj/Downloads/druid.pdf cleanly today"), /local paths/);
  assert.match(validateObservation(`${"x".repeat(401)} y`), /400/);
});

test("the evidence block embeds hosted screenshots and hides local files", async () => {
  const secret = "/home/nj/Downloads/druid.pdf";
  const dir = runDir(rootDir => {
    fs.writeFileSync(path.join(rootDir, "suite.json"), JSON.stringify({
      pass: true,
      results: [
        { id: "open-importer", ok: true, detail: `saw ${secret}`, dir: "open-importer" },
        { id: "druid", ok: true, detail: "PASS", dir: "druid" },
      ],
    }));
    journey(path.join(rootDir, "open-importer"), { kind: "open", shots: requiredShots("open") });
    const druid = path.join(rootDir, "druid");
    journey(druid, { kind: "import", shots: requiredShots("import") });
    writePng(path.join(druid, "extra-notes.png"));
    fs.writeFileSync(path.join(druid, "world-after.json"), JSON.stringify({ name: "Secret Hero", file: secret }));
    fs.writeFileSync(path.join(druid, "shots.json"), JSON.stringify([
      { slug: "review", file: secret, caption: "ignored ](https://evil.example/x)" },
      { slug: "not-a-shot", file: secret, caption: "nope" },
    ]));
    fs.writeFileSync(path.join(druid, "browser-console.log"), [
      "[log] ready",
      "[warning] foundry.utils.something is deprecated",
      `[error] [daggerheart-demiplane-importer] failed reading ${secret}`,
    ].join("\n"));
  });
  try {
    let uploaded = null;
    const markdown = await renderFromDir(dir, {
      headSha: SHA,
      upload: async items => {
        uploaded = items;
        return Object.fromEntries(items.map((item, index) => [
          item.uploadName,
          `https://github.com/user-attachments/assets/shot${index}`,
        ]));
      },
    });
    assert.ok(uploaded.every(item => item.file.startsWith(dir) && item.file.endsWith(".png")));
    assert.ok(uploaded.some(item => item.uploadName === "druid-review.png" && item.file.endsWith(`${path.sep}druid${path.sep}review.png`)));
    assert.equal(uploaded.some(item => item.uploadName.includes("extra-notes")), false);
    for (const pattern of [
      new RegExp(`Head: \`${SHA}\``), /Foundry: 14\.370/, /Foundryborne: 2\.10\.2/, /Module: 0\.1\.2/,
      /### open-importer\n\nPASS\n\nObservation: /, /### druid\n\nPASS\n\nObservation: /,
      /!\[Review calculated stats\]\(https:\/\/github\.com\/user-attachments\/assets\/shot\d+\)/,
      /!\[Created actor sheet\]/, /!\[Wizard: upload the PDF\]/, /deprecated/, /console line omitted/,
      new RegExp(PRIVACY_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    ]) assert.match(markdown, pattern);
    assert.doesNotMatch(markdown, /evil\.example|Secret Hero|\/home\/nj|druid\.pdf|extra-notes/);
    assert.deepEqual(
      markdown.split("### druid")[1].match(/!\[[^\]]+\]/g),
      requiredShots("import").map(slug => `![${SHOTS[slug].caption}]`),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a journey directory outside the run is not uploaded", async () => {
  await rejected(rootDir => {
    fs.writeFileSync(path.join(rootDir, "suite.json"), JSON.stringify({
      pass: true, results: [{ id: "druid", ok: true, dir: "../../druid" }],
    }));
  }, /escapes the run folder/);
});

test("a passing journey missing a screenshot uploads nothing", async () => {
  await rejected(rootDir => {
    fs.writeFileSync(path.join(rootDir, "suite.json"), JSON.stringify({
      pass: true, results: [{ id: "druid", ok: true, dir: "druid" }],
    }));
    journey(path.join(rootDir, "druid"), {
      kind: "import", shots: requiredShots("import").filter(slug => slug !== "created-actor-sheet"),
    });
  }, /created-actor-sheet\.png/);
});

test("a failed journey still needs an observation and one screenshot", async () => {
  const dir = runDir(rootDir => journey(path.join(rootDir, "druid"), {
    kind: "import", pass: false, shots: ["failure"],
    observation: "Create stayed disabled and the wizard showed the error banner.",
    result: { failures: ["create failed"], pageErrors: ["TypeError"] },
  }));
  try {
    const markdown = await renderFromDir(dir, {
      headSha: OTHER_SHA,
      upload: async items => Object.fromEntries(items.map(item => [item.uploadName, "https://github.com/user-attachments/assets/failure1"])),
    });
    assert.match(markdown, /### druid\n\nFAIL\n\nObservation: Create stayed disabled/);
    assert.match(markdown, /!\[Journey failed\]\(https:\/\/github\.com\/user-attachments\/assets\/failure1\)/);
    assert.match(markdown, new RegExp(`Head: \`${OTHER_SHA}\`[\\s\\S]*Server launched at: \`${SHA}\`[\\s\\S]*failures: 1\\npageErrors: 1`));
    assert.doesNotMatch(markdown, /Review calculated stats/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("check prints the block plan and does not upload", () => {
  const dir = runDir(rootDir => journey(path.join(rootDir, "open-importer"), { kind: "open", shots: requiredShots("open") }));
  const args = ["--evidence", dir, "--sha", SHA, "--check"];
  try {
    const ok = spawnSync(process.execPath, [path.join(scripts, "render-evidence.mjs"), ...args], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /open-importer-sidebar-wizard\.png/);
    assert.equal(fs.existsSync(path.join(dir, "evidence-block.md")), false);
    fs.rmSync(path.join(dir, "open-importer", "observation.txt"));
    const missing = spawnSync(process.execPath, [path.join(scripts, "render-evidence.mjs"), ...args], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing observation\.txt/);
    assert.doesNotMatch(`${missing.stdout}${missing.stderr}`, /user-attachments/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("png upload uses the user-attachments store and refuses other files", () => {
  const png = path.join(os.tmpdir(), `dpi-review-${process.pid}.png`);
  const calls = [];
  const run = (_cmd, args) => {
    calls.push(args);
    if (String(args[1] ?? "").startsWith("repos/")) return { status: 0, stdout: "1377731507\n", stderr: "" };
    return { status: 0, stdout: "{\"url\":\"https://github.com/user-attachments/assets/abc-def\"}\n", stderr: "" };
  };
  fs.writeFileSync(png, PNG);
  try {
    const urls = uploadPngs([{ file: png, uploadName: "druid-review.png" }], { repo: "nessamurmur/daggerheart-demiplane-importer", run });
    assert.equal(urls["druid-review.png"], "https://github.com/user-attachments/assets/abc-def");
    const flat = calls.flat().join(" ");
    assert.match(flat, /https:\/\/uploads\.github\.com\/user-attachments\/assets\?repository_id=1377731507/);
    assert.match(flat, /name=druid-review\.png/);
    assert.match(flat, /content_type=image%2Fpng/);
    assert.match(flat, /Content-Type: image\/png/);
    assert.equal(flat.includes("Authorization"), false);
    const before = calls.length;
    assert.throws(() => uploadPngs([{ file: "/home/nj/Downloads/druid.pdf", uploadName: "druid-review.png" }], { repo: "nessamurmur/daggerheart-demiplane-importer", run }), /non-png/);
    const bytes = path.join(os.tmpdir(), `dpi-bytes-${process.pid}.png`);
    fs.writeFileSync(bytes, Buffer.from("%PDF-1.4\n"));
    try {
      assert.throws(() => uploadPngs([{ file: bytes, uploadName: "druid-review.png" }], { repo: "nessamurmur/daggerheart-demiplane-importer", run }), /not a PNG/);
    } finally {
      fs.rmSync(bytes, { force: true });
    }
    assert.equal(calls.length, before);
  } finally {
    fs.rmSync(png, { force: true });
  }
  assert.equal(consoleNotes("[warning] Something is deprecated in the sheet").length, 1);
});

test("a shot symlink and a symlinked journey directory are not uploaded", async () => {
  const pdf = Buffer.from("%PDF-1.4\n");
  const failed = { kind: "import", pass: false, shots: [], observation: "Create stayed disabled and the wizard showed the error banner." };
  await rejected(rootDir => {
    const journeyDir = path.join(rootDir, "druid");
    journey(journeyDir, failed);
    const secret = path.join(rootDir, "secret.pdf");
    fs.writeFileSync(secret, pdf);
    fs.symlinkSync(secret, path.join(journeyDir, "failure.png"));
  }, /refusing symlink failure\.png/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dpi-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "failure.png"), pdf);
    fs.writeFileSync(path.join(outside, "result.json"), JSON.stringify({ kind: "import", pass: false, failures: ["create failed"], pageErrors: [] }));
    fs.writeFileSync(path.join(outside, "observation.txt"), failed.observation);
    await rejected(rootDir => {
      fs.symlinkSync(outside, path.join(rootDir, "druid"));
      fs.writeFileSync(path.join(rootDir, "suite.json"), JSON.stringify({
        pass: false,
        results: [{ id: "druid", ok: false, dir: "druid" }],
      }));
    }, /refusing symlink druid/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
  await rejected(rootDir => {
    const journeyDir = path.join(rootDir, "druid");
    journey(journeyDir, failed);
    fs.writeFileSync(path.join(journeyDir, "failure.png"), pdf);
  }, /not a PNG/);
});
