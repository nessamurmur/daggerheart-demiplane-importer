// Playwright helpers for driving the Demiplane importer in a real Foundry instance started by fvtt.sh.
// Import from journey scripts:  import { session, ... } from "./harness.mjs";
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { recordShot, shotSpec } from "./evidence.mjs";

export const MODULE_ID = "daggerheart-demiplane-importer";
export const WIZARD = `#${MODULE_ID}`;            // ApplicationV2 root element id
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

/** Launch Chrome, join the world as Gamemaster, enable the module if needed. Returns { browser, page, shot, log, close }. */
export async function session({ url, evidence, headless = process.env.HEADED ? false : true }) {
  if (!url || !evidence) throw new Error("session needs { url, evidence } (both printed by fvtt.sh launch)");
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  // Foundry's core.welcome tour is a client setting (localStorage "core.tourProgress"). A fresh browser profile has
  // never seen it, so on a new world it starts a few seconds after ready and its .tour-overlay swallows every click.
  // Mark it completed before any page script runs, as in a returning GM's browser. welcome.json has 3 steps.
  await context.addInitScript(() => {
    try {
      const p = JSON.parse(localStorage.getItem("core.tourProgress") || "{}");
      p.core = { ...(p.core || {}), welcome: 3 };
      localStorage.setItem("core.tourProgress", JSON.stringify(p));
    } catch {}
  });
  const page = await context.newPage();
  const consoleLog = fs.createWriteStream(path.join(evidence, "browser-console.log"), { flags: "a" });
  page.on("console", m => consoleLog.write(`[${m.type()}] ${m.text()}\n`));
  page.on("pageerror", e => consoleLog.write(`[pageerror] ${e.stack ?? e}\n`));
  const shots = [];
  const shot = async name => {
    const spec = shotSpec(name);
    const file = path.join(evidence, spec.file);
    await page.screenshot({ path: file, fullPage: false });
    recordShot(shots, name);
    writeJSON(evidence, "shots.json", shots);
    return file;
  };
  const log = (...args) => { const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "); console.log(line); fs.appendFileSync(path.join(evidence, "journey.log"), line + "\n"); };

  await join(page, url);
  const active = await page.evaluate(id => game.modules.get(id)?.active, MODULE_ID);
  if (!active) {
    // Setup only: equivalent to Settings > Manage Modules > tick > Save. Requires a reload, like the UI.
    await page.evaluate(async id => {
      const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
      cfg[id] = true; await game.settings.set("core", "moduleConfiguration", cfg);
    }, MODULE_ID);
    await join(page, url);
    if (!await page.evaluate(id => game.modules.get(id)?.active, MODULE_ID)) throw new Error("module did not activate; check server.log and that dist/ is built");
  }
  await dismissPopups(page);
  return { browser, page, shot, log, close: async () => { consoleLog.end(); await browser.close(); } };
}

export async function join(page, url) {
  await page.goto(`${url}/join`);
  await page.locator("#join-username option", { hasText: "Gamemaster" }).waitFor({ state: "attached", timeout: 30000 });
  await page.selectOption("#join-username", { label: "Gamemaster" });
  await page.click('button[name="join"]');
  await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 90000 });
}

/** Close a tour or system dialog if one is open (fallback; the init script normally prevents the welcome tour). */
export async function dismissPopups(page) {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(() => {
      const Tour = foundry.nue.Tour;
      if (Tour.activeTour) Tour.activeTour.exit();
      for (const app of foundry.applications.instances.values()) if (app instanceof foundry.applications.api.DialogV2) app.close();
      ui.notifications.clear(); // headless Chrome's permanent "no hardware acceleration" warning covers window headers
      return !!(Tour.activeTour || document.querySelector(".tour-overlay"));
    });
    if (!open) return;
    await page.waitForTimeout(500);
  }
  throw new Error("a tour overlay or dialog would not close; see screenshots");
}

/** User path: Actors sidebar tab -> "Import Demiplane PDF" button. Returns the wizard locator. */
export async function openImporterFromSidebar(page) {
  await page.click('#sidebar [data-tab="actors"], nav#sidebar-tabs [data-tab="actors"]');
  const btn = page.locator(`#actors button[data-module="${MODULE_ID}"]`);
  await btn.waitFor({ state: "visible", timeout: 15000 });
  await btn.click();
  const wiz = page.locator(WIZARD);
  await wiz.waitFor({ state: "visible", timeout: 15000 });
  return wiz;
}

/** Wait until the wizard is idle (no spinner) and return its visible error, if any. */
export async function settle(page, timeout = 60000) {
  await page.waitForFunction(sel => !document.querySelector(`${sel} .dpi-status`), WIZARD, { timeout });
  const err = page.locator(`${WIZARD} .dpi-error`);
  return (await err.count()) ? (await err.textContent()).trim() : null;
}

export const action = (page, name) => page.locator(`${WIZARD} [data-dpi-action="${name}"]`);
export const tab = (page, id) => page.locator(`${WIZARD} [data-dpi-action="tab"][data-tab="${id}"]`);

/** Read-only world state, for proving side effects (created actors/items/effects, flags). */
export async function worldState(page) {
  // Derived (prepared) values come from a.system; stored data via toObject() so nothing circular is serialized.
  return page.evaluate(id => {
    const plain = v => v == null ? null : JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === "object" && x.constructor?.name !== "Object" && !Array.isArray(x) && typeof x.toObject === "function") ? x.toObject() : x));
    return game.actors.contents.map(a => {
      const s = a.system ?? {};
      return {
        id: a.id, uuid: a.uuid, name: a.name, type: a.type,
        level: s.levelData?.level?.current ?? null,
        evasion: s.evasion ?? null, hp: s.resources?.hitPoints?.max ?? null, stress: s.resources?.stress?.max ?? null,
        traits: s.traits ? Object.fromEntries(Object.entries(s.traits).map(([k, t]) => [k, t?.value ?? null])) : null,
        hope: s.resources?.hope?.value ?? null, armorScore: s.armorScore ?? null,
        thresholds: plain(s.damageThresholds), proficiency: s.proficiency ?? null,
        items: a.items.contents.map(i => ({ name: i.name, type: i.type, source: i._stats?.compendiumSource ?? null, equipped: i.system?.equipped ?? null, inVault: i.system?.inVault ?? null })),
        effects: a.effects.contents.map(e => { const o = e.toObject(); return { name: e.name, disabled: e.disabled, changes: o.changes ?? o.system?.changes ?? null }; }),
        reportStatus: a.getFlag(id, "report")?.status ?? null
      };
    });
  }, MODULE_ID);
}

export function writeJSON(evidence, name, data) {
  const file = path.join(evidence, name); fs.writeFileSync(file, JSON.stringify(data, null, 2)); return file;
}

/** Set Foundryborne's "automatic level-up" world setting (Settings > Automation). Returns the previous value. */
export async function setLevelupAuto(page, value) {
  return page.evaluate(async v => {
    const key = CONFIG.DH.SETTINGS.gameSettings.Automation;
    const current = game.settings.get(CONFIG.DH.id, key);
    const previous = current.levelupAuto;
    await game.settings.set(CONFIG.DH.id, key, { ...current.toObject(), levelupAuto: v });
    return previous;
  }, value);
}

/** The level-up dialog's checkbox state for an actor raised to `level`, without saving: { "Tier 2": "X__ X_ __ X X _", ... }.
 *  Groups follow the tier's option order; X = taken by a saved selection. Built the way the sheet's Level Up button does. */
export async function levelupDialogState(page, actorId, level) {
  return page.evaluate(({ id, level }) => {
    const actor = game.actors.get(id).clone({ "system.levelData.level.changed": level }, { keepId: true });
    const app = new game.system.api.applications.levelup.CharacterLevelup(actor);
    return Object.fromEntries(app.levelup.tiersForRendering.map(t => [t.name, t.groups.map(g => g.checkboxGroups.map(cg => cg.checkboxes[0].selected ? "X" : "_").join("")).join(" ")]));
  }, { id: actorId, level });
}

/** Saved level-up history of an actor, compact: { "2": ["trait:strength,presence", "hitPoint"], ... }. */
export async function levelupHistory(page, actorId) {
  return page.evaluate(id => Object.fromEntries(Object.entries(game.actors.get(id).system.levelData.toObject().levelups)
    .map(([lvl, l]) => [lvl, l.selections.map(s => s.optionKey + (s.data?.length && s.type === "trait" ? ":" + s.data.join(",") : ""))])), actorId);
}

