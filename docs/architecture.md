# FDC Architecture

This document is the map of the current FDC runtime. Detailed behavior belongs
in the feature documents for [Garage](garage.md), [Asphalt Coach](asphalt-coach.md),
and [Shift Light](shift-light.md).

## System boundary

FDC is a standalone Windows Tauri application for Forza Horizon 6. The
repository owns the native Direct Data Out receiver and decoder, the browser
overlay, Configuration, lap timing, Garage, Asphalt Coach, Shift Light, and local HUD
profile persistence.

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
    |       |          |             |            |
    v       v          v             v            v
Telemetry  Lap timing  Garage         Asphalt      Shift Light
HUD                     |              Coach          |
                        v                             v
                    fdc.sqlite                     fdc.sqlite
```

The native layer emits one normalized telemetry payload for each valid FH6
packet. The browser overlay receives it through the `direct_telemetry` Tauri
event and passes it to `queueTelemetry`. That function fans the sample out to
the HUD renderer, lap timing, Garage, Asphalt Coach, and Shift Light runtime.
The feature branches keep their own state; Garage and Shift Light write to the
local SQLite profile store.

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
  visibility, display preferences, Garage and Shift Light profile operations,
  and reset.
- Garage and Shift Light database commands open `fdc.sqlite` below the Tauri
  application data directory and apply the versioned schema there.

The native layer does not implement Asphalt Coach or the browser HUD
presentation. Those consumers operate on the normalized event after the IPC
boundary.

## Browser overlay

`overlay/index.html` is the static main-window entry point. It loads the
telemetry route, display preferences, presentation, Coach, lap timing, layout,
HUD preference, Tauri event, Garage, Shift Light, and overlay modules in dependency
order. The Tauri configuration uses `overlay/` as the frontend distribution.

The main window is a transparent, always-on-top HUD positioned across the
primary monitor. The browser layer renders the current telemetry HUD, lap time,
Coach card, Garage persistence, and Shift Light presentation. It schedules visual updates through
`requestAnimationFrame`; the normalized sample remains the shared input rather
than each feature subscribing to the UDP source independently.

The settings window is a separate browser page. It observes route status,
Garage, and Shift Light events, and invokes native commands for configuration
actions. The tray menu opens Configuration and provides the application exit
path.

## Garage boundary

Garage is a browser-local `queueTelemetry` consumer with native local
persistence. It records each car ordinal once, records class, performance
index, and drivetrain configurations separately, and refreshes Configuration through the local
`hud_garage` event. Its native snapshot also summarizes the existing Shift
Light profiles with the same car ordinal and PI; both features stay in the
single FDC-local `fdc.sqlite` file. It does not create another telemetry
transport or use a car name service. Its full behavior and SQLite contract are documented in
[Garage](garage.md).

## Asphalt Coach boundary

Asphalt Coach is a browser-local consumer of `queueTelemetry`. Its state,
calibration, findings, lifecycle, and presentation modules do not write to
`fdc.sqlite` and do not require a network or track service. The current
behavioral boundary is asphalt-only, current-run, and zero-reference.

The full state machine, evidence gates, supported cues, reports, and known
limitations are documented in [Asphalt Coach](asphalt-coach.md). This document
only records its position in the system: normalized telemetry in, temporary
browser state and Coach UI out.

## Shift Light boundary

Shift Light spans both layers:

1. The canonical learner, estimator, and telemetry source are TypeScript files
   in `src/shift-light/`.
2. The browser runtime in `overlay/` adapts telemetry to the learner and
   presents the light-bar signal.
3. Tauri commands persist bounded profiles and gearbox variants in the local
   `fdc.sqlite` database.

The full identity, variant resolution, learning evidence, target calculation,
visual timing, persistence rules, compatibility constraints, and verification
requirements are documented in [Shift Light](shift-light.md).

## Configuration

Configuration is a local Tauri settings window rather than a second runtime
telemetry path. It provides:

- overlay target editing for the Coach card, lap timer, and telemetry HUD;
- visibility controls for the top-level overlay and HUD components;
- speed-unit selection and Shift Light brightness;
- Garage current-car and saved-car views, including local name editing and the
  current car's configuration list;
- Direct Data Out status and retry;
- current Shift Light diagnostics and reset.

Layout, visibility, and display choices are kept in versioned browser storage
keys (`fdc.layout.v1`, `fdc.hud-visibility.v1`,
`fdc.overlay-visibility.v1`, and `fdc.display-preferences.v1`). Commands that
affect the native window or Shift Light database cross the Tauri IPC boundary.

## Local persistence

`fdc.sqlite` is created in the FDC application-data directory, outside the
repository. Its current schema contains the Garage car registry and
class/PI/drivetrain configuration registry alongside the Shift Light car registry, gearbox variant
registry, per-gear profiles, bounded profile samples, and schema version
metadata. Transactional native commands enforce Garage identity and recency as
well as Shift Light identity and monotonic merge rules.

The Coach calibration envelope, active findings, lap timing state, telemetry
history, and visual presentation state remain in memory for the running HUD.
Configuration and layout preferences use the versioned local browser storage
keys listed above.

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

- The supported runtime is the Windows PC release build on `main` for Forza
  Horizon 6.
- The Direct Data Out contract is a 324-byte packet received at
  `127.0.0.1:5301`; invalid packet formats are reported instead of being sent
  to feature consumers.
- `queueTelemetry` is the shared browser ingress. Feature code must preserve
  the normalized telemetry contract and must not create a parallel telemetry
  transport.
- Garage, Coach, and Shift Light are intentionally separate feature boundaries;
  their detailed current behavior and limitations live in their dedicated
  documents.
- The checked-in generated Shift Light bundle is a runtime input. A source move
  or build-tool change must preserve its runtime behavior and compatibility
  contracts.
