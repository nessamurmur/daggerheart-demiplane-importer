#!/usr/bin/env node
// Journey: open the wizard the ways a GM does and fail on any uncaught page error.
// Usage: node open-importer.mjs --url <URL> --evidence <EVIDENCE>
// Steps: sidebar button (first open) -> close -> macro API open -> sidebar again while open (must not duplicate).
import { session, openImporterFromSidebar, dismissPopups, WIZARD, MODULE_ID } from "./harness.mjs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({ options: { url: { type: "string" }, evidence: { type: "string" } } });
if (!a.url || !a.evidence) { console.error("need --url --evidence"); process.exit(2); }
const evidence = path.join(a.evidence, `open-importer-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`);
const failures = [], pageErrors = [];

const s = await session({ url: a.url, evidence });
const { page, shot, log } = s;
page.on("pageerror", e => pageErrors.push(String(e.stack ?? e).split("\n").slice(0, 3).join(" | ")));
try {
  await openImporterFromSidebar(page);
  await page.waitForTimeout(1000);
  await shot("first-open-sidebar");
  log("after first open:", { windows: await page.locator(WIZARD).count(), front: await page.evaluate(() => ui.activeWindow?.id ?? null) });

  await dismissPopups(page); // the GPU warning can arrive late and cover the close button
  await page.click(`${WIZARD} [data-action="close"]`);
  await page.locator(WIZARD).waitFor({ state: "detached", timeout: 10000 });

  await page.evaluate(id => game.modules.get(id).api.openImporter(), MODULE_ID);
  await page.locator(WIZARD).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1000);
  await shot("reopen-api");

  await page.click(`#actors button[data-module="${MODULE_ID}"]`);
  await page.waitForTimeout(1000);
  const count = await page.locator(WIZARD).count();
  const front = await page.evaluate(() => ui.activeWindow?.id ?? null);
  log("after reopen while open:", { windows: count, front });
  if (count !== 1) failures.push(`expected one wizard window, found ${count}`);
  if (front !== MODULE_ID) failures.push(`wizard is not the front window (front=${front})`);
  await shot("reopen-while-open");
} catch (e) {
  failures.push(e.message); await shot("failure").catch(() => {});
} finally {
  if (pageErrors.length) failures.push(...pageErrors.map(e => `uncaught page error: ${e}`));
  log(failures.length ? `FAIL\n- ${failures.join("\n- ")}` : "PASS");
  await s.close();
  process.exitCode = failures.length ? 1 : 0;
}
