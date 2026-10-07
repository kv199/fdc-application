# Signal F — application icon proposal

This is a design proposal. The installed application still uses
`src-tauri/icons/icon.ico` and `src-tauri/icons/icon.png`.

## Idea

The F stands for FDC. Its lime upper rail reads as an active signal, and the
two clipped ends borrow the HUD's precise geometry. The rounded olive tile
gives the icon a single clear outline in Windows. The mark uses no texture so
its shape survives the 16 px tray size.

## Files

- `fdc-icon.svg`: editable original vector source, 512 × 512 viewBox.
- `fdc-icon.png`: 1024 × 1024 transparent-corner export.
- `fdc-icon.ico`: Windows export with 16, 24, 32, 48, 64, 128, and 256 px layers.

All shapes were authored for FDC. No external imagery, stock asset, icon pack,
or AI-generated raster was used. Colors are copied from the implemented FDC Dark
tokens: `--surface-deep` `#152019`, `--text` `#edf0df`, and `--accent`
`#c3ed83`. The icon does not include the app's painted header texture.

The `foundation-icon` board compares this proposal with the current icon and
shows the export at taskbar and tray sizes. Replacing the runtime icon and
updating application assets belongs to the later implementation step.
