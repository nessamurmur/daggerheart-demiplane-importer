import { test } from "node:test";
import assert from "node:assert/strict";
import { character, mockRuntime } from "./helpers.ts";
import { resolveEntries } from "../src/core.ts";

class Checkbox {
  type = "checkbox";
  value = "";
  checked = false;
  dataset: Record<string, string> = {};
}
class SourceSelect {
  value = "";
  dataset: Record<string, string> = {};
}
Object.assign(globalThis, {
  HTMLInputElement: Checkbox, HTMLSelectElement: SourceSelect, HTMLTextAreaElement: class {}, HTMLElement: class {},
  ui: { notifications: { error() {} } },
  foundry: { applications: { api: { ApplicationV2: class { async render() {} } } }, utils: { randomID: () => "id" } },
  CONFIG: { DH: { DOMAIN: { allDomains: () => ({}) } }, Actor: { documentClass: class {} } },
  game: { system: { version: "2.10.2", settings: { automation: { levelupAuto: true }, homebrew: { maxLoadout: 5 } } }, user: { isGM: true }, modules: { get: () => ({ version: "test" }) }, i18n: { localize: (key: string) => key } }
});

const { ImportWizard } = await import("../src/wizard.ts");

test("Review keeps an excluded item's chosen source, so including it again does not ask for one", async () => {
  const c = character({ armor_name: "Test Armor" });
  const armorIndex = c.entries.findIndex(e => e.name === "Test Armor");
  const armor = c.entries[armorIndex]!;
  const sources = [{ uuid: "Compendium.test.Item.armor", name: "Test Armor", type: "armor", pack: "Armors" }];
  const include = new Checkbox();
  include.dataset.bind = `entries.${armorIndex}.include`;
  const source = new SourceSelect();
  source.dataset.source = armor.id;
  source.value = "pdf";
  const { runtime } = mockRuntime();
  const wizard = new ImportWizard() as InstanceType<typeof ImportWizard> & { element: { querySelectorAll(selector: string): unknown[]; querySelector(): null } };
  wizard.runtime = runtime;
  wizard.character = c;
  wizard.candidates = sources;
  wizard.resolutions = resolveEntries(c, sources);
  wizard.stage = "edit";
  wizard.tab = "content";
  wizard.element = {
    querySelectorAll: selector => selector === "[data-bind]" ? [include] : selector === "[data-source]" ? [source] : [],
    querySelector: () => null
  };
  const chip = () => wizard.entryEditor(armor, armorIndex).match(/dpi-source">([^<]*)</)?.[1];

  await wizard.act("preview", new HTMLElement());
  assert.equal(wizard.error, "");
  assert.equal(wizard.stage, "review");
  await wizard.act("back", new HTMLElement());
  assert.equal(armor.include, false);
  assert.equal(chip(), "Editable PDF item");

  include.checked = true;
  await wizard.act("preview", new HTMLElement());
  assert.equal(wizard.error, "");
  assert.equal(chip(), "Editable PDF item");
  assert.equal(wizard.plan!.issues.some(i => i.message.includes(`Choose a content source for “${armor.name}”`)), false);
});
