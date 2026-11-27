# Bundled fonts

The WOFF2 files come from the Google Fonts stylesheet service. They are shipped as
supplied, with the same script subsets and weight ranges. The app loads them from
its own server. The icon subset is a static 20-point optical size, weight 400,
with fill and grade set to zero.

- Inter, version 4.001 (git-66647c0bb), is licensed under the SIL Open Font
  License 1.1. See [the bundled notice](inter-OFL.txt).
- JetBrains Mono, version 2.211, is licensed under the SIL Open Font License 1.1.
  See [the bundled notice](jetbrains-mono-OFL.txt).
- Material Symbols Outlined 20pt, version 2.985, is copyright 2026 Google LLC
  and is licensed under the Apache License 2.0. See [the bundled licence](material-symbols-LICENSE.txt).

The source notices for Inter and JetBrains Mono are from the
[Google Fonts repository](https://github.com/google/fonts/tree/5026800714d07231937d92eb4cceabf06e05d74e).
The Material Symbols notice is from the
[Google Material Design Icons repository](https://github.com/google/material-design-icons/tree/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7).
The latter identifies Material Symbols separately from the older Material Icons.

When adding an icon, update the WOFF2 subset and its glyph list together. The
subset test checks rendered source references, and the browser test checks the
ligatures in the bundled font.
