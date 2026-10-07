# Changelog

All user-facing changes to FDC are listed here, newest release first. The
format and rules are described in [Releasing FDC](docs/releasing.md#changelog).

## Unreleased

### Fixed

- **Hotkeys**: the HUD edit and Driver Analysis hotkeys now accept Ctrl, Alt,
  or Shift with a number key, such as `Ctrl + Shift + 8`, and letter keys on
  any keyboard layout.
- **Driver Analysis**: free roam before a race is no longer included at the
  start of that race's drive, so the drive's start time, duration, and map
  begin at the race start.
- **Driver Analysis**: cars only shown on car-selection screens no longer
  appear as extra cars in a recording; a car that moved no more than 25 metres
  without a race is not saved.

### Added

- **HUD**: move and resize the HUD over a running Forza without pausing it.
  Press the new in-game edit hotkey, `Ctrl + Shift + F8` by default, then
  drag any enabled block or Delta and press the hotkey again to save;
  **CANCEL** puts every block back.
- **HUD**: the HUD tab is simpler and the same in Grouped and Freeform.
  **EDIT LAYOUT** starts one edit of every enabled block, and you pick the
  block to change by clicking it on the screen. **RESET LAYOUT** returns
  every block and Delta to its default place after you confirm. The
  **IN-GAME EDIT HOTKEY** row shows and changes the hotkey, and one
  **WIDGETS** list switches each widget, or every widget with **ALL**.
- **HUD**: the layout edit shows an alignment grid, 4 × 4 zones with a finer
  dot grid measured from the screen center. A dragged block moves dot to dot
  by its top-left corner and centers itself on the middle and quarter lines
  of the screen; resizing never snaps. **GRID ON** on the edit toolbar turns
  the grid off and then reads **GRID OFF**.
- **Design**: FDC has a new look, FDC Dark. Configuration gets a painted
  header with each tab's description and the Data Out status, which opens the
  connection guide when selected; drill-down pages show where you are, such as
  `← EVENTS / EVENT`; and the next step on each screen, such as CREATE,
  DETAILS, or RECORD RUN, is highlighted in lime. The HUD and Delta use the new
  fonts and cut corners and keep their colors and opacity, and the layout
  editor sets SAVE, CANCEL, and RESET apart. Your data and settings are
  unchanged.

### Improved

- **Driver Analysis**: while a recording is exported, its button reads
  EXPORTING… with a moving bar, and a finished export is reported in green with
  its size, without a size warning.

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
