import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseManifest } from "../scripts/release-manifest.mjs";

const base = { id: "test-module", version: "1.2.3", url: "https://github.com/example/test-module" };
test("release builds retain a stable update URL and version-specific ZIP", () => {
  const first = releaseManifest(base);
  const next = releaseManifest({ ...base, version: "1.2.4", download: first.download });
  assert.equal(first.manifest, next.manifest);
  assert.equal(next.download, "https://github.com/example/test-module/releases/download/v1.2.4/test-module-1.2.4.zip");
  assert.equal(releaseManifest(base, { repository: "another/fork" }).manifest, "https://github.com/another/fork/releases/latest/download/module.json");
});
test("release builds reject version mismatches and invalid destinations", () => {
  assert.throws(() => releaseManifest(base, { tag: "v1.2.2" }), /Release tag/);
  assert.throws(() => releaseManifest(base, { packageVersion: "1.2.4" }), /versions must match/);
  assert.throws(() => releaseManifest(base, { repository: "owner/repo/extra" }), /owner\/repository/);
});
