# Studio Director live-model acceptance

This is an **opt-in real-model** suite, not a browser simulation or a mocked LLM test.

It calls the running WebCap server's `/fs/director/chat` and job polling endpoints with a configured, **real** model ID. The suite evaluates the **actual production JavaScript** request builders from `tool/js/director_chat.js`, fetches the current backend guidance/H3 reference from `/fs/studio/director/guidance`, and uses the production Project-draft parser. WebCap supplies the configured output schema through its ordinary queue. The tests inspect model responses and authoritative saved state.

## Run on the machine hosting the selected model

Start WebCap normally with an available local or remote Director model. Use a disposable WebCap checkout/configuration and filesystem root: the suite creates two test Projects, runs actual LLM work, and removes those Projects afterward. It never operates on existing Project IDs.

```bash
WEBCAP_LIVE_URL=http://127.0.0.1:4200 \
WEBCAP_LIVE_MODEL='remote-1::your-real-model-id' \
WEBCAP_LIVE_REPORT=director-live-results.json \
node --test tests/studio_director_live_model.test.cjs
```

Set `WEBCAP_LIVE_MODEL` to the exact ID shown by WebCap (e.g., `local::model.gguf` or `runtime-id::model-id`). The optional `WEBCAP_LIVE_URL` defaults to `http://127.0.0.1:4200`; optional `WEBCAP_LIVE_TIMEOUT_MS` defaults to 900000 per model call. `WEBCAP_LIVE_REPORT` records the exact outbound messages, model replies, job IDs and timings, so failures can be reproduced. Treat reports as model transcripts and review before sharing. Omit the report variable to avoid writing a file.

Without `WEBCAP_LIVE_MODEL`, the test is **skipped**, never falsely reported as live-pass. This suite is deliberately not part of normal CI: GitHub-hosted runners do not have access to the user's local model hardware. CI checks that its JavaScript is valid.

## Concrete acceptance checks

1. **Read:** Ask about the saved Rainy Bookshop Project. The real model must identify its title, burgundy cardigan, and green door. Verify the Project was not mutated.
2. **Write Project:** Use the exact production Project authoring task plus current server guidance/schema. The real model must return usable Concept and Visual fields for a bakery at blue dawn. Save through the normal Project endpoint and reread from disk.
3. **Write Scene:** Use the exact production targeted-Scene revision task, saved Scene field serializer, H3 guidance and selected model. The model must retain fixed clothing/door details while making the ending quieter. Save the complete replacement and requested 12-second duration through the normal conflict-checked Scene endpoint. Confirm persisted prompt, duration and unaffected title.

Test stages are separately reported. Existing unrelated Projects are never selected for writes. Temporary test Projects are deleted in `finally`; any cleanup error identifies the Project ID.

This tests actual model adherence, context delivery, schema compatibility and persistence—not browser clicks, real-time DOM behavior, or statistical reliability across arbitrary creative requests. Run it on the exact model and machine that will be used for acceptance. A failure is useful evidence about the *specific* stage; no extra repair calls are performed automatically.
