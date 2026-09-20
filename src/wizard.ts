import { MODULE_ID, TRAITS, type Candidate, type Entry, type ImportReport, type ParsedCharacter, type Resolution, type ResolvedImportPlan } from "./types.ts";
import { candidatesFor, escapeHTML as esc, finiteNumber, getPath, resolveEntries, setPath, validateCharacter } from "./core.ts";
import { buildPlan, executePlan, foundryRuntime, loadCatalog, type ImportRuntime } from "./importer.ts";
import { readPdf } from "./pdf.ts";

const field = (label: string, path: string, value: unknown, type = "text", attrs = "") => `<label class="dpi-field"><span>${esc(label)}</span><input data-bind="${esc(path)}" aria-label="${esc(label)}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const number = (label: string, path: string, value: unknown, attrs = "") => field(label, path, value, "number", `step="1" ${attrs}`);
const check = (label: string, path: string, value: boolean) => `<label class="dpi-check"><input type="checkbox" data-bind="${esc(path)}" ${value ? "checked" : ""}> ${esc(label)}</label>`;
const area = (label: string, path: string, value: string) => `<label class="dpi-field dpi-wide"><span>${esc(label)}</span><textarea data-bind="${esc(path)}" aria-label="${esc(label)}" rows="3">${esc(value)}</textarea></label>`;
const select = (label: string, path: string, value: unknown, options: [string, string][], attrs = "") => `<label class="dpi-field"><span>${esc(label)}</span><select data-bind="${esc(path)}" aria-label="${esc(label)}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(value ?? "") === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
const button = (action: string, text: string, extra = "") => `<button type="button" data-dpi-action="${action}" ${extra}>${text}</button>`;
const traitOptions: [string, string][] = [["", "Choose…"], ...TRAITS.map(t => [t, t] as [string, string])];
const rangeOptions: [string, string][] = [["", "Choose…"], ["melee", "Melee"], ["veryClose", "Very Close"], ["close", "Close"], ["far", "Far"], ["veryFar", "Very Far"]];
const diceOptions: [string, string][] = [["", "Choose…"], ...[4, 6, 8, 10, 12, 20].map(d => [`d${d}`, `d${d}`] as [string, string])];
const trainingOptions: [string, string][] = [["", "Choose training…"], ["experience", "Intelligent (+1 experiences)"], ["hope", "Light in the Dark"], ["creatureComfort", "Creature Comfort"], ["armored", "Armored"], ["damage", "Vicious: damage"], ["range", "Vicious: range"], ["stress", "Resilient (+1 Stress)"], ["bonded", "Bonded"], ["evasion", "Aware (+2 evasion)"]];

export class ImportWizard extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "daggerheart-demiplane-importer", classes: ["dpi-window"],
    window: { title: "Import Demiplane PDF", icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 860, height: 760 }
  };
  character?: ParsedCharacter;
  candidates: Candidate[] = [];
  resolutions: Resolution[] = [];
  plan?: ResolvedImportPlan;
  report?: ImportReport;
  runtime: ImportRuntime = foundryRuntime();
  busy = "";
  error = "";
  tab = "character";
  stage: "upload" | "edit" | "review" | "done" = "upload";
  listeners?: AbortController;

  async _renderHTML(): Promise<string> {
    const c = this.character;
    const header = `<div class="dpi-header"><span class="dpi-eyebrow">DEMIPLANE → FOUNDRYBORNE</span><h2>${this.stage === "done" ? "Import complete" : c ? esc(c.name || "Review character") : "Bring your character to the table"}</h2><p>${c ? esc(c.source.fileName) : "Choose an original Demiplane PDF, review its details, then create a new character."}</p></div>`;
    if (this.busy) return `<div class="dpi-shell">${header}<div class="dpi-status" role="status"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(this.busy)}</div></div>`;
    const error = this.error ? `<div class="dpi-error" role="alert">${esc(this.error)}</div>` : "";
    let body = "", footer = "";
    if (this.stage === "upload") {
      body = `<div class="dpi-upload"><i class="fa-regular fa-file-pdf"></i><label for="dpi-file">Demiplane character PDF</label><input id="dpi-file" type="file" accept="application/pdf,.pdf"><p>The PDF is read on this device. Scanned and flattened sheets are not supported.</p></div>`;
      footer = button("read", "Read character", 'class="dpi-primary"');
    } else if (this.stage === "edit") {
      body = `<nav class="dpi-tabs" aria-label="Import review sections">${[["character", "Character"], ["content", "Content"], ["advanced", "Ancestry & companion"], ["notes", "Notes & warnings"]].map(([id, label]) => button("tab", label, `data-tab="${id}" aria-pressed="${this.tab === id}"`)).join("")}</nav><form class="dpi-form">${this.editBody()}</form>`;
      footer = button("restart", "Choose another PDF") + button("preview", "Review calculated stats", 'class="dpi-primary"');
    } else if (this.stage === "review") {
      body = this.reviewBody();
      footer = button("back", "Back to details") + (this.report?.status === "failed" ? button("report", "Download failure report") : "") + button("create", "Create character", `class="dpi-primary" ${this.plan?.issues.some(i => i.blocking) ? "disabled" : ""}`);
    } else {
      body = `<p class="dpi-success"><i class="fa-solid fa-circle-check"></i> ${esc(c!.name)} was created${this.report?.companionUuid ? " with a companion" : ""}.</p><p>The import report is saved on the character and can also be downloaded.</p>${this.issueList(this.report?.issues ?? [])}`;
      footer = button("report", "Download import report") + button("restart", "Import another PDF", 'class="dpi-primary"');
    }
    return `<div class="dpi-shell">${header}${error}<div class="dpi-body">${body}</div><footer class="dpi-footer">${footer}</footer></div>`;
  }
  _replaceHTML(result: string, content: HTMLElement): void { content.innerHTML = result; }
  _onRender(): void {
    this.listeners?.abort(); this.listeners = new AbortController();
    const signal = this.listeners.signal;
    this.element.querySelectorAll("[data-dpi-action]").forEach((element: HTMLElement) => element.addEventListener("click", () => { void this.act(element.dataset.dpiAction!, element); }, { signal }));
    this.element.querySelector("form")?.addEventListener("submit", (event: Event) => event.preventDefault(), { signal });
    // Re-render only controls which reveal a different editor, not ordinary typing.
    this.element.querySelectorAll('[data-bind="mixedAncestry.enabled"], [data-bind="companion.enabled"], [data-refresh], [data-source]').forEach((element: HTMLElement) => element.addEventListener("change", () => {
      this.capture(); this.error = ""; void this.render();
    }, { signal }));
  }
  _onClose(): void { this.listeners?.abort(); }

  editBody(): string {
    const c = this.character!;
    if (this.tab === "character") return `
      <section><h3>Identity</h3><div class="dpi-grid">${field("Character name", "name", c.name, "text", "required")}${number("Level", "level", c.level, 'min="1" max="10" required')}${field("Pronouns", "pronouns", c.pronouns)}${field("Heritage", "heritage", c.heritage)}</div></section>
      <section><h3>Traits</h3><div class="dpi-grid dpi-six">${TRAITS.map(t => `<div>${number(t[0].toUpperCase() + t.slice(1), `traits.${t}`, c.traits[t], "required")}${check("Marked this tier", `markedTraits.${t}`, c.markedTraits[t])}</div>`).join("")}</div></section>
      <section><h3>Exported statistics</h3><p class="dpi-hint">Blank means unknown. These values will be compared with Foundry’s calculations.</p><div class="dpi-grid">${Object.entries({ evasion: "Evasion", armor: "Armor score", major: "Major threshold", severe: "Severe threshold", hitPoints: "Maximum HP", stress: "Maximum Stress", proficiency: "Proficiency" }).map(([k, label]) => number(label, `stats.${k}`, c.stats[k], 'min="0"')).join("")}</div></section>
      <section><h3>Current resources</h3><div class="dpi-grid">${number("Marked HP", "resources.hitPoints", c.resources.hitPoints, 'min="0"')}${number("Marked Stress", "resources.stress", c.resources.stress, 'min="0"')}${number("Available Hope", "resources.hope", c.resources.hope, 'min="0"')}${number("Marked armor slots", "resources.armor", c.resources.armor, 'min="0"')}</div></section>
      <section><h3>Experiences</h3><p class="dpi-hint">These names come directly from the PDF. Remove any that are not part of your character; excluded entries remain identified in the import report.</p>${c.experiences.map((e, i) => `<div class="dpi-experience">${field(`Experience ${i + 1}`, `experiences.${i}.name`, e.name)}${number(`Bonus ${i + 1}`, `experiences.${i}.value`, e.value)}${button("remove-experience", "Remove", `data-index="${i}"`)}</div>`).join("")}${button("add-experience", "Add experience")}</section>
      <section><h3>Gold</h3><div class="dpi-grid">${number("Handfuls", "gold.handfuls", c.gold.handfuls, 'min="0"')}${number("Bags", "gold.bags", c.gold.bags, 'min="0"')}${number("Chests", "gold.chests", c.gold.chests, 'min="0"')}</div></section>`;
    if (this.tab === "content") return `<section><h3>Content and equipment</h3><p class="dpi-hint">Review the source for each item. “Editable PDF item” uses only the information below. Uncheck entries you do not want to import.</p>${c.entries.map((e, i) => this.entryEditor(e, i)).join("")}<div class="dpi-buttons">${button("rematch", "Refresh content matches")}${button("add-entry", "Add item")}${button("add-class", "Add multiclass")}${button("add-subclass", "Add subclass")}</div></section>`;
    if (this.tab === "advanced") return this.advancedBody();
    return `<section><h3>Biography</h3>${area("Background", "biography.background", c.biography.background)}${area("Connections", "biography.connections", c.biography.connections)}${area("Appearance and details", "biography.details", c.biography.details)}${area("Notes", "biography.notes", c.biography.notes)}</section><section><h3>Source warnings</h3>${this.issueList(c.issues)}<details><summary>Original populated form fields</summary><dl class="dpi-fields">${Object.entries(c.source.fields).filter(([, v]) => v !== null && v !== "" && v !== "/Off" && v !== "Off").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></details></section>`;
  }

  entryEditor(e: Entry, i: number): string {
    const resolution = this.resolutions.find(r => r.entry.id === e.id);
    const current = resolution?.selected;
    const options: [string, string][] = [["unresolved", "Choose a content source…"], ["pdf", "Editable PDF item"]];
    const kinds = e.inventoryText ? ["loot", "consumable", "weapon", "armor"] : [e.kind];
    const candidates = this.candidates.filter(c => kinds.includes(c.type));
    const exact = new Set(candidatesFor(e, candidates).map(c => c.uuid));
    options.push(...[...candidates].sort((a, b) => Number(exact.has(b.uuid)) - Number(exact.has(a.uuid)) || a.name.localeCompare(b.name)).map(c => [c.uuid, `${exact.has(c.uuid) ? "✓ " : ""}${c.name} — ${c.pack}`] as [string, string]));
    const p = `entries.${i}`;
    const sourceSelector = `<label class="dpi-field dpi-wide"><span>Source for ${esc(e.name)}</span><select data-source="${e.id}" aria-label="Source for ${esc(e.name)}">${options.map(([v, label]) => `<option value="${esc(v)}" ${(current === undefined ? "unresolved" : current ?? "pdf") === v ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`;
    let detail = "";
    if (e.kind === "class") detail = `${check("Multiclass", `${p}.isMulticlass`, !!e.isMulticlass)}${field(e.isMulticlass ? "Gained multiclass domain (one)" : "Domains for editable class (comma separated)", `${p}.domains`, e.domains?.join(", "), "text", 'data-list="true"')}`;
    if (e.kind === "subclass") detail = `${select("Parent class", `${p}.className`, e.className, [["", "Choose…"], ...this.character!.entries.filter(x => x.kind === "class" && x.include).map(x => [x.name, x.name] as [string, string])])}${select("Subclass advancement", `${p}.featureState`, e.featureState, [["1", "Foundation"], ["2", "Specialization"], ["3", "Mastery"]], 'data-number="true"')}${select("Spellcasting trait (leave blank to use matched source)", `${p}.spellcastingTrait`, e.spellcastingTrait, traitOptions)}`;
    if (e.kind === "domainCard") detail = `${field("Domain", `${p}.domain`, e.domain)}${select("Card type", `${p}.cardType`, e.cardType, [["ability", "Ability"], ["spell", "Spell"], ["grimoire", "Grimoire"]])}${number("Card level (required for editable cards)", `${p}.level`, e.level, 'min="1" max="10"')}${number("Recall Cost", `${p}.recallCost`, e.recallCost, 'min="0"')}${check("In vault", `${p}.inVault`, !!e.inVault)}${check("Preserve as descriptive feature", `${p}.asFeature`, !!e.asFeature)}`;
    if (["weapon", "armor"].includes(e.kind)) detail += check("Equipped", `${p}.equipped`, !!e.equipped);
    if (e.kind === "weapon") detail += `${check("Secondary weapon", `${p}.secondary`, !!e.secondary)}${select("Attack trait", `${p}.trait`, e.trait, traitOptions)}${select("Weapon range", `${p}.range`, e.range, rangeOptions)}${select("Damage die", `${p}.dice`, e.dice, diceOptions)}${number("Damage bonus", `${p}.damageBonus`, e.damageBonus ?? 0)}${select("Damage type", `${p}.damageType`, e.damageType, [["", "Choose…"], ["physical", "Physical"], ["magical", "Magical"]])}${select("Hands", `${p}.burden`, e.burden, [["", "Use matched source"], ["oneHanded", "One-handed"], ["twoHanded", "Two-handed"]])}`;
    if (e.kind === "armor") detail += `${number("Base armor score", `${p}.armorScore`, e.armorScore, 'min="0"')}${number("Base major threshold", `${p}.major`, e.major, 'min="0"')}${number("Base severe threshold", `${p}.severe`, e.severe, 'min="0"')}`;
    if (["loot", "consumable"].includes(e.kind)) detail += `${number("Quantity", `${p}.quantity`, e.quantity ?? 1, 'min="1"')}${check("Equip if matched as equipment", `${p}.equipped`, !!e.equipped)}`;
    const summary = current === undefined ? "Choose source" : current === null ? "Editable PDF item" : this.candidates.find(x => x.uuid === current)?.pack ?? "Selected source";
    return `<details class="dpi-entry" ${current === undefined ? "open" : ""}><summary><span>${esc(e.name || "New item")}</span><span class="dpi-chip">${esc(e.kind)}</span><span class="dpi-source">${esc(summary)}</span></summary><div class="dpi-grid">${check("Include this item", `${p}.include`, e.include)}${field("Item name", `${p}.name`, e.name)}${sourceSelector}${detail}${area("PDF text / editable rules", `${p}.description`, e.description)}</div></details>`;
  }

  advancedBody(): string {
    const c = this.character!, p = c.companion;
    const ancestries: [string, string][] = [["", "Choose ancestry…"], ...this.candidates.filter(a => a.type === "ancestry").map(a => [a.uuid, `${a.name} — ${a.pack}`] as [string, string])];
    return `<section><h3>Mixed ancestry</h3>${check("Use features from two ancestries", "mixedAncestry.enabled", c.mixedAncestry.enabled)}${c.mixedAncestry.enabled ? `<div class="dpi-grid">${field("Combined ancestry name", "mixedAncestry.name", c.mixedAncestry.name)}${select("Primary ancestry feature from", "mixedAncestry.primaryUuid", c.mixedAncestry.primaryUuid, ancestries)}${select("Secondary ancestry feature from", "mixedAncestry.secondaryUuid", c.mixedAncestry.secondaryUuid, ancestries)}</div>` : ""}</section>
      <section><h3>Companion</h3>${check("Create and link a companion", "companion.enabled", p.enabled)}${p.enabled ? `<p class="dpi-hint">Enter the companion’s current values. Record previous training so Foundry will offer only new choices on future level-ups.</p><div class="dpi-grid">${field("Companion name", "companion.name", p.name)}${number("Companion evasion", "companion.evasion", p.evasion, 'min="1"')}${number("Companion maximum Stress", "companion.stressMax", p.stressMax, 'min="1"')}${number("Companion marked Stress", "companion.stress", p.stress, 'min="0"')}${field("Companion attack name", "companion.attackName", p.attackName)}${select("Companion damage die", "companion.damageDice", p.damageDice, diceOptions)}${select("Companion range", "companion.range", p.range, rangeOptions)}${select("Companion damage type", "companion.damageType", p.damageType, [["physical", "Physical"], ["magical", "Magical"]])}</div><h4>Companion experiences</h4>${p.experiences.map((e, i) => `<div class="dpi-experience">${field(`Companion experience ${i + 1}`, `companion.experiences.${i}.name`, e.name)}${number(`Companion bonus ${i + 1}`, `companion.experiences.${i}.value`, e.value)}</div>`).join("")}${button("add-companion-experience", "Add companion experience")}<h4>Previous companion training</h4><div class="dpi-grid">${Array.from({ length: Math.max(0, (c.level ?? 1) - 1) }, (_, i) => {
        const t = p.training[i]; const value = t?.type === "vicious" ? t.data[0] : t?.type;
        return `<label class="dpi-field"><span>Training at level ${i + 2}</span><select data-training="${i}" aria-label="Training at level ${i + 2}">${trainingOptions.map(([v, l]) => `<option value="${v}" ${(value ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
      }).join("")}</div>${area("Companion notes", "companion.notes", p.notes)}` : ""}</section>`;
  }

  issueList(issues: { message: string; blocking?: boolean }[]): string {
    return issues.length ? `<ul class="dpi-issues">${issues.map(i => `<li class="${i.blocking ? "dpi-blocking" : ""}">${esc(i.message)}</li>`).join("")}</ul>` : "<p>No source warnings.</p>";
  }
  reviewBody(): string {
    const plan = this.plan!;
    return `<section><h3>Calculated statistics</h3><p>Choose how to resolve each difference. Keeping a PDF value adds an editable adjustment to this character.</p>${plan.comparisons.length ? `<table class="dpi-comparisons"><thead><tr><th>Statistic</th><th>PDF</th><th>Foundry</th><th>Use</th></tr></thead><tbody>${plan.comparisons.map((c, i) => `<tr><td>${esc(c.label)}</td><td>${c.pdf}</td><td>${c.calculated}</td><td><select data-comparison="${i}" aria-label="Resolve ${esc(c.label)}"><option value="">Choose…</option><option value="foundry" ${c.choice === "foundry" ? "selected" : ""}>Use Foundry calculation</option><option value="pdf" ${c.choice === "pdf" ? "selected" : ""}>Preserve PDF value</option></select></td></tr>`).join("")}</tbody></table>` : "<p>No calculated-stat differences.</p>"}</section>
      <section><h3>Import summary</h3><p>Create ${esc(plan.character.name)}, level ${plan.character.level ?? "?"}, with ${plan.itemSources.length} selected items${plan.companionData ? ` and companion ${esc(plan.companionData.name)}` : ""}. Linked features are included automatically.</p>${this.issueList(plan.issues)}</section>
      <label class="dpi-check dpi-ack"><input id="dpi-reviewed" type="checkbox"> I have reviewed the source warnings, missing rules, and stat choices.</label>`;
  }

  capture(): void {
    if (!this.character || this.stage !== "edit") return;
    this.element.querySelectorAll("[data-bind]").forEach((input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
      let value: any = input.value;
      if (input instanceof HTMLInputElement && input.type === "checkbox") value = input.checked;
      else if (input instanceof HTMLInputElement && input.type === "number" || input.dataset.number) value = finiteNumber(input.value);
      else if (input.dataset.list) value = input.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      setPath(this.character, input.dataset.bind!, value);
    });
    this.element.querySelectorAll("[data-source]").forEach((input: HTMLSelectElement) => {
      const entry = this.character!.entries.find(e => e.id === input.dataset.source)!;
      let resolution = this.resolutions.find(r => r.entry.id === entry.id);
      if (!resolution) { resolution = { entry, candidates: [], selected: undefined }; this.resolutions.push(resolution); }
      resolution.entry = entry;
      resolution.selected = input.value === "unresolved" ? undefined : input.value === "pdf" ? null : input.value;
      if (entry.asFeature) resolution.selected = null;
    });
    this.element.querySelectorAll("[data-training]").forEach((input: HTMLSelectElement) => {
      const value = input.value;
      this.character!.companion.training[Number(input.dataset.training)] = { type: ["damage", "range"].includes(value) ? "vicious" : value, data: ["damage", "range"].includes(value) ? [value] : [] };
    });
    for (const entry of this.character.entries.filter(e => e.kind === "subclass")) {
      entry.isMulticlass = !!this.character.entries.find(e => e.kind === "class" && e.name === entry.className)?.isMulticlass;
    }
  }

  async act(action: string, target: HTMLElement): Promise<void> {
    if (this.busy) return;
    try {
      this.error = "";
      if (action === "read") {
        const file = this.element.querySelector("#dpi-file")?.files?.[0];
        if (!file) throw new Error("Choose a Demiplane PDF first.");
        this.busy = "Reading PDF fields…"; await this.render();
        this.character = await readPdf(new Uint8Array(await file.arrayBuffer()), file.name);
        this.busy = "Matching your installed content…"; await this.render();
        const catalog = await loadCatalog();
        this.candidates = catalog.candidates;
        this.character.issues.push(...catalog.issues);
        this.resolutions = resolveEntries(this.character, this.candidates);
        this.stage = "edit"; this.tab = "character";
      } else if (action === "tab") { this.capture(); this.tab = target.dataset.tab!; }
      else if (action === "preview") {
        this.capture();
        this.resolutions = this.character!.entries.filter(e => e.include).map(entry => {
          const old = this.resolutions.find(r => r.entry.id === entry.id);
          return old ? { ...old, entry } : resolveEntries({ ...this.character!, entries: [entry] }, this.candidates)[0];
        });
        const missing = validateCharacter(this.character!);
        if (missing.length) throw new Error(missing.map(i => i.message).join(" "));
        this.busy = "Calculating character stats…"; await this.render();
        this.plan = await buildPlan(this.character!, this.resolutions, this.runtime);
        this.stage = "review";
      } else if (action === "create") {
        const p = this.plan!;
        this.element.querySelectorAll("[data-comparison]").forEach((input: HTMLSelectElement) => { p.comparisons[Number(input.dataset.comparison)].choice = input.value === "pdf" || input.value === "foundry" ? input.value : null; });
        if (!this.element.querySelector("#dpi-reviewed")?.checked) throw new Error("Acknowledge the review before creating the character.");
        if (p.comparisons.some(c => !c.choice)) throw new Error("Choose a value for every stat difference.");
        p.reviewed = true;
        this.busy = "Creating character and linked features…"; await this.render();
        const result = await executePlan(p, this.runtime);
        this.report = result.report; this.stage = "done";
        result.actor.sheet.render(true);
        if (result.companion) result.companion.sheet.render(true);
        console.info(`[${MODULE_ID}] Import complete`, result.report);
      } else if (action === "back") { this.stage = "edit"; }
      else if (action === "restart") { this.character = undefined; this.plan = undefined; this.report = undefined; this.resolutions = []; this.stage = "upload"; }
      else if (action === "rematch") { this.capture(); this.resolutions = resolveEntries(this.character!, this.candidates); }
      else if (action === "add-experience") { this.capture(); this.character!.experiences.push({ name: "", value: null }); }
      else if (action === "remove-experience") { this.capture(); this.character!.experiences.splice(Number(target.dataset.index), 1); }
      else if (action === "add-companion-experience") { this.capture(); this.character!.companion.experiences.push({ name: "", value: null }); }
      else if (["add-entry", "add-class", "add-subclass"].includes(action)) {
        this.capture();
        const kind = action === "add-class" ? "class" : action === "add-subclass" ? "subclass" : "loot";
        const entry: Entry = { id: this.runtime.id(), name: "", description: "", fields: [], kind, include: true, isMulticlass: kind === "class", domains: [], quantity: 1, featureState: 1, inventoryText: kind === "loot" };
        this.character!.entries.push(entry); this.resolutions.push({ entry, candidates: [], selected: undefined });
      } else if (action === "report") {
        const blob = new Blob([JSON.stringify(this.report, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `${this.character!.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}-import-report.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error: any) {
      this.error = error.message || String(error);
      if (error.importReport) { this.report = error.importReport; console.error(`[${MODULE_ID}] Import failed`, error.importReport); }
      console.error(`[${MODULE_ID}]`, error);
    } finally { this.busy = ""; await this.render(); }
  }
}
