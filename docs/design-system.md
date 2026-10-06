# FDC design system

This is the rulebook for building or changing a Configuration screen, so new
features look and behave like the rest of FDC. FDC has one dark visual
direction; there is no light theme or theme switch.

## Sources and checks

- `overlay/tokens.css` defines every color, the fonts, the type scale, and the
  spacing rhythm. Configuration (`overlay/settings.css`) and the in-game HUD
  (`overlay/overlay.css`) load it before their own stylesheet.
- Stylesheets use tokens only. `overlay/color-tokens-guard.test.js` fails on a
  color literal or on a custom property that is defined nowhere.
- `overlay/token-contrast.test.js` keeps text and control contrast at WCAG AA
  for the token pairs the interface uses.

## Choosing a token

- Pick a token by meaning, not by value. Two roles may share a value today
  and change independently later.
- Vehicle classes (`--class-*`), event modes (`--mode-*`), lap and Driver
  Analysis map layers (`--trace-*`, `--problem-*`), and HUD telemetry
  (`--telemetry-*`, `--hud-*`) keep their own tokens and established colors.
- A translucent variant mixes a role with transparent:
  `color-mix(in srgb, var(--accent) 14%, transparent)`.
- Add a token only for a repeated decision, and name it after its role.

## Surfaces

| Token | Use |
| --- | --- |
| `--bg` | Application background |
| `--surface-deep` | Insets, tables, inputs, chips, the navigation bar, the connection status |
| `--surface` | Ordinary cards, sections, lists, controls at rest |
| `--panel` | The raised plate: at most one per page, for the main working area or principal result; also floating menus and tooltips |
| `--surface-hover` | Hover and focus washes on rows and cards |
| `--paint` | The painted application header |

The application header is the only textured surface: it shows
`overlay/assets/textures/paint.jpg` at `--paint-texture-opacity` over
`--paint`. Cards, forms, tables, the HUD, and Delta use even fills.

## Lines and shape

- `--line-subtle`: dividers between rows and quiet card edges.
- `--line`: default card and control borders.
- `--line-strong`: emphasized edges, the header frame, primary buttons and
  switches at rest.
- Borders are 1px. Corners are square; only status dots are round.

## Text

- `--text`: normal information.
- `--text-soft`: secondary emphasis.
- `--text-muted`: supporting labels and descriptions.
- `--text-subtle`: tertiary metadata.
- `--text-faint`: placeholders, missing values, and disabled labels only.
- Capitalized labels use `--type-label` with letter spacing.

## Accent and status colors

- Lime `--accent` is for interaction: hover fills, selected tabs and choices,
  switches that are on, slider fills, and the focus outline. As text it is
  reserved for sparse ready, positive, or timing values, never decoration.
- `--best` (purple) marks best results and the learned Shift Light cue.
- `--danger` and `--danger-text` mark destructive actions and errors.
- `--caution` and `--warning` mark attention and unsaved state.
- `--notice` marks advisory hints.
- `--alert` is the redline and shift-light red.
- Within one comparison keep one meaning per color, and prefer labels and
  signs before adding another color. Color always supplements a written label.

## Typography

- `--font-ui`: Barlow 400/600 for interface text.
- `--font-readout`: Barlow Condensed 500/600 for the page title, section
  headings, the FDC brand, and prominent numeric readouts with tabular
  numerals.
- Scale: `--type-page-title` 44px (36px below 560px width),
  `--type-detail-title` 27px for drill-down titles, `--type-heading` 28px for
  section headings, `--type-body` 14px, `--type-label` 11px.
- The font files and their SIL Open Font License texts are in
  `overlay/assets/fonts/`. Windows fonts in the fallback stack cover glyphs
  Barlow lacks, such as Cyrillic in user-entered names.

## Spacing

`--space-1` to `--space-6` are 4, 8, 12, 18, 24, and 36 px.

## Controls and states

- Buttons (`.settings-button`) rest on `--surface` with a `--line` border.
  On hover or keyboard focus they fill with `--accent` and `--text-on-accent`.
  Primary buttons rest on `--surface-deep` with a `--line-strong` border.
- Destructive buttons (`.settings-button--danger`) keep `--danger-text` at rest
  and fill with `--danger` and `--text-on-danger` on hover or focus.
- Disabled controls use `--surface-deep`, `--line-subtle`, and `--text-faint`,
  and get no hover fill.
- Navigation tabs and segmented choices (layout mode, units) keep a persistent
  `--accent` fill with `--text-on-accent` when selected, and expose the state
  through `aria-selected` or a checked input. Hovered tabs show an `--accent`
  border.
- Switches (`.visibility-toggle`) have a square knob: `--text-subtle` on the
  left when off, `--accent` on the right when on.
- Sliders have an 8px track filled with `--accent` (`--alert` for the redline
  setting) and a light rectangular thumb.
- Keyboard focus is a 2px `--accent` outline outside the control. Do not
  remove it with `outline: none` on `:focus-visible`.

## Empty, waiting, and error states

- Show a named state, such as WAITING or a specific unavailable message.
  Never show illustrative values as live telemetry.
- Use the shared `.settings-empty` pattern for empty lists.

## Checklist for a new screen or feature

- Uses existing tokens and components; no color literals.
- At most one raised plate (`--panel`) per page.
- Lime only for interaction or meaningful positive values.
- Titles, headings, and readouts follow the type scale and fonts above.
- Empty, waiting or offline, loading, disabled, hover, focus, and error states
  are styled.
- Works at the Configuration window's default 820x620 and minimum 460x560
  without horizontal scrolling.
- The full Node test suite passes, including the guard and contrast tests.
