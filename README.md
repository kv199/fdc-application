# Forza Horizon 6 HUD

A lightweight, always-on-top telemetry overlay for Forza Horizon 6.

The application renders tire temperatures, throttle and brake input, steering,
the current gear, and input history over the game. It consumes the local
WebSocket telemetry stream exposed by [co-driver](https://github.com/Ojansen/co-driver).

## Driver Coach MVP

The Coach card includes a neutral observed Driver Coach phase indicator:
`BRAKE`, `BLEND`, `COAST`, or `POWER`. It describes the observed pedal and
steering phase of the current turn; `BLEND` is the observable overlap of brake
and steering, not a quality score or a claim that trail braking was correct.
After a turn, the HUD briefly shows accumulated `BLEND` and `COAST` time plus
minimum and exit speed when available.

The Driver Coach is a large, movable card over the game. The telemetry HUD
stays anchored near the bottom of the primary monitor, while the Coach card
can be placed at the driver's preferred sight line. The lap-delta strip is
anchored directly above the main HUD at the same width and is not part of the
movable Coach card. It remains visible in a neutral state before a reference is
available.

To move the Coach in the Tauri app, open the HUD icon's system-tray menu and
choose `Edit Coach position`. Drag the card, then press `DONE`. The position is
stored locally. The same menu can reset the card or exit edit mode. In a browser
preview, use `?demo=1&corner=entry&edit=1` or press `Ctrl+Shift+E`.

The Reference Coach can be previewed without Forza in demo mode:

```text
?demo=1&reference=brake-late
?demo=1&reference=release
?demo=1&reference=apex-slow
?demo=1&reference=throttle-late
?demo=1&reference=good
```

The Driver Coach and lap-delta strip are shown only when a matching reference is
available. When a lap changes, the last available Coach state and lap delta are
held as a `LAP COMPLETE` summary for four seconds, then cleared. Without a
reference, the HUD keeps the ordinary telemetry and corner readout without
inventing coaching advice. The same summary is captured when co-driver reports
that the current reference is no longer available, when the HUD detects the
transition after the final template corner, or when recording becomes idle,
so the final corner cannot erase the last useful result before the lap transition.

The RPM preview can be combined with a reference state, for example
`?demo=1&signal=shift&reference=brake-late`. In demo mode, keys `1`–`3` select
the RPM signal and keys `9` and `0` select reference states.

Corner context can be previewed with the same demo page:

```text
?demo=1&corner=between
?demo=1&corner=approach
?demo=1&corner=entry
?demo=1&corner=apex
?demo=1&corner=exit
```

The corner readout consumes `corner_template` and `corner_state` messages from
the local WebSocket. `co-driver` remains responsible for matching telemetry to
track corners; the HUD presents the number, direction, phase, distance, and any
explicit reference cue supplied by the backend.

## Reference Coach contract

The HUD accepts an optional WebSocket message with this envelope:

```json
{
  "type": "coach_reference",
  "reference": {
    "available": true,
    "corner": "T3 LEFT",
    "phase": "entry",
    "cue": {
      "kind": "brake_late",
      "value": 12,
      "unit": "m",
      "severity": "warning"
    },
    "summary": {
      "deltaMs": 180,
      "apexSpeedDeltaKmh": -4
    }
  }
}
```

Supported cue kinds are `brake_late`, `brake_early`, `release_late`,
`apex_too_fast`, `apex_too_slow`, `throttle_late`, `throttle_early`, and
`good`. If `available` is not `true` and no short post-lap summary is active,
the HUD hides the Coach and lap-delta strip and keeps the ordinary HUD. The HUD
does not derive advice from raw telemetry.

The Coach shows one phase-specific action at a time: brake on approach, release
brake on entry, apex guidance at the apex, and throttle pickup on exit. It shows
only the reference/observed pedal point relevant to that phase. The browser demo
covers the same states:

```text
?demo=1&reference=brake-late
?demo=1&reference=release
?demo=1&reference=apex-slow
?demo=1&reference=throttle-late
?demo=1&reference=good
?demo=1&reference=summary
```

When reference data is available, the separate strip shows only `lapDeltaMs`:
positive values are slower and move left into the red zone; negative values are
faster and move right into the green zone. The visual range is limited to ±1 s,
and missing deltas stay neutral. The Coach border uses the local `deltaMs` for a
small color accent, but does not display it as a second large number. `targets`
and `observed` are displayed by the HUD and are not recomputed from telemetry.

To preview the short post-lap state in a browser, add `lapSummary=1`, for example:

```text
?demo=1&reference=good&lapSummary=1
```

## Development workflow

- `develop` is the default working and integration branch. Normal tasks are
  committed directly to it as focused, validated commits.
- Testable development executables are built from `develop` so changes can be
  evaluated before release.
- `main` contains only accepted, verified versions. `develop` is merged into
  `main` only after explicit approval, and stable gaming executables are built
  from `main`.
- A short-lived feature branch is created from `develop` only after a change has
  been discussed and judged large, risky, or long-running enough to need
  isolation.

## Local dependency

Run the matching co-driver channel before starting the HUD. The production HUD
connects to `ws://127.0.0.1:3000/_ws`; the `develop` HUD connects to
`ws://127.0.0.1:3001/_ws`. The overlay does not duplicate co-driver's UDP
parsing or storage.

For local development, start the non-main co-driver channel with:

```powershell
cd C:\Install\co-driver
.\scripts\start-develop.cmd
```

The browser preview can select the same channel explicitly:

```text
http://127.0.0.1:8765/index.html?channel=develop
```

For a visual-only layout check, use:

```text
http://127.0.0.1:8765/index.html?demo=1&corner=entry&edit=1
```

Do not add `demo=1` when checking live telemetry: demo mode intentionally
does not open a WebSocket. Use `?demo=1` only for the offline visual previews.

## Steering wheel assets

Steering wheel artwork lives in `overlay/assets/steering-wheels/`. Each asset is
a self-contained SVG with a `140 x 140` viewBox, a transparent background, and
its rotation pivot at `(70, 70)`. The neutral marker must point to 12 o'clock.

The active asset is selected in `overlay/overlay.js`; adding a new SVG does not
require changes to telemetry or the Tauri layer.

## Build

Development build from the `develop` branch:

```powershell
cd src-tauri
cargo check --profile develop --locked
cargo build --profile develop --locked
```

The development executable selects the `3001` WebSocket channel automatically.

The executable is written to:

```text
src-tauri/target/develop/forza-horizon-6-hud.exe
```

Stable build from the `main` branch after an approved merge:

```powershell
cd src-tauri
cargo build --release --locked
```

The production executable selects the `3000` WebSocket channel.

The executable is written to:

```text
src-tauri/target/release/forza-horizon-6-hud.exe
```

Cargo's standard `target/debug` output is reserved for technical diagnostics and
is not the normal development build handed off for game testing.
