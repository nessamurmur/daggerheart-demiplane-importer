import { MODULE_ID } from "./types.ts";
import { ImportWizard } from "./wizard.ts";

let wizard: ImportWizard | undefined;
export function openImporter(): void {
  if (!game.user.isGM) { ui.notifications.warn("Only a GM may import Demiplane characters."); return; }
  if (game.system.id !== "daggerheart") { ui.notifications.error("This importer requires the Foundryborne Daggerheart system."); return; }
  if (foundry.utils.isNewerVersion("2.10.2", game.system.version)) { ui.notifications.error("This importer requires Foundryborne 2.10.2 or newer."); return; }
  if (!wizard || !wizard.rendered) wizard = new ImportWizard();
  wizard.render({ force: true });
  wizard.bringToFront();
}

Hooks.once("ready", () => {
  if (game.system.id !== "daggerheart") return;
  game.modules.get(MODULE_ID).api = { openImporter };
  if (game.user.isGM && game.system.version !== "2.10.2") console.warn(`[${MODULE_ID}] Verified against Foundryborne 2.10.2; running ${game.system.version}. Review calculated values carefully.`);
  ui.actors?.render();
});
Hooks.on("renderActorDirectory", (_app: any, html: HTMLElement | { 0: HTMLElement }) => {
  if (!game.user?.isGM || game.system.id !== "daggerheart") return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(`[data-module="${MODULE_ID}"]`)) return;
  const host = root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root.querySelector("header");
  if (!host) return;
  const button = document.createElement("button");
  button.type = "button"; button.dataset.module = MODULE_ID;
  button.className = "dpi-directory-button";
  button.innerHTML = '<i class="fa-solid fa-file-import"></i> Import Demiplane PDF';
  button.addEventListener("click", openImporter); host.append(button);
});
