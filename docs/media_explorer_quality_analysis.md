# Media Explorer — on-demand measured detail (2026-11-18)

## Purpose
Help sort candidate material when high-resolution video is visibly soft or contains little useful fine detail. Pixel dimensions are not a visual-quality grade. This first pass exposes **measured multiscale detail**, not a model-based or calibrated overall video-quality score.

## Codebase-grounded phases
1. **Analyzer** — `tool/server/media_quality.py` measures a relative fine-to-coarse grayscale detail signal from native or downscaled video/image samples. It decodes at most eight distributed video frames through local FFmpeg at a maximum side of 1024px, using CPU only. Low-texture frames are unmeasurable, not condemned as bad.
2. **Owner-local persistence** — external Explorer's existing on-demand metadata worker invokes the analyzer only for an explicit `mode: quality` request. It merges a normalized `quality` block with version and method into `media_metadata.json` using the existing synchronized writer; the original media is unchanged. Existing technical metadata and curator ratings/tags are preserved. Source changes invalidate the cached block with the existing size/mtime freshness contract.
3. **Explorer integration** — a contextual **Analyze Detail** button sits next to **Generate Metadata** for external sources. Existing progress and Stop apply to both jobs, and a different-mode request during an active scan visibly fails rather than interrupting work unexpectedly. Measured detail sorting, scan-coverage filters, and Inspector evidence reuse current layout. Unknown/flat frames sort last, in both directions. Saved views retain the filter. Internal producer sources remain unchanged and do not imply access to externally configured folders.
4. **Verification** — focused analyzer tests check sharp-vs-blurred synthetic scenes, flat inputs, short-video sampling, partial decode and cancellation. External scanning tests cover caching, stale results, sorting, and stopping. Explorer DOM tests exercise scan mode and filter/sort query wiring.

## Interpretation and limitations
- The score is **relative detail evidence**; cross-content comparisons can be misleading. Grain, textured backgrounds, motion blur, subject size, AI upscaling and severe compression influence the signal.
- It is not a trained no-reference perceptual metric, artifact detector, or proof of suitability for training. There are deliberately no global “good/poor” thresholds or automatic trash/pruning decisions.
- Partial video decodes preserve measurable samples and report failed sample counts. A file whose entire sampling fails is reported as an analysis error without suppressing other results.
- Cached quality is available only from an authorized source-local scan; this does not allow Prep to enumerate a separate Explorer root.
- Future follow-up, once validated against real examples: add genuine compression/artifact and temporal-consistency measurements, visual frame jump links, and optional read-only QA Curate consumption. Do not label those features implemented here.

## QA to run against the working tree
```sh
python -m pytest tests/test_media_quality.py tests/test_external_media.py -q
node --test tests/media_explorer.test.js
```
Then browse a representative library of genuine low-resolution, native high-resolution, upscaled, grainy, compressed, motion-blurred, and intentionally defocused video. Validate that the tool surfaces useful evidence without treating unmeasurable frames as poor. Confirm scan cancellation, cache reuse, sorting, selection preservation, metadata writer compatibility, and responsive layout before merging.
