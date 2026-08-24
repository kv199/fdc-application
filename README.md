# Forza Horizon 6 HUD

A lightweight, always-on-top telemetry overlay for Forza Horizon 6.

The application renders tire temperatures, throttle and brake input, steering,
the current gear, and input history over the game. It can consume the local
WebSocket telemetry stream exposed by [co-driver](https://github.com/Ojansen/co-driver)
or receive FH6 Data Out directly over UDP.

This directory is the HUD application inside Forza Horizon 6 Suite. It remains
self-contained so it can be exported and published as a standalone repository,
while the Suite root owns local runtime startup and end-to-end workflow.

## Driver Coach MVP

The Coach card is a compact at-a-glance instruction surface. It shows one large
actionable instruction, the corner identity, and at most one numeric context.
Technical matcher phases and absolute `REF` / `YOU` lap positions are not drawn
in game. When a correction already includes a distance or speed, the secondary
corner distance is hidden so the card never competes with itself.

The Driver Coach, lap-delta strip, and telemetry HUD are independently movable
overlay targets. The HUD icon's tray menu opens `Configuration`; the window is
shown automatically on the first launch and hides to the tray when closed.
Use `EDIT` in Configuration, drag the selected target in the overlay, then press
`SAVE` in Configuration or on the target itself. Closing Configuration during an edit
cancels the uncommitted position. Positions are stored locally and clamped to
the primary monitor. Configuration is the only layout entry point in the native HUD.

The `HUD` tab also controls the five HUD content blocks: tires, throttle and brake,
steering, gear/speed/RPM, and input history. Disabled blocks disappear and the
remaining HUD grid contracts; disabling every block hides the telemetry HUD.
The three top-level overlay targets also have independent visibility toggles;
the Telemetry HUD row expands to reveal its five child blocks. The `SETTINGS`
tab controls the displayed speed unit (`km/h` by default or `mph`), the selected
telemetry route, endpoint, lifecycle state, and Suite
coexistence diagnostics; no route status is drawn over the in-game HUD.
Display and visibility choices are stored locally. In a browser preview, use
`?demo=1&corner=entry&edit=1` to edit the Coach.

The Reference Coach can be previewed without Forza in demo mode:

```text
?demo=1&reference=brake-late
?demo=1&reference=release
?demo=1&reference=apex-slow
?demo=1&reference=throttle-late
?demo=1&reference=good
```

The Driver Coach card is shown when a matching reference is available or when a
completed-lap result is being held. A provider `lap_complete` message anchors
the final delta to the game's lap boundary; the HUD keeps the `LAP COMPLETE`
card and final lap delta until the next live lap or recording. Without a
reference, the HUD keeps ordinary telemetry and corner readout without
inventing coaching advice. The older short summary fallback remains for
transitions where no finish result was received.

The lap clock is source-neutral and game-clock based. Direct and Suite telemetry
both use `lap.current` for the live clock, preserve the last useful value during
pause/stale packets, and reset volatile timing state when the source changes.
Suite `lap_complete.timeSource=forza_lap_last` represents a circuit boundary;
`forza_lap_current` represents a validated point-to-point completion. The HUD
does not infer a sprint finish from `isRaceOn=false` alone: an advancing
`LastLap` is authoritative, while a CurrentLap-only finish needs the same
non-live value twice and is cancelled if live driving resumes. Direct keeps the
game lap clock visible but hides the Suite-only reference track and Coach.

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
track corners; the HUD presents the number, direction, one relevant distance,
and any explicit reference cue supplied by the backend.

## Telemetry sources and Shift Light

The release executable has one universal build with two explicit source modes
in `Configuration > SETTINGS`:

- `Direct Forza` binds `127.0.0.1:5301`, decodes FH6 Data Out packets locally,
  and works without Docker or co-driver. It renders the compact telemetry HUD
  and HUD-owned Shift Light; Coach, reference, corner, and lap-delta surfaces
  stay hidden because they require the Suite analysis path.
- `co-driver Suite` connects to `ws://127.0.0.1:3001/_ws` and preserves the
  existing Coach, reference, corner, and lap-delta behavior. The HUD does not
  bind UDP in this mode.

The HUD source modes are mutually exclusive inside the executable: Direct never
reads the Suite WebSocket, and Suite never starts the HUD UDP receiver. Docker
Desktop can expose its own `5301` forwarding endpoint while Direct owns
`127.0.0.1:5301` on Windows, so co-driver may also receive packets in the
background. The `SETTINGS` tab shows the authoritative route plus this
coexistence state; the HUD never switches sources automatically. The selected mode is stored in local
HUD storage; there is no second executable or installer variant.

Shift Light is calculated by the HUD in both modes. It learns per-gear targets
from clean full-throttle upshifts, accepts the game's neutral transition by
elapsed time (bounded to 200 ms and 64 frames), and restores partial evidence as
well as calibrated targets by the internal
`fh6:<ordinal>:<pi>:<rpmMax>` variant key. Its visual brightness is adjustable from 0% to 100%; the
default 80% preserves the original alert intensity without dimming the gear,
speed, or RPM text. The control lives with its diagnostics in the `SHIFT LIGHT`
tab. Purple shift cues latch immediately for at least 250 ms and use the bounded
RPM-rate lead for both observed and optimal profiles. Profiles are stored in a
HUD-local `hud.sqlite` under the Windows AppData directory, never in the
provider's `runtime/data` database. The schema separates `Car` (`gameId` plus
`carOrdinal`), tune/gearbox `Variant` (`PI` plus `RPM max`), and bounded per-gear
learning evidence. A car and variant are registered on the first valid packet,
before calibration is complete. After enough adjacent ratios are confirmed,
the HUD adds a bounded, quantized gearbox signature to the variant, extends it
when higher-gear evidence becomes reliable, and only activates observed,
partial, or optimal evidence with a matching signature. Reset also clears the
provisional unsigned evidence for the same car variant.
The `SHIFT LIGHT` tab listens to HUD-local events for the current per-gear table and the
reset action clears the active variant and its unsigned provisional companion. The provider no longer sends a
`shift_light` WebSocket message or owns Shift Light persistence.
Pause packets and temporary telemetry gaps keep the last car and per-gear table
available in Configuration while clearing only the in-progress pull. Reset is
acknowledged after the HUD-local SQLite operation completes, so it remains
usable while Forza is paused.

The checked-in `overlay/shift-light-engine.js` is generated from
`apps/co-driver/app/utils/shift-light.ts` with the root command
`.\scripts\build-shift-light-bundle.ps1`; it is the browser bundle used by
the standalone HUD. Its learner behavior is covered by
`overlay/shift-light-engine.test.js`.

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

At a game-reported lap boundary, co-driver sends the immutable finish result
separately:

```json
{
  "type": "lap_complete",
  "lapComplete": {
    "lapNumber": 11,
    "lapTimeMs": 51250,
    "referenceTimeMs": 50000,
    "deltaMs": 1250,
    "sourceSessionId": 29,
    "timeSource": "forza_lap_last"
  }
}
```

This `deltaMs` is a `REFERENCE DELTA` against the stored reference lap, not the
game's displayed Rivals time.

Supported cue kinds are `brake_late`, `brake_early`, `release_late`,
`apex_too_fast`, `apex_too_slow`, `throttle_late`, `throttle_early`, and
`good`. If `available` is not `true` and no short post-lap summary is active,
the HUD hides the Coach and lap-delta strip and keeps the ordinary HUD. The HUD
does not derive advice from raw telemetry.

The Coach shows one phase-specific action at a time: brake on approach, release
brake on entry, apex guidance at the apex, and throttle pickup on exit. Reference
and observed pedal points remain provider data but are not displayed as raw
lap-relative coordinates in the in-game card. The browser demo covers the same
states:

```text
?demo=1&reference=brake-late
?demo=1&reference=release
?demo=1&reference=apex-slow
?demo=1&reference=throttle-late
?demo=1&reference=good
?demo=1&reference=summary
```

When reference data is available, the separate `REFERENCE DELTA` strip shows
only `lapDeltaMs`:
positive values are slower and move left into the red zone; negative values are
faster and move right into the green zone. The visual range is limited to ±1 s,
and missing live deltas stay neutral. A `lap_complete.deltaMs` value replaces
the rolling value after the finish. The Coach does not use the local corner
`deltaMs` as a second performance color; its color is reserved for the current
instruction. `targets` and `observed` remain in the provider contract and are
not recomputed from telemetry.

To preview the short post-lap state in a browser, add `lapSummary=1`, for example:

```text
?demo=1&reference=good&lapSummary=1
```

## Development workflow

- Suite development and end-to-end commits use the monorepo `main` branch.
- `release` is the single supported Cargo profile for runnable HUD builds.
- Do not add custom `develop` or `preview` Cargo profiles. Use browser demo mode
  for visual previews and Cargo's standard `debug` profile only for temporary
  diagnostics.
- The release build uses the same local provider endpoint; build profiles are
  not Git branches or runtime channels.

## Local dependency

Choose `Direct Forza` in `Configuration > SETTINGS` to run without Docker or co-driver. Choose
`co-driver Suite` to use `ws://127.0.0.1:3001/_ws` and the provider's analysis
features. In Direct mode the HUD periodically probes the Suite WebSocket only
for its immediate `forza_status`, closes the probe immediately after that
snapshot, and ignores every other message. The `SETTINGS` tab reports whether
co-driver is also online or receiving Forza packets; probe data never enters the HUD telemetry
pipeline. The overlay owns its Shift Light
learner and local profile database; it does not read the provider database or
duplicate provider corner/Coach analysis.

From the Suite root:

```powershell
.\scripts\up.ps1
```

The live browser preview uses the same endpoint without a channel parameter:

```text
http://127.0.0.1:8765/index.html
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

Optimized HUD build from the Suite root:

```powershell
.\scripts\build-hud.ps1
```

The executable selects `ws://127.0.0.1:3001/_ws`.

The executable is written to:

```text
src-tauri/target/release/forza-horizon-6-hud.exe
```

Cargo's standard `target/debug` output is reserved for temporary technical
diagnostics. Only `target/release/forza-horizon-6-hud.exe` is handed off for
game testing; generated target output is never committed. Before handoff,
launch that exact release executable and confirm it remains alive for at least
five seconds—a successful Cargo build alone does not validate Tauri startup.
