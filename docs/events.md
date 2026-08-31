# Events

Events is FDC's local library of player-created Forza Horizon 6 events. It is
available as the Events tab in Configuration, directly after Garage.

## User experience

- **Events** shows active events as responsive tiles in the Garage card style.
  A tile shows its database event ID as `#ID`, its name, Mode, and Route Type.
  Selecting a tile opens that event.
- The Events list has a persistent **SORT** selection. Its default is ID from
  highest to lowest; it can also order ID ascending or the most recently
  recorded run date ascending or descending.
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
- An event page contains its controls, identity, and saved runs. Mode, Route
  Type, and Class appear beside the clickable title in one compact row when
  space permits; narrow layouts wrap that row below the title. Mode uses its
  configured color, and Class uses the existing Garage class color. Notes, when
  supplied, appear in their own framed area directly beneath that row. The
  top-left **BACK** action and Escape both return to the Events list.
- Selecting the event title starts inline renaming. Enter or leaving the input
  saves a non-empty name; Escape cancels that rename without leaving the page.
- An event page has one green **RECORD RUN** control. Selecting it changes the same
  control to red **STOP** and arms capture for that event. FDC does not accept
  a run already in progress: it waits for a new live race whose Current Lap and
  Current Race Time are at most two seconds and whose travelled distance is at
  most 25 metres.
- One saved run ID represents one driving attempt, including every completed
  circuit lap in that attempt. Completing another lap never creates another
  run ID. A circuit result stores each completed lap and shows the best lap and
  its lap number in the event page; a sprint shows its confirmed finish time.
  A confirmed sprint is saved immediately and leaves capture armed for the
  next attempt. Circuit laps remain in their current run until **STOP** or a
  confirmed restart. Each row displays the local run start as
  `YYYY.MM.DD HH:MM:SS`.
- The saved-run header sorts by ID, Best, or Date. Its default is Date from
  newest to oldest, and that temporary choice is not persisted. Selecting a
  saved run opens its detail page.
- A run detail repeats the Event identity and shows a **Best Hypothetical
  Time** when all three virtual sectors are available. It is the sum of the
  quickest Sector 1, Sector 2, and Sector 3 across that run's rows. Its lap
  table is `Lap`, `Lap Time`, `Sector 1`, `Sector 2`, and `Sector 3`; it starts
  from the highest lap number and a Lap-header click reverses that temporary
  order. In each time column, every tied quickest value is purple, the next
  distinct value is green, and all remaining values are white. Selecting a lap
  row expands it beneath the table; selecting the same row again collapses it.
  The expanded row shows a top-down X/Z trace on the left and pedal-use
  statistics on the right. The first Escape collapses an open row; **BACK** or
  a following Escape returns to the Event page.
- Trace segments are thin and use green for throttle, red for brake, and
  yellow for coasting. Brake takes precedence whenever both pedal inputs are
  at least five percent. Thin black `S1`, `S2`, and `S3` ticks mark the ends
  of the three virtual distance sectors. The white marker is the saved start
  point.
- Pedal statistics are time-weighted, not sample-count-weighted: Throttle
  (`X`), Brake (`A`), and Coast (`C`) always total 100%. The first point owns
  the initial interval from lap zero, each following point owns the interval
  until the next point, and the last point owns the remaining time until the
  saved lap result. A pre-trace lap keeps its normal timing row and shows an
  unavailable trace state when expanded.
- A Sprint is represented by one saved row when telemetry supplies enough data
  to compute its virtual sectors. Its run type is a capture hint only: the
  detail page uses the saved rows, so a Sprint recorded as a one-lap circuit
  still renders correctly.
- Paused, non-live, free-roam, and in-race rewind telemetry suspend or resume
  capture without discarding or splitting a run. A new run ID is created only
  when live telemetry returns to a clean lap-zero race start after at least one
  completed lap. That confirmed restart saves a valid preceding attempt while
  **STOP** remains active.
- A circuit attempt with no completed lap, or a sprint without a confirmed
  result, is discarded rather than added to the saved-run list. If a started
  sprint reaches a zeroed non-live result packet before its final packet is
  observed, **STOP** checks up to 48 additional packets (for at most one
  second) for the official final result. It uses that result when available;
  otherwise it uses the last live race time as the manually confirmed result.
  Selecting **STOP** explicitly reports whether the attempt was saved,
  discarded, or could not be stored. A saved circuit reports its latest stored
  completed lap as **LAST**; a saved Sprint reports its stored final result as
  **RESULT**. The feedback never uses the live clock after the game resets it.
- **DELETE** asks for confirmation, then permanently removes the event and
  returns to the list.

## Telemetry recording

Events consumes the normalized Direct Data Out sample delivered through the
shared browser `queueTelemetry` path. It does not read the game's result-screen
UI or use a second telemetry source.

| Forza field | Current Events use |
| --- | --- |
| `IsRaceOn` | Identifies live racing and non-live transitions. |
| `CurrentLap` | Validates the clean start window and can confirm a sprint result when its non-live final value repeats. |
| `CurrentRaceTime` | Validates the clean start window and provides the manual sprint fallback time. |
| `DistanceTraveled` | Validates the clean start window. |
| `LapNumber` | Detects circuit-lap boundaries and a confirmed clean restart. |
| `LastLap` | Stores an official completed circuit lap and is the preferred sprint finish evidence. |
| `Position X`, `Position Y`, `Position Z` | Saves a compact per-lap vehicle trace; the detail map renders the top-down X/Z projection while retaining Y. |
| `Throttle`, `Brake` | Saves the pedal inputs used by the existing HUD and derives trace colors and time-weighted pedal statistics. |
| Vehicle ordinal, name, class, PI, and drivetrain | Snapshots the vehicle recorded with the run. |

Forza `BestLap` is not persisted as an independent input. FDC derives a circuit
run's best lap and its lap number from the stored `LastLap` records.

For each new saved row, FDC retains only enough in-memory samples to interpolate
the current-lap timestamps at one-third and two-thirds of that lap's travelled
distance span, whether Forza resets or accumulates `DistanceTraveled` between
laps.
It stores the resulting three virtual-sector durations with the lap. This does
not persist the telemetry stream. Runs created before sector storage have no
sector values and therefore show `—` for them and no hypothetical time.

For a newly completed lap, FDC also stores a compact downsampled trace (at
most 1,200 points) containing elapsed time, travelled distance, position, and
pedal inputs. This is independent data for every lap: runs on the same route
can look similar, but each trace and its colouring describe that exact drive.
The same synthetic lap used for a confirmed Sprint receives a trace. Existing
saved laps are not backfilled because the source telemetry no longer exists.

### Run lifecycle

- **Record Run** records the local system timestamp used as the run start time,
  then waits for the clean live start described above before creating a run ID.
- In a circuit, a higher `LapNumber` together with a positive `LastLap` records
  that completed lap in the current run. If `LastLap` arrives one packet late,
  FDC retains the pending boundary until that value arrives. The stored circuit
  time is the `LastLap` value, not a sampled current clock.
- In a sprint, a non-live positive `LastLap` that is new and compatible with
  the live attempt confirms the finish immediately. A non-live advancing
  `CurrentLap` can also confirm the finish after the same value is observed in
  two consecutive packets. A confirmed sprint is stored immediately and
  capture remains armed for another attempt.
- A live clean lap-zero start after a completed lap is a confirmed restart.
  FDC saves a valid preceding run and begins a new run ID. An in-race rewind,
  pause, non-live transition, or free-roam tail does not by itself split a run.

### Result reset and precision

Some sprint result transitions clear `IsRaceOn`, `CurrentLap`,
`CurrentRaceTime`, `LastLap`, and travelled distance before a final result is
available to FDC. If **STOP** is selected after such a transition, FDC enters
the temporary **FINALIZING** state and continues processing up to 48 subsequent
Direct Data Out samples for at most one second.

If those samples contain a confirmed final `LastLap` or Current Lap result,
that official telemetry value is saved. If not, FDC saves the last live
`CurrentRaceTime` as the manually confirmed sprint result so the run is not
lost. That fallback is the last time received before the game cleared its
telemetry and can differ by a few milliseconds from the time displayed by
Forza on its result screen. FDC cannot reconstruct a more precise result when
the corresponding value is absent from Direct Data Out.

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
Type, Mode, optional notes, and creation/update timestamps. Schema version 8
adds event runs and their completed circuit laps. Schema version 9 removes the
obsolete Event archive timestamp and adds nullable Sector 1, Sector 2, and
Sector 3 durations to each saved lap. Schema version 10 adds
`event_run_lap_trace_points`, keyed by `(run_id, lap_number, sample_index)`,
with elapsed time, distance, `position_x`, `position_y`, `position_z`,
`throttle`, and `brake`. The table has a composite foreign key to the saved
lap and is deleted with that lap or its Event. Trace points are omitted from
run-list reads and loaded only for the selected run detail.
A run snapshots the vehicle ordinal, class, PI, drivetrain, start time, run
type, and confirmed result. Run reads resolve the current Garage display name
for the ordinal, so renaming a Garage car updates existing Event rows. Existing
Garage and Shift Light data is retained during migration.

Deleting an Event permanently removes it and its runs. FDC trims names and
notes before storing them; empty notes are stored as absent.

## Native commands

- `create_event`
- `load_events`
- `load_event`
- `rename_event`
- `delete_event`
- `record_event_run`
- `load_event_runs`
- `load_event_run`
