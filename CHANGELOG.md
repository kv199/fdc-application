# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

## 7.24.62 - 2026-10-05

### Added

- **HUD**: **HUD DISPLAY** on the HUD tab chooses which monitor the HUD covers,
  and FDC remembers it. Moving the HUD to another monitor with Win+Shift+Arrow
  now fills that whole monitor.
- **Configuration**: until Forza has sent data once, FDC opens on a
  **CONNECT FORZA HORIZON 6** screen that shows the Data Out settings to enter
  in the game, `127.0.0.1` and port `5301`, and switches to **CONNECTED** as
  soon as data arrives.

### Improved

- **Configuration**: the X button now quits FDC after asking **QUIT FDC?**;
  minimize the window to keep the HUD running. From the second quit on, the
  question offers **Don't ask again**, and **CONFIRM BEFORE QUITTING** in
  Settings turns it back on. A recording in progress always asks.

## 7.22.61 - 2026-10-02

### Fixed

- **Garage**: renaming a car now also updates an open Event run and no longer
  breaks an open Driver Analysis car or drive page.
- **Configuration**: slider titles line up with their value and RESET again,
  and every "nothing here yet" message now uses the same framed style.

### Added

- **Driver Analysis**: **EXPORT** on a recording saves it with its telemetry
  and analysis to one file that you can attach to a bug report when a result
  looks wrong. The file contains no personal data.
- **Settings**: a separate **Distance unit** (km or mi) joins the speed unit,
  and both now apply to Events and Driver Analysis as well as the HUD.
- **Configuration**: **HELP** at the bottom of the window opens the bug report
  form with your version filled in, GitHub Discussions for ideas, or Q&A for
  questions. Click the version to copy it.

### Improved

- **Configuration**: deleting an Event or a Driver Analysis recording now asks
  **ARE YOU SURE?** with **NO** selected; Escape or a click outside the
  question keeps everything. On a Driver Analysis recording, **DETAILS** now
  sits above **EXPORT** and **DELETE**.
- **Shift Light**: **RESET CURRENT CALIBRATION** now asks **ARE YOU SURE?**
  first, and never resets another car if you switch cars while it asks.
- **Garage**: a car is shown the same way everywhere — by its Garage name, or
  by its car number when it has no name — and renaming it updates Events,
  Driver Analysis, and Shift Light right away.
- **Configuration**: tabs are now ordered HUD, Events, Driver, Shift Light,
  Garage, Settings, and each tab opens with a short explanation of what it
  does, with fewer technical labels and clearer empty-state hints.
- **Settings**: the note that all FDC data stays on this PC is now part of the
  tab's intro instead of looking like a setting.

## 7.19.55 - 2026-09-30

### Fixed

- **HUD**: in Freeform layout, **EDIT** no longer hides the block you are
  moving while **Show HUD with telemetry** is on and the game is in a menu.

## 7.19.54 - 2026-09-27

### Fixed

- **Driver Analysis**: corner stats now show time above 100% tire slip
  instead of a misleading front-vs-rear number.

### Added

- **Events**: bigger lap map with Throttle, Brake, Coast, and Slip layers.
  Hover the trace to see speed, gear, pedals, and tire data.
- **Driver Analysis**: one recording can now include several cars. Each race
  is detected automatically and has its own map showing where you made
  mistakes.

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
