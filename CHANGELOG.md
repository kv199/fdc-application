# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

### Fixed

- **Driver Analysis**: corner statistics now show how much of the cornering
  time the front and rear tires spent above 100% slip, the level at which the
  in-game tire friction telemetry turns red, instead of a front-versus-rear
  comparison that read above 90% for almost every recording.

### Added

- **Events**: the lap map of a saved run is larger and draws the track
  outline with Throttle, Brake, Coast, and Slip layers. A legend below the map
  shows each layer's share of lap time and lets you show one layer or any
  combination. Hovering the trace shows the recorded speed, gear, RPM, pedals,
  steering, acceleration, and per-wheel slip, tire temperature, suspension
  travel, curb, and puddle values at that point. Laps recorded before this
  version show the pedal layers only.
- **Driver Analysis**: a recording now keeps going when you change cars and
  shows one card per recording with a line for each car. DETAILS lists the cars;
  each car has its own result, statistics, and a table of its races with type
  (circuit laps or sprint), duration, start time, and error count. Recordings
  also use about half the disk space.

### Improved

- **Driver Analysis**: the Front scrub description now spells "tires" like the
  rest of FDC.

## 7.16.48 - 2026-09-25

First public release of FDC.

- **HUD**: tire temperatures, throttle and brake, steering, gear, speed and
  RPM, boost, power and torque, and an eight-second input graph, in one panel
  or as freely placed blocks.
- **Shift Light**: per-gear shift points learned for each car and tune, with a
  red approach cue and a purple optimal shift cue.
- **Events**: a local event library with run recording, lap and sector times,
  top-down traces, and a live Delta against the fastest saved run.
- **Driver Analysis** (beta): recorded asphalt sessions that report the
  dominant recurring problem.
- **Garage**: automatic vehicle library with class, PI, and drivetrain
  configurations.
