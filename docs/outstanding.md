This file tracks implemented work vs outstanding items.
Last reviewed: 2026-08-15.

## Active UX Work


## Bugs
- Rename video clip requires manual folder refresh to show new name
- Resuming mh3 with trust cache may not be the intention if buckets, lr, or other settings are the reason for the resume. We need to find a better balance between immutable runs and the very reasonable action of resuming from epochs or weights or even just tweaking settings, all of these things are valid and should be supported cleanly. Without these, I essentially have to run trainings outside the app sometimes, which defeats the purpose of managed training.
- Running a job from scratch without separating caching from running seems to work outside the app, I'm not sure we need to stop caching first, but this might be worth a test, for if we're doing two runs, one to cache, and one to skip it, unecessarily, that's a waste and presents other problems that we've created ourselves (like where cache may actually be stale pre-resume)
- buckets for MH3 should probably borrow the motion/detail concept from WAN2.2, although probably with stricter ceilings.
- Quality mode is probably untrainable, I also want to consider whether we're purposefully skipping lower resolution clips for Quality mode, this makes it different from Normal and POC in ways that deviate from the spirit, I think.
- If I am resuming, and I've changed the LR, we need force_constant_lr added, but... maybe that's on me.
- After Pause, the button says Restart... not Resume? Queue held? are these useful distinctions? It's a Queue, why not just 'Resume'
- For the [dataset] config editor, we only have so many buckets that are applicable to stanzas, I'm dreaming of a friendly system where, say I want to manipulate frames, or resolutions, or directories, I can do so with assistance... choose higher/lower resolutions, compatible bucket sizes, informed by the model, estimated fit in VRAM, etc... I think we already have the correct data points, we'd just need to implement the UI for managing this. A fallback text editor is still desirable.
- The Review / Train screens are getting a bit busy. I feel like these screens were initially tacked on, maybe not given the respsect they deserve, I wouldn't go crazy with a revamp, the train stuff in the center pane is solid, it's more the right pane and how the center and right pane kind of swap responsibilities that seems off.
- The metadata info should probably be shown as soon as we hit Review in the left sidebar, that information is valid and doesn't really require "assessment" from my perspstive.

## Enhancements / Ideas
- Provide the ability to resume from existing weights (resume from LORA, not from saved checkpoint, which we already support).


## Backlog (Do Not Implement Yet)
- Training Items: clicking on an item should probably highlight it in the media-list and preview it back in captioning mode.. it's odd to show these but have them inert. Also, the Hide Items button is full width... this should probably just be a chevron, let's try to be consistent across the app.
- Explore making model addition configurable/extendable so that new models can be added without code changes.
- Either through the logs or tracking, also register and shoe the last saved checkpoint something in the running job
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.

## Cleanup Candidates
- Seek out overengineered solutions and code portions that are too large and fragile compared to the value they offer.
