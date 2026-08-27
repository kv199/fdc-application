# fdc-application

## Forza Horizon 6 HUD

A lightweight, always-on-top telemetry overlay for Forza Horizon 6.

The application renders tire temperatures, throttle and brake input, steering,
the current gear, and input history over the game. It receives FH6 Data Out
directly over UDP 5301 and owns the telemetry path locally.

This is the standalone `fdc-application` repository. The local folder remains
`50-59_2026_FDC_PRN`; `fdc-application` is the logical product and future Git
repository name. The application owns its overlay, native Tauri runtime, Direct
UDP receiver, Asphalt Coach, Shift Light, recording path, analysis path, and
local SQLite profile storage.

The product name is **FDC**, expanded as **Feedback-Driven Companion**. The
initial platform is Windows PC and the initial game is Forza Horizon 6. FDC is
a local-first telemetry, HUD, and driving-feedback application.

## Asphalt Zero-reference Driving Coach

The Coach is **Asphalt only**. It is a current-run, zero-reference technique
assistant for Road, Street, Rivals, Circuit and Sprint asphalt events. The HUD
does not classify Dirt or Cross Country from telemetry; the driver must use it
only for asphalt. It does not attempt to infer an ideal line, a track identity,
or a single driving score.

Forza Data Out is decoded by the native UDP receiver and enters the normalized
`queueTelemetry` path. The state machine and findings remain local and
transport-independent. It observes the bounded lifecycle `STRAIGHT → BRAKING → TURN-IN → ROTATION → EXIT`
without a map. A session-scoped observed car envelope is calibrated in fixed
speed bins with bounded rolling percentile evidence. Each bin becomes ready only
after enough eligible local evidence; learned bins are then held stable, while
an unseen speed range remains silent and continues calibrating. Acceleration
rates use a bounded three-frame median, so ordinary FH6 frame noise does not
become a hard calibration failure. Repeated packets from one FH game-clock tick
are coalesced without advancing evidence time, and the latest normalized sample
is retained for the next tick. Obvious failure signatures, rumble/puddle
contact, four-wheel full suspension extension, and local transient outliers are excluded from calibration; the
collision gate compares each axis with the learned per-speed-bin noise profile
instead of using a fixed global jerk cutoff. A confirmed retry starts a new
finding attempt but keeps the bounded envelope for the same car; the envelope
is discarded on an incompatible car identity or direct receiver restart. It is not
written to `fdc.sqlite`.

After enough valid evidence, one high-confidence cue may appear briefly. The
first version covers `FRONT SCRUB`, `EXIT WHEELSPIN`, `BRAKE + STEERING
OVERLOAD`, and `ABRUPT BRAKE RELEASE`, plus positive `CLEAN EXIT` and
`CONTROLLED RELEASE` evidence. It stays silent on straights, before
calibration, paused/menu or rewound telemetry, gaps, rumble/puddle contact, and
conservative lateral, longitudinal, and vertical transient gates for jumps or
impacts. A cue's confidence is calculated from the minimum of independent
evidence components: local speed-bin percentile/rank for steering, slip and
load, measured response loss, and sustained evidence duration. A borderline
signal therefore remains below the cue gate; no finding receives a fixed
confidence constant. It does not
show exact metres, seconds, late-throttle claims, wrong-apex/line claims, or
optimal gear advice.

FDC keeps the game clock visible and shows `ASPHALT COACH · LEARNING` or
`ASPHALT COACH · READY` while no cue is active, so silence is distinguishable
from an unavailable Coach. Live cue instructions may wrap instead of being
truncated by the compact card.

At a confirmed attempt finish, the same card shows a compact `DRIVER BRIEF ·
ASPHALT` for about 25 seconds:

```text
DRIVER BRIEF · ASPHALT
MAIN HABIT — recurring finding + evidence count
STRONG — one demonstrated positive pattern
NEXT RUN — one focused technique instruction
```

The standard FH Dash packet has no dedicated sprint-finish flag and
`isRaceOn=false` also covers pause and menus. When a valid Direct attempt leaves
live telemetry without an authoritative result, the card therefore shows `RUN
CHECK · NOT FINAL`: the same current-run technique evidence, labelled `CURRENT
PATTERN`, `CURRENT STRENGTH`, and `FOCUS`, without claiming a finish or official
time. Resuming the same run hides the check and preserves
its evidence; a confirmed retry keeps the learned same-car envelope, resets the
attempt counts, and carries the selected focus forward. Ordinary multi-lap
boundaries do not show a full brief; `HudLapTiming` remains the only official
time authority. Reference-track comparison and exact time-loss calculations are
outside this local-first Coach. `EXCESSIVE COAST` is intentionally
outside this first version because it cannot yet be separated reliably from
correct front-axle recovery.

The checked-in `overlay/asphalt-coach-fixtures.js` contains rounded,
coordinate-free grounded and airborne segments derived from saved FH6 replays.
Automated tests use the responsive grounded braking turn as a non-empty negative
replay and the airborne segment to verify contact-loss exclusion, alongside
strong and borderline synthetic episodes. A passing test run proves the
normalized telemetry path and the confidence gate; it does not prove live
Forza behavior or classify road surface from telemetry.

The Coach card, lap timer, and telemetry HUD are independently movable
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
tab controls the displayed speed unit (`km/h` by default or `mph`), Direct Data
Out endpoint, and receiver lifecycle state; no route status is drawn over the
in-game HUD.
Display and visibility choices are stored locally. In a browser preview, use
`?demo=1&coach=front-scrub` to preview the zero-reference cue,
`?demo=1&coach=run-check` to preview the non-final report, or
`?demo=1&coach=brief` to preview the finish brief. The available Coach demos
are `calibrating`, `ready`, `front-scrub`, `exit-wheelspin`, `brake-overload`,
`abrupt-release`, `clean-exit`, `controlled-release`, `brief`, `run-check`, and
`focus`.

The lap clock is based on the FH6 game clock. It uses `lap.current` for the live
clock, preserves the last useful value during pause or telemetry gaps, and
recognizes circuit and sprint completion from the normalized UDP packet fields.
The RPM preview can be combined with any local Coach demo, for example
`?demo=1&signal=shift&coach=front-scrub`. In demo mode, keys `1`–`3` select the
RPM signal.

## Direct Data Out and Shift Light

The release executable has one runtime flow:

```text
Forza Horizon 6 → UDP 5301 → FDC → HUD / Recording / Analysis
```

FDC binds `127.0.0.1:5301`, decodes FH6 Data Out packets locally, and sends
each valid packet through the normalized `queueTelemetry` path. Configuration
shows the Direct Data Out endpoint and receiver state. It reports only receiver
startup/bind errors, missing packets, or an incompatible packet format.

Shift Light is calculated by FDC from the Direct Data Out stream. It learns per-gear targets
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
FDC-local `fdc.sqlite` under the Windows AppData directory. The schema separates `Car` (`gameId` plus
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
The `SHIFT LIGHT` tab listens to FDC-local events for the current per-gear table;
the reset action clears the active numeric variant and its provisional companion.
Pause packets and temporary telemetry gaps keep the last car and per-gear table
available in Configuration while clearing only the in-progress pull. Reset is
acknowledged after the HUD-local SQLite operation completes, so it remains
usable while Forza is paused.

The checked-in `overlay/shift-light-engine.js` is the self-contained browser
bundle used by FDC. Its learner behavior is covered by
`overlay/shift-light-engine.test.js`.

## Development workflow

- `main` is the only permanent branch in this standalone repository.
- The repository is mirrored to the private GitHub repository
  `https://github.com/kv199/fdc-application`; `main` is the only permanent branch.
- `release` is the single supported Cargo profile for runnable HUD builds.
- Do not add custom `develop` or `preview` Cargo profiles. Use browser demo mode
  for visual previews and Cargo's standard `debug` profile only for temporary
  diagnostics.
- Build profiles are not Git branches or runtime channels.

## Runtime and development

FDC always starts the Direct Data Out receiver on `127.0.0.1:5301`. The overlay
owns its Shift Light learner, recording path, and local profile database. The
Asphalt Coach is HUD-owned, bounded, current-run analysis over normalized FH6
telemetry.

From the project root:

```powershell
cargo run --release --locked --manifest-path src-tauri/Cargo.toml
```

The live browser preview can be served locally at:

```text
http://127.0.0.1:8765/index.html
```

For a visual-only layout check, use:

```text
http://127.0.0.1:8765/index.html?demo=1&edit=1
```

Use `?demo=1` only for offline visual previews; omit it when checking live
telemetry.

## Steering wheel assets

Steering wheel artwork lives in `overlay/assets/steering-wheels/`. Each asset is
a self-contained SVG with a `140 x 140` viewBox, a transparent background, and
its rotation pivot at `(70, 70)`. The neutral marker must point to 12 o'clock.

The active asset is selected in `overlay/overlay.js`; adding a new SVG does not
require changes to telemetry or the Tauri layer.

## Build

Optimized standalone build from the project root:

```powershell
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
```

The executable is written to:

```text
src-tauri/target/release/fdc-application.exe
```

Cargo's standard `target/debug` output is reserved for temporary technical
diagnostics. Only `target/release/fdc-application.exe` is handed off for game
testing; generated target output is never committed. Before handoff, launch
that exact release executable and confirm it remains alive for at least five
seconds—a successful Cargo build alone does not validate Tauri startup.
