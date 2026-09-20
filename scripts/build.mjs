import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { releaseManifest } from "./release-manifest.mjs";

const sourceManifest = JSON.parse(await fs.readFile("module.json", "utf8"));
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const manifest = releaseManifest(sourceManifest, { repository: process.env.RELEASE_REPOSITORY, tag: process.env.RELEASE_TAG, packageVersion: pkg.version });
const manifestJSON = JSON.stringify(manifest, null, 2) + "\n";
const directory = path.resolve("dist", manifest.id);
await fs.rm(directory, { recursive: true, force: true });
await fs.mkdir(path.join(directory, "scripts"), { recursive: true });
await fs.mkdir(path.join(directory, "vendor"), { recursive: true });
await build({ entryPoints: ["src/module.ts"], bundle: true, format: "esm", platform: "browser", target: "es2022", outfile: path.join(directory, "scripts/module.js"), sourcemap: true });
await fs.writeFile(path.join(directory, "module.json"), manifestJSON);
for (const file of ["README.md", "VALIDATION.md", "LICENSE"]) await fs.copyFile(file, path.join(directory, file));
await fs.cp("styles", path.join(directory, "styles"), { recursive: true });
for (const file of ["pdf.mjs", "pdf.worker.mjs"]) await fs.copyFile(`node_modules/pdfjs-dist/build/${file}`, path.join(directory, "vendor", file));
await fs.copyFile("node_modules/pdfjs-dist/LICENSE", path.join(directory, "vendor/PDFJS-LICENSE"));
await fs.writeFile(path.join(directory, "THIRD_PARTY_NOTICES.txt"), "PDF.js / pdfjs-dist\nCopyright Mozilla Foundation\nLicensed under the Apache License, Version 2.0. See vendor/PDFJS-LICENSE.\nhttps://github.com/mozilla/pdf.js\n\nThis module bundles no Daggerheart game content or sample character PDFs.\n");
const zip = new JSZip();
async function addDirectory(dir, prefix = manifest.id) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name), dest = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await addDirectory(full, dest);
    else zip.file(dest, await fs.readFile(full));
  }
}
await addDirectory(directory);
await fs.mkdir("artifacts", { recursive: true });
await fs.writeFile("artifacts/module.json", manifestJSON);
const output = `artifacts/${manifest.id}-${manifest.version}.zip`;
await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
console.log(`Built ${output}`);
console.log(`Manifest URL (after publishing): ${manifest.manifest}`);
