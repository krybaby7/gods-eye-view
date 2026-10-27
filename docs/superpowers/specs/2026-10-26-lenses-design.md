# Lenses: pick topics, not layers

Date: 2026-10-26. Status: design, agreed with the owner, not built.

## 0. Shape in one paragraph

A lens is a named set of data layers: Air, Sea, Space, Conflict, Hazards, City, Signals. Clicking a
lens turns its layers on; clicking it again turns them off. Several lenses can be on at once, and
the map shows every layer from all of them. A lens does nothing else: no visual style, HUD,
camera, panel or news-filter changes. A lens has no state of its own; whether it reads on, partly
on or off is worked out from its layers. The existing DATA LAYERS list stays, unchanged, as the
expert panel.

## 1. Decisions (owner, 2026-10-26)

- A lens only turns data layers on and off ("keep it simple"). Full game-style modes that also
  change the look, HUD and news feed were considered and declined.
- Lenses may overlap. Layers simply add up.
- The old layer list stays as an expert panel.
- Start from the draft lens list in section 2.

## 2. Lens list

Layer ids are the ones registered in the app catalog and grouped in `src/ui/layerPanel.js`.

| Hotkey | Lens | Layers | Notes |
|---|---|---|---|
| Shift+1 | Air | `flights`, `military`, `local-adsb` | `local-adsb` needs a local receiver; skipped when absent |
| Shift+2 | Sea | `ais-live-vessels`, `telegeography-submarine-cables` | |
| Shift+3 | Space | `satellites`, `rocket-launches` | |
| Shift+4 | Conflict | `military`, `military-installations`, `local-firms` | Add `news` once the war monitor (fork PR krybaby7/gods-eye-view#1) is merged |
| Shift+5 | Hazards | `earthquakes`, `weather-cyclones`, `local-firms`, `fire-perimeters`, `weather-radar`, `weather-lightning`, `wind` | The draft said "Weather"; radar and lightning are the hazard-relevant weather layers. See 6.2 |
| Shift+6 | City | `traffic`, `transit`, `bikeshare`, `cctv`, `alpr-cameras` | `street-level` and `directions` dropped (owner, 2026-10-26). See 6.1 |
| Shift+7 | Signals | `radio`, `cctv` | |

Shared layers: `military` (Air, Conflict), `local-firms` (Conflict, Hazards), `cctv` (City,
Signals).

In no lens, so expert panel only: `street-level`, `directions`, `recent-imagery`,
`local-datacenters`, `local-dams`, `weather-satellite`, `military-awareness` (Global Context, owned by the Context modes) and the
Bhote Koshi event layers.

## 3. Rules

### Lens status, read from the layers

The lens reads each layer through `LayerLifecycle.isEffectivelyEnabled`, so a click that is still
in flight already counts.

| Status | Meaning | Button |
|---|---|---|
| on | every available layer in the lens is on | lit |
| partial | some of its available layers are on | half-lit, with a count such as `2/3` |
| off | none of its layers are on | plain |
| unavailable | none of its layers is available | dimmed; the tooltip gives each layer's reason |

"Available" means the layer row is not reporting a missing key or an unavailable source. The lens
uses the same availability and reason text the layer row already shows. It does not keep its own
copy.

### What a click (or hotkey) does

- **off or partial:** turn on every available layer in the lens that is off.
- **on:** turn off each of its layers, except a layer that also belongs to another lens that is
  **on**. A partial lens does not protect shared layers.
- **unavailable:** nothing; the button is disabled.

Examples:

- Air and Conflict are both on. Turn Air off: `flights` and `local-adsb` go off, `military`
  stays because Conflict is still on.
- Conflict is on. The owner turns `military-installations` off in the expert panel: Conflict now
  reads `2/3`. Clicking Conflict turns `military-installations` back on.
- The owner turns on `ais-live-vessels` and `telegeography-submarine-cables` by hand: Sea lights
  up as on without being clicked.

### How the changes are made

Each layer change is one `LayerLifecycle.setEnabled(layerId, enabled, { origin: 'user' })` call,
exactly as if the owner had clicked that row. The first-run missions in
`src/firstRunExperience.js` already turn layers on this way. This means:

- **Saving:** the existing `gev:layer-state:v2` store keeps the layers, and nothing new is stored.
  Reloads and share links restore the layers, and lens status follows from them.
- **Unavailable layers** are left out before any call is made, so a lens never triggers the
  manager's refusal for them.
- **Context modes** (Contacts, Space Missions) keep their current rules. A lens turning off a
  mode's required layer exits the mode, just as clicking that row does today.
- **Clear layers** turns everything off; every lens then reads off.
- **Rapid clicks** are safe. The manager already serialises toggles and drops outdated work, and
  each click is planned from the latest intent, so a second click reverses the first.

## 4. UI

- **Lens bar:** a new `#lens-bar` is the first child of `#left-panel-stack` in
  `src/ui/templates/layer-panels.html`. It is always visible and holds one row of seven icon
  buttons, each labelled with its name. Each button shows the status from section 3. Hovering a
  button lists the lens's layers with their current state. On narrow screens the row scrolls
  sideways inside itself instead of widening the page.
- **Expert panel:** the existing DATA LAYERS panel, with its Movement / Cameras / Infrastructure /
  Events / Weather / Utilities groups, stays exactly as it is.
- **Hotkeys:** Shift+1 to Shift+7, matched on `event.code` (`Digit1` to `Digit7`) in
  `src/ui/applicationShortcuts.js`. Plain 1 to 7 stay as the visual-style keys (normal, retro,
  surveillance, thermal, anime, noir, snow). On some layouts, such as French AZERTY, Shift plus
  the digit key produces the digit itself in `event.key`. So the style handler must also ignore
  key presses with Shift held, and the two never collide on any layout. Form fields are ignored,
  as for the other shortcuts.

## 5. Code shape

| File | Role |
|---|---|
| `src/lenses/catalog.js` | Frozen `LENSES` list: `id`, `label`, `icon`, `hotkey`, `layerIds` |
| `src/lenses/rules.js` | Pure functions: `lensStatus(...)` and `planLensClick(...)`, which returns `[{ layerId, enabled }]`. No DOM, no manager imports |
| `src/ui/lensBar.js` | Renders the bar, re-reads status on manager activity, runs the planned `setEnabled` calls, shows busy while they settle |
| `src/app/data.js` | Mounts the lens bar next to `presentation.mount(...)`, where the layer manager is available |
| `src/ui/applicationShortcuts.js` | Shift+digit binding that calls the lens bar's click action; style keys ignore Shift |
| `src/ui/templates/layer-panels.html` and styles | `#lens-bar` markup and states |
| `scripts/package-boundaries.json` | Register the new modules |

## 6. Open points, with recommendations

1. **`street-level` and `directions` in City. Decided: dropped (owner, 2026-10-26).** These are
   tools rather than data layers. Switching `street-level` on opens its own panel (any
   user-origin switch-on does), and `directions` shows nothing until a route is entered. Both
   stay in the expert panel only.
2. **Hazards is heavy.** It switches on seven layers at once, including GPU wind and two weather
   imagery layers. Measure the frame rate when it is built, and trim the list if it drops.
3. **Layers in no lens** (data centers, dams, recent imagery, weather satellite) stay expert-only
   for now. An Infrastructure lens is a possible later addition.

## 7. Later, not in this design

Voice ("turn on the conflict lens"), solo-click (one lens, all others off), owner-made lenses, a
visual look per lens, layers that appear only as you zoom in, and a news feed filtered by the
active lenses.

## 8. Tests

- Every layer id in `LENSES` is registered in the app catalog, which catches renames.
- Lens ids and hotkeys are unique, and the hotkeys are 1 to 7.
- `lensStatus`: on, partial, off and unavailable, including a lens with some unavailable layers.
- `planLensClick` from each status, including shared-layer protection by an on lens only.
- Shortcuts: Shift+Digit toggles a lens, plain digits still set the style, and both are ignored
  in form fields.
- Lens bar DOM: each status renders, and a click calls `setEnabled` with `origin: 'user'`.
- In the running app: click each lens and check its layers, reload and check they come back, and
  record the frame rate with Hazards on.
