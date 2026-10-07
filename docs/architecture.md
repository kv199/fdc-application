# FDC Architecture

This document is the map of the current FDC runtime. Detailed behavior belongs
in the feature documents for [Garage](garage.md), [Driver Analysis](driver-analysis.md),
[Shift Light](shift-light.md), and [Events](events.md).

## System boundary

Feedback-Driven Companion (FDC) is an independent, unofficial Windows Tauri
application compatible with Forza Horizon 6. The
repository owns the native Direct Data Out receiver and decoder, the browser
overlay, Configuration, lap timing, Delta, Garage, Driver Analysis, Shift Light, Events,
and local HUD profile persistence.

The runtime boundary ends at the local application. The current source of
telemetry is FH6 Data Out over the local UDP endpoint described below.

## Runtime data flow

```text
Forza Horizon 6 Data Out
            |
            v
UDP 127.0.0.1:5301
            |
            v
Native Tauri decoder
            |
            v
Normalized telemetry
            |
            v
queueTelemetry
    |       |          |       |             |                |            |
    v       v          v       v             v                v            v
Telemetry  Lap timing  Delta   Garage    Driver Analysis  Shift Light  Events
HUD                         |             |                  |          |
                            v             v                  v          v
                        fdc.sqlite      fdc.sqlite         fdc.sqlite  fdc.sqlite
```

The native layer emits one normalized telemetry payload for each valid FH6
packet. The browser overlay receives it through the `direct_telemetry` Tauri
event and passes it to `queueTelemetry`. That function fans the sample out to
the HUD renderer, lap timing, Delta, Garage, Driver Analysis, Shift Light, and Events
runtime. The feature branches keep their own state; Garage, Driver Analysis,
Shift Light, and Events write to the local SQLite profile store.

Events uses this same normalized sample rather than the game's result-screen
UI. Its recording logic reads `isRaceOn`, `lap.current`, `lap.raceTime`,
`lap.distance`, `lap.number`, and `lap.last`, plus the normalized vehicle
identity. A result time that Forza displays but does not emit through Direct
Data Out is outside FDC's telemetry boundary and cannot be reconstructed as a
game-reported result.

Connection lifecycle is a parallel status path. The native receiver emits
`direct_status` for waiting, live, stale, offline, and incompatible-packet
conditions. The overlay converts that state into the local route status shown
in Configuration and into the HUD connection state.

## Native layer

The Rust/Tauri process in `src-tauri/` is responsible for application windows,
the tray menu, Direct Data Out, and native persistence commands.

- `start_direct_source` binds `127.0.0.1:5301` and runs the UDP receive loop.
- Only the expected 324-byte FH6 packet is decoded. The decoder converts the
  packet into the normalized camel-case payload used by the browser, including
  vehicle, lap, engine, control, tire, motion, and surface-contact data.
- A valid packet emits `direct_telemetry`. Receiver lifecycle emits
  `direct_status`; a packet gap longer than one second becomes stale.
- Tauri commands control source lifecycle, Configuration, layout and
  visibility, display preferences, Garage and Events operations, Shift Light
  profile operations, Driver Analysis recording/history operations, and reset.
- Garage, Driver Analysis, Events, and Shift Light database commands open `fdc.sqlite` below the Tauri
  application data directory and apply the versioned schema there.
- At startup the HUD window is sized and positioned to cover the saved HUD
  monitor, or the primary monitor. `list_hud_displays` and `set_hud_display`
  list the connected monitors and move the HUD to one of them. When Windows
  moves or rescales the HUD, for example with Win+Shift+Arrow, the window is
  refitted to the monitor its top-left corner is on, and that monitor is saved.
- Closing the Configuration window asks the page before quitting, and
  `quit_app` exits FDC.

The native layer registers the Driver Analysis global recording hotkey (keyboard
or game-controller button via Windows Raw Input) while Driver Analysis is
enabled, and a refused binding does not stop startup. It does not analyze driving
telemetry. The browser consumer operates on normalized telemetry after the IPC
boundary.

## Browser overlay

`overlay/index.html` is the static main-window entry point. It loads the
telemetry route, display preferences, Driver Analysis, lap timing, Delta, layout,
HUD preference, Tauri event, Garage, Shift Light, and overlay modules in dependency
order. The Tauri configuration uses `overlay/` as the frontend distribution.

The main window is a transparent, always-on-top HUD positioned across the
monitor chosen in **HUD DISPLAY**. The browser layer renders the current
telemetry HUD, lap time, Delta, Garage persistence, and Shift Light
presentation. Driver Analysis runs
without a HUD widget and records only when explicitly started. Event
recording initially configures Delta from the saved Event best, then replaces
that reference in memory when a faster completed circuit lap or Sprint result
arrives. Delta reads the existing normalized telemetry stream and the Event's
local best trace rather than a second transport. It schedules visual updates
through `requestAnimationFrame`; the normalized sample remains the shared input
rather than each feature subscribing to the UDP source independently.

The settings window is a separate browser page. It observes route status,
Garage, and Shift Light events, presents the Events library, and invokes native
commands for configuration actions. The tray menu opens Configuration and
quits FDC. Closing the Configuration window asks the page through
`SettingsController.requestQuit`; a confirmed quit calls the native
`quit_app` command.

The Configuration footer shows the build version, which copies `FDC <version>`
to the clipboard when clicked, and a **HELP** menu. Its items call the native
`open_feedback_link` command with a fixed kind (`bug`, `idea`, or `question`);
the native layer maps each kind to a fixed GitHub page, prefilling the bug form
with the build version, and opens it in the default browser through
`tauri-plugin-opener`. The webview has no opener permission and cannot open
arbitrary URLs.

## Garage boundary

Garage is a browser-local `queueTelemetry` consumer with native local
persistence. It records each car ordinal once, records class, performance
index, and drivetrain configurations separately, and refreshes Configuration through the local
`hud_garage` event. Its native snapshot also summarizes the existing Shift
Light profiles with the same car ordinal and PI; both features stay in the
single FDC-local `fdc.sqlite` file. It does not create another telemetry
transport or use a car name service. Its full behavior and SQLite contract are documented in
[Garage](garage.md).

## Vehicle identity and names

The shared `overlay/vehicle.js` module owns the car display-name rule (the
current Garage name, otherwise the car ordinal), the class and drivetrain
labels, and the reader of the normalized telemetry `car` object (`ordinal`,
`class`, `pi`, `carGroup`, `drivetrain`, `cylinders`) used by Garage and
Events. Garage, Events, Driver Analysis, and the Shift Light settings panel
show car names only through that rule. The native layer resolves names only
from `garage_cars.display_name`.

Each feature keeps its own persisted identity key, because each is a storage
contract:

| Feature | Identity |
| --- | --- |
| Garage car | `game_id` + car ordinal |
| Garage variant | car ordinal + class + PI + drivetrain |
| Shift Light | `fh6:<ordinal>:<class>:<pi>:<drivetrain>:<cylinders>` |
| Driver Analysis | `<ordinal>:<pi>:<rpmMax>:<drivetrain>` |
| Event run | car ordinal, class, PI, and drivetrain stored with the run |

## Driver Analysis boundary

Driver Analysis is a browser-local consumer of `queueTelemetry`. Its map-free
state, opportunity, evidence, and scoring modules do not require a network or
track service. Recording is explicit, asphalt-only, and zero-reference. The
browser batches selected normalized samples to native commands; sessions,
samples, opportunities, evidence, and the single selected result are kept in
the local `fdc.sqlite` database until the user deletes that recording.

Driver Analysis uses its own Tauri commands: `create_driver_analysis_session`,
`append_driver_analysis_samples`, `finalize_driver_analysis_session`,
`load_driver_analysis_samples`, `reanalyze_driver_analysis_session`,
`save_driver_analysis_stats`, `load_driver_analysis_sessions`,
and `delete_driver_analysis_session`.
Each recording also stores versioned descriptive statistics of the collected
telemetry next to its result.

The full state machine, evidence gates, supported findings, recording controls,
card layout, history contract, and known limitations are documented in
[Driver Analysis](driver-analysis.md).

## Shift Light boundary

Shift Light spans both layers:

1. The canonical learner, estimator, and telemetry source are TypeScript files
   in `src/shift-light/`.
2. The browser runtime in `overlay/` adapts telemetry to the learner and
   presents the light-bar signal.
3. Tauri commands persist a compact vehicle configuration, limiter samples,
   per-pair targets, and accepted shift comparisons in local `fdc.sqlite`.

The full identity, numeric configuration resolution, learning evidence, target
calculation, visual timing, persistence rules, compatibility constraints, and
verification requirements are documented in [Shift Light](shift-light.md).

## Configuration

Configuration is a local Tauri settings window rather than a second runtime
telemetry path. It provides:

- overlay target editing for Delta and the telemetry HUD. The
  telemetry HUD offers a default `GROUPED` mode that moves and resizes the
  compact panel as one target, and a `FREEFORM` mode that moves and resizes
  Tires, Throttle and Brake, Steering, Gear / Speed / RPM, Engine / Boost, and
  Input Graph independently. Each mode keeps its own layout, while visibility
  and opacity remain shared. Both modes start from the same compact responsive
  arrangement. Reset returns a target to its active-mode default size and
  position;
- a **HUD DISPLAY** monitor selector that moves the HUD to cover the chosen
  monitor and is unavailable during a layout edit;
- visibility controls for the top-level overlay and HUD components, plus a
  `SHOW HUD WITH TELEMETRY` preference that defaults to enabled and shows the
  HUD and Delta only while live samples (`IsRaceOn`) arrive, and hides them
  500 ms after the last live sample. Forza keeps sending samples in menus, and
  some menu states, such as the garage, can still report `IsRaceOn`, so the HUD
  and Delta can briefly or intermittently appear there;
- a Driver Analysis tab with an enable toggle, explicit record/stop control,
  editable global hotkey, beta/asphalt warning, and newest-first history;
- speed-unit selection and separate Redline and FDC Shift Light brightness;
- standard minimize and maximize controls, a persisted Configuration
  always-on-top preference that defaults to disabled, and a persisted window
  size (default `820 × 620` logical pixels) and last valid on-screen position;
- a close button that quits FDC after **QUIT FDC?**. **Don't ask again** is
  offered from the second confirmed quit and turns off the persisted
  **CONFIRM BEFORE QUITTING** preference; a Driver Analysis or Event recording
  in progress always asks;
- Garage current-car and saved-car views, including local name editing and the
  current car's configuration list;
- the Events library with local event creation, management, and run records;
- the Direct Data Out status in the header, which opens the setup screen
  below when selected;
- a **CONNECT FORZA HORIZON 6** setup screen that covers Configuration while
  FDC has never received Data Out. It is skipped when the persisted
  `fdc.connection-guide.v1` flag is set or the Garage already has a car, shows
  the Data Out steps with `127.0.0.1` and `5301`, and follows the route
  status: waiting, **CONNECTED** with **START USING FDC**, or a receiver problem
  with **RETRY DATA OUT**. The first live status sets the flag; **SKIP FOR
  NOW** or Escape closes it until the next launch. Selecting the header status
  opens it again at any time;
- current Shift Light diagnostics and reset.

Layout, visibility, and display choices are kept in versioned browser storage
keys (`fdc.layout.v2`, `fdc.layout-mode.v1`, `fdc.hud-visibility.v1`,
`fdc.overlay-visibility.v1`, `fdc.display-preferences.v1`,
`fdc.quit-confirmation.v1`, and `fdc.connection-guide.v1`). The prior
`fdc.layout.v1` position is intentionally not migrated. Commands that affect
the native window or Shift Light database cross the Tauri IPC boundary.

## Local persistence

`fdc.sqlite` is created in the FDC application-data directory, outside the
repository. Its current schema contains the Garage car and configuration
registries; four Shift Light tables for configuration identity, limiter
samples, per-pair targets, and accepted comparisons; Events tables; Driver
Analysis sessions, samples, opportunities, and evidence; and schema version
metadata. Transactional native commands enforce Garage recency and
Shift Light identity. Shift Light replaces one bounded compact calibration per
configuration, skips writes for unchanged snapshots, and retries failed writes
in memory with bounded backoff. Reset invalidates stale writers.

Lap timing state and HUD telemetry history remain in memory. Driver Analysis
keeps only its enable state and hotkey in versioned browser storage; its
recordings and results live in `fdc.sqlite`. Configuration and layout preferences use the versioned local browser storage
keys listed above. The Configuration window size and last valid on-screen
position are stored separately in the FDC application-data directory so a
user-resized and moved window is restored on the next launch. A saved position
outside the available monitors is ignored. The HUD monitor is stored in the
same directory as its Windows name, physical position, and size; the position
and size identify it when the name no longer matches.

## Generated assets

The browser overlay is served as checked-in static files. Shift Light has an
explicit source/build boundary:

```text
src/shift-light/*.ts
        |
        v
tools/build-shift-light.mjs
        |
        v
overlay/shift-light-engine.js
```

`overlay/shift-light-engine.js` is the self-contained generated browser bundle
consumed by the executable. Node.js, TypeScript, and esbuild are build-time
dependencies only; they are not required by the release executable. The
remaining overlay JavaScript, CSS, HTML, and SVG files are loaded directly from
`overlay/`.

## Current runtime constraints

- The supported runtime is the Windows PC release build on `main`, compatible
  with Forza Horizon 6.
- The Direct Data Out contract is a 324-byte packet received at
  `127.0.0.1:5301`; invalid packet formats are reported instead of being sent
  to feature consumers.
- `queueTelemetry` is the shared browser ingress. Feature code must preserve
  the normalized telemetry contract and must not create a parallel telemetry
  transport.
- Garage, Driver Analysis, and Shift Light are intentionally separate feature boundaries;
  their detailed current behavior and limitations live in their dedicated
  documents.
- The checked-in generated Shift Light bundle is a runtime input. A source move
  or build-tool change must preserve its runtime behavior and compatibility
  contracts.
