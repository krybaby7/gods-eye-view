# Earth-style globe controls implementation plan

> For agentic workers: use superpowers:subagent-driven-development for independent changes and root integration, followed by spec and quality review.

**Goal:** Deliver the approved full-window view and clear, smoother globe navigation in the installed application.

**Architecture:** Retain Cesium native gestures and existing tracking-aware target frames. Extend the shared camera animator for bounded zoom, bind new controls through the existing navigation authority, and relocate only globe-navigation chrome. Keep render-quality controls independent of imagery selection.

**Tech stack:** Vanilla JavaScript, CesiumJS, CSS/HTML templates, Vite, node:test.

## Baseline

- Worktree: `C:/Users/adami/.codex/worktrees/earth-controls/gods-eye-view`.
- Branch: `codex/earth-style-controls`, base `9beadbd`.
- Existing dependencies reused through a node_modules junction; no dependency changes.
- `node --test src/app/application.test.mjs src/ui/cameraOrientationControls.test.mjs src/scopeMask.test.mjs`: 60 passed.
- Full upstream suite previously has one unrelated Windows OAuth path-fixture failure.

## Task 1: Shared zoom motion

Files: `src/ui/cameraOrientationControls.js`, `src/ui/cameraOrientationControls.test.mjs`.

- [x] Add real-camera failing regressions for bounded zoom in/out that retains target, heading and pitch, repeated/reversed presses, cancellation and a moving EntityView.
- [x] Extend `createCameraOrientationAnimator.animate(frame, destination)` to normalize optional heading/pitch/range and ease range along with orientation. Preserve pending destinations before navigation callbacks cancel the current animation.
- [x] Bind optional `zoomInButton` and `zoomOutButton` through `runNavigation('camera', navigate)`. Use a reciprocal range factor of 1.5; honor controller minimum/maximum distance and at least 150m when following. Retain existing north/tilt behavior and listener disposal.
- [x] Expose an action text node for the viewing-angle button that says 3D when overhead and 2D when tilted.
- [x] Run `node --test src/ui/cameraOrientationControls.test.mjs src/data/trackedCamera.test.mjs src/navigationPolicy.test.mjs` until passing.

## Task 2: Native input response and render clarity

Files: `src/app/viewer.js`, `src/app/application.test.mjs`; new focused render-quality module/test only if needed.

- [x] First update pinch behavior expectations so ordinary deltas receive gentler amplification and large deltas remain capped. Verify event relay happens once, ordinary wheel remains native and disposal restores controller bindings.
- [x] Tune amplification from 8 to 2 with a 60px cap; preserve Ctrl+wheel registration and all other gestures.
- [x] Add a small render-quality API that explicitly selects standard CSS-pixel resolution or sharp rendering capped at 2 device pixels per CSS pixel. Preserve device resize behavior and avoid overriding tracking-owned controller state.
- [x] Test resolution behavior at DPR1, DPR2, DPR3 and invalid inputs before implementation. Root will bind the display setting.
- [x] Run `node --test src/app/application.test.mjs` plus the render-quality test.

## Task 3: Full-window default and navigation chrome

Files: `src/scopeMask.js`, `src/ui/templates/display-controls.html`, `src/ui/templates/scene-chrome.html`, `src/ui/shellElements.js`, `src/ui/applicationShell.js`, `src/ui/styles/status.css`, `src/ui/styles/responsive.css`, `src/ui/styles/controls.css`, `src/ui/styles/recording.css`, `src/ui/styles/cockpit.css`, and share-state default files identified by source search.

- [x] Set the default scope off in source, display markup and default share-state fallback; preserve explicitly supplied scope on.
- [x] Move tilt/north/reset into `#globe-navigation` at the bottom right; add zoom buttons and text for the angle toggle. Keep share/clear at the top. Add nonintrusive gesture help.
- [x] Wire the new button elements into the existing camera binding. Add a standard/sharp display selector using the render-quality API if useful after assessment.
- [x] Style 44px focusable buttons, compact zoom grouping, north needle and safe-area offsets. Hide the new group wherever existing camera controls are hidden in clean view, recording and Cockpit.
- [x] Run relevant scope/share/camera tests and inspect generated HTML via build.

## Task 4: Review, verify and install

- [x] Review final diff against the approved design, then review code quality and fix any defects.
- [x] Format changed files, run meaningful camera/gesture/scope/share/tracking tests, source-boundary check and production build.
- [x] Use supported browser tooling for desktop/narrow layout and interaction checks where policy permits. Do not bypass earlier blocked browser actions; report any remaining visual-check limitation accurately.
- [x] Commit verified changes on the isolated branch, recheck the installed checkout remains clean, then fast-forward it to the tested commit. Restart only the owned local server if needed and verify HTTP response.
- [x] Provide the running local URL and clear explanation of any imagery or test limitations.

## Verified outcome

Installed locally on 2026-10-13. Focused tests: 227 passed. Full suite: 6,362 passed, 1 known upstream Windows OAuth path-fixture failure, 10 skipped. Build, formatting and source boundaries passed. Desktop and 390px layout, scope toggle, quality selector, compass/angle/zoom controls and clean-view visibility were checked through the supported browser. The preview canvas measured 1 render pixel per CSS pixel; its imagery remains Esri. Review-driven regressions cover roll retention, free-camera terrain clearance and once-per-action height sampling.
