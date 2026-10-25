# Storytelling for MiniMax H3 — Creative Direction

> Vision and working principles, not an implementation plan or UI specification.
> Discussed 2026-10-25. Keep the creative intent stable while the interface and orchestration remain open questions.

## The ambition

Build a **storytelling Director that can notice and repair its own weaknesses**. The goal is not merely better prose or a longer prompt. It is sustained narrative quality across a story: interesting images, substantive action, convincing dialogue, escalating consequences, and purposeful use of expensive rendered seconds.

Our immediate medium is **MiniMax H3 text-to-video**. The output is not a conventional screenplay: Storyboard Scenes are generatable clips (often up to 15 seconds) that can contain multiple shots, transitions, actions, and exchanges. A beat or shot does **not** automatically deserve its own Scene or render.

The guiding metric is **meaningful visual or dramatic payoff per rendered second**, not minimum shot count, minimum scene count, or literary detail.

## The problem to solve

Storytelling LLMs often write strong opening scenes, then become repetitive, thin, predictable, and overly dependent on the tone and vocabulary of their own earlier prose. They may spend scarce runtime introducing an environment, repeat the same emotional exchange, or split a single quick sequence into four independently generated clips.

A long context window doesn't guarantee sustained inventiveness. Letting the model imitate its earlier finished scenes can amplify stylistic habits. We want to preserve story facts and consequences **without forcing every continuation to mimic the prose that came before**.

This is also an economic constraint: a quality 0.8 MP render can take around eight minutes. A gorgeous but unnecessary establishing shot is expensive. We should plan for the medium before spending time generating it.

## Creative principles

1. **Substance before prose.** Decide what happens, why it matters, what the viewer sees, and what changes. Polish the language afterward. An empty scene cannot be repaired solely by rewording it.
2. **Plan in visual time.** A 15-second clip is a bounded visual experience, not fifteen seconds of prose. Use multiple short shots and quick developments when useful. A context/setup shot often deserves only ~2–3 seconds; linger when the shot itself is the focus.
3. **Do not confuse shots with clips.** Several angles, beats, reactions, lines, or quick setups may belong inside **one** generatable Scene. Add a new Scene only when a separately rendered unit meaningfully improves the result.
4. **Make every second earn its place.** Embed exposition in action, use a reveal in place of explanation, trim redundant coverage, and allow some information to be implied or teased.
5. **Keep the work interesting.** Ask where the curiosity, tension, provocation, chemistry, surprise, beauty, humor, danger, or other compelling element lives. Not every clip needs a cliffhanger, but it should have a reason to exist.
6. **Natural behavior matters.** Dialogue, reactions, motivation, and physical actions should be plausible *within the story's intended world*. Avoid generic, oddly formal, repetitive, or exposition-heavy exchanges.
7. **Treat continuity realistically.** Maintain narrative continuity in planning: who knows what, what happened, motivations, objects, and consequences. Independently generated H3 clips may break pixel-perfect visual continuity. Avoid making the story depend on fragile cross-clip details where the creative goal doesn't require them.
8. **Preserve creative freedom.** Fast pacing is the default for groundwork, **not** an absolute cut-every-three-seconds rule. A sustained single shot is welcome when attention, suspense, performance, or visual focus makes it valuable.
9. **Criticize at the level of the defect.** Repetition of story events calls for a new idea; implausible motivation calls for reconsidering actions; awkward speech calls for dialogue repair; only cliché wording calls for prose repair.
10. **Do not revise the life out of the work.** Critics can approve an effective scene. Prefer one focused correction over endless passes, cosmetic churn, and safe but bland results.

## Questions worth answering before scene development

The existing **Story Overview / Continuity** concept could grow into a broader set of **creative directing guidelines**, but the UI and names are undecided. These are questions to help the author and Director shape the *whole story* before drafting clips:

- **Visual priorities:** What should dominate the viewer's attention? Which subjects, actions, details, or images matter most?
- **Interest:** Why is this story, exchange, or image compelling? What makes it provocative, surprising, tense, funny, moving, or otherwise worth seeing?
- **Progression:** What meaningfully changes over the story? How do actions cause later consequences, rather than merely repeat an atmosphere?
- **Pacing and density:** Where should shots be rapid and information-dense? Where is deliberate attention justified?
- **Compression:** Which setup, context, or explanations can be conveyed in a couple of seconds, folded into action, implied, shortened, or omitted?
- **Continuity anchors:** Which character traits, relationships, facts, objects, and outcomes must persist? Which purely visual continuities are fragile or optional?
- **Medium and budget:** Given short H3 clips and costly rendering, what is actually worth an independent generation?

These answers should be **visible, understandable, and editable before scenes are developed**. The Director may propose them from the Overview; the author remains in control. They are creative guidance, not mandatory questionnaires or inflexible validation gates.

## Candidate creative process

These are **conceptual stages**, not a requirement for separate screens, calls, agents, or stored artifacts.

### 1. Intent / story blueprint

First outline the dramatic and visual progression *without writing finished scene prose*. For each proposed clip, capture only the substance needed to direct it:

- Purpose: why this moment exists and what changes.
- Dominant image or action; the hook or payoff.
- Essential actions, shot beats, and likely dialogue.
- Story facts and character intentions needed from before.
- What could be shortened, combined, suggested, or dropped.

Planning at this level should reduce the model's tendency to echo its own ornate prose.

### 2. Clip and shot mapping

Map fast-moving beats into **generatable clips**, rather than reflexively turning each shot into a separate Scene. Several 2–3-second setup or context shots may be followed by a longer focal exchange *inside the same 15-second clip*, where plausible.

Ask whether a clip is visually understandable within its duration. A timing estimate is a creative heuristic, **not** a promise that H3 can execute it exactly. A dense plan may still exceed the video model's actual motion, dialogue, and editing capabilities; we should test those limits with real renders.

### 3. Composition

Develop the scenes individually from their intent, shot map, relevant narrative state, and directing guidelines. Avoid passing a growing wall of earlier completed prose as the primary writing instruction. Preserve facts and creative decisions, not a self-reinforcing stylistic template.

A scene draft should supply concrete imageable action, economical dialogue, and a meaningful progression, while leaving room for creativity and the production style.

### 4. Critical review

Ask a critic to challenge the *work*, not automatically praise or rewrite it. Review at least:

- Does this advance the story or repeat an earlier moment?
- Is the exchange interesting or merely atmospheric?
- Do the dialogue and reactions sound natural for these characters?
- Is an action physically or psychologically strange without intentional reason?
- What dominates visually? Is the sequence readable?
- Does each setup earn its seconds? Is context taking too long?
- What could be pruned, implied, compressed, or merged?
- Have beats been spread across too many **renders**, rather than packed usefully into one or two?
- Is a continuity requirement fragile across separately generated clips?
- Does the ending deliver a turn, consequence, strong image, or meaningful bridge?

**Important correction:** Do *not* use “Are there too many independent events or camera setups?” as a blanket criticism. The actual failure mode often is **too few meaningful developments per expensive clip**. Distinguish dense, purposeful editing *within* a clip from needless multiplication of standalone clips.

### 5. Targeted repair and acceptance

Return concrete findings to the right level of work:

| Detected weakness | Repair target |
| --- | --- |
| Repeated or anemic narrative beat | Intent / story blueprint |
| Unnecessary standalone Scene | Clip grouping / shot map |
| Slow groundwork or wasted seconds | Timing and compression |
| Contrived motivation or action | Character logic / event |
| Flat, implausible dialogue | Dialogue beats / scene draft |
| Repetitive adjectives or tone | Prose only |
| Fragile cross-clip dependence | Continuity design / framing |

Make focused changes, preserving successful content. Accept good results without revision. Keep the human able to override any proposed fix.

## What 'self-healing' should mean

A useful Director notices **specific, actionable deficiencies**, points to their causes, and proposes localized repairs. It must distinguish a story problem from a phrasing problem; it should not simply regenerate the whole story with another generic instruction to “be more creative.”

It may be useful to review the story's **global variation** separately from individual scene quality: repeated conflicts, identical reveals, recycled dialogue patterns, static character dynamics, or successive clips with no meaningful change.

We should **test**, rather than assume, whether separate planning, composition, and critique calls improve long-story quality for the models available locally. The same LLM can miss its own mistakes; a self-critique isn't independent proof of quality. Human review and rendered H3 results remain the final authority.

## UX intent, deliberately undecided

Possibilities include expanding or renaming the current Continuity pane, showing editable Director guidelines before scene creation, previewing a compact clip blueprint, and offering an explicit compression/review action.

**No UI layout, workflow gate, extra persistence model, or multi-agent framework is authorized by this note.** Prefer using the existing Story Overview, Scene, and Director/Storyboard flows; respect `AGENTS.md` and `docs/storyboard.md`. Keep planning optional or lightweight, editable, and separate from user-authored material until explicitly applied.

The best experience should make useful decisions visible without making the author read walls of analysis or answer dozens of questions.

## How to evaluate the idea

Compare the same storytelling model on the same premise using:

- Normal full-story or sequential drafting.
- Intent + clip map + per-scene composition.
- The above with one focused critique/repair pass.

Judge *both* writing and render economics: scene-to-scene variety, coherent escalation, dialogue plausibility, clip consolidation, useful action per 15 seconds, avoidable renders, and actual H3 results. A modest model that stays consistently interesting could outperform a more eloquent model that deteriorates after two scenes.

## The north star

**Help the author spend fewer renders on setup and more renders on moments worth watching.**

The Director should remember what matters, challenge lazy repetition, and help compress a vivid story into purposeful, fast-moving, renderable clips—without becoming a rigid formula or taking creative control away from the author.
