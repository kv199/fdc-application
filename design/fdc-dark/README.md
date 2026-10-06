# FDC design book — FDC Dark

The design book shows the FDC Dark design as it is implemented in the app,
with fixture data. It lives on the `design` branch only and never merges into
`develop` or `main`; bring it up to date by merging the implementation branch
into `design`.

## Open it

```
node design/preview/serve.cjs
```

Then open `http://127.0.0.1:5320/`. The book loads the app's own stylesheet
and fonts through `../../overlay/`, so it needs the server (browsers block font
files opened from disk). The overview links to every board and to live
previews of the real Configuration and HUD; see `design/preview/README.md`.

Run `node design/fdc-dark/verify.cjs` to check boards, links, app assets, and
the tokens named on the specification board.

## One source of values

- Colors, fonts, the type scale, and spacing come from `overlay/tokens.css`,
  which `index.html` loads before the book's own styles. The book has no copy
  of the palette.
- `design-system.css` maps the book's older token names onto those roles
  (for example `--lime` is `--accent`, `--muted` is `--text-muted`) and adds
  book-specific layout. `book.css` holds the artboard and specimen layout.
- The fonts (`overlay/assets/fonts/`, with their SIL Open Font License texts)
  and the header texture (`overlay/assets/textures/paint.jpg`) are the app's
  files.
- The **Exact style specification** board reads each token's value from the
  loaded stylesheet, so it always shows what the app uses.

`docs/design-system.md` (on the implementation branch) is the rulebook for the
tokens and components; the book illustrates it.

## Boards

Sixteen application boards cover HUD configuration, Grouped and Freeform
geometry and shift states, Driver history, recording, car, and drive pages,
Shift Light, Garage, Events library, create, event, run, and map, and Settings.
Six reference boards cover the exact style specification, materials, fonts,
the component and state kit, the screen map, and the connection guide with the
confirmation dialogs.

Boards follow the implemented app: the tab description and the Direct Data Out
status in the header, the compact drill-down path such as `← RECORDING / CAR`,
lime ready actions (CREATE, DETAILS, SAVE, RECORD RUN, a dialog's safe answer),
the TELEMETRY ARRANGEMENT row, the layout editor toolbar, the translucent HUD
surfaces, and the full-width Delta strip. Values on the boards are fixtures,
never live telemetry; map paths are schematic and identify no track.

## Fonts

Barlow and Barlow Condensed are bundled by the app under the SIL Open Font
License 1.1. The UI is English; Windows fonts in the fallback stack cover
glyphs Barlow lacks, such as Cyrillic in user-entered names.
