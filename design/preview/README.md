# FDC design preview

Local tools to look at the design book and the real FDC screens in a browser,
without the Tauri backend or a running game. Nothing here ships with FDC.

## Start

```
node design/preview/serve.cjs
```

The server listens on `http://127.0.0.1:5320/` (pass another port as the first
argument) and serves the repository root:

| Address | Shows |
| --- | --- |
| `/` | The design book (`design/fdc-dark/index.html`) |
| `/preview/settings` | The real Configuration (`overlay/settings.html`) with a mock backend and fixture data |
| `/preview/hud` | The real in-game HUD (`overlay/index.html`) with a state helper |

The preview pages are the application files themselves. While serving them,
the server adds a `<base href="/overlay/">` and the scripts from this folder;
it never copies files into `overlay/`. Changes to `overlay/tokens.css`,
`overlay/settings.css`, or `overlay/overlay.css` show up on reload.

## Configuration preview

`settings-mock.js` stands in for the Tauri backend: it answers the commands
Configuration calls and delivers backend events (such as the Direct Data Out
status) to the page. Fixture data covers a current car with variants and saved
cars of every class, four events with runs and laps, two Driver Analysis
recordings, a Shift Light calibration, two monitors, and default display
preferences. Unknown commands log a warning and resolve `null`.

Helpers for the browser console:

- `fdcPreview.setRouteStatus(phase)` switches the Direct Data Out status:
  `live`, `waiting`, `stale`, `offline`, or `error`.
- `await phase4.open(name)` (from `settings-states.js`) drives the real UI into
  a state: `guide-waiting`, `guide-connected`, `guide-problem`,
  `confirm-destructive`, `confirm-discard`, `confirm-quit`, `help-menu`,
  `events-create`, `hud-display`, `driver-history`, `hotkey-capture`,
  `empty-states`.

## HUD preview

`hud-states.js` stops the HUD's own update loop and applies fixture states:
`hudPreview.set(name)` with `grouped-live`, `grouped-redline`, `grouped-shift`,
`grouped-waiting`, `freeform`, `edit-grouped`, `edit-freeform`, `delta-ahead`,
`delta-behind`, or `opacity-40`. The page background is a mid green-grey so the
translucent HUD surfaces are visible. A narrow window (about 760 px wide) shows
the HUD close to its base scale.

## Known gaps

- The fixtures carry little or no recorded position data, so Events lap maps
  and Driver Analysis drive maps may stay empty; tables and metrics populate.
- `phase4.open` does not always close what the previous state opened; reload
  the page between states when a dialog or the guide stays on screen.
- In `freeform` and `edit-freeform`, widget positions are fixtures and can
  overlap Delta.
- The steering wheel is drawn by the HUD script and may show only its outline.
