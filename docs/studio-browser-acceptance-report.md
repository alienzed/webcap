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
| 2 — Create multiple Scenes | `scenes.spec.cjs` — count/persistence and incomplete sibling | **Unverified on latest revision**; first CI attempt failed on the test fixture's assumption there was only one Project, since the suite shares isolated data; fixture corrected. No Scene acceptance pass claimed yet |
| 3 — Revise Overview and Scenes | `revisions.spec.cjs` — Project save and partial batch | **Unverified**; multiple batch outcomes, cancellation, unsupported durations and context preservation need separate observed results |
| 4 — Conversation and explicit Read | `director-read.spec.cjs` and `explicit-read.spec.cjs` | **Plain-text conversation passing checkpoint** on run 43773272703; **explicit Read not verified**, with a real-browser assertion intentionally requiring visible selection-and-sharing UI. The legacy `studio-dw-read` control is currently hidden in source; automatic context attachment does not count as a pass |
| 5 — Change Project context | `context-switch.spec.cjs` | **Unverified**; real A/B navigation, bound destination and save verification written |
| 6 — Two proposals same Project | `scenes.spec.cjs` — ownership | **Unverified**; review switching and preservation of an edited unsaved draft asserted through real reply controls |
| 7 — Recovery and failures | `recovery.spec.cjs` | **Unverified**; in-session navigation, saved draft, retry/no duplicate and external inference failure checks written. Concurrent update conflict, cancellation and post-save refresh/receipt failure not yet exercised |
| 8 — Studio Blocks | `blocks.spec.cjs` | **Passing UI/persistence checkpoint** on [43772879212](https://github.com/alienzed/webcap/actions/runs/43772879212): create, reopen and slash-insert; later change added real Send + exact external inference request check, **not yet verified on latest revision** |
| 9 — Optional specialist tools | `specialist.spec.cjs` | **Unverified** utility discovery, Coherence preset and no accidental Take-generation while cancelled. Actual Coherence execution and Revise & Generate effects **not automated**, so the optional full flow is not complete |

**Completion policy:** No numbered flow is marked fully complete until every required action, persistence check, relevant variations and failure behavior have passed in the final CI run. Prior passing checkpoints above remain evidence only for the specific behavior they exercised. Failed tests remain failing regressions; never rewrite the acceptance contract to match broken UI.

## Known unautomated steps / investigation needs

- **Explicit Read:** user-selected Project, Scene and field sharing, inspect exactly what was shared, and refreshed selected context must be proven in browser. The visible Project-access `Inspect fields` is not a substitute for the documented user-selected **Share context** flow. The historical `studio-dw-read` selector is hidden; decide whether current UI can fulfill this contract before any product UI change.
- **Save succeeds but receipt or refresh fails:** requires a controlled *real* post-save transport/storage fault, not mocked success responses. This scenario is not implemented yet and must not count as passing.
- **Cancellation and concurrent edit conflicts:** additional real operations are required, including confirmed saved/failed/not-attempted counts and saved-value freshness.
- **Complete specialist flow:** Coherence model response, review, actual effects, and Revise & Generate need a separate deterministic browser exercise; Take generation requires a configured inference worker and should remain disabled in the default no-GPU suite.
- **Visual UX and hierarchy:** reading order, discoverability, dialogs/pinning, keyboard navigation, narrow viewport, and creative-quality judgments still warrant human inspection. Browser checks cannot certify design quality.
- **Live model behavior:** the opt-in smoke is authored but not run. Controlled replies prove WebCap's behavior for returned data, not that a particular deployed model can reliably author the data.

## Evidence boundaries

CI launches actual Chromium against actual isolated WebCap. Failures in the suite are treated as evidence requiring investigation, not as permission to modify production code. No production Studio behavior or UI was changed by this browser-test branch.
