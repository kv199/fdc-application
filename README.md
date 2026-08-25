# Forza Horizon 6 HUD

A lightweight, always-on-top telemetry overlay for Forza Horizon 6.

The application renders tire temperatures, throttle and brake input, steering,
the current gear, and input history over the game. It can consume the local
WebSocket telemetry stream exposed by [co-driver](https://github.com/Ojansen/co-driver)
or receive FH6 Data Out directly over UDP.

This directory is the HUD application inside Forza Horizon 6 Suite. It remains
self-contained so it can be exported and published as a standalone repository,
while the Suite root owns local runtime startup and end-to-end workflow.

## Asphalt Zero-reference Driving Coach

The Coach is **Asphalt only**. It is a current-run, zero-reference technique
assistant for Road, Street, Rivals, Circuit and Sprint asphalt events. The HUD
does not classify Dirt or Cross Country from telemetry; the driver must use it
only for asphalt. It does not attempt to infer an ideal line, a track identity,
or a single driving score.

Direct Forza UDP and co-driver Suite normalized telemetry enter the same
`queueTelemetry` path, so the state machine and findings are source-neutral. It
observes the bounded lifecycle `STRAIGHT → BRAKING → TURN-IN → ROTATION → EXIT`
without a map. A session-scoped observed car envelope is calibrated in fixed
speed bins with bounded rolling percentile evidence. Once the minimum envelope
is ready, that car-local profile is held stable for the session so a bad corner
cannot train its own threshold. It is discarded on restart, rewind, source
switch, or incompatible car identity. It is not written to `hud.sqlite`.

After enough valid evidence, one high-confidence cue may appear briefly. The
first version covers `FRONT SCRUB`, `EXIT WHEELSPIN`, `BRAKE + STEERING
OVERLOAD`, and `ABRUPT BRAKE RELEASE`, plus positive `CLEAN EXIT` and
`CONTROLLED RELEASE` evidence. It stays silent on straights, before
calibration, paused/menu or rewound telemetry, gaps, rumble/puddle contact,
and conservative vertical-transient gates for jumps or impacts. It does not
show exact metres, seconds, late-throttle claims, wrong-apex/line claims, or
optimal gear advice.

At a confirmed attempt finish, the same card can show a compact
`DRIVER BRIEF · ASPHALT` for about 25 seconds:

```text
DRIVER BRIEF · ASPHALT
MAIN HABIT — recurring finding + evidence count
STRONG — one demonstrated positive pattern
NEXT RUN — one focused technique instruction
```

The next live attempt hides the brief immediately and keeps its selected focus
for cue arbitration. Ordinary multi-lap boundaries do not show a full brief;
`HudLapTiming` remains the only finish authority. Historical/reference track
comparison and exact time-loss calculations remain provider-owned features and
are not used by this zero-reference Coach. `EXCESSIVE COAST` is intentionally
outside this first version because it cannot yet be separated reliably from
correct front-axle recovery.

The Coach card, lap-delta strip, and telemetry HUD are independently movable
overlay targets. The HUD icon's tray menu opens `Configuration`; the window is
shown automatically on the first launch and hides to the tray when closed.
Use `EDIT` in Configuration, drag the selected target in the overlay, then press
`SAVE` in Configuration or on the target itself. Closing Configuration during an edit
cancels the uncommitted position. Positions are stored locally and clamped to
the primary monitor. Configuration is the only layout entry point in the native HUD.

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
`?demo=1&coach=front-scrub` to preview the zero-reference cue, or
`?demo=1&coach=brief` to preview the finish brief. The available Coach demos
are `calibrating`, `front-scrub`, `exit-wheelspin`, `brake-overload`,
`abrupt-release`, `clean-exit`, `controlled-release`, `brief`, and `focus`.

The historical Reference Coach can still be previewed without Forza in demo mode:

```text
?demo=1&reference=brake-late
?demo=1&reference=release
?demo=1&reference=apex-slow
?demo=1&reference=throttle-late
?demo=1&reference=good
```

Reference messages remain a separate Suite historical layer. If no local
Asphalt cue is active, the existing provider reference guidance remains
visible in the same Coach card; a local Asphalt cue takes presentation
priority. The zero-reference analysis never consumes a reference cue or
reconstructs provider history. A provider `lap_complete` message still
anchors the existing final delta to the game's lap boundary; it does not by
itself create an Asphalt Coach brief while the car is live.

The lap clock is source-neutral and game-clock based. Direct and Suite telemetry
both use `lap.current` for the live clock, preserve the last useful value during
pause/stale packets, and reset volatile timing state when the source changes.
Suite `lap_complete.timeSource=forza_lap_last` represents a circuit boundary;
`forza_lap_current` represents a validated point-to-point completion. The HUD
does not infer a sprint finish from `isRaceOn=false` alone: an advancing
`LastLap` is authoritative, while a CurrentLap-only finish needs the same
non-live value twice and is cancelled if live driving resumes. The Asphalt
Coach uses that existing `HudLapTiming` result in both Direct and Suite modes.

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
track corners; that historical context is separate from the map-free Asphalt
Coach technique state.

## Telemetry sources and Shift Light

The release executable has one universal build with two explicit source modes
in `Configuration > SETTINGS`:

- `Direct Forza` binds `127.0.0.1:5301`, decodes FH6 Data Out packets locally,
  and works without Docker or co-driver. It renders the compact telemetry HUD
  and HUD-owned Shift Light. The same Asphalt-only zero-reference Coach runs
  locally after the normalized Direct frame.
- `co-driver Suite` connects to `ws://127.0.0.1:3001/_ws` and preserves the
  normalized telemetry path. The same Asphalt Coach runs after the WebSocket
  frame; provider-owned historical reference/corner context remains separate.
  The HUD does not bind UDP in this mode.

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
`fh6:<ordinal>:<pi>:<rpmMax>` base vehicle identity. SQLite assigns each
resolved gearbox an immutable numeric `variantId`; ratio drops are matching
features, not a changing database key. Its visual brightness is adjustable from 0% to 100%; the
default 80% preserves the original alert intensity without dimming the gear,
speed, or RPM text. The control lives with its diagnostics in the `SHIFT LIGHT`
tab. Purple shift cues latch immediately for at least 250 ms and use the bounded
RPM-rate lead for both observed and optimal profiles. Profiles are stored in a
HUD-local `hud.sqlite` under the Windows AppData directory, never in the
provider's `runtime/data` database. The schema separates `Car` (`gameId` plus
`carOrdinal`), base tune identity (`PI` plus `RPM max`), immutable numeric
gearbox `Variant` IDs, and bounded per-gear learning evidence. A car and its
provisional variant are registered on the first valid packet, before
calibration is complete. After enough adjacent ratios are confirmed, the HUD
matches compatible ratio features with tolerance and updates the resolved
variant row without changing its ID. Higher-gear evidence extends the same
variant; a material contradiction creates another variant; ambiguous matches
remain provisional. Provisional partial evidence is merged transactionally,
and monotonic persistence never replaces calibrated or stronger evidence with
weaker data. Reset targets the active numeric variant and clears the same
base vehicle's provisional evidence without deleting other variants.
The `SHIFT LIGHT` tab listens to HUD-local events for the current per-gear table and the
reset action clears the active numeric variant and its provisional companion. The provider no longer sends a
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

## Historical Reference contract (Suite context)

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

Supported provider cue kinds are `brake_late`, `brake_early`, `release_late`,
`apex_too_fast`, `apex_too_slow`, `throttle_late`, `throttle_early`, and
`good`. These remain historical/reference context for the Suite delta and
corner surfaces. They are not reinterpreted as Asphalt zero-reference cues,
and the HUD does not derive reference advice from raw telemetry.

Reference and observed pedal points remain provider data and are not displayed
as raw lap-relative coordinates in the Asphalt Coach card. The historical demo
states remain available for the separate Suite context:

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

To preview the historical short post-lap state in a browser, add `lapSummary=1`,
for example:

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
pipeline. The overlay owns its Shift Light learner and local profile database;
it does not read the provider database or duplicate provider historical
reference analysis. The Asphalt Coach itself is HUD-owned, bounded, current-run
analysis in both source modes.

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
