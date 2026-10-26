# Lenses verification — 2026-10-26

Implemented on `feat/lenses` in `/workspace/gev-lenses`, based on the fork's
unchanged `origin/main` at `c3758a734d9728db48e56cc8b6bcfe28541380cb`.
The first branch commit contains the supplied design and prompt. The original
checkout was left unchanged. Publication targets `main` in the owner's fork,
`krybaby7/gods-eye-view`.

## Result

The seven topic buttons derive their state from effective layer intent and
catalog source availability. Clicks use the existing `setEnabled` API with
`origin: 'user'`; shared layers are protected only by another fully-on lens.
There is no lens storage, availability probe by activation, new lifecycle
origin, or change to the DATA LAYERS groups. Shift+Digit1–7 activates lenses;
Shift-held digits are excluded from the visual-style handler, including AZERTY.

The static bar follows the rail surface contract, reserves its height without
auto-collapsing, and keeps all seven controls reachable in Cyber and narrow
layouts. Source metadata exposes only configuration booleans. Custom sources
retain their own availability, and receiver-state changes refresh cold controls
without opening a device or starting a feed.

Space starts its Context-owned launch intent before the satellite companion;
real Context/lifecycle tests prove switching it off does not resurrect
satellites. A cancelled background military-to-Flights handoff now owns its
promise; unexpected failures still retain their error in a warning.

## Repository checks: actual output

All commands ran from `/workspace/gev-lenses` using Node 24.19.0 and npm 11.9.0.
The final production-code checks completed before browser measurements, with
no subsequent production-code changes. Formatting was checked again after
the browser harness was finalized.

```text
$ npm test
ℹ tests 6431
ℹ pass 6430
ℹ fail 0
ℹ skipped 1

# The runner then executed both serialized allocation suites:
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0

ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ skipped 0

$ npm run build
vite v6.4.3 building for production...
✓ 815 modules transformed.
✓ built in 23.20s

$ npm run format:check
Checked 1331 source files.

$ npm run check:boundaries
{"modules":955,"portableEntries":77}
Checked application-components: 16 exports, 772 owned modules.
Checked application-layer-construction: 1 exports, 493 owned modules.
# All 121 boundary groups completed successfully.

$ npm run layer-token:check -- --base-ref origin/main
Layer tokens valid against origin/main: 29 published, 0 new.
```

The one skipped unit test requires Windows' native DACL tooling. The build
retains the existing warning about chunks larger than 1500 kB. The bare
`npm run layer-token:check` initially printed its required `--base-ref` usage;
the supported invocation above passed.

Raw command output is retained under `qa-artifacts/lenses/checks/`:
`gev-lenses-final-unit.log`, `gev-lenses-build.log`,
`gev-lenses-format.log`, `gev-lenses-boundaries.log`, and
`gev-lenses-layer-token.log`.

## Browser checks

The harness uses the real app, catalog, lifecycle, renderers and persistence,
with deterministic transport fixtures. Fixture HTTP interception uses narrow
public CDP patterns; JavaScript and geometry workers load normally. Only a
browser-proven canceled request may be recorded as a canceled interception;
unrelated protocol failures and all application exceptions remain failures.

```text
# Complete keyless run, including performance:
RESULT: 23 passed, 0 failed

# Final keyless behavior run after navigation/transport hardening:
RESULT: 22 passed, 0 failed, 1 skipped

# Seven-layer fixture behavior rerun:
RESULT: 22 passed, 0 failed
```

The explicit skip is the separately recorded performance check. The seven-layer
behavior rerun also used `--skip-performance`; its JSON records that flag and
`performance: null`. No zero-test or preparing-renderer run is treated as
validation.

Both behavior modes verified:

- Every lens enables and disables its exact available layer set, with
  `origin: 'user'` and no intent sent to an unavailable source.
- Shared-layer protection, partial completion from the expert panel, partial
  peers not protecting shared layers, and rapid in-flight reversal.
- Missing-key and missing-receiver guidance without activation probes.
- Durable local layer choices and derived lens status after plain-URL reload,
  with no lens storage key. Explicit share URLs retain their existing precedence.
- All seven Shift+Digit/AZERTY cases, all seven plain style keys, form-field
  refusal, and Clear Layers.
- Default and Cyber desktop layouts, plus 720×480 and 390×600 layouts:
  controls remain at least 49px tall, the page does not widen, and the final
  button accepts pointer input after any necessary row scrolling.
- No uncaught application errors. The unavailable-state screenshot separately
  uses the real lens-bar factory with explicitly synthetic unavailable metadata.

Reports are in `qa-artifacts/lenses/keyless-behavior/report.json` and
`qa-artifacts/lenses/full-behavior/report.json`. Full-page and bar-only
screenshots are beside them, including `lens-off`, `lens-on`, `lens-partial`,
`lens-missing-key`, `lens-cyber`, `lens-narrow-720`, `lens-narrow-390`, and
`lens-unavailable-fixture` variants. These generated artifacts are Git-ignored.

## Hazards frame rate

These are headless Chromium 154 / SwiftShader measurements in the five-CPU
cloud environment, using three paired samples with matched render demand.
They are relative software-rendering evidence, not live-provider or hardware-GPU
performance claims. The view was fixed at 1366×900, Normal style, tactical HUD,
OSM fixture imagery, and 1,200,000 m over Austin, looking straight down.

| Fixture mode | Median baseline FPS | Median Hazards FPS | Drop |
| --- | ---: | ---: | ---: |
| Keyless: 6 available layers; FIRMS skipped | 1.333244 | 0.999933 | 25.0% |
| All 7 layers; FIRMS fixture present | 1.225809 | 0.833292 | 32.0% |

The full-seven samples were:

```text
Baseline FPS: 1.333267, 1.166608, 1.225809
Hazards FPS:  0.833292, 0.832778, 0.833306
Drop: 32.021107277949014%
```

The populated workload contained 16 earthquakes, one cyclone, one fire
perimeter, a 2,664-point wind grid with 7,200 GPU paths / 917,728 vertices,
and two weather imagery layers with 50 loaded tiles each. All wind geometry
was ready, including all 15 visible cells. The seven-layer case also rendered
32 FIRMS records. Active layers reported no loading or error state before
measurement. The keyless case truthfully omitted FIRMS.

Raw measurements and renderer witnesses are retained in
`qa-artifacts/lenses/keyless/report.json` and
`qa-artifacts/lenses/full/report.json`. The full-seven measurement's enclosing
run also recorded one reload-harness failure from an intervening authored share
URL; its performance gate passed independently after resetting the complete
view/layer state. That navigation fixture was corrected, and the subsequent
full-seven behavior rerun passed 22/22. Original reports were preserved rather
than rewritten to hide earlier failures.

## Owner decisions and remaining limits

- **City:** the owner answered "Drop both". Street Level and Directions remain
  expert-only, and City contains its five agreed data layers.
- **Hazards:** the owner decided to retain all seven specified layers,
  including Wind, and will measure performance on real hardware. SwiftShader
  measurements are not representative of hardware-GPU performance and do not
  justify a trim. **No trim was applied.**
- Conflict has no news layer. No section 7 features were started.
- Live provider access, real provider credentials, physical local receiver
  operation, and hardware-GPU frame rates were not validated by fixture QA.
  Windows-specific native hardening remains the unit runner's explicit skip.
- TLS verification remained enabled and Chromium's trust store was not changed.
  A temporary pinned-browser download domain requirement was reverted once the
  fixture protocol correction made that fallback unnecessary.

## Reproduce

Use the feature worktree's Node 24 environment and installed dependencies.
Run server modes sequentially because they share the Vite optimization cache;
stop only the server started for this QA. Use a free port other than 5173/5199.

```sh
# Keyless mode:
NODE_USE_ENV_PROXY=1 npm run dev -- --host localhost --port 4181 --strictPort --force
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/qa-lenses.mjs --url http://localhost:4181

# After stopping that server, the seven-layer fixture mode:
FIRMS_MAP_KEY=qa-fixture NODE_USE_ENV_PROXY=1 npm run dev -- --host localhost --port 4182 --strictPort --force
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/qa-lenses.mjs --url http://localhost:4182 --full-hazards

# Behavior-only reruns retain separate output and explicitly skip performance:
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/qa-lenses.mjs --url http://localhost:4181 --skip-performance --output qa-artifacts/lenses/keyless-behavior
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node scripts/qa-lenses.mjs --url http://localhost:4182 --full-hazards --skip-performance --output qa-artifacts/lenses/full-behavior
```

`qa-fixture` is a non-credential presence flag used only by the temporary test
server; every FIRMS request is answered by the fixture transport before reaching
the server. That process was stopped after QA. The remaining development server
is keyless on port 4181.
