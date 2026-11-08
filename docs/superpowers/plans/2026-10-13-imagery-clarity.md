# Imagery clarity implementation plan

> **For agentic workers:** Use the assigned provider and QA subtasks in this session; root integrates and reviews changes.

**Goal:** Make Google Satellite selectable without disturbing globe controls, layers, selection or tracking, and prepare reproducible Egypt comparisons.

**Architecture:** Extend the existing source registry and Cesium factories. Retain Google 3D and the same viewer/controller. Account choice and live Google requests remain deferred by the user.

**Tech stack:** Node 24, Vite, installed Cesium, Node tests, repository Puppeteer QA.

- [x] Provider task: add factory, descriptor and registry availability, explicit credentials, matching terrain and Esri recovery. First add and run failing `sourceFactories.test.mjs` cases; implement and verify those cases.
- [x] Presentation task: add `google-satellite` to map chips, VIEW_MAPS, voice aliases/schema and submarine cable globe-stack classification. Verify a source can be selected, shared and restored. Keep labels distinct from satellite imagery.
- [x] Diagnostics task: add failing tests for redacting provider URLs, query/header credentials and raw Google 3D failure output. Add map-specific safe error text at scene/controller boundaries and a tileset failure listener.
- [x] Preservation task: assert camera orientation, selected/tracked entity, unrelated imagery and primitives survive Google satellite/Esri/Google 3D switches, including delayed superseded activation.
- [x] Setup task: document Google and ion account/asset requirements in existing POWER UP provider descriptions. No new credential storage.
- [x] Evidence task: run `node scripts/qa-imagery-clarity.mjs`; record Esri Giza/Cairo baselines, actual canvas size, ground coverage and tile settling. Block paid routes unless `--google-approved` is explicitly requested after setup.
- [x] Verification task: run focused Node tests, `npm run build`, `npm run format:check`, `npm run check:boundaries`, and browser QA. Run full tests if changes affect shared source schemas. Review the final diff independently.
- [x] Delivery task: verify launcher and installed localhost serve the changed source; expose POWER UP for user credential entry. Report Google quality comparison pending until account choice and authorized tiles are supplied.

Live Google image quality validation remains pending the user-deferred account choice and credential setup; the completed evidence task prepares and verifies the Esri baselines and comparison protocol.
