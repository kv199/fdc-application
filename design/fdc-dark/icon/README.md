# Signal F — application icon proposals

This is a design proposal. The installed application still uses
`src-tauri/icons/icon.ico` and `src-tauri/icons/icon.png`.

## Current study: Unified Chroma F

The F is one continuous vector path and one radial gradient fill. Its
outer left edge is a single straight line; the previous middle-arm protrusion
is removed. A soft light source near the upper right uses `--accent-soft` and
`--accent` to add volume without a separate stripe or texture. The light tile
falls through `--paint` to `--surface-deep`; the black tile falls through
`--line-strong` to `--paint` so the stem stays visible on `--shadow` black.
Both versions use the same contour and have transparent rounded corners. Each
has an SVG source, a 1024 px PNG, and a seven-layer Windows ICO.

## Previous study: Split F

Split F interprets the supplied flat, two-color monogram reference as an original
F rather than copying its letterform. Its tall deep-olive stem and two rounded
rails stay readable at Windows icon sizes. The light tile is `--text-bright`;
the upper rail is `--paint`, the middle rail is `--accent`, and the stem and
rail edge are `--surface-deep`. The subtle tile border is `--text-soft`.
All are existing FDC tokens; there is no generated image or texture in this
study. The SVG is the editable source for its PNG and seven-layer ICO exports.

## Earlier ideas

The F stands for FDC. Its lime upper rail reads as an active signal, and the
clipped ends borrow the HUD's precise geometry. The rounded olive tile gives
the icon a single clear outline in Windows. Pulse raises one step in the rail.
Lift follows a supplied sketch: both F arms have diagonal cuts, and the two
floating pieces repeat those cuts with a small gap and upward shift. The latest
study shortens the cream arms, widens the colored pieces, and reduces the gaps.
The Lift mark is larger within the tile. Its exported tile uses a restrained
olive gradient so the shape can still be judged at the 16 px tray size.

Chroma and Spectrum are a new, separate exploration prompted by a supplied
multicolor app-icon reference. Both use an italic F with a warm spine, cool
middle rail, and rounded night-blue tile. Chroma keeps smooth color fields for
the clearest small-size read. Spectrum adds three distinct middle-rail bands
and sparse points on the tile. The reference image is not included or traced;
the geometry and exports were authored for FDC. These colors are exploratory
and do not change the app or HUD palette.

Chroma · FDC palette is a follow-up that keeps Chroma's exact F geometry.
The warm spine uses `--warning`, `--notice`, and `--telemetry-brake`; the
two rails use `--best`, `--text`, and `--telemetry-throttle`. The tile
uses `--surface-deep` and `--paint`. A grayscale powder-coated metal
texture was generated with the built-in image tool and deterministically
tinted between those two existing surface colors. The SVG embeds the
tinted texture, so it is portable; the separate source and tinted files
preserve texture provenance. Chroma and Spectrum remain comparison
studies with exploratory colors, not selected FDC palette proposals.

Texture generation used the built-in image tool with this brief: fine
powder-coated automotive metal, restrained irregular micro-etching and
hairline machining marks, even visual density, grayscale, no icon or text,
no rust, carbon-fiber weave, grid, spotlight, or large scratches. The
generated grayscale is kept as `fdc-icon-chroma-fdc-texture-source.png`;
the colorized tile is derived from it, not generated in new colors.

## Files

- `fdc-icon-chroma-light.svg`, `.png`, `.ico`: unified F on a light FDC tile.
- `fdc-icon-chroma-black.svg`, `.png`, `.ico`: the same F on a black tile.
- `fdc-icon-split.svg`, `.png`, `.ico`: flat Split F source and Windows exports.
- `fdc-icon.svg`: editable original vector source, 512 × 512 viewBox.
- `fdc-icon.png`: 1024 × 1024 transparent-corner export.
- `fdc-icon.ico`: Windows export with 16, 24, 32, 48, 64, 128, and 256 px layers.
- `fdc-icon-pulse.svg`: editable vector variant with one raised signal step.
- `fdc-icon-pulse.png`: 1024 × 1024 transparent-corner variant export.
- `fdc-icon-pulse.ico`: Windows variant export with the same seven sizes.
- `fdc-icon-lift.svg`: editable vector variant with matching cuts in the F and two detached pieces.
- `fdc-icon-lift.png`: 1024 × 1024 transparent-corner variant export.
- `fdc-icon-lift.ico`: Windows variant export with the same seven sizes.
- `fdc-icon-lift-mark.svg`: foreground-only preview for comparing tile finishes.
- `fdc-icon-chroma.svg`, `.png`, `.ico`: editable Chroma vector and Windows exports.
- `fdc-icon-spectrum.svg`, `.png`, `.ico`: editable Spectrum vector and Windows exports.
- `fdc-icon-chroma-fdc.svg`, `.png`, `.ico`: FDC palette vector proposal and Windows exports.
- `fdc-icon-chroma-fdc-texture-source.png`: generated grayscale texture source.
- `fdc-icon-chroma-fdc-texture.jpg`: tinted tile texture embedded in the SVG.

All shapes were authored as FDC vectors. Lift interprets a user-supplied
composition sketch; the sketch file is not included in the repository. No
stock asset or icon pack was used. The new Chroma · FDC tile texture is
AI-generated; its color is restricted to existing FDC surface tokens. All F
shapes remain authored vectors. Earlier Signal F, Pulse, and Lift colors follow
the implemented FDC Dark tokens. Signal F and Pulse use `--surface-deep`
`#152019`, `--text` `#edf0df`, and `--accent` `#c3ed83`. Lift keeps the text
color and uses the HUD's `--telemetry-throttle` `#69e83f` and
`--telemetry-brake` `#ff312b` for the two floating pieces. Its gradient blends
olive surface colors without texture. The book also previews the foreground
on the existing `overlay/assets/textures/paint.jpg`. That preview is not an
icon export and does not duplicate the texture in this folder.

The `foundation-icon` board pairs light and black Unified Chroma first,
then shows Split F, Chroma · FDC, two earlier color studies, and all three
original proposals below.
It compares them at taskbar and tray sizes and shows the current installed
icon separately. No proposal is selected for
implementation. Replacing the runtime icon and updating application assets
belongs to the later implementation step.
