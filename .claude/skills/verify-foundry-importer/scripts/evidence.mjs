// Pure evidence model for a live Foundry run. No Playwright, no network.
// The drive scripts record shots; render-evidence.mjs turns a run directory into the PR block.
import fs from "node:fs";
import path from "node:path";

/** Stable screenshot names. Declaration order is the order in the PR block. */
export const SHOTS = {
  "wizard-upload": { caption: "Wizard: upload the PDF", kind: "import" },
  "tab-character": { caption: "Wizard step: Character", kind: "import" },
  "tab-content": { caption: "Wizard step: Content", kind: "import" },
  "tab-advanced": { caption: "Wizard step: Ancestry and companion", kind: "import" },
  "tab-notes": { caption: "Wizard step: Notes and warnings", kind: "import" },
  "character-answered": { caption: "Wizard step: Character answers filled", kind: "import" },
  "review": { caption: "Review calculated stats", kind: "import" },
  "created-actor-sheet": { caption: "Created actor sheet", kind: "import" },
  "sidebar-wizard": { caption: "Wizard opened from the Actors sidebar", kind: "open" },
  "reopen-api": { caption: "Wizard reopened through the module API", kind: "open" },
  "single-window": { caption: "One wizard window after opening again", kind: "open" },
  "failure": { caption: "Journey failed", kind: null },
};

export const PRIVACY_NOTE = "Screenshots are GitHub user-attachments for this repository, not files in git. Sample PDFs and saved world JSON are not in this block. Character names in the images are visible to anyone who can read the pull request.";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSlug(value, label) {
  if (!SLUG.test(value ?? "")) throw new Error(`${label} must be a slug`);
  return value;
}
const SHA = /^[0-9a-f]{7,40}$/;
const ATTACHMENT_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+$/;
export const RUN_META_KEYS = ["runId", "foundry", "foundryborne", "moduleVersion", "headSha"];

export function shotFileName(slug) {
  if (!SLUG.test(slug)) throw new Error(`shot name must be a stable slug, got ${JSON.stringify(slug)}`);
  return `${slug}.png`;
}

export function shotSpec(slug) {
  const known = SHOTS[slug];
  return {
    slug,
    file: shotFileName(slug),
    caption: known?.caption ?? slug.replaceAll("-", " "),
    kind: known?.kind ?? null,
  };
}

/** Append one shot after its png exists. The same slug always maps to the same file name. */
export function recordShot(shots, slug) {
  const spec = shotSpec(slug);
  if (shots.some(shot => shot.slug === slug)) throw new Error(`duplicate shot ${slug}`);
  const entry = { slug, file: spec.file, caption: spec.caption };
  shots.push(entry);
  return entry;
}

export function requiredShots(kind) {
  return Object.entries(SHOTS).filter(([, shot]) => shot.kind === kind).map(([slug]) => slug);
}

export function runMeta(input) {
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

export function validateObservation(text) {
  if (typeof text !== "string") return "observation is missing";
  const line = text.replace(/^\uFEFF/, "").trim();
  if (!line) return "observation is empty";
  if (/[\r\n]/.test(line)) return "observation must be a single line";
  if (line.startsWith("{") || line.startsWith("[")) return "observation must be a sentence, not a data dump";
  if (/\/home\/|~\/|foundry-verify|world-after|license\.json|\.pdf\b/i.test(line)) {
    return "observation must not include local paths, PDF names, or saved world files";
  }
  if (line.length < 15 || !/\s/.test(line)) return "observation must be one sentence";
  if (line.length > 400) return "observation must be one sentence under 400 characters";
  return null;
}

export function parseGitHubRepo(remote) {
  const match = String(remote).trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) throw new Error(`cannot parse a GitHub owner/repo from ${JSON.stringify(remote)}`);
  return `${match[1]}/${match[2]}`;
}

export function consoleNotes(logText) {
  if (!logText) return [];
  const notes = [];
  for (const raw of logText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const interesting = line.includes("[daggerheart-demiplane-importer]") || /deprecat/i.test(line);
    if (!interesting) continue;
    if (/\/home\/|~\/|Downloads|\.pdf\b|foundry-verify/i.test(line)) {
      notes.push("console line omitted; it contained a local path");
    } else {
      notes.push(line.slice(0, 180));
    }
    if (notes.length === 5) break;
  }
  return notes;
}

function countList(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Walk from `root` with lstat. A symlink, or a real path outside `root`, throws. */
export function realInside(root, target) {
  const base = fs.realpathSync(root);
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("path escapes the run folder");
  let current = base;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    if (part === "..") throw new Error("path escapes the run folder");
    const next = path.join(current, part);
    let st;
    try { st = fs.lstatSync(next); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const missing = new Error(`missing ${part}`);
      missing.code = "ENOENT";
      throw missing;
    }
    if (st.isSymbolicLink()) throw new Error(`refusing symlink ${part}`);
    current = next;
  }
  const real = fs.realpathSync(current);
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error("path escapes the run folder");
  return real;
}

/** Regular file, not a symlink, whose first bytes are a PNG signature. */
export function assertPngBytes(file) {
  const name = path.basename(file);
  if (path.extname(file).toLowerCase() !== ".png") throw new Error(`refusing to upload a non-png (${name})`);
  let st;
  try { st = fs.lstatSync(file); }
  catch { throw new Error(`refusing to upload a missing file (${name})`); }
  if (st.isSymbolicLink()) throw new Error(`refusing symlink ${name}`);
  if (!st.isFile()) throw new Error(`refusing to upload a non-file (${name})`);
  const buf = Buffer.alloc(8);
  const fd = fs.openSync(file, "r");
  try {
    if (fs.readSync(fd, buf, 0, 8, 0) !== 8 || !buf.equals(PNG_MAGIC)) throw new Error(`not a PNG (${name})`);
  } finally { fs.closeSync(fd); }
}

function readJsonInside(root, file) {
  return JSON.parse(fs.readFileSync(realInside(root, file), "utf8"));
}

function shotOrder(slug) {
  const names = Object.keys(SHOTS);
  const index = names.indexOf(slug);
  return index === -1 ? names.length : index;
}

/** Read one run directory. Shot files are `<journey>/<slug>.png`. JSON paths are ignored. */
export function prepareEvidence(evidenceDir, { headSha } = {}) {
  const errors = [];
  const root = path.resolve(evidenceDir);
  let run = null;
  try {
    run = runMeta(readJsonInside(root, path.join(root, "run.json")));
  } catch (error) {
    errors.push(`run.json: ${error.message}`);
  }
  if (!headSha || !SHA.test(headSha)) errors.push("head SHA must be 7 to 40 hex characters");
  const shaOk = typeof headSha === "string" && SHA.test(headSha);

  let entries = [];
  let suite = null;
  try {
    suite = readJsonInside(root, path.join(root, "suite.json"));
  } catch (error) {
    if (error.code !== "ENOENT") errors.push(`suite.json: ${error.message}`);
  }
  if (suite) {
    entries = Array.isArray(suite.results) ? suite.results.map(result => ({
      id: result.id,
      dir: result.dir || result.id,
      ok: result.ok,
    })) : [];
  } else if (!errors.some(error => error.startsWith("suite.json:"))) {
    entries = fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .filter(entry => {
        try { return fs.lstatSync(path.join(root, entry.name, "result.json")).isFile(); }
        catch { return false; }
      })
      .map(entry => ({ id: entry.name, dir: entry.name, ok: undefined }));
  }
  if (!entries.length) errors.push("no journey results");

  const journeys = [];
  for (const entry of entries) {
    if (typeof entry.id !== "string" || !SLUG.test(entry.id)) {
      errors.push(`bad journey id ${JSON.stringify(entry.id)}`);
      continue;
    }
    let journeyDir;
    try {
      journeyDir = realInside(root, path.resolve(root, entry.dir ?? entry.id));
      if (!fs.lstatSync(journeyDir).isDirectory()) throw new Error("evidence directory is not a directory");
    } catch (error) {
      errors.push(`${entry.id}: ${error.code === "ENOENT" ? "missing evidence directory" : error.message}`);
      continue;
    }
    let result;
    try {
      result = readJsonInside(root, path.join(journeyDir, "result.json"));
    } catch (error) {
      errors.push(`${entry.id}: result.json ${error.code === "ENOENT" ? "missing" : error.message}`);
      continue;
    }
    const kind = result.kind === "open" || result.kind === "import" ? result.kind : null;
    if (!kind) errors.push(`${entry.id}: result.json needs kind "open" or "import"`);
    if (typeof result.pass !== "boolean") errors.push(`${entry.id}: result.json needs pass true or false`);
    if (entry.ok !== undefined && entry.ok !== result.pass) {
      errors.push(`${entry.id}: suite.json pass/fail does not match result.json`);
    }

    let observationText = null;
    try {
      observationText = fs.readFileSync(realInside(root, path.join(journeyDir, "observation.txt")), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") errors.push(`${entry.id}: observation.txt ${error.message}`);
    }
    const observationError = observationText === null ? "missing observation.txt" : validateObservation(observationText);
    if (observationError) errors.push(`${entry.id}: ${observationError}`);
    const observation = observationError ? "" : observationText.replace(/^\uFEFF/, "").trim();

    const slugs = new Set();
    const consider = slug => {
      if (!SHOTS[slug]) return;
      if (slug === "failure" && result.pass === true) return;
      slugs.add(slug);
    };
    try {
      const manifest = readJsonInside(root, path.join(journeyDir, "shots.json"));
      if (Array.isArray(manifest)) {
        for (const shot of manifest) if (shot && typeof shot.slug === "string") consider(shot.slug);
      }
    } catch (error) {
      if (error.code !== "ENOENT") errors.push(`${entry.id}: shots.json ${error.message}`);
    }
    for (const fileName of fs.readdirSync(journeyDir)) {
      if (!fileName.endsWith(".png")) continue;
      consider(fileName.slice(0, -4));
    }

    const required = kind ? requiredShots(kind) : [];
    const shots = [];
    for (const slug of [...slugs].sort((a, b) => shotOrder(a) - shotOrder(b) || a.localeCompare(b))) {
      const spec = shotSpec(slug);
      const nominal = path.join(journeyDir, spec.file);
      let file;
      try {
        file = realInside(root, nominal);
        assertPngBytes(file);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        errors.push(`${entry.id}: ${spec.file}: ${error.message}`);
        continue;
      }
      shots.push({
        slug,
        caption: SHOTS[slug]?.caption ?? spec.caption,
        uploadName: `${entry.id}-${spec.file}`,
        file,
      });
    }
    const have = new Set(shots.map(shot => shot.slug));
    if (result.pass === true) {
      for (const slug of required) {
        if (!have.has(slug)) errors.push(`${entry.id}: passed without screenshot ${shotFileName(slug)}`);
      }
    } else if (result.pass === false && shots.length === 0) {
      errors.push(`${entry.id}: failed with no screenshot`);
    }

    const failures = countList(result.failures);
    const pageErrors = countList(result.pageErrors);
    if (failures === null) errors.push(`${entry.id}: result.json failures must be a list`);
    if (pageErrors === null) errors.push(`${entry.id}: result.json pageErrors must be a list`);
    let consoleText = "";
    try {
      consoleText = fs.readFileSync(realInside(root, path.join(journeyDir, "browser-console.log")), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") errors.push(`${entry.id}: browser-console.log ${error.message}`);
    }
    journeys.push({
      id: entry.id,
      pass: result.pass === true,
      observation,
      failures: failures ?? 0,
      pageErrors: pageErrors ?? 0,
      consoleNotes: consoleNotes(consoleText),
      shots,
    });
  }

  const model = run && shaOk ? {
    headSha,
    launchedSha: run.headSha,
    foundry: run.foundry,
    foundryborne: run.foundryborne,
    moduleVersion: run.moduleVersion,
    runId: run.runId,
    journeys,
  } : null;
  return { errors, model };
}

function altText(caption) {
  return caption.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

/** Markdown for the PR description. `urls` maps uploadName to a user-attachments URL. */
export function renderEvidenceBlock(model, urls) {
  if (!model) throw new Error("nothing to render");
  const lines = [
    "## Live evidence",
    "",
    `Head: \`${model.headSha}\``,
  ];
  if (model.launchedSha && model.launchedSha !== model.headSha) {
    lines.push(`Server launched at: \`${model.launchedSha}\``);
  }
  lines.push(
    `Foundry: ${model.foundry}`,
    `Foundryborne: ${model.foundryborne}`,
    `Module: ${model.moduleVersion}`,
    `Run: \`${model.runId}\``,
    "",
    PRIVACY_NOTE,
    "",
  );
  for (const journey of model.journeys) {
    lines.push(`### ${journey.id}`, "", journey.pass ? "PASS" : "FAIL", "", `Observation: ${journey.observation}`, "");
    for (const shot of journey.shots) {
      const url = urls[shot.uploadName];
      if (!ATTACHMENT_URL.test(url ?? "")) throw new Error(`missing user-attachments URL for ${shot.uploadName}`);
      lines.push(`![${altText(shot.caption)}](${url})`, "");
    }
    lines.push(`failures: ${journey.failures}`, `pageErrors: ${journey.pageErrors}`);
    if (journey.consoleNotes.length) {
      for (const note of journey.consoleNotes) lines.push(`- ${note}`);
    } else {
      lines.push("console: no module errors or deprecation warnings");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
