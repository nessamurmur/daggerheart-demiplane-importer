/** Gated manifest properties. A violation fails `pnpm verify`. Findings are recorded separately and do not. */

export interface ManifestTexts {
  moduleJson: {
    id?: string;
    version?: string;
    url?: string;
    manifest?: string;
    download?: string;
    compatibility?: { minimum?: string; verified?: string; maximum?: string };
    relationships?: { systems?: { id?: string; type?: string; compatibility?: { minimum?: string; verified?: string } }[] };
    esmodules?: string[];
    styles?: string[];
    license?: string;
    readme?: string;
  };
  packageJson: { name?: string; version?: string };
  fileExists(path: string): boolean;
}

const compareVersions = (a: string, b: string): number => {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
};

/** Properties the published manifest is required to satisfy. Each string is one broken promise. */
export function manifestViolations(input: ManifestTexts): string[] {
  const manifest = input.moduleJson;
  const violations: string[] = [];
  if (!manifest.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) violations.push(`id ${JSON.stringify(manifest.id)} is not lower-case hyphenated`);
  if (input.packageJson.name !== manifest.id) violations.push(`package.json name ${JSON.stringify(input.packageJson.name)} differs from module id ${JSON.stringify(manifest.id)}`);
  if (!manifest.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) violations.push(`version ${JSON.stringify(manifest.version)} is not MAJOR.MINOR.PATCH`);
  if (input.packageJson.version !== manifest.version) violations.push(`package.json version ${JSON.stringify(input.packageJson.version)} differs from module.json ${JSON.stringify(manifest.version)}`);

  const remote = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(manifest.url ?? "");
  if (!remote) violations.push(`url ${JSON.stringify(manifest.url)} is not https://github.com/owner/repo`);
  else {
    const base = `https://github.com/${remote[1]}/${remote[2]}`;
    const expectedManifest = `${base}/releases/latest/download/module.json`;
    const expectedDownload = `${base}/releases/download/v${manifest.version}/${manifest.id}-${manifest.version}.zip`;
    if (manifest.manifest !== expectedManifest) violations.push(`manifest ${JSON.stringify(manifest.manifest)} is not ${expectedManifest}`);
    if (manifest.download !== expectedDownload) violations.push(`download ${JSON.stringify(manifest.download)} is not ${expectedDownload}`);
  }

  const compatibility = manifest.compatibility ?? {};
  if (!compatibility.minimum) violations.push("compatibility.minimum is missing");
  if (!compatibility.verified) violations.push("compatibility.verified is missing");
  if (compatibility.minimum && compatibility.verified && compareVersions(compatibility.minimum, compatibility.verified) > 0) {
    violations.push(`compatibility.minimum ${compatibility.minimum} is newer than verified ${compatibility.verified}`);
  }

  const daggerheart = (manifest.relationships?.systems ?? []).find(system => system.id === "daggerheart");
  if (!daggerheart || daggerheart.type !== "system") violations.push("relationships.systems does not name daggerheart with type system");
  else if (daggerheart.compatibility?.minimum && daggerheart.compatibility.verified && compareVersions(daggerheart.compatibility.minimum, daggerheart.compatibility.verified) > 0) {
    violations.push("daggerheart compatibility.minimum is newer than verified");
  }

  for (const file of manifest.styles ?? []) if (!input.fileExists(file)) violations.push(`styles entry is missing on disk: ${file}`);
  for (const file of manifest.esmodules ?? []) {
    const source = file.replace(/^scripts\//, "src/").replace(/\.js$/, ".ts");
    if (!input.fileExists(file) && !input.fileExists(source)) violations.push(`esmodules entry has neither ${file} nor ${source}`);
  }
  if (manifest.license && !/^https?:/.test(manifest.license) && !input.fileExists(manifest.license)) violations.push(`license path is missing: ${manifest.license}`);
  if (manifest.readme && !/^https?:/.test(manifest.readme) && !input.fileExists(manifest.readme)) violations.push(`readme path is missing: ${manifest.readme}`);
  return violations;
}

/**
 * Promises the manifest does not currently keep.
 * Foundry hard-enforces compatibility.maximum and refuses to install above it.
 * The readiness lint records the same fact as INFO compat-maximum and asks whether it is intentional.
 */
export function manifestFindings(moduleJson: ManifestTexts["moduleJson"]): string[] {
  const maximum = moduleJson.compatibility?.maximum;
  if (!maximum) return [];
  return [`compatibility.maximum is ${JSON.stringify(maximum)}. Foundry hard-enforces maximum and blocks install above it. The property "compatibility.maximum is absent" does not hold.`];
}
