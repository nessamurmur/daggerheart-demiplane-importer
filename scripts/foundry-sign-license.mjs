// Sign a local Foundry server through its licence page. The key stays in the environment.
// No screenshots: the page contains the key.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { licenseSigned, redactSecrets } from "./foundry-run-meta.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, "../.claude/skills/verify-foundry-importer/scripts");
const require = createRequire(path.join(skillDir, "package.json"));
const { chromium } = require("playwright-core");

const url = process.argv[2];
const licenseFile = process.argv[3];
const adminFile = process.argv[4];
if (!url || !licenseFile || !adminFile) {
  console.error("usage: foundry-sign-license.mjs <url> <license.json> <admin-password-file>");
  process.exit(2);
}
const key = (process.env.FOUNDRY_LICENSE_KEY || "").trim();
if (key.length < 20) {
  console.error("Missing Runtime Secret FOUNDRY_LICENSE_KEY.");
  process.exit(1);
}

function seedUnsignedLicense() {
  fs.mkdirSync(path.dirname(licenseFile), { recursive: true });
  fs.writeFileSync(licenseFile, JSON.stringify({ license: key.replaceAll("-", "") }) + "\n", { mode: 0o600 });
}

function rememberAdmin(value) {
  fs.mkdirSync(path.dirname(adminFile), { recursive: true });
  fs.writeFileSync(adminFile, value + "\n", { mode: 0o600 });
}

async function clickForward(page) {
  const buttons = page.locator("button, input[type='submit']");
  const count = await buttons.count();
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const label = ((await button.innerText().catch(() => "")) || (await button.getAttribute("value")) || "").replace(/\s+/g, " ").trim();
    if (/decline|cancel|back|deny|disagree/i.test(label)) continue;
    if (/submit|agree|accept|continue|sign|next|confirm|save/i.test(label)) {
      await button.click();
      return true;
    }
  }
  return false;
}

const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let seeded = false;
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let step = 0; step < 8 && !licenseSigned(licenseFile); step++) {
    const keyInput = page.locator("#key, #licenseKey, input[name='licenseKey'], input[name='key']").first();
    if ((await keyInput.count()) && (await keyInput.isVisible().catch(() => false))) {
      await keyInput.fill(key);
      await clickForward(page);
      await page.waitForTimeout(1000);
      continue;
    }
    const password = page.locator("input[type='password']:visible").first();
    if (await password.count()) {
      const value = (process.env.FOUNDRY_ADMIN_KEY || "").trim() || randomBytes(18).toString("base64url");
      rememberAdmin(value);
      const fields = page.locator("input[type='password']:visible");
      for (let index = 0; index < await fields.count(); index++) await fields.nth(index).fill(value);
      await clickForward(page);
      await page.waitForTimeout(1000);
      continue;
    }
    const box = page.locator("input[type='checkbox']:visible").first();
    if (await box.count()) await box.check().catch(() => {});
    const clicked = await clickForward(page);
    if (!clicked && !seeded) {
      seedUnsignedLicense();
      seeded = true;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    }
    await page.waitForTimeout(1000);
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !licenseSigned(licenseFile)) await page.waitForTimeout(500);
  if (!licenseSigned(licenseFile)) {
    console.error(`Licence was not signed. Page stayed at ${page.url()}.`);
    process.exitCode = 1;
  }
} catch (error) {
  const message = redactSecrets(error && error.message ? error.message : error);
  console.error(`Licence form failed: ${message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
