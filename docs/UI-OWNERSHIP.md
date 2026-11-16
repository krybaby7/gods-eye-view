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
| `toolsMenu.js`, `menuSections.js`, `styles/tools-menu.css` | The top bar's menu (roadmap 1.5): the original app's tools in three floating panels, and the hook that opens a section |

The World Board's own files (`worldPanel.js` and the other `world*.js`) own
what the sheet, the lens row, the legend and the turn say; the frame owns
where they sit and how the tab bar looks. The board decides which sheet tabs
exist and their order; the frame only shows the first four and puts the rest
under More, so a new first tab (Overview) needs no frame change. A control the
frame cannot connect is hidden, never shown dead.

### The layers menu (roadmap 1.4)

The bottom bar's **Layers** button opens the layers menu and its **Presets**
button opens a small menu of the eight presets. Neither sits on the globe any
more: the old left-rail Data Layers panel and lens bar are gone from it.

| Owner | Responsibility |
| --- | --- |
| `src/lenses/groups.js` | The one table of groups, row names, columns, preset hotkeys, the tool row that opens a panel, and the layers that have no row (World and the layers another surface drives) |
| `src/lenses/catalog.js` | The eight presets, read from that table |
| `templates/layers-menu.html` | The menu's head ("Layers", the on count, Switch all off, close), the preset chips, and the foot: links to Data sources and keys, Display, and Scenes, recording and drawing, then its sentence |
| `styles/layers-menu.css` | The floating menu's size and place at each width (three columns, two, one, a full-width sheet at 720 px and under) |
| `styles/lens-bar.css` | The preset chips in the menu and the rows of the Presets menu |
| `layersMenu.js` | Opening and closing: the Layers buttons, Escape, the close button, a press outside, focus in and back, the on count on the button and in the head, the Presets menu, the foot links (each closes the menu and opens its section of the top bar's menu); the F key goes through `layersMenuToggle.js` |
| `layerPanel.js` | The rows and their switches, built from the group table |
| `layerStates.js` | The plain words a row says: live, stale, waiting for a key |

The menu is still `#data-panel`, a collapsible panel, so voice, share links,
saved panel state and Escape keep opening and closing it as before. The bottom
bar, the top bar and the command dock stay the frame's and roadmap 1.5's.

The War Monitor has no row: its switch is in Menu > Data sources and keys, and,
like World, "Switch all off" and the presets leave it alone.

In the cockpit the bars are not drawn, so the cockpit's own **Layers** and
**Presets** buttons (`#cockpit-layers`, `#cockpit-presets` in `#view-switcher`,
shown only in cockpit mode) open the same two menus, centred between the
cockpit's side windows, under its top line and above its compass. The Presets
menu moves to the body while it is open there and goes back to the bottom bar
when it closes. F opens and closes the layers menu in the frame and in the
cockpit. Recording, the clean view and embedded views draw neither menu and
have no route to Layers or Presets; F does nothing there.

One menu at a time: the layers menu, the Presets menu, the top bar's menu list
and its panels, the sheet's More menu and the legend's popover each dispatch
`gev:menu-open` (`MENU_OPEN_EVENT` in `menuSections.js`) when they open, and
every other one closes on it. Escape closes only the menu that is open; the
layers and Presets menus take it first, so it does not also leave the cockpit
or let go of a tracked aircraft.

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
Tactical. Rails treat `#intel-hud .hud-status` and the frame's bars as
obstacles, and the World Board hides country codes that would sit under a
panel or an open menu panel (`src/overlays/panelCover.js`).

## The top bar's menu

Nothing of the original app sits on the globe by default but the status line.
Its tools open from the menu button, last in the top bar (`#frame-menu`, three
lines), as three floating panels inside `#frame-tools`:

| Section | What it holds |
| --- | --- |
| Data sources and keys (`sources`) | The provider keys dialog (`#key-setup`, opened through its own chip, which no longer shows) and the War Monitor's switch and the way to open its panel |
| Display (`display`) | Visual presets, map source and render quality (`#control-panel`); the display options (`#pp-toggles`: detection, 3D models, scope, sun and moon ring, bloom, sharpen, MGRS and clean view) |
| Tools (`tools`) | Going to a place (`#location-bar`), the view controls and navigation help (`#globe-navigation`), drawing, scenes and recording (`#scene-panel`), and the share link (`#share-btn`) |

`toolsMenu.js` moves each original control, whole, into its slot in
`templates/frame.html`; markup, ids and wiring stay, so voice actions, scenes,
share links and tests still find them. A moved panel is marked
`data-panel-fixed` and kept open; its dock or rail disclosure no longer
applies. A control that is absent hides its group, and a section with nothing
in it hides its entry. Panels open only when chosen and close by their close
button or Escape (focus returns to the menu button), a press outside them, or
another menu opening; a press on the globe or in a dialog leaves them open, so
drawing and picking places work while one is open. Below 720 px the
panels are full-width sheets above the bottom bar. The holder is a frame
region, so the panels are not drawn in the cockpit, while recording, in the
clean view or when embedded.

Voice is reached only from `#frame-voice`; the dock keeps the voice card and
its error tray, and its pill is not drawn. Zoom is only in the bottom bar. The
cockpit is still entered from a selected aircraft's card.

Other parts open a section with `openMenuSection(name)` from `toolsMenu.js`, or,
without importing the menu, by dispatching `gev:open-menu-section`
(`MENU_SECTION_EVENT` in `menuSections.js`) on `document` with
`detail.section` one of `MENU_SECTIONS`. Voice's `set_panel_open` on a moved
panel opens or closes its section the same way.

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
