# Studio Director — real-model Playwright acceptance

This suite runs Chromium, WebCap's actual backend and the configured Director model; it does not queue synthetic inference replies.

Run all real-model journeys from the repository root:
```bash
npx playwright test --config=playwright.live.config.cjs --headed
```

Run the targeted prompt/schema and cross-Project journeys first:
```bash
npx playwright test tests/live/studio-actual-schema.spec.cjs --config=playwright.live.config.cjs --headed
```

Set `WEBCAP_TEST_DIRECTOR_MODEL` to an exact configured model ID to avoid silently testing a different model.

To focus on the creative-partner conversation and successive revisions:

```bash
npx playwright test tests/live/studio-actual-schema.spec.cjs --config=playwright.live.config.cjs --headed --grep "creative partner|existing Scene rewrite"
```

These are opt-in **real-model** tests: they need the configured Director endpoint and cannot be verified by ordinary CI. The test suite uses natural author requests without spelling out JSON keys; Director's actual prompt and schema must make the material usable.

## Acceptance evidence

The live tests inspect actual completed model response JSON, not just button text or mocked responses. They fail if an explicitly requested existing-Scene revision omits a complete `prompt`, or an authored Scene record lacks title, duration or complete prompt. They also verify new-Project pivots, changing a Scene's destination after authoring, cross-Project approved references, actual persistence, and no unnecessary additional model call.

Important distinction: `studio_scene_field_draft` uses a response schema that requires `prompt`. The open-ended `studio_chat` schema also supports ordinary discussion and title-only edits, so `changes.scene.prompt` cannot be globally required in every chat response. When the request actually asks for a complete Scene revision, the live tests explicitly fail if the model omits `changes.scene.prompt`. The model's compliance is measured, not presumed.

The separate live suites also test Overview revisions, Develop Scenes, UI-based Scene revisions, Project switching, cancellation and token cutoff. Skipped conditional boundaries do not count as verified passes.

The creative-partner journey now checks that Director can discuss contrasting staging ideas, make a recommendation and turn that choice into an authored, eight-second Scene in the next turn. The existing-Scene journey checks two successive real-model rewrites against the *freshly saved* baseline, verifies that the original creative detail survives the follow-up, and proves that only the chosen Scene is saved. The scoped required-prompt job remains a separate schema-contract test rather than pretending to be a browser conversation.

Creative quality is partly qualitative: raw requests and outputs are retained for inspection. The assertions cover objectively observable authoring and persistence; **a pass does not establish the 90% first-attempt usability goal**, which requires multiple representative trials and an explicit assessment rubric. A model that returns only promises or omits a required Scene prompt must fail the live test; a WebCap routing/save defect must remain separately diagnosable.

## Evidence and limitations

Playwright writes traces, screenshots on failure and attached raw model result evidence under `test-results/studio-live-artifacts/` and `test-results/studio-live-html/`. Do not replace missing model fields with test-generated text, quietly retry with a changed creative request, or treat an action promise as a successful result.

The controlled-model `playwright.config.cjs` suite tests plumbing and persistence, but is NOT live-model functional acceptance. CI checks live-test syntax, not actual live inference, which must be run locally with an available configured model.
