# Studio Director browser acceptance — execution and coverage report

**Contract:** [studio-user-flows.md](studio-user-flows.md). This document reports implementation and evidence, not a replacement contract. Each status is based on observed Chromium/Flask behavior, not source inspection, mocked DOM, promises from an LLM, or a passing code-only test.

## Repeatable commands

Run from the repository root with Python 3, Node 22 and Playwright Chromium installed:

```sh
python -m pip install Flask Pillow imageio websocket-client opencv-python-headless Send2Trash pytest
npm install --no-save @playwright/test
npx playwright install chromium
npx playwright test --config=playwright.config.cjs
```

**One-command repeat after installation:** `npx playwright test --config=playwright.config.cjs`

The Playwright webServer starts the **real Flask app and frontend** from a disposable copied install under the OS temporary directory, with an isolated `tool/config.json`, Project root, output and app-data root. It refuses port 4200 if a WebCap server is already running. All accepted requests use real WebCap routes and DOM controls. Only OpenAI-compatible inference is deterministic, using a separate local HTTP endpoint at port 4211; the endpoint records every inference request and returns queued responses. It never mocks internal WebCap routes or saves. No GPU or user projects are needed.

The run is serial: a single isolated backend is shared across tests; fixtures use unique identities and compare saved records by ID rather than assuming the server is empty. Temporary data is deleted on exit. Test failures retain **screenshots, Playwright traces, captured browser page/console/request errors, HTML report**, and `test-results/studio-backend.log`. CI uploads these as `studio-browser-evidence`.

**Optional live remote model smoke (never automatic):**

```sh
WEBCAP_TEST_REMOTE_ENDPOINT=http://your-compatible-model-host/v1 \
WEBCAP_TEST_REMOTE_MODEL=your-model-id \
npx playwright test --config=playwright.live.config.cjs
```

The smoke test uses a separate isolated app and **actual remote model**. It verifies only that the browser can obtain and show a brief response, not model quality, scene adherence or complete acceptance. Live smoke is not part of CI and is not claimed run.

## Coverage mapped to the flow contract

| Flow | Browser test | Evidence / state |
| --- | --- | --- |
| 1 — New Project and Overview | `project.spec.cjs` | **Passing checkpoint** on run [43773272703](https://github.com/alienzed/webcap/actions/runs/43773272703): visible Review, edited Overview and Invariant persisted, reload, one inference call; open-another-Project variant remains unverified |
| 2 — Create multiple Scenes | `scenes.spec.cjs` — count/persistence and incomplete sibling | **Unverified on latest revision**; first CI attempt failed on a shared-fixture count assumption, corrected without weakening Scene assertions. No Scene acceptance pass claimed yet |
| 3 — Revise Overview and Scenes | `revisions.spec.cjs` — Project save and partial batch | **Unverified**; multiple batch outcomes, cancellation, unsupported durations and context preservation need separate observed results |
| 4 — Conversation and explicit Read | `director-read.spec.cjs` and `explicit-read.spec.cjs` | **Plain-text conversation passing checkpoint** on run 43773272703; current visible Project-access **explicit Read** is now tested by selecting Project fields and a Scene prompt, inspecting the actual transmitted content and refreshing after a real saved change. **Latest explicit Read test remains unverified** |
| 5 — Change Project context | `context-switch.spec.cjs` | **Unverified**; real A/B navigation, bound destination and save verification written |
| 6 — Two proposals same Project | `scenes.spec.cjs` — ownership | **Unverified**; review switching and preservation of an edited unsaved draft asserted through real reply controls |
| 7 — Recovery and failures | `recovery.spec.cjs` | **Unverified**; in-session navigation, saved draft, retry/no duplicate and external inference failure checks written. Concurrent update conflict and cancellation remain unexercised; `post-save-receipt.spec.cjs` adds a real isolated-filesystem permission fault after Scene save, but awaits a browser result |
| 8 — Studio Blocks | `blocks.spec.cjs` | **Passing UI/persistence checkpoint** on [43772879212](https://github.com/alienzed/webcap/actions/runs/43772879212): create, reopen and slash-insert; later change added real Send + exact external inference request check, **not yet verified on latest revision** |
| 9 — Optional specialist tools | `specialist.spec.cjs` | **Unverified** utility discovery, Coherence preset and no accidental Take-generation while cancelled. Actual Coherence execution and Revise & Generate effects **not automated**, so the optional full flow is not complete |

**Completion policy:** No numbered flow is marked fully complete until every required action, persistence check, relevant variations and failure behavior have passed in the final CI run. Prior passing checkpoints above remain evidence only for the specific behavior they exercised. Failed tests remain failing regressions; never rewrite the acceptance contract to match broken UI.

## Known unautomated steps / investigation needs

- **Explicit Read:** current supported UI is **Project access → field group / Scene → Inspect fields**; this actually sends the selected saved content to the model and exposes the payload, unlike the retired hidden `studio-dw-read` panel. The new test covers this workflow and refreshed saved context. Its full browser result is pending; discoverability and whether automatic sending from a button labelled **Inspect fields** are good UX remain separate decisions.
- **Save succeeds but receipt or refresh fails:** `post-save-receipt.spec.cjs` now creates a real POSIX permission failure in the isolated conversation directory after the authored Scene is ready, and asserts the Scene persists while the application reports the receipt error. **Not yet CI-verified**. It does not run on Windows without an equivalent real fault mechanism.
- **Cancellation and concurrent edit conflicts:** additional real operations are required, including confirmed saved/failed/not-attempted counts and saved-value freshness.
- **Complete specialist flow:** Coherence model response, review, actual effects, and Revise & Generate need a separate deterministic browser exercise; Take generation requires a configured inference worker and should remain disabled in the default no-GPU suite.
- **Visual UX and hierarchy:** reading order, discoverability, dialogs/pinning, keyboard navigation, narrow viewport, and creative-quality judgments still warrant human inspection. Browser checks cannot certify design quality.
- **Live model behavior:** the opt-in smoke is authored but not run. Controlled replies prove WebCap's behavior for returned data, not that a particular deployed model can reliably author the data.

## Evidence boundaries

CI launches actual Chromium against actual isolated WebCap. Failures in the suite are treated as evidence requiring investigation, not as permission to modify production code. No production Studio behavior or UI was changed by this browser-test branch.

**Latest branch CI:** [GitHub Actions Studio browser acceptance](https://github.com/alienzed/webcap/actions/workflows/studio-browser-acceptance.yml) remains the authoritative check for this draft PR; a run in progress is not reported as a pass. The latest targeted checks before expansion were **3 passed, 2 failed on fixture setup** (run 43773272703), after which the fixture was corrected. Later expanded runs have not yet been accepted as complete.

## CI rerun log (2026-11-15)

- [Run 43773671802](https://github.com/alienzed/webcap/actions/runs/43773671802) executed **13 real-browser checkpoints**: **3 passed / 10 failed**. The passing checkpoints were Studio Blocks including actual Send, plain-text Director Read, and reviewed Project save/reload. Failures occurred before the intended assertions: most tests unconditionally clicked **Use open Project** even when Director was already attached and the button was intentionally hidden; the specialist setup lacked selected-Scene focus; and the explicit Read test incorrectly targeted a retired hidden panel. These are harness mistakes, **not proven product defects**.
- Corrections now use the current Project-access explicit Read UI, conditionally attach only when offered (verifying the displayed Project label), and focus the Scene before invoking specialist controls; all acceptance expectations of real returned/persisted values remain intact. **Rerun on the corrected head is pending; do not transfer earlier passes to whole-flow completion.**
- An unrelated browser console error `ReferenceError: workspaceState is not defined` in `group_workbench.js` appeared in traces; product code was deliberately left unchanged. It merits separate investigation rather than hiding the diagnostic in the tests.

## Local real-model acceptance (opt-in)

The same real browser/Flask/isolation harness now supports **your actual configured Director**, not the controlled-response endpoint. Run from the repository root:

```sh
npm install --no-save @playwright/test
npx playwright install chromium
npx playwright test --config=playwright.live.config.cjs
```

The **last line is the repeatable command**. It reads `tool/config.json` from this checkout, uses the configured `director_model` and `storyboard.director` settings (including local llama.cpp model discovery or enabled remote endpoints), and runs actual inference; **no endpoint or model ID has to be provided manually**. To use a different config, set `WEBCAP_TEST_CONFIG` to its full path; `WEBCAP_TEST_DIRECTOR_MODEL` can optionally select a specific discovered model ID. The test fails visibly if the configured model is missing.

This mode runs in its **own disposable working copy of WebCap**. It reads, but does not modify, the original config or model files. It copies only inference-related config values, and forcibly assigns temporary roots for Sets/Projects, output, and application data. The cloned backend uses port 4200, so stop any other instance on that port before starting; it will refuse to bind over it. The remote/local inference runtime may use your GPU, which is the intention of this explicit opt-in run.

**Live suite assertions and limits (not claims of passing):**

| Flow | Actual-model browser test | Evidence being checked |
| --- | --- | --- |
| 1 | `tests/live/studio-authoring.spec.cjs` | Model-authored Project reaches editable review; user edit and actual save survive reload |
| 2 | `tests/live/studio-authoring.spec.cjs` | Authored Scene records reach review; accepts actual returned count; edited prompts are saved/reloaded |
| 3 | `tests/live/studio-authoring.spec.cjs` | Model-suggested Overview revision reviewed/saved; unrelated Scene preserved; batch revision is still controlled-suite only |
| 4 | `tests/live/studio-authoring.spec.cjs`, `director-live.spec.cjs` | Explicit Project and selected Scene Read to real Director, visible material, response and no unintended saves |
| 5 | `tests/live/studio-continuity.spec.cjs` | Attached Project A while editor shows B, followed by reviewed save and destination check |
| 6 | `tests/live/studio-continuity.spec.cjs` | Two real authored replies, separate unsaved review drafts, first one recoverable |
| 7 | `tests/live/studio-continuity.spec.cjs` | Real Scene draft edited, navigation away/back, save and reload |
| 8 | `tests/live/studio-continuity.spec.cjs` | Studio Block slash insertion and actual sent text with real model response |
| 9 (optional) | `tests/live/studio-specialist.spec.cjs` | Real Coherence analysis is displayed in a review dialog; discarding does not save changes or queue Takes |

The live assertions target **actual returned data, selected destination, editable material, save and persistence**, not exact generated wording, the requested number of Scene records, or a subjective creativity score. Missing usable material, wrong destination, incomplete persistence or nonactionable responses are **real failing checks**. Do not substitute a controlled-response pass for model capability. We do not automatically repair, regenerate or retry model responses.

**Not yet proven:** These new live tests have been authored and syntax-checked, but have **not been executed against your configured models** in this workspace, which does not have your local `tool/config.json`, model files or GPU endpoint. Running `npx playwright test --config=playwright.live.config.cjs` on your Windows checkout is required for runtime evidence; their existence is not passing coverage. The separate repeatable no-GPU CI suite remains `npx playwright test --config=playwright.config.cjs`. Some documented variations, full batch revision, failure injection, and Take-generating specialist execution are only partially covered; visual hierarchy still needs human judgment. Record and investigate any failures rather than changing the user-flow contract.
