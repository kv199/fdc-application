# Events

Events is FDC's local library of player-created Forza Horizon 6 events. It is
available as the Events tab in Configuration, directly after Garage.

## User experience

- **Events** shows active events as responsive tiles in the Garage card style.
  A tile shows its database event ID as `#ID`, its name, Mode, and Route Type.
  Selecting a tile opens that event.
- The Events heading has a right-aligned **CREATE** action. It opens a creation
  area above the active event tiles.
- The creation area keeps the input order as Event Name, then Mode / Route
  Type / Class, then optional Notes and the Create action. A blank name or an
  unselected required field cannot be submitted.
- **Cancel**, pressing **CREATE** again while the area is open, and Escape
  request that the creation area close. An empty form closes immediately. If
  any field contains a value, FDC asks whether to discard the unsaved changes.
  **NO** keeps the area and its values open; **YES** clears the form and closes
  it. Escape in this confirmation has the same effect as **NO**.
- Class values are `Any`, `D`, `C`, `B`, `A`, `S1`, `S2`, `R`, and `X`.
- Route Type values are `Asphalt`, `Rally`, and `Offroad`.
- Mode values are `Any`, `Rivals`, `Online`, `EventLab`, `Official`, and
  `Blueprint`.
- A successful Create saves the event and opens its page immediately.
- An event page contains only its controls and event identity. Mode, Route
  Type, and Class appear beside the clickable title in one compact row when
  space permits; narrow layouts wrap that row below the title. Mode uses its
  configured color, and Class uses the existing Garage class color. Notes, when
  supplied, appear in their own framed area directly beneath that row. The
  top-left **BACK** action and Escape both return to the Events list.
- Selecting the event title starts inline renaming. Enter or leaving the input
  saves a non-empty name; Escape cancels that rename without leaving the page.
- An event page has one green **RECORD RUN** control. Selecting it changes the same
  control to red **STOP** and arms capture for that event. FDC does not accept
  a run already in progress: it waits for a new live race whose race clock and
  distance are both within the bounded start window.
- One saved run ID represents one driving attempt, including every completed
  circuit lap in that attempt. Completing another lap never creates another
  run ID. A circuit result stores each completed lap and shows the best lap and
  its lap number in the event page; a sprint shows its confirmed finish time.
  Each row displays the local run start as `YYYY.MM.DD HH:MM:SS`.
- Paused or non-live telemetry suspends capture without discarding a run. A
  subsequent live sample is the same attempt unless the race clock has moved
  backwards by more than five seconds and either lap number or distance has
  also moved backwards. That confirmed restart saves a valid preceding attempt
  and immediately begins a new run ID while **STOP** remains active.
- A circuit attempt with no completed lap, or a sprint without a confirmed
  result, is discarded rather than added to the saved-run list. Selecting
  **STOP** saves only a valid current attempt.
- **ARCHIVE** retains the event locally, removes it from the active Events
  list, and returns to that list. **DELETE** asks for confirmation, then
  permanently removes the event and returns to the list.

## Mode colors

The event tile's left edge and Mode badge use a stable Mode color. The mapping
uses the corresponding existing Forza-style class colors where specified:

| Mode | Color |
| --- | --- |
| Any | B-class orange |
| Rivals | D-class blue |
| Online | C-class yellow |
| EventLab | White |
| Official | A-class red |
| Blueprint | S1-class purple |

## Local SQLite state

Events use the existing FDC application-data database, `fdc.sqlite`. Schema
version 7 adds the `events` table with a numeric event ID, name, Class, Route
Type, Mode, optional notes, creation/update timestamps, and an optional archive
timestamp. Schema version 8 adds event runs and their completed circuit laps.
A run snapshots the vehicle ordinal, class, PI, drivetrain, start time, run
type, and confirmed result. Run reads resolve the current Garage display name
for the ordinal, so renaming a Garage car updates existing Event rows. Existing
Garage and Shift Light data is retained during migration.

The active Events list excludes archived records. Event detail remains loadable
for an archived record by the native layer, while deletion removes the record
permanently. FDC trims names and notes before storing them; empty notes are
stored as absent.

## Native commands

- `create_event`
- `load_events`
- `load_event`
- `rename_event`
- `archive_event`
- `delete_event`
- `record_event_run`
- `load_event_runs`
