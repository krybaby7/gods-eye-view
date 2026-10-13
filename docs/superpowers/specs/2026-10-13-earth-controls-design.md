# Globe navigation and full-window view

Approved by the user on 2026-10-13 after reviewing the proposed first pass.

## Intended experience

The normal view fills the rectangular viewport. The circular scope remains an optional display effect and explicit saved/share-link settings continue to work.

A compact bottom-right navigation group offers zoom in/out, a live north compass, a 2D/3D viewing-angle toggle and full-globe reset. Share and clear-layers remain at the top. Buttons have clear labels, keyboard focus states and touch-sized targets. The navigation group respects narrow-screen safe areas, clean view, recording and Cockpit modes.

Mouse drag pans, wheel and trackpad pinch zoom, and Ctrl+drag orbits using Cesium's native terrain-aware controls. Pinch response becomes gentler than the existing eightfold amplification. Zoom buttons ease around the view center in free navigation and around the selected subject during following. They preserve heading, pitch and tracking ownership. Repeated or reversed presses remain predictable; a physical gesture or camera-owner change cancels pending animation immediately. The existing tilt and north transitions share the same animator.

## Boundaries

Retain Cesium and the current imagery source, overlays, live layers and follow camera. The 2D/3D control changes the viewing angle; it does not switch map projections. Full-globe reset retains its existing selection/camera-release semantics. Double-click entity tracking and drawing tools retain their existing behavior. No provider keys or paid service setup are part of this change.

## Clarity assessment

Inspect the rendered canvas resolution and provider state independently of controls. Offer a bounded high-resolution render where useful, with a performance fallback. This can improve rendering on high-density displays but cannot recover missing detail from imagery or promise parity with Google's mosaic and labels.

## Verification

Exercise real Cesium camera math for zoom range, rapid presses, bounds, cancelation and moving tracked targets. Verify pinch event relay/lifecycle, scope on/off/share defaults, production build and source boundaries. Check the layout at desktop and narrow widths and attempt browser interaction through supported browser tools only. Keep the already-known Windows OAuth test failure separate from navigation regressions.
