# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

### Fixed

- **Shift Light**: wheelspin on full throttle is no longer mistaken for the
  rev limiter. On powerful cars it could set the learned limit hundreds of RPM
  too low and light the shift cue far too early. Such false readings are now
  dropped once the engine revs well past them. If a car's cue still comes
  early, reset its calibration in the Shift Light tab.
- **Shift Light**: shifting right after the engine bounced off the rev limiter
  no longer teaches a shift point below the limiter. Power is reduced for a
  moment after each limiter cut, which made the next gear look stronger; such
  shifts are now ignored. Reset the calibration of a car that learned a shift
  point this way.
- **HUD**: the purple shift cue is no longer hidden by the red limiter flash
  when Shift Light has learned a shift point for the gear but not yet the
  car's limiter; red now waits until RPM passes that shift point.
- **Shift Light**: the shift cue comes on at a steady point that follows how
  fast the engine revs, instead of switching between two lead values on every
  other telemetry frame.

### Added

- **Shift Light**: shift points are now worked out from the engine's power
  curve and the car's gear ratios, so the cue can ask for an earlier shift
  than you have tried yourself. On a car whose power falls well before the
  limiter, a few full-throttle runs through the gears are enough. Your real
  shifts check each point, and the old learning takes over for a gear where
  they disagree. The Shift Light tab now lists each gear with its shift point
  and **READY** or **LEARNING**.
- **Shift Light**: FDC now keeps your last drives, about one hour and at
  most 200 MB, in `fdc-lab.sqlite` next to its other data, so Shift Light can
  be checked against real drives. The file stays on your computer; share a
  copy only if you want to send drives for feedback.

### Improved

- **Shift Light**: shift points now also appear for the low gears of powerful
  cars. Gear ratios are taken from how fast the driven wheels turn, so
  wheelspin no longer hides them.

## 7.37.101 - 2026-10-19

This release lets you edit the HUD over a running game, adds sector results
to Delta and a Theoretical Best to Events, saves Event laps as you drive,
makes the maps zoomable, and gives FDC a new look, FDC Dark. Your data and
settings carry over unchanged.

### Fixed

- **Driver Analysis**: a race's drive now begins at the race start instead of
  including the free roam before it, cars only shown on car-selection screens
  no longer appear in a recording, and the hotkey accepts Ctrl, Alt, or Shift
  with a number key and letter keys on any keyboard layout.

### Added

- **HUD**: edit the HUD layout over a running Forza without pausing it. Press
  the in-game edit hotkey, `Ctrl + Shift + F8` by default, drag or resize any
  enabled block, Delta, or the Shift Bar, and press the hotkey again to save;
  **CANCEL** puts everything back. While you drag, blocks snap to an alignment
  grid, which **GRID ON** turns off. The HUD tab is simpler and the same in
  Grouped and Freeform: **EDIT LAYOUT**, **RESET LAYOUT**, the hotkey, and one
  **WIDGETS** list.
- **Delta**: three sector results under the Delta bar show how much faster or
  slower each third of the lap was than the reference: green when faster,
  yellow when slower, and purple for the Event's best time in that sector.
  They stay on screen until the first sector of the next lap is done.
- **Events**: **THEORETICAL BEST** replaces Absolute Best: the sum of the
  Event's best three sectors, with the run, lap, and car each one came from.
  **VIEW SECTOR**, the sector times in the lap table, and **SECTOR 1–3** on a
  lap map highlight one sector with its distance and its throttle, brake,
  coast, and slip shares; **FIT SECTOR** zooms to it. Each run shows its own
  Theoretical Best too.
- **Events**: circuit laps are saved as each one is completed, so closing FDC
  no longer loses a session. The Event page updates during the session and
  marks the run being recorded **LIVE**. After a Sprint finish, **STOP** waits
  up to five seconds for the game's result; a time taken from the last live
  race time is shown with `~`.
- **Events** and **Driver Analysis**: maps can be zoomed and moved. Scroll to
  zoom around the pointer, drag to move, double-click to zoom in, or use
  **+**, **−**, and **FIT**.
- **HUD**: a new **Shift Bar** widget, off by default: a slim row of triangles
  above the HUD that fills green as RPM climbs to the shift point, then
  flashes red or purple together with the Gear block.
- **Settings**: **HUD RENDERING** draws the HUD with the graphics card or the
  processor. Choose **CPU** if the HUD lags behind the game while Forza fully
  loads the graphics card, for example with an uncapped frame rate; it costs
  some FPS. The change applies after FDC restarts.
- **Design**: FDC has a new look, Settings is grouped
  into **WINDOW & EXIT**, **HUD BEHAVIOR**, and **UNITS**, and the Garage
  lists observed variants in their own panel.

### Improved

- **Shift Light**: the rev limiter is now learned for almost every car, so
  the red limiter flash and the purple cue use the car's real limiter instead
  of the game's RPM limit, which many engines never reach. Before the first
  limiter hit FDC estimates it at 89% of the game's limit, uses the first hit
  right away, and confirms it after three matching hits, shown in **LEARNED
  CEILING**.
- **Performance**: FDC uses less processor time while you drive. The HUD only
  redraws what changed, the map **POINT DATA** panel updates at most once per
  screen refresh, and with **HUD RENDERING** on **CPU** the HUD window covers
  only its blocks, which costs far less graphics card time.
- **Driver Analysis**: while a recording is exported, its button reads
  **EXPORTING…** with a moving bar, and a finished export is reported in green
  with its size.

## 7.24.67 - 2026-10-06

### Fixed

- **Driver Analysis**: a recording's distance and average speed no longer
  come out wrong after online races, where the average could exceed the top
  speed. Saved recordings are corrected the next time FDC starts.
- **Driver Analysis**: online races no longer add short phantom sprint drives
  at the start; the race is recorded as one drive from its first second.
- **Driver Analysis**: online circuit races that reach the finish are now
  saved as finished with all their laps instead of unfinished and one lap
  short.
- **Driver Analysis**: resetting the car to the track during a race no longer
  ends the drive; the rest of the race stays in the same drive.

### Improved

- **Delta**: the Delta strip now appears only while recording with a known
  reference (immediately for an Event with a saved Absolute Best trace; from
  the second circuit lap or the next Sprint attempt for a new Event). The Event
  page's Absolute Best time updates silently as Delta accepts a faster result,
  before the run is saved.

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
