# Signal F — application icon proposals

This is a design proposal. The installed application still uses
`src-tauri/icons/icon.ico` and `src-tauri/icons/icon.png`.

## Idea

The F stands for FDC. Its lime upper rail reads as an active signal, and the
clipped ends borrow the HUD's precise geometry. The rounded olive tile gives
the icon a single clear outline in Windows. Pulse raises one step in the rail.
Lift follows a supplied sketch by detaching and raising both horizontal tips;
both floating tips end in the same diagonal cut. All marks use no texture so
their shapes can be judged at the 16 px tray size.

## Files

- `fdc-icon.svg`: editable original vector source, 512 × 512 viewBox.
- `fdc-icon.png`: 1024 × 1024 transparent-corner export.
- `fdc-icon.ico`: Windows export with 16, 24, 32, 48, 64, 128, and 256 px layers.
- `fdc-icon-pulse.svg`: editable vector variant with one raised signal step.
- `fdc-icon-pulse.png`: 1024 × 1024 transparent-corner variant export.
- `fdc-icon-pulse.ico`: Windows variant export with the same seven sizes.
- `fdc-icon-lift.svg`: editable vector variant with two detached, raised tips.
- `fdc-icon-lift.png`: 1024 × 1024 transparent-corner variant export.
- `fdc-icon-lift.ico`: Windows variant export with the same seven sizes.

All shapes were authored as FDC vectors. Lift interprets a user-supplied
composition sketch; the sketch file is not included in the repository. No
stock asset, icon pack, or AI-generated raster was used. Colors are copied
from the implemented FDC Dark tokens: `--surface-deep` `#152019`, `--text`
`#edf0df`, and `--accent` `#c3ed83`. The icon does not include the app's
painted header texture.

The `foundation-icon` board compares all three proposals at taskbar and tray
sizes and shows the current installed icon separately. No proposal is selected
for implementation. Replacing the runtime icon and updating
application assets belongs to the later implementation step.
