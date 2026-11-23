#!/usr/bin/env node
// Deterministic Foundry package-readiness lint for daggerheart-demiplane-importer.
// Cheap, no dependencies. Run from the repo root: node scripts/check-package-readiness.mjs [--json]
// Exit 1 only on ERROR. WARN/INFO are for the reviewer (docs/review/foundry-readiness.md) to interpret.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const findings = [];
const add = (level, code, message, where) => findings.push({ level, code, message, ...(where ? { where } : {}) });
const read = file => fs.readFileSync(file, "utf8");
const exists = file => fs.existsSync(file);
const json = file => { try { return JSON.parse(read(file)); } catch (e) { add("ERROR", "json-invalid", `${file} is not valid JSON: ${e.message}`, file); return null; } };
const cmp = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };

const m = exists("module.json") ? json("module.json") : (add("ERROR", "manifest-missing", "module.json is missing at the repo root"), null);
const pkg = exists("package.json") ? json("package.json") : null;

if (m) {
  for (const key of ["id", "title", "description", "version"]) if (!m[key]) add("ERROR", "manifest-required", `module.json is missing required field "${key}"`, "module.json");
  if (m.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id)) add("ERROR", "id-format", `id "${m.id}" must be lower-case with hyphens only`, "module.json");
  if (pkg?.name && m.id && pkg.name !== m.id) add("WARN", "id-name-drift", `package.json name "${pkg.name}" differs from module id "${m.id}"`, "package.json");
  if (pkg?.version && m.version !== pkg.version) add("ERROR", "version-drift", `module.json version ${m.version} != package.json version ${pkg.version}`, "module.json");
  if (m.version && !/^\d+\.\d+\.\d+$/.test(m.version)) add("ERROR", "version-format", `version "${m.version}" should be plain MAJOR.MINOR.PATCH (no pre-release labels; Foundry's isNewerVersion ignores them)`, "module.json");
  if (exists("RELEASE_NOTES.md") && m.version && !read("RELEASE_NOTES.md").includes(m.version)) add("WARN", "release-notes-stale", `RELEASE_NOTES.md does not mention ${m.version}`, "RELEASE_NOTES.md");

  const c = m.compatibility ?? {};
  if (!c.minimum) add("ERROR", "compat-minimum", "compatibility.minimum is missing", "module.json");
  if (c.minimum && c.verified && cmp(c.minimum, c.verified) > 0) add("ERROR", "compat-order", "compatibility.minimum is newer than verified", "module.json");
  if (c.maximum) add("INFO", "compat-maximum", `compatibility.maximum="${c.maximum}" is hard-enforced by Foundry (blocks install/enable above it). Foundry's guidance: leave empty unless a known break. Intentional?`, "module.json");
  for (const s of m.relationships?.systems ?? []) {
    const sc = s.compatibility ?? {};
    if (sc.minimum && sc.verified && cmp(sc.minimum, sc.verified) > 0) add("ERROR", "system-compat-order", `system ${s.id}: minimum newer than verified`, "module.json");
  }
  if (!(m.system ?? []).length && !(m.relationships?.systems ?? []).some(s => s.id)) add("WARN", "system-restriction", "No system restriction declared; module is Daggerheart-only", "module.json");

  const gh = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(m.url ?? "");
  if (!m.url) add("WARN", "url-missing", "url is empty", "module.json");
  if (m.manifest && gh && m.manifest !== `https://github.com/${gh[1]}/${gh[2]}/releases/latest/download/module.json`) add("WARN", "manifest-url", `manifest is not the stable releases/latest/download/module.json URL: ${m.manifest}`, "module.json");
  if (m.download && m.id && m.version && !m.download.endsWith(`/releases/download/v${m.version}/${m.id}-${m.version}.zip`)) add("ERROR", "download-url", `download must point at this version's ZIP: ${m.download}`, "module.json");
  if (!m.bugs) add("WARN", "bugs-missing", 'No "bugs" URL. Foundry shows it to users who need to report an issue', "module.json");
  if (!m.changelog) add("WARN", "changelog-missing", 'No "changelog" URL', "module.json");
  const author = m.authors?.[0]?.name ?? "";
  if (!author || /contributors/i.test(author)) add("WARN", "author-generic", `authors[0].name is "${author}": a package listing needs an accountable human/handle`, "module.json");
  for (const f of [...(m.styles ?? []), ...(m.languages ?? []).map(l => l.path)]) if (!exists(f)) add("ERROR", "file-missing", `module.json references ${f}, which does not exist in the repo`, "module.json");
  for (const f of m.esmodules ?? []) {
    const built = f.replace(/^scripts\//, "src/").replace(/\.js$/, ".ts");
    if (!exists(f) && !exists(built)) add("ERROR", "file-missing", `module.json esmodules entry ${f} has no source (${built}) or file`, "module.json");
  }
  if (!(m.languages ?? []).length) add("WARN", "no-i18n", 'No "languages" array / lang/en.json: UI strings cannot be localized', "module.json");
  if (m.license && !/^https?:/.test(m.license) && !exists(m.license)) add("ERROR", "license-missing", `license points at ${m.license}, which does not exist`, "module.json");
  if (!m.license) add("WARN", "license-field", "No license field", "module.json");
  if (m.readme && !/^https?:/.test(m.readme) && !exists(m.readme)) add("ERROR", "readme-missing", `readme points at ${m.readme}, which does not exist`, "module.json");
}

// Tracked-file hygiene (needs git).
try {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of tracked) {
    if (/\.pdf$/i.test(f)) add("ERROR", "tracked-pdf", `PDF is committed: ${f}. Sample character sheets must never be in git`, f);
    if (/(^|\/)\.env|\.pem$|license\.json$/i.test(f)) add("ERROR", "tracked-secret", `Possible secret or Foundry license file is committed: ${f}`, f);
    if (/\.(png|jpe?g|webp|svg|gif|mp3|ogg|wav|webm|mp4|woff2?|ttf)$/i.test(f)) add("WARN", "asset-added", `Binary/art asset in repo: ${f}. Needs provenance (human-made or licensed) for the Foundry listing`, f);
  }
} catch { add("INFO", "git-unavailable", "git ls-files failed; hygiene checks skipped"); }

// Source heuristics.
const files = fs.existsSync("src") ? fs.readdirSync("src").filter(f => f.endsWith(".ts")).map(f => path.join("src", f)) : [];
let anyCount = 0, uiLiterals = 0;
for (const f of files) {
  read(f).split("\n").forEach((line, i) => {
    const where = `${f}:${i + 1}`;
    if (/["'`]\/modules\//.test(line) || /`\/modules\//.test(line)) add("WARN", "absolute-route", "Hard-coded absolute /modules/ URL breaks on hosts with a route prefix; build it with foundry.utils.getRoute()", where);
    const v = line.match(/["'`](\d+\.\d+\.\d+)["'`]/g);
    if (v && /(version|isNewerVersion|!==|===)/.test(line)) add("WARN", "version-literal", `Version literal ${v.join(",")} in code; derive from module.json / the module's own manifest (single source of truth)`, where);
    if (/\bwindow\.[A-Za-z_$][\w$]*\s*=|\bglobalThis\.[A-Za-z_$][\w$]*\s*=/.test(line)) add("WARN", "global-write", "Assignment to a global; expose APIs on game.modules.get(id).api instead", where);
    if (/\beval\(|new Function\(/.test(line)) add("ERROR", "dynamic-code", "Dynamic code execution; Foundry's AI policy requires user consent for runtime-generated code and it is a security risk", where);
    if (/ui\.notifications\.\w+\(\s*["'`]/.test(line)) uiLiterals++;
    anyCount += (line.match(/:\s*any\b|<any>|as any\b/g) ?? []).length;
  });
}
if (uiLiterals) add("INFO", "hardcoded-ui-strings", `${uiLiterals} ui.notifications call(s) pass literal English strings (plus wizard templates). Not localizable until moved to lang/en.json`);
add("INFO", "any-count", `${anyCount} explicit 'any' occurrences in src/ (track the trend; do not let it grow)`);

// IP / attribution signals (human decision, never auto-fail).
if (m) {
  const corpus = [m.title, m.description, exists("README.md") ? read("README.md") : ""].join("\n");
  if (/daggerheart/i.test(m.title ?? "")) add("INFO", "name-mark-in-title", `Package title contains the "Daggerheart" Name Mark ("${m.title}"). DPCGL §2.5 restricts Name Marks in titles of works that use the license; needs a decision (see foundry-readiness.md §IP)`, "module.json");
  if (!/compatible/i.test(corpus)) add("INFO", "no-compatible-wording", 'No "Compatible" wording next to the Daggerheart name in README/description (DPCGL §2.5(c))');
  if (!/Darrington Press Community Gaming/i.test(corpus + (exists("THIRD_PARTY_NOTICES.txt") ? read("THIRD_PARTY_NOTICES.txt") : ""))) add("INFO", "no-dpcgl-attribution", "No DPCGL attribution/copyright statement found. Required if any Public Game Content (SRD text, names, domain icons) is shared (DPCGL §4.1). The importer ships none today, so confirm it stays that way or add the notice");
}

const order = { ERROR: 0, WARN: 1, INFO: 2 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const errors = findings.filter(f => f.level === "ERROR").length;
if (process.argv.includes("--json")) console.log(JSON.stringify({ errors, warnings: findings.filter(f => f.level === "WARN").length, findings }, null, 2));
else {
  for (const f of findings) console.log(`${f.level.padEnd(5)} ${f.code}${f.where ? ` [${f.where}]` : ""}: ${f.message}`);
  console.log(`\n${errors} error(s), ${findings.filter(f => f.level === "WARN").length} warning(s), ${findings.filter(f => f.level === "INFO").length} info`);
}
process.exit(errors ? 1 : 0);
