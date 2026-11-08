# Google satellite clarity in the installed globe

Scope authorized by the user's 2026-10-13 request. Account selection is deferred until the app changes are ready. No credentials, service activation, account changes or paid requests are authorized in this implementation pass.

## Provider choice

Keep the existing Google Photorealistic 3D Tiles integration and startup behavior. Add an explicitly selected `google-satellite` source through the installed Cesium Google 2D imagery integration. Google currently lists Egypt for 2D Map Tiles, without 3D Tiles coverage; satellite imagery is the relevant route for the Egypt comparison. No Google Earth mosaic parity or improvement is assumed.

Use an explicit Google browser key with `Google2DImageryProvider.fromUrl` (`satellite`, `en-US`, `EG`), or an explicit ion token with `IonImageryProvider.fromAssetId(3830182)`. The installed `Google2DImageryProvider.fromIonAssetId` does not accept the caller's token. Do not alter SDK credential defaults. Google Satellite has no burned-in road labels. Retain keyless terrain, or the existing ion world terrain when configured, with the same controller used by Esri. Recover to Esri if Google construction or tile requests fail.

## Preservation and setup

Keep the rectangular viewport, optional scope, Sharp/Standard render detail, zoom/compass/tilt/reset controls and camera ownership unchanged. Switching only replaces the owned base imagery layer. Other imagery overlays, primitives, data sources, entity selection and tracking stay intact. Add the source to the tray, share/view validation, voice source names and globe surface classification so all app entry points agree.

Use POWER UP for user-entered credentials. Its guidance distinguishes ion's qualifying Community allowance from direct Google billing and Map Tiles API enablement. A credential enables source selection, not a promise of image quality. Never output key/token values. Redact provider error URLs and credentials before logs/toasts, and intercept Cesium's raw Google 3D tile failure logging. Keep native provider attribution visible.

## Evidence

Compare Giza and central Cairo at identical camera, nadir angle, 1440×900 viewport and device scale. Record corner-ray ground coverage, actual canvas dimensions, render-detail mode, sharpen state, native credits, and settled globe tile status. Separate source detail from display pixel count, contrast sharpening and geographic labels. Without a configured and approved Google route, capture Esri baselines and mark the live Google comparison pending. Synthetic source-switch tests prove preservation, not Google imagery quality.

## Official references checked 2026-10-13

- [Google coverage](https://developers.google.com/maps/coverage)
- [Google Map Tiles setup](https://developers.google.com/maps/documentation/tile/get-api-key)
- [Google usage and billing](https://developers.google.com/maps/documentation/tile/usage-and-billing)
- [Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Cesium Google 2D provider](https://cesium.com/learn/cesiumjs/ref-doc/Google2DImageryProvider.html)
- [Cesium imagery assets](https://sandcastle.cesium.com/?id=imagery-assets-available-from-ion)
- [Cesium ion plans](https://cesium.com/platform/cesium-ion/pricing/)
- [Google attribution policies](https://developers.google.com/maps/documentation/tile/policies)

Direct Google requires a Cloud project, billing enabled and the Map Tiles API. Current 2D free usage is 100,000 returned tiles/month; the first paid tier is USD 0.60/1,000. Ion Community currently includes 1,000 global imagery sessions/month for qualifying personal/evaluation use; eligibility and asset access must be checked by the account holder. Source detail, dates and coverage vary by location.

## Verified outcome

Google Satellite is selectable when a Google Maps key or ion token is configured. Esri remains selected with no keys. The existing Google 3D integration, approved globe controls, rendering detail and live-layer architecture remain in place. Independent review caught and corrected direct Google 2D viewport copyrights being omitted by Cesium 1.138; a fresh Resource with an explicit empty credit list lets the SDK return those copyrights. Google 3D tile-failure listeners suppress the SDK's raw credential-bearing URL diagnostics. Voice instructions now explicitly distinguish Google Satellite from the satellites data layer.

234 imagery/source/setup tests and 104 navigation/tracking/render-quality tests passed. The production build, formatting and source boundaries passed. The final ordinary full suite had 6,374 passed, 10 skipped and two failures: the known Windows OAuth executable-path fixture and an unrelated concurrent MCP key-file repair race. The key-repair and CCTV timing fixtures passed together when rerun separately (29 tests). These modules were not changed.

The browser harness passed all eight checks. Esri Giza and Cairo captures used the same 1440×900 viewport and canvas, DPR 1, nadir camera, Sharp mode and sharpening disabled. It recorded camera ray footprints, actual provider, tile queues, rendered imagery and visible attribution. Settling requires at least three unchanged rendered frames and one continuous second with loaded tiles and no pending work. A discarded pre-settle screenshot warms headless Chrome's compositor; broad request interception was replaced by targeted paid-route blocking because it stalled terrain workers. The synthetic Google source uses a local fixture and verifies 15 preservation/control checks; it is not Google imagery.

Evidence is in `qa-shots/imagery-clarity/report.json`, `giza-esri-imagery.png`, `cairo-esri-imagery.png` and `source-tray.png`. Google and ion credential-presence flags remain false. Both live Google comparisons are pending the user's deferred account choice, user-entered credential and approval for provider requests. No Google imagery improvement or Google Earth parity has been established. The launcher and desktop shortcut still target this installed checkout at `http://localhost:4173/`.
