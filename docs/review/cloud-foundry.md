# Live Foundry on a Cursor cloud agent

The verify skill (`.claude/skills/verify-foundry-importer`) drives a throwaway Foundry 14.370 world. On NJ's machine that world already exists. On a cloud agent, `scripts/foundry-verify-server.sh` prepares the same layout and is the only command that should start or stop the server.

Run this for a release-candidate pull request, the one that bumps the version in `module.json` and `package.json`. Other pull requests do not require it (`docs/review/evidence-contract.md`).

`up` prints `RUN`, `URL`, and `EVIDENCE`. `EVIDENCE` is the directory `.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs` reads. `down` stops that server and keeps the directory. Do not paste `RUN` or `EVIDENCE` into a pull request; paste the `## Live evidence` block.

## What the agent runs

```sh
scripts/foundry-verify-server.sh up
# RUN=...  URL=http://localhost:<port>  EVIDENCE=...  SAMPLES=ok|SAMPLES_MISSING=...
S=.claude/skills/verify-foundry-importer/scripts
node $S/suite.mjs --url "$URL" --evidence "$EVIDENCE"
# Write one sentence into $EVIDENCE/<journey-id>/observation.txt for each journey.
node $S/render-evidence.mjs --evidence "$EVIDENCE" --check
node $S/render-evidence.mjs --evidence "$EVIDENCE"
scripts/foundry-verify-server.sh down
```

`render-evidence.mjs` is `.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs`, on `main`. `up` writes `EVIDENCE/run.json` in the shape that script requires.

Proven journeys: `open-importer`, `druid`, `ex_ampleton`, `luph`, `luph-levelup-manual`, `raelyn`. Import journeys need `druid.pdf`, `ex_ampleton.pdf`, `luph.pdf`, and `raelyn.pdf` in `~/Downloads`. `luph-levelup-manual` uses `luph.pdf`.

## Evidence directory

`EVIDENCE` is `~/foundry-verify/evidence/<run-id>/` (no dot-directory in the path). `up` writes `run.json`:

| Field | Example |
| --- | --- |
| `runId` | `20261123-120000-12345` |
| `foundry` | `14.370` |
| `foundryborne` | `2.10.2` |
| `moduleVersion` | from `module.json` |
| `headSha` | full git SHA |

No field is a path. The suite then writes `<journey-id>/result.json`, `<journey-id>/<slug>.png`, and the agent writes `<journey-id>/observation.txt`. `down` copies `server.log` into the same directory and deletes only the run data.

Foundry is **14.370**. `module.json` `compatibility.verified` is **14.367**. Say that in the live-evidence block when the build differs.

## Secrets

The only Foundry secret is `FOUNDRY_LICENSE_KEY`. It signs the server. It does not download Foundry. There is no foundryvtt.com username or password.

Add it as a **Runtime Secret**, not a Build Secret. Build Secrets are only present while the image builds. `up` runs later, in the agent. Runtime Secrets are injected there and redacted from transcripts.

Cursor dashboard → Cloud Agents → Secrets (My Secrets). Apply it to `nessamurmur/daggerheart-demiplane-importer`. `FOUNDRY_LICENSE_KEY` is already set.

Optional Runtime Secret `DEMIPLANE_SAMPLES_URL`: an `https` zip whose members include the four suite PDFs by those file names. Otherwise copy the PDFs into `~/Downloads`.

`up` exits before it starts Foundry if the cache archive or `FOUNDRY_LICENSE_KEY` is missing, and the message names which one. It does not print the key.

## Foundry archive

The Node.js build only, not the Linux/Electron build. The file the maintainer downloads is `FoundryVTT-Node-14.370.zip` (150,182,237 bytes, sha256 `e891a46b2878745b38dd8c28e843d763f83e69aa14bdbd3156edd8dafaabe846`). `main.js` is at the archive root. `up` installs that tree at `~/foundry-verify/app-14.370/resources/app/` and starts it with system Node.

A timed release URL lasts about five minutes and is not a standing secret. An agent with a fresh URL runs:

```sh
scripts/foundry-cache-fetch.sh '<timed-url>'
```

That writes `~/foundry-verify/cache/FoundryVTT-Node-14.370.zip`, checks the sha256, and does not print the URL's query string. The maintainer then saves an environment snapshot so later agents already have the archive. `up` fails if that file is missing or the hash does not match.

## One licence, one server

Foundry allows one active server for a licence. A second host (NJ's computer, or another cloud agent) can fail the signature or kick the first server off.

- Do not run `up` while any other Foundry is using this licence.
- In this VM, `up` and `down` take a lock, and a second `up` prints the server that is already active instead of starting another.
- `down` also stops a licence-signing server left behind when `up` is killed. `up` stops that stale server before it starts another. The signing server is detached so it can finish if `up` is interrupted; it is still this script's process, recorded for `down`.
- If the log shows the licence in use or a failed signature, `up` stops and tells you to free the other session.

`up` is safe to rerun. `down` is safe when nothing is running. Foundry is not started from `.cursor/environment.json` `start`, because that would hold the licence for every agent, including doc-only ones.

The signed licence is bound to the machine. A snapshot from another hostname will not stay signed. `up` signs again when `license.json` has no `signature`.

## One-time steps for the maintainer

This agent's environment is dashboard-managed: it does not read `.cursor/environment.json` until that file is selected as the environment's configuration. After this change is on the branch the environment builds:

1. `FOUNDRY_LICENSE_KEY` is the only Foundry secret. It is already a Runtime Secret. Do not add a foundryvtt.com username or password.
2. Point the environment at `.cursor/environment.json` and run a Build. The image installs Node 24.22.3, pnpm 11.19.0, Chrome, and the Foundryborne 2.10.2 zip. It does not install Foundry.
3. On the Purchased Licenses page, choose Node.js 14.370 and copy the timed URL (about five minutes). In an agent on this environment, run `scripts/foundry-cache-fetch.sh '<timed-url>'`. It stores `FoundryVTT-Node-14.370.zip` in the verify cache and checks the sha256. Save an environment snapshot after that so later agents start with the archive cached.
4. Put the four sample PDFs in `~/Downloads`. Include them in the same snapshot if later agents should have them without `DEMIPLANE_SAMPLES_URL`.

Foundry 14.370 and Foundryborne 2.10.2 match the verify skill. The module's `compatibility.verified` stays 14.367 until a live run on this build is the reason to change it.
