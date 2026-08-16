This file tracks implemented work vs outstanding items.
Last reviewed: 2026-08-15.

## Active UX Work


## Bugs
- Rename video clip requires manual folder refresh to show new name

## Enhancements / Ideas


## Backlog (Do Not Implement Yet)
- Training Items: clicking on an item should probably highlight it in the media-list and preview it back in captioning mode.. it's odd to show these but have them inert. Also, the Hide Items button is full width... this should probably just be a chevron, let's try to be consistent across the app.
- Explore making model addition configurable/extendable so that new models can be added without code changes.
- Either through the logs or tracking, also register and shoe the last saved checkpoint something in the running job
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.

## Cleanup Candidates
- Seek out overengineered solutions and code portions that are too large and fragile compared to the value they offer.
