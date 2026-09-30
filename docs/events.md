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
  configured color, and Class uses the existing Garage class color. The same
  row starts with the event's database ID as `#ID`. Notes, when supplied,
  appear in their own framed area directly beneath that row. The page also
  shows a purple **Absolute Best**: the quickest actual saved circuit lap or
  confirmed Sprint result across that Event. When the Event has saved traces,
  only results whose trace covers at least 97% of the Event's longest traced
  distance are eligible. The top-left **BACK** action and
  Escape both return to the Events list.
- Selecting the event title starts inline renaming. Enter or leaving the input
  saves a non-empty name; Escape cancels that rename without leaving the page.
- An event page has one green **RECORD RUN** control. Selecting it changes the same
  control to red **STOP** and arms capture for that event. FDC does not accept
  a run already in progress: it waits for a new live race whose Current Lap and
  Current Race Time are at most two seconds and whose travelled distance is at
  most 25 metres.
- The recorder keeps an orange Sprint warning visible while idle, armed, or
  recording: leave capture armed between attempts and press **STOP** when the
  session is over. If Forza omits the exact result, FDC uses the last live race
  time. A finalizing or
  another-Event status temporarily replaces the warning with its operational
  instruction.
- One saved run ID represents one driving attempt, including every completed
  circuit lap in that attempt. Completing another lap never creates another
  run ID. A circuit result stores each completed lap and shows the best lap and
  its lap number in the event page; a sprint shows its confirmed finish time.
  A confirmed sprint is saved immediately and leaves capture armed for the
  next attempt. Circuit laps remain in their current run until **STOP** or a
  confirmed restart. Each saved-run row shows its lap count between Best and
  Date, then displays the local run start as `YYYY.MM.DD HH:MM:SS`.
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
  The expanded row shows a full-width top-down X/Z trace map shaped to the
  track, at most 560 px tall, with a legend row beneath it. The first Escape collapses an open row; **BACK** or
  a following Escape returns to the Event page.
- The trace map draws a thin white track outline under its layers. Pedal
  segments use green for throttle, red for brake, and yellow for coasting.
  Brake takes precedence whenever both pedal inputs are at least five percent.
  The Slip layer draws a wide translucent cyan band under the pedal segments
  wherever any wheel's absolute combined slip exceeds 1, the level at which the
  in-game tire friction telemetry shows more than 100% and turns red. Thin
  `S1`, `S2`, and `S3` ticks mark the ends of the three virtual distance
  sectors. The white marker is the saved start point.
- The legend row shows **THROTTLE**, **BRAKE**, and **COAST** with their share
  of lap time, **SLIP** with the share of lap time in which any wheel was above
  100% combined slip, and **ALL**. The legend buttons also choose the visible
  layers: with every layer shown, selecting one shows only that layer; after
  that, selecting a layer adds or removes it. Removing the last visible layer,
  adding the final hidden one, or selecting **ALL** shows every layer again. A
  hidden layer leaves the white outline visible, and the shares do not change
  with the selection. The choice applies to every lap until the Configuration
  window is reloaded. **SLIP** is unavailable and shows `—` for a lap recorded
  without extended telemetry.
- Hovering the map marks the nearest trace point and shows its recorded values
  without interpretation: distance from the lap's first point, lap time, speed,
  gear, RPM, throttle, brake, steering, lateral, longitudinal, and vertical
  acceleration in g, yaw rate, and a per-wheel table of combined slip, slip
  angle, and slip ratio in percent, tire temperature, and suspension travel
  (0% fully extended, 100% fully compressed). A curb row lists wheels on a
  rumble strip and a puddle row lists wheels in water; each appears only when
  it applies. A lap recorded before extended telemetry shows distance, time,
  throttle, and brake only.
- Legend shares are time-weighted, not sample-count-weighted: Throttle
  (`X`), Brake (`A`), and Coast (`C`) always total 100%, and Slip uses the
  same time ownership. The first point owns
  the initial interval from lap zero, each following point owns the interval
  until the next point, and the last point owns the remaining time until the
  saved lap result. A pre-trace lap keeps its normal timing row and shows an
  unavailable trace state when expanded.
- A Sprint is represented by one saved row when telemetry supplies enough data
  to compute its virtual sectors. Its run type is a capture hint only: the
  detail page uses the saved rows, so a Sprint recorded as a one-lap circuit
  still renders correctly.
- Paused, non-live, free-roam, and in-race rewind telemetry suspend or resume
  capture without discarding or splitting a run. A new run ID is created when
  live telemetry returns to a confirmed clean lap-zero restart after at least
  one completed lap, or after a zeroed Sprint result transition. That restart
  saves a valid preceding attempt while **STOP** remains active.
- A circuit attempt with no completed lap, or a sprint without a confirmed
  result, is discarded rather than added to the saved-run list. If a started
  sprint reaches a zeroed non-live result packet before its final packet is
  observed, **STOP** checks up to 48 additional packets (for at most one
  second) for the game-reported final result. It uses that result when
  available; otherwise it uses the last live race time as the manually
  confirmed result.
  Selecting **STOP** explicitly reports whether the attempt was saved,
  discarded, or could not be stored. A saved circuit reports its latest stored
  completed lap as **LAST**; a saved Sprint reports its stored final result as
  **RESULT**. The feedback never uses the live clock after the game resets it.
- **DELETE** asks for confirmation, then hides the event from the active list
  while retaining its row and saved runs in SQLite, and returns to the list.

## Telemetry recording

Events consumes the normalized Direct Data Out sample delivered through the
shared browser `queueTelemetry` path. It does not read the game's result-screen
UI or use a second telemetry source.

When **Record Run** arms an Event with an Absolute Best trace, the browser
Delta widget loads that Event's exact fastest saved result as its reference. A
new Event has no Delta during its first circuit lap or Sprint attempt. As soon
as a completed lap or confirmed Sprint provides a faster usable trace, that
trace becomes the in-memory reference before the next lap or attempt is
processed; a slower result leaves the reference unchanged. A trace that covers
less than 97% of the active reference distance never replaces it, and a trace
that covers noticeably more distance replaces a partial reference regardless
of time. Circuit rows remain
part of the active unsaved run until **STOP** or a confirmed restart.

In a live race Delta interpolates the active reference trace's elapsed time at
the current lap distance and shows current elapsed time minus reference elapsed
time. Negative values are ahead and green; positive values are behind and red.
The center-out bar reaches its corresponding edge at one second in either
direction. The top-right **BEST** value is the official completed time that
selected the active trace, not the final sampled trace timestamp. An Event
without a usable recorded reference leaves Delta inactive; stopping capture
clears its reference.

| Forza field | Current Events use |
| --- | --- |
| `IsRaceOn` | Identifies live racing and non-live transitions. |
| `CurrentLap` | Validates the clean start window and can confirm a sprint result when its non-live final value repeats. |
| `CurrentRaceTime` | Validates the clean start window and provides the manual sprint fallback time. |
| `DistanceTraveled` | Validates the clean start window and the distance a Sprint result covered. |
| `LapNumber` | Detects circuit-lap boundaries and a confirmed clean restart. |
| `LastLap` | Stores a game-reported completed circuit lap and is the preferred sprint finish evidence. |
| `Position X`, `Position Y`, `Position Z` | Saves a compact per-lap vehicle trace; the detail map renders the top-down X/Z projection while retaining Y. |
| `Throttle`, `Brake` | Saves the pedal inputs used by the existing HUD and derives trace colors and time-weighted pedal statistics. |
| Speed, gear, RPM, steering, acceleration, angular velocity Y | Saves the extended trace values shown when hovering the map. |
| Tire slip angle, slip ratio, and combined slip; tire temperature; suspension travel; rumble strip; puddle depth (per wheel) | Saves the per-wheel trace values shown when hovering the map; combined slip also drives the Slip layer. |
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

For a newly completed lap, FDC also stores a trace containing elapsed time,
travelled distance, position, pedal inputs, and extended telemetry: speed,
gear, RPM, steering, acceleration, yaw rate, and per wheel slip angle, slip
ratio, combined slip, tire temperature, suspension travel, puddle depth, and
rumble strip contact. A point is stored every 100 ms and additionally whenever
the pedal state or gear changes. A lap keeps up to 10,000 points; only beyond
that are every other point dropped. Slip values are the signed value with the
largest magnitude among all packets since the previous point, and rumble strip
contact is set when any of those packets touched a strip, so short slides and
curb strikes between points are not lost. The other values come from the
packet that stored the point. This is independent data for every lap: runs on
the same route can look similar, but each trace and its colouring describe
that exact drive.
The same synthetic lap used for a confirmed Sprint receives a trace. Existing
saved laps are not backfilled because the source telemetry no longer exists;
laps recorded before extended telemetry keep their pedal-only traces.

### Run lifecycle

- **Record Run** records the local system timestamp used as the run start time,
  then waits for the clean live start described above before creating a run ID.
- In a circuit, a higher `LapNumber` together with a positive `LastLap` records
  that completed lap in the current run. If `LastLap` arrives one packet late,
  FDC retains the pending boundary until that value arrives. The stored circuit
  time is the `LastLap` value, not a sampled current clock. A faster completed
  lap becomes Delta's in-memory reference immediately, while persistence still
  occurs for the complete run at **STOP** or a confirmed restart.
- In a sprint, a non-live positive `LastLap` that is new and compatible with
  the live attempt confirms the finish immediately. A non-live advancing
  `CurrentLap` can also confirm the finish after the same value is observed in
  two consecutive packets. A confirmed sprint is stored immediately and
  capture remains armed for another attempt.
- A live clean lap-zero start after a completed lap is a confirmed restart.
  FDC saves a valid preceding run and begins a new run ID. An in-race rewind,
  pause, non-live transition, or free-roam tail does not by itself split a run.
- After a zeroed non-live Sprint result, the next clean live start confirms the
  previous attempt with its last live race time when no exact result arrived.
  FDC saves that fallback Sprint and starts the next attempt automatically.
- An attempt abandoned through the in-game restart menu produces the same
  zeroed transition, so every Sprint result is compared with the active Delta
  reference distance. A Sprint whose live travelled distance is less than 97%
  of that reference is discarded and never becomes the reference. Without an
  active reference, the Sprint is kept.

### Result reset and precision

Some sprint result transitions clear `IsRaceOn`, `CurrentLap`,
`CurrentRaceTime`, `LastLap`, and travelled distance before a final result is
available to FDC. The next clean live start automatically saves the preceding
attempt using the last live `CurrentRaceTime` and begins a new attempt. If
**STOP** is selected instead, FDC enters the temporary **FINALIZING** state and
continues processing up to 48 subsequent Direct Data Out samples for at most
one second.

If those samples contain a confirmed final `LastLap` or Current Lap result,
that game-reported telemetry value is saved. If not, FDC saves the last live
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
lap and is deleted with that lap. Trace points are omitted from
run-list reads and loaded only for the selected run detail.
A run snapshots the vehicle ordinal, class, PI, drivetrain, start time, run
type, and confirmed result. Run reads resolve the current Garage display name
for the ordinal, so renaming a Garage car updates existing Event rows. Event
schema migrations do not modify Garage or Shift Light tables. The separate
Shift Light v15 migration preserves compatible configuration identity and
reported-redline data but intentionally discards obsolete learning facts.
Schema version 16 adds the nullable `deleted_at` marker used for silent Event
deletion; deleted rows and their numeric IDs remain stored and are excluded
from the active library. Schema version 20 adds nullable extended telemetry
columns to `event_run_lap_trace_points`; existing trace rows keep them empty.
The Absolute Best reference used by Delta loads only the base trace columns.

Deleting an Event hides it from the active library while retaining its row and
runs in SQLite so its numeric ID is not reused. FDC trims names and
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
- `load_event_absolute_best`
