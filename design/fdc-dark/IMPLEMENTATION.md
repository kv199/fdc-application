# Where the FDC Dark design lives

The book illustrates the design; the application files are the source of truth
for values and behavior. This map shows where each part is implemented.

The proposed light Configuration palette is in
`design/fdc-dark/light-theme.css` and `LIGHT_THEME.md`. It is scoped to its
design-book specimen. The approved revision uses neutral grey panels and a
new light masthead texture in `design/fdc-dark/textures/paint-light.jpg`
(original: `paint-light-source.png`). This revision is not implemented in
FDC. The Events and Driver map proposal scopes a dark palette to the route
canvas only; POINT DATA, legends and controls retain the light theme. Its
styles are in `design/fdc-dark/light-maps.css`. The in-game HUD and Delta
stay on the current dark design.

The `settings` board is also a proposal. It groups the six current preferences
into Window & Exit, HUD Behavior, and Units on ordinary surfaces. It shows the
GPU/CPU restart state, but does not change `#settings-panel` or persistence.

The three application icon proposals are in `design/fdc-dark/icon/`. Each SVG is
the editable source and PNG/ICO are exports. The installed Tauri icon is
unchanged.

## Values and rules

| Part | Implementation |
| --- | --- |
| Color, font, type scale, spacing, and HUD geometry tokens | `overlay/tokens.css` |
| Rules for choosing tokens and building screens | `docs/design-system.md` |
| Fonts with license texts | `overlay/assets/fonts/` |
| Header texture | `overlay/assets/textures/paint.jpg` |
| Configuration styles | `overlay/settings.css` |
| In-game HUD and Delta styles | `overlay/overlay.css` |

Checks that keep the design consistent:

- `overlay/color-tokens-guard.test.js`: no color literals outside
  `tokens.css` and no undefined custom properties.
- `overlay/token-contrast.test.js`: WCAG AA contrast for the token pairs the
  interface uses.
- `overlay/design-rules-guard.test.js`: square corners, visible focus, no
  glows or decorative gradients, fonts through tokens, texture only in the
  header, no hover fill on disabled buttons, no button state hover hidden by
  the base button hover.
- `overlay/hud-design-contract.test.js`: HUD cuts, dividers, fonts, font
  preloads, and layout editor button roles.
- `overlay/font-assets.test.js`: bundled fonts, license texts, texture size.

## Board-to-runtime map

| Boards | Runtime area |
| --- | --- |
| `hud-config` | `#hud-panel` in `overlay/settings.html`; `overlay/settings.css` |
| `hud-live`, `hud-freeform`, `hud-states` | `overlay/index.html`, `overlay/overlay.css`, `overlay/hud-layout.js` |
| `driver-list`, `driver-recording`, `driver-detail`, `driver-drive` | `#driver-analysis-panel`; drill-down path in the header |
| `shift-light` | `#shift-light-panel` |
| `garage` | `#garage-panel` |
| `events-library`, `events-create`, `events-detail`, `events-run`, `events-map` | `#events-panel`; drill-down path in the header |
| `settings` (grouping proposal) | `#settings-panel`; current behavior and stored preferences stay authoritative |
| `foundation-overlays` | `#connect-guide` and `.confirm-dialog` in `overlay/settings.html` |

The application header (tab title, tab description, Direct Data Out status
button, drill-down path) is in `overlay/settings.html` and styled in
`overlay/settings.css`; `overlay/settings.js` switches the tab description and
records the Driver Analysis level the path names.

## Seeing the real screens

`node design/preview/serve.cjs` serves the book and live previews of the real
Configuration (mock backend with fixture data) and HUD (state helper); see
`design/preview/README.md`.
