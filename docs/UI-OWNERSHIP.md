# Application UI ownership

`src/ui/applicationShell.js` constructs controls, connects their explicit inputs
and coordinates shutdown. `shellFacade.js` preserves the methods used by layers,
scene playback and voice. It delegates; new behavior belongs with its owner.

| Owner | Responsibility |
| --- | --- |
| `navigationController.js` | Navigation generation, tracking release and camera authority |
| `locationNavigation.js` | Destination lookup/selection, orbit, world jumps and globe-reset completion |
| `cockpitCoordinator.js` | Cockpit entry/rollback, readouts and the single Display portal |
| `visualSettings.js` | Effects, detection overrides, visual restoration and render-loop lifetime |
| `panelChrome.js` | Disclosure, docking, layout and Cockpit panel restoration |
| `railSinglePanel.js` | The right rail's one-expanded-panel rule; off (`RIGHT_RAIL_SINGLE_PANEL`) |
| `aircraftDisplay.js` | Shared commercial/military 3D display preferences and controls |
| `layerBindings.js` | Data-manager attachment, selected-tracker adoption and camera-entry listeners |
| `displayBindings.js` | Keyboard/display subscriptions and frame-rate monitor lifetime |
| `shareRestoration.js` | Initial share/layer restoration and cancellation |
| `shellFeedback.js` | Loading feedback, notices and toast lifetime |

## The frame

The frame (roadmap 1.2) is the app's container: five solid regions, the top
bar, Today on the left (folding to a 48 px rail), the globe, one sheet on the
right and the bottom bar. Its owners:

| Owner | Responsibility |
| --- | --- |
| `templates/frame.html` | The regions' markup, the sheet's tab bar and More menu, the bars' controls |
| `styles/frame.css` | All placement: region sizes, the globe's inset, the bars' contents, where floating chrome sits inside the globe's region |
| `frame.js` | Region state on `<body>` (`data-today`, `data-sheet`), Today and the sheet taking turns below 1,180 px, the sheet's first four tabs and More, the bars' controls, a render request on every layout change |
| `frameGauges.js` | The top bar's date, refresh day and gauges, from the board's stored snapshot only |

The World Board's own files (`worldPanel.js` and the other `world*.js`) own
what the sheet, the lens row, the legend and the turn say; the frame owns
where they sit and how the tab bar looks. The board decides which sheet tabs
exist and their order; the frame only shows the first four and puts the rest
under More, so a new first tab (Overview) needs no frame change. A control the
frame cannot connect is hidden, never shown dead.

`#cesiumContainer` and `#world-overlay-root` are inset to the globe's region,
so the canvas no longer fills the window. Anything that mixes Cesium's canvas
pixels with window pixels converts through `src/overlays/canvasFrame.js`, and
fixed chrome over the globe positions itself from the frame's `--frame-*`
variables, not the window.

The status line (`src/hud.js`, formats in `src/hudFormat.js`) runs along the
bottom of the globe's region: place name, degrees and minutes, MGRS when
turned on in Display, eye altitude above sea level and the UTC time, with the
imagery credit at its right end and the selected vessel's AIS line above it.
When space runs short the place name gives way first; altitude and the time
always stay. Its layouts are Tactical, Operator and Minimal
(`src/hudLayoutPolicy.js`); a stored or shared `cyber` layout falls back to
Tactical. Rails treat `#intel-hud .hud-status`, the frame's bars and the key
setup chip as obstacles, and the World Board hides country codes that would
sit under a panel (`src/overlays/panelCover.js`).

Owners receive named services, elements, operations and readers. They do not
receive the application shell itself. Readers resolve a replaceable collaborator
at use time; operations cross an ownership boundary without copying its state.
The facade exposes existing properties as delegates rather than duplicate state.

Shutdown has two phases. First revoke input, deferred navigation, camera-entry
listeners, lookups, timers and rendering work. Then await Context restoration,
release sensor overrides while the manager is still attached, detach layer
services and destroy scene resources. Late callbacks cannot acquire the camera.
Manager replacement also releases subscriptions and the previous Directions
module even if the replacement does not provide a Directions layer.

Source-contract tests follow both sides of delegated wiring. Lifecycle tests
exercise pending reset cancellation, stale camera callbacks, replacement and
idempotent teardown. Browser acceptance covers the composed application, including
share restoration, scene commands, navigation, Cockpit, display and voice.
