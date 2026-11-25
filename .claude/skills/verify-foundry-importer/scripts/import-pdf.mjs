#!/usr/bin/env node
// Journey: import one Demiplane PDF through the real wizard, the way a GM does, and record evidence.
// Usage:
//   node import-pdf.mjs --url <URL> --evidence <EVIDENCE> --pdf <file.pdf> [--answers answers.json] [--journey <id>] [--stop-at edit|review]
// answers.json (all optional):
//   { "name": "[Import test] Jen",                 // overrides the character name (keep the [Import test] prefix)
//     "fields": { "level": 1 },                     // data-bind path -> value, typed into the Character tab inputs
//     "experiences": { "Folk hero": 0 },            // experience name -> bonus (for bonuses the PDF left blank)
//     "comparisons": { "Evasion": "pdf", "*": "foundry" },   // stat label -> "pdf" | "foundry"; "*" = default
//     "expect": { "actor": { "evasion": 8, "armorScore.max": 4 },   // dotted paths into worldState() of the new character
//                 "items": [..], "inVault": [..], "loadout": [..], "itemCounts": { "Round Shield": 1 },
//                 "effects": ["PDF import: Evasion"], "unmatched": [..],     // unmatched = items with no compendium source
//                 "levelupDialog": { "Tier 2": "X__ X_ __ X X _" } },     // taken checkboxes when raised to next level
//     "settings": { "levelupAuto": false } }        // set Foundryborne's automatic level-up before importing
// Exit code 0 = journey reached its end state and all expectations held.
import { session, openImporterFromSidebar, settle, action, tab, worldState, writeJSON, setLevelupAuto, levelupDialogState, levelupHistory, WIZARD } from "./harness.mjs";
import { assertSlug } from "./evidence.mjs";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({ options: { url: { type: "string" }, evidence: { type: "string" }, pdf: { type: "string" }, answers: { type: "string" }, "stop-at": { type: "string" }, journey: { type: "string" } } });
if (!a.url || !a.evidence || !a.pdf) { console.error("need --url --evidence --pdf"); process.exit(2); }
if (a.journey) { try { assertSlug(a.journey, "--journey"); } catch (e) { console.error(e.message); process.exit(2); } }
const answers = a.answers ? JSON.parse(fs.readFileSync(a.answers, "utf8")) : {};
const pdf = path.resolve(a.pdf.replace(/^~/, process.env.HOME));
const evidence = a.journey
  ? path.join(a.evidence, a.journey)
  : path.join(a.evidence, `${path.basename(pdf, ".pdf")}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`);
const failures = [];

const s = await session({ url: a.url, evidence });
const { page, shot, log } = s;
let previousLevelupAuto;
try {
  if ("levelupAuto" in (answers.settings ?? {})) {
    previousLevelupAuto = await setLevelupAuto(page, answers.settings.levelupAuto);
    log("levelupAuto:", previousLevelupAuto, "->", answers.settings.levelupAuto);
  }
  const before = await worldState(page);
  writeJSON(evidence, "world-before.json", before);

  // 1. Upload
  await openImporterFromSidebar(page);
  await page.setInputFiles(`${WIZARD} #dpi-file`, pdf);
  await shot("wizard-upload");
  await action(page, "read").click();
  const readErr = await settle(page);
  if (readErr) throw new Error(`read failed: ${readErr}`);
  log("read ok:", await page.locator(`${WIZARD} .dpi-header h2`).textContent());

  // 2. Edit tabs: capture each, apply answers on the Character tab
  for (const id of ["character", "content", "advanced", "notes"]) {
    await tab(page, id).click(); await settle(page);
    await shot(`tab-${id}`);
    if (id === "content") {
      const unresolved = await page.locator(`${WIZARD} select[data-source]`).evaluateAll(sels => sels.filter(s => s.value === "unresolved").map(s => s.getAttribute("aria-label")));
      log("unresolved content sources:", unresolved);
      const summary = await page.locator(`${WIZARD} details.dpi-entry summary`).evaluateAll(xs => xs.map(x => x.innerText.replace(/\s+/g, " ").trim()));
      writeJSON(evidence, "content-matches.json", summary);
    }
  }
  await tab(page, "character").click(); await settle(page);
  if (answers.name) await page.fill(`${WIZARD} [data-bind="name"]`, answers.name);
  for (const [bind, value] of Object.entries(answers.fields ?? {})) {
    const input = page.locator(`${WIZARD} [data-bind="${bind}"]`);
    if (!await input.count()) { failures.push(`no input for ${bind}`); continue; }
    await input.fill(String(value));
  }
  for (const [expName, value] of Object.entries(answers.experiences ?? {})) {
    const idx = await page.locator(`${WIZARD} [data-bind^="experiences."][data-bind$=".name"]`).evaluateAll((xs, n) => xs.findIndex(x => x.value.trim().toLowerCase() === n.toLowerCase()), expName);
    if (idx < 0) { failures.push(`no experience named ${expName}`); continue; }
    await page.fill(`${WIZARD} [data-bind="experiences.${idx}.value"]`, String(value));
  }
  const name = await page.inputValue(`${WIZARD} [data-bind="name"]`);
  if (!name.startsWith("[Import test]")) log(`WARN character name "${name}" lacks the [Import test] prefix`);
  await shot("character-answered");
  if (a["stop-at"] === "edit") { log("stopped at edit"); process.exitCode = failures.length ? 1 : 0; }
  else {
    // 3. Review calculated stats
    await action(page, "preview").click();
    const prevErr = await settle(page);
    if (prevErr) throw new Error(`preview failed: ${prevErr}`);
    const rows = await page.locator(`${WIZARD} table.dpi-comparisons tbody tr`).evaluateAll(trs => trs.map(tr => [...tr.cells].slice(0, 3).map(td => td.innerText.trim())));
    log("comparisons [label, pdf, foundry]:", rows);
    for (const [label] of rows) {
      const choice = answers.comparisons?.[label] ?? answers.comparisons?.["*"];
      if (!choice) { failures.push(`no comparison answer for ${label}`); continue; }
      await page.selectOption(`${WIZARD} select[aria-label="Resolve ${label}"]`, choice);
    }
    const issues = await page.locator(`${WIZARD} .dpi-issues li`).allInnerTexts();
    log("review issues:", issues);
    await shot("review");
    if (a["stop-at"] === "review") { log("stopped at review"); }
    else {
      // 4. Create
      await page.check(`${WIZARD} #dpi-reviewed`);
      await action(page, "create").click();
      const createErr = await settle(page, 120000);
      if (createErr) throw new Error(`create failed: ${createErr}`);
      await page.waitForTimeout(1500); // let actor sheets open
      await shot("created-actor-sheet");
      const after = await worldState(page);
      writeJSON(evidence, "world-after.json", after);
      const created = after.filter(x => !before.some(b => b.id === x.id));
      log("created actors:", created.map(c => `${c.name} (${c.type}) evasion=${c.evasion} hp=${c.hp} report=${c.reportStatus}`));
      const actor = created.find(c => c.type === "character");
      if (!actor) failures.push("no character actor created");
      else {
        if (actor.reportStatus !== "complete") failures.push(`report status ${actor.reportStatus}`);
        const exp = answers.expect ?? {};
        const at = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);
        for (const [k, want] of Object.entries(exp.actor ?? {})) { const got = at(actor, k); if (got !== want) failures.push(`${k}: expected ${want}, got ${JSON.stringify(got)}`); }
        for (const item of exp.items ?? []) if (!actor.items.some(i => i.name === item)) failures.push(`missing item ${item}`);
        for (const item of exp.inVault ?? []) if (!actor.items.some(i => i.name === item && i.inVault)) failures.push(`not in vault: ${item}`);
        for (const item of exp.loadout ?? []) if (!actor.items.some(i => i.name === item && i.type === "domainCard" && i.inVault === false)) failures.push(`not in loadout: ${item}`);
        for (const [item, n] of Object.entries(exp.itemCounts ?? {})) { const c = actor.items.filter(i => i.name === item).length; if (c !== n) failures.push(`${item}: expected ${n} copies, got ${c}`); }
        if ("effects" in exp) { const names = actor.effects.map(e => e.name).sort(); if (JSON.stringify(names) !== JSON.stringify([...exp.effects].sort())) failures.push(`effects: expected ${JSON.stringify(exp.effects)}, got ${JSON.stringify(names)}`); }
        const history = await levelupHistory(page, actor.id);
        const dialog = await levelupDialogState(page, actor.id, (actor.level ?? 1) + 1);
        writeJSON(evidence, "levelups.json", { history, dialogAtNextLevel: dialog });
        log("level-up history:", history); log(`level-up dialog at level ${(actor.level ?? 1) + 1}:`, dialog);
        for (const [tierName, want] of Object.entries(exp.levelupDialog ?? {})) if (dialog[tierName] !== want) failures.push(`${tierName} dialog: expected "${want}", got "${dialog[tierName]}"`);
        if ("unmatched" in exp) { const u = actor.items.filter(i => !i.source).map(i => i.name).sort(); if (JSON.stringify(u) !== JSON.stringify([...exp.unmatched].sort())) failures.push(`unmatched (no compendium source): expected ${JSON.stringify(exp.unmatched)}, got ${JSON.stringify(u)}`); }
        // Existing actors must be untouched
        for (const b of before) { const now = after.find(x => x.id === b.id); if (!now || JSON.stringify(now) !== JSON.stringify(b)) failures.push(`pre-existing actor changed: ${b.name}`); }
      }
    }
  }
} catch (e) {
  failures.push(e.message);
  await shot("failure").catch(() => {});
} finally {
  // Uncaught page errors are reported here; open-importer.mjs is the journey that fails on them.
  if (previousLevelupAuto !== undefined) {
    try {
      await setLevelupAuto(page, previousLevelupAuto);
      log("levelupAuto restored:", previousLevelupAuto);
    } catch (e) {
      log("levelupAuto restore failed:", e.message);
    }
  }
  const pageErrors = fs.existsSync(path.join(evidence, "browser-console.log"))
    ? fs.readFileSync(path.join(evidence, "browser-console.log"), "utf8").split("\n").filter(l => l.startsWith("[pageerror]")) : [];
  if (pageErrors.length) log("page errors:", pageErrors);
  log(failures.length ? `FAIL\n- ${failures.join("\n- ")}` : "PASS");
  writeJSON(evidence, "result.json", {
    journey: a.journey ?? path.basename(pdf, ".pdf"),
    kind: "import",
    pdfName: path.basename(pdf),
    pass: failures.length === 0,
    failures,
    pageErrors,
  });
  await s.close();
  process.exitCode = failures.length ? 1 : 0;
}
