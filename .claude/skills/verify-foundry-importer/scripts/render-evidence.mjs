#!/usr/bin/env node
// node render-evidence.mjs --evidence <EVIDENCE> [--repo owner/name] [--sha <head>] [--check]
// Uploads each key png to the repo's GitHub user-attachments store and prints the PR block.
// --check uploads nothing. The gh token stays inside gh.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertPngBytes, parseGitHubRepo, prepareEvidence, realInside, renderEvidenceBlock } from "./evidence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

function gh(run, args) {
  const result = run("gh", args, { encoding: "utf8" });
  if (!result || result.status !== 0) {
    const detail = `${result?.stderr ?? ""}`.trim().slice(0, 300);
    throw new Error(detail ? `gh api failed: ${detail}` : `gh api failed (${result?.status ?? "no result"})`);
  }
  return result.stdout;
}

/** Upload png screenshots. `items` are { file, uploadName } from prepareEvidence. Returns uploadName -> URL. */
export function uploadPngs(items, { repo, run = spawnSync }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("repo must be owner/name");
  for (const item of items) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(item.uploadName)) throw new Error(`bad upload name ${item.uploadName}`);
    assertPngBytes(item.file);
  }
  const id = gh(run, ["api", `repos/${repo}`, "--jq", ".id"]).trim();
  if (!/^\d+$/.test(id)) throw new Error("repository id was not a number");
  const urls = {};
  for (const item of items) {
    const endpoint = `https://uploads.github.com/user-attachments/assets?repository_id=${id}&name=${encodeURIComponent(item.uploadName)}&content_type=image%2Fpng`;
    const stdout = gh(run, [
      "api", "--method", "POST",
      "-H", "Accept: application/json",
      "-H", "Content-Type: image/png",
      "--input", item.file,
      endpoint,
    ]);
    let body;
    try {
      body = JSON.parse(stdout);
    } catch {
      throw new Error(`upload for ${item.uploadName} did not return JSON`);
    }
    const url = body.url || body.href;
    if (typeof url !== "string" || !url.startsWith("https://github.com/user-attachments/assets/")) {
      throw new Error(`upload for ${item.uploadName} did not return a user-attachments URL`);
    }
    urls[item.uploadName] = url;
  }
  return urls;
}

export async function renderFromDir(evidenceDir, { headSha, upload }) {
  const { errors, model } = prepareEvidence(evidenceDir, { headSha });
  if (errors.length || !model) {
    const error = new Error(errors.join("\n") || "evidence is incomplete");
    error.errors = errors;
    throw error;
  }
  const root = path.resolve(evidenceDir);
  const items = [];
  for (const journey of model.journeys) {
    for (const shot of journey.shots) {
      const file = realInside(root, shot.file);
      assertPngBytes(file);
      items.push({ ...shot, file });
    }
  }
  const urls = await upload(items);
  return renderEvidenceBlock(model, urls);
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || `git ${args.join(" ")} failed`).trim());
  return result.stdout.trim();
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  const { values } = parseArgs({
    options: {
      evidence: { type: "string" },
      repo: { type: "string" },
      sha: { type: "string" },
      check: { type: "boolean", default: false },
    },
  });
  if (!values.evidence) {
    fail("need --evidence <dir> [--repo owner/name] [--sha <head>] [--check]");
    return;
  }
  const headSha = values.sha ?? git(["-C", repoRoot, "rev-parse", "HEAD"]);
  const prepared = prepareEvidence(values.evidence, { headSha });
  if (prepared.errors.length || !prepared.model) {
    fail(prepared.errors.join("\n"));
    return;
  }
  if (values.check) {
    const count = prepared.model.journeys.reduce((sum, journey) => sum + journey.shots.length, 0);
    console.log(`ready: ${prepared.model.journeys.length} journey(s), ${count} screenshot(s), head ${headSha}`);
    for (const journey of prepared.model.journeys) {
      console.log(`${journey.pass ? "PASS" : "FAIL"}  ${journey.id}`);
      for (const shot of journey.shots) console.log(`  ${shot.uploadName}`);
    }
    return;
  }
  let repo = values.repo;
  try {
    if (!repo) repo = parseGitHubRepo(git(["-C", repoRoot, "remote", "get-url", "origin"]));
    const markdown = await renderFromDir(values.evidence, {
      headSha,
      upload: items => uploadPngs(items, { repo }),
    });
    const out = path.join(path.resolve(values.evidence), "evidence-block.md");
    fs.writeFileSync(out, markdown);
    process.stdout.write(markdown);
    console.error(`wrote ${out}`);
  } catch (error) {
    fail(`${error.message}\nThe evidence file was not written. Uploading needs gh with write access to ${repo ?? "the origin repo"}.`);
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main().catch(error => fail(error.message));
