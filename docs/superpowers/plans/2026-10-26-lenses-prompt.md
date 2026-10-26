You are implementing the Lenses feature in this repo (God's Eye View, a CesiumJS globe OSINT app, vanilla JS + Vite + Node 24). A lens is a named set of data layers (Air, Sea, Space, Conflict, Hazards, City, Signals). Clicking a lens turns its layers on; clicking it again turns them off. Lenses can overlap, and the existing DATA LAYERS list stays as the expert panel. The design is agreed. Your job is to build it, verify it, and report back.

Read first, in this order:

docs/superpowers/specs/2026-10-26-lenses-design.md (the spec: lens list with real layer ids, status and click rules, UI, code shape, open points, tests)
docs/CODE-BOUNDARIES.md and docs/panel-surfaces.md (the lens bar is a new direct child of #left-panel-stack, so it must follow the rail panel surface contract)
src/data/lifecycle.js: setEnabled, isEffectivelyEnabled, getAll, subscribeActivity
src/ui/layerPanel.js (PANEL_GROUPS, layerKeyRequirementTooltip, how a row shows availability) and src/data/feedState.js
src/firstRunExperience.js (the precedent: missions turn layers on with setEnabled(..., { origin: 'user' }), and the long comment on what that persists)
src/contextModePolicy.js (shouldExitContextForLayerChange), src/ui/applicationShortcuts.js, src/app/data.js, src/ui/templates/layer-panels.html, scripts/package-boundaries.json
Owner decisions (2026-10-26). Do not reopen them:

A lens only turns data layers on and off. No visual style, HUD, camera, panel or news-feed changes.
A lens has no stored state. Its status (on, partial, off, unavailable) is derived from its layers every time.
Every layer change is LayerLifecycle.setEnabled(layerId, enabled, { origin: 'user' }), the same as clicking the row. No new origin, no new storage key, no change to the lifecycle or its semantics.
The DATA LAYERS panel and its groups stay unchanged.
Hotkeys are Shift+1 to Shift+7 on event.code Digit1 to Digit7. Plain 1 to 7 stay the visual-style keys, and the style handler must ignore presses with Shift held (AZERTY gives the digit in event.key with Shift).
Still open. Ask me before building the City lens:

Spec 6.1: should street-level and directions be dropped from City? Switching street-level on opens its panel, and directions shows nothing until a route is entered. The recommendation is to drop both.
Spec 6.2: measure the frame rate with Hazards on. If it drops noticeably, report the numbers and propose a trimmed list. Don't trim it yourself.
Conflict gets the news layer only after the war monitor PR (krybaby7/gods-eye-view#1) is merged. Don't add it now.
Git and workspace:

origin is my fork krybaby7/gods-eye-view; upstream is bilawalsidhu/gods-eye-view (read-only for me). My main deliberately sits on an old upstream base. Do not merge or rebase onto upstream.
This main checkout has uncommitted, unrelated imagery-clarity work (src/maps/, src/mapStackChips, src/voice/, src/keySetupCore.mjs, server/providers/openai/, src/app/scene.js, src/view/index.js and others). Leave it alone and never commit it.
Work in a new worktree: git worktree add "../gev-lenses" -b feat/lenses main. The spec and this prompt are untracked in the main checkout, so they are not in the worktree. Copy docs/superpowers/specs/2026-10-26-lenses-design.md and docs/superpowers/plans/2026-10-26-lenses-prompt.md into it, and make them the branch's first commit.
Run npm install in the worktree if node_modules is missing. Use a dev-server port other than 5173 and 5199, which other checkouts may be using.
How to work:

After reading, post a short plan in chat (at most 8 steps) and wait for my go.
Build the pure parts first, test-first: src/lenses/catalog.js and src/lenses/rules.js (lensStatus, planLensClick), with *.test.mjs beside them like the rest of src. Cover every case in spec section 8. Include a test that every lens layer id is registered in the app catalog.
Then build the lens bar (src/ui/lensBar.js, its markup and styles), wire it in src/app/data.js, add the Shift+digit shortcut, and register the new modules in scripts/package-boundaries.json.
Match the surrounding code: its comment density, naming and idioms. Check the bar in the Cyber theme and at 720px width or less, per docs/panel-surfaces.md.
Verification. Report the actual output, not a summary of what should happen:

npm test, npm run build, npm run format:check, npm run check:boundaries, npm run layer-token:check.
Run the app from the worktree and check in a browser:
each lens turns exactly its layers on and off;
a shared layer survives turning off one of its lenses while the other lens is on;
partial status appears after you turn a layer off in the expert panel, and clicking the lens completes it;
a lens with a missing key skips that layer and shows the reason;
reloading restores the layers and the lens status;
Shift+1 to Shift+7 toggle lenses, and plain 1 to 7 still change the style;
Clear Layers turns every lens off;
the frame rate with Hazards on.
Take a screenshot of the lens bar in its main states.
Standing rules:

If a test or check fails, say so first, with the output.
Do not start any item from spec section 7 (voice, solo-click, owner-made lenses, per-lens looks, zoom-dependent layers, news filtering). If one looks necessary, say so in one line.
Commit on feat/lenses as you go. Push and open a PR against my fork's main only when I ask.
End with a short report: what was built, test and QA results, the Hazards frame rate, anything not verified, and the answer you got on the open points.