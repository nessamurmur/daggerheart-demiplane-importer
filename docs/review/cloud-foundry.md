# Live Foundry on a Cursor cloud agent

The verify skill (`.claude/skills/verify-foundry-importer`) drives a throwaway Foundry 14.370 world. On NJ's machine that world already exists. On a cloud agent, `scripts/foundry-verify-server.sh` prepares the same layout and is the only command that should start or stop the server.

`up` prints `RUN`, `URL`, and `EVIDENCE`. `EVIDENCE` is the directory `render-evidence.mjs` reads (pull request #13). `down` stops that server and keeps the directory. Do not paste `RUN` or `EVIDENCE` into a pull request; paste the `## Live evidence` block.

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

`render-evidence.mjs` is added by pull request #13. Until that file is on the branch you have checked out, `up` still writes `EVIDENCE/run.json` in the shape that script requires.

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

Add these as **Runtime Secrets**, not Build Secrets and not plain Environment Variables. Build Secrets are only present while the image builds. `up` runs later, in the agent, and reads the process environment. Runtime Secrets are injected there and redacted from transcripts.

Cursor dashboard → Cloud Agents → Secrets (My Secrets). Apply them to `nessamurmur/daggerheart-demiplane-importer`. Environment-scoped secrets apply only to that exact environment, and a config-as-code environment may not show a Secrets section. My Secrets for this repository is the place that reaches every environment.

| Name | Required | What it is |
| --- | --- | --- |
| `FOUNDRY_USERNAME` | yes, unless the 14.370 zip is already cached | foundryvtt.com username or email |
| `FOUNDRY_PASSWORD` | yes, unless the 14.370 zip is already cached | foundryvtt.com password |
| `FOUNDRY_LICENSE_KEY` | yes, until `Config/license.json` has a signature | the software licence key |

A licence key does not download Foundry. The account password does, through the same login form as foundryvtt.com (`/auth/login/`, then `GET /releases/download?build=370&platform=node`). A timed download URL expires in about five minutes, so it is not a standing secret. If the website asks for a second factor, login fails: download the Node.js zip for 14.370 from the Purchased Licenses page and place it at `~/foundry-verify/cache/foundryvtt-14.370.zip` (mode 600). `up` uses that file and does not log in.

Optional Runtime Secret `DEMIPLANE_SAMPLES_URL`: an `https` zip whose members include the four suite PDFs by those file names. Otherwise copy the PDFs into `~/Downloads`.

`up` exits before it downloads or starts Foundry if a required secret is missing, and the message names the variable. It does not print the value. Start a new agent after saving secrets. An agent that is already running does not see them.

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

1. Add the three Runtime Secrets above.
2. Point the environment at `.cursor/environment.json` and run a Build. The image installs Node 24.22.3, pnpm 11.19.0, Chrome, and the Foundryborne 2.10.2 zip. It does not install Foundry.
3. Put the four sample PDFs in `~/Downloads`. Take an environment snapshot after that if later agents should have the PDFs without `DEMIPLANE_SAMPLES_URL`. A snapshot is optional for Foundry itself: the first `up` on a disk downloads 14.370 into `~/foundry-verify` and later ups reuse it.

Foundry 14.370 and Foundryborne 2.10.2 match the verify skill. The module's `compatibility.verified` stays 14.367 until a live run on this build is the reason to change it.
