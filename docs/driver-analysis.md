# Driver Analysis

## Purpose and product boundary

Driver Analysis is a local, zero-reference review tool for asphalt driving in
Forza Horizon 6. It is a beta feature. The driver enables it and explicitly
starts and stops each recording from Configuration or with the global hotkey.

The feature does not identify the road surface, track, ideal line, apex, or
optimal gear. It does not produce a driving score or an exact time-loss claim.
The driver must record on asphalt. A recording is analyzed separately for each
car driven in it. Each car shows at most one dominant, recurring technique
problem. When no problem qualifies, the car shows the most frequent checked
pattern as an observation instead.

## Runtime data flow

```text
FH6 Data Out → UDP 127.0.0.1:5301 → native decoder → direct_telemetry
  → queueTelemetry → Driver Analysis recorder
  → phase/maneuver state → opportunities → evidence → scoring
  → samples + analysis in local fdc.sqlite
  → Configuration / Driver Analysis history
```

Driver Analysis remains a consumer of the existing normalized `queueTelemetry`
stream. It does not add another telemetry transport or subscribe directly to
UDP. It has no HUD widget and displays no live driving cues.

## Controls and lifecycle

Driver Analysis is disabled by default. Its Configuration tab is third, after HUD
and Events. It opens with a short intro and contains the enable toggle,
`RECORD` / `STOP` control, editable hotkey, beta/asphalt warning, and
newest-first history.

The recording state machine is:

```text
OFF → READY → WAITING → RECORDING → FINALIZING → READY
                                      └────────→ ERROR
```

- `WAITING` means recording is armed but valid telemetry has not arrived. No
  empty database recording or session is created.
- The first valid sample creates the local recording and the session of the
  current car and enters `RECORDING`. While it records, the history shows the
  recording as `RECORDING IN PROGRESS` with a `LIVE` duration and disabled
  `EXPORT` and `DELETE` controls.
- Samples are appended to SQLite in ordered batches rather than one command per
  packet. Forza sends packets in pairs that share a game timestamp; only the
  first packet at a timestamp is analyzed and stored. Each stored sample also
  keeps the car position.
- A telemetry gap invalidates the active maneuver evidence and recording can
  continue.
- A vehicle-identity change finishes and saves the analysis session of the
  previous car and starts a new session for the new car in the same recording.
  Switching back to an earlier car starts another session for it.
- An unfinished `recording` session is recovered as `interrupted` when FDC
  starts.

### Drives

While recording, each car's telemetry is split into drives, one per race. A
drive starts at a clean race start: live telemetry with Current Lap and Current
Race Time of at most two seconds and a travelled distance of at most 25 metres,
the same start that Events use. It ends at another clean start, when driving
continues after the finish line, when the travelled distance falls back by more
than 100 metres together with a lap change or a reset lap clock, at a car
change, or when recording stops. A smaller fall back without those signals is
an in-race rewind and the drive continues; pauses continue the drive too.

Telemetry does not identify the race type, so a drive is classified from its
laps:

- a higher Lap Number seen while racing
  becomes a completed circuit lap once the car travels another 100 metres;
- a higher Lap Number or a new Last Lap on the non-live result packets, or a
  lap boundary that the car does not travel past, is the finish line;
- in a sprint, a non-live Current Lap that advances past the last live value
  and repeats in two consecutive packets is the finish line too, and so is a
  zeroed non-live result, with Current Lap, Current Race Time, Last Lap, and
  travelled distance all cleared, once the drive has covered more than 25
  metres; live driving after a zeroed result that does not continue the race
  clock and distance ends the drive;
- a drive with at least one completed circuit lap is a circuit whose lap count
  includes the finish lap when it was reached; any other drive is a sprint, so
  a one-lap circuit appears as a sprint;
- a drive without a finish line is unfinished;
- a drive whose car never travels more than 25 metres from its start is not
  saved; standing in free roam, for example to change cars, reports the same
  zero race clock and distance as a race start.

Driving outside races is analyzed exactly as before and counts toward the
car's result, but it is not a drive. Drives are saved with the car's session
when it is finalized and are not recomputed by later reanalysis, because the
non-live packets they depend on are not stored.

The default hotkey is `Ctrl+Shift+F9`. The hotkey is registered only while
Driver Analysis is enabled and is released when it is disabled. If Windows
refuses the binding, for example because another program holds it, FDC keeps
running, shows the error in Configuration, and recording remains available
from the `RECORD` control. The binding can be a keyboard combination or a
game-controller button. Keyboard rules: Windows-key combinations, bare keys,
`Alt+F4`, `Alt+Tab`, `Ctrl+Escape`, and `Ctrl+Shift+Escape` are rejected.
Controller buttons are captured from any HID joystick, gamepad, or multi-axis
device via Windows Raw Input in the background. Only button press edges count;
buttons already held (such as engaged gear shifter buttons) are ignored. The game
also receives the button press. Controller binding format: `Controller:VVVV:PPPP:N`
where VVVV and PPPP are 4-digit hex vendor and product IDs, and N is the decimal
button number 1–1024. Example: `Controller:346E:0006:116`.

## Opportunity and evidence model

The map-free state engine segments telemetry into straight, braking, turn-in,
rotation, and exit phases, and creates bounded opportunities for four supported
problem types:

| Problem | Driver input and observed response | User instruction |
| --- | --- | --- |
| `FRONT SCRUB` | More steering drives the front tires to the grip limit (front slip angle at least 0.9) while lateral acceleration drops by at least 0.5 m/s² or yaw rate by at least 0.05 rad/s | Reduce steering and let the front recover |
| `EXIT WHEELSPIN` | More throttle/driven-wheel slip with weak acceleration response | Build throttle after the car is settled |
| `BRAKE + STEERING OVERLOAD` | Brake and steering overlap with high combined front slip and stalled response | Release brake as steering builds |
| `ABRUPT BRAKE RELEASE` | Sharp brake release followed by response/yaw loss or rear-slip growth | Release brake smoothly through rotation |

A maneuver survives short steering gaps: when the steering returns within 1 s
in the same direction and lateral acceleration stays at 3 m/s² or more
throughout the gap, the same maneuver continues. This keeps pulsed gamepad
steering inside one corner. The maneuver ends when the gap fails, when the
brake is applied during the gap, or when steering resumes in the opposite
direction, which starts a new maneuver. Opportunities other than exit wheelspin
stay open across a bridged gap.

A front scrub opportunity needs at least 200 ms of sustained steering. Shorter
steering pulses are stored as invalid `steering_pulse` opportunities and do not
count toward recurrence.

Front scrub is evaluated in turn-in, rotation, and exit, so corners taken on
throttle are checked as well. Brake and steering overload and abrupt brake
release remain limited to turn-in and rotation. When a front scrub trigger
follows a throttle increase of at least 10% before the front slip rise, the
slip may come from traction rather than steering, so the opportunity is marked
`ambiguous` with the `throttle_rise` confounder.

Each opportunity ends as `clean`, `problem`, `ambiguous`, or `incomplete` and
has one evidence record. Evidence includes detector confidence, driver
attribution confidence, severity, causal metrics, counterexample support, and
confounders. If several symptoms occur in one maneuver, causal ordering marks
only the earliest supported cause as primary.

## Separating driver input from vehicle behavior

A detector is not enough to blame the driver. Attribution additionally needs:

- temporal causality: the relevant input change occurs before the degraded
  response;
- comparable clean counterexamples from the same car and similar speed/gear
  context;
- repeatability across distinct maneuvers; and
- no surface/contact confounder such as rumble contact, puddle data, or full
  suspension extension.

Missing counterexamples or conflicting signals reduce attribution and produce
an ambiguous result. This is intentionally conservative: the feature prefers
no conclusion over incorrectly labeling vehicle behavior as driver error.

## Qualification and prioritization

A problem can qualify only with all of these gates:

- at least 5 valid opportunities;
- at least 3 primary problem evidence records;
- at least 3 distinct maneuvers;
- recurrence of at least 40%;
- median detector confidence of at least 0.84;
- median attribution confidence of at least 0.70; and
- ambiguity of at most 30%.

Qualified problems are ranked by recurrence, detector confidence, attribution
confidence, severity, sample support, and an ambiguity penalty. The winner must
score at least 15% above the second problem. Otherwise the recording is saved
as ambiguous and the UI does not invent a dominant recommendation.

Data sufficiency is evaluated separately from problem qualification. When a
recording contains enough valid opportunities for at least one supported
pattern across enough maneuvers but no problem reaches the recurrence and
confidence gates, the result is `NO
RECURRING PROBLEM DETECTED`. An ambiguous result is reserved for a recurring
candidate that the available evidence cannot reliably attribute to the driver,
or for qualified candidates that are too close to prioritize.

## Recording statistics

Every saved recording also shows descriptive statistics of the telemetry that
was collected, regardless of its result. They describe what happened in this
recording only. There are no reference values, grades, scores, or
recommendations. The statistics are computed by
`overlay/driver-analysis-stats.js` from the same normalized samples and phases
that feed the maneuver analysis. Samples separated by a telemetry gap do not
contribute time or distance, and a braking event or corner interrupted by a gap
is discarded. Acceleration peaks use a 150 ms moving average, and each event's
peak is the 95th percentile of those smoothed values, so single-frame spikes
such as curb or contact impacts do not dominate the result.

| Row | Content |
| --- | --- |
| `PEDALS` | Share of moving time with full throttle (at least 95%), partial throttle, coasting, and braking. The brake share also shows the part with steering applied. |
| `STEERING` | Share of steering time (moving, steering input at least 12%) spent at full lock (at least 99%) and the median number of full-lock entries per corner. |
| `BRAKING` | Braking events that start at 40 km/h or more and last 0.3–15 s: median peak deceleration, duration, release time (from the last brake level at or above 80% of that event's peak until release), and trail braking. An event counts as trail braking when it starts without steering and the brake stays at 30% or more while steering is applied for at least 250 ms. The share is taken over events that start without steering, and the median brake-and-steering overlap of those events is shown in parentheses. |
| `CORNERS` | Maneuvers that last at least 0.7 s and reach a peak lateral acceleration of 4 m/s², so brief steering corrections are not counted as corners: median and 90th-percentile peak lateral acceleration, the share of turning time in which the front and, separately, the rear axle's average absolute combined tire slip exceeds 1 (above 100%, where the in-game tire friction telemetry turns red), and how many corners were taken flat-out (full throttle and no brake throughout the turning phases). |
| `ON POWER` | How many corners were already at full throttle at their minimum-speed sample, and, for the corners that lifted and returned to full throttle later, the median delay after the minimum speed and the median peak longitudinal acceleration. |
| `CHECKED` | How many opportunities of each supported pattern were evaluated and how many ended as a problem. |

The `BRAKING`, `CORNERS`, and `ON POWER` rows are hidden when fewer than three
events were measured. Each of those rows shows its event count, and hovering a
row shows the 10th–90th percentile range of its values.

The statistics are stored as versioned JSON in the session's `stats_json`
column, together with a `patterns` entry per supported problem type holding the
checked, problem, and ambiguous counts of that recording. Finished recordings
with saved samples but missing or outdated statistics are replayed locally once
through `save_driver_analysis_stats`, which writes only the statistics; the
saved result, opportunities, and evidence of those recordings are not changed.

## Card layout

The history shows one card per recording, newest first. A collapsed card shows
the recording date, its duration from the first car's start to the last car's
finish (`LIVE` while recording), storage size, and the number of cars and
drives. Its finding column has one line per car, in the order driven, with the
car's Garage name (or its car ordinal) and the headline of that car.
A card with a single car adds a one-line summary below: distance, average
speed, top speed, and corner count. A card with several cars leaves it out,
because totals across different cars say little.

The action column on the right holds `DETAILS`, `EXPORT`, and `DELETE`, top
to bottom; `DETAILS` is shown once every car of the recording is finished.
`DETAILS` opens the recording page, and the history is replaced by pages like
the Events tab, with the same tables and metrics: each page has `BACK`, and
Escape also goes up one level. The recording page shows the date, duration,
car and drive counts, storage size, and the `CARS` table with each car, its
PI, drivetrain, drive count, duration, and headline; selecting a row opens the
car page. A recording with a single car opens its car page directly, and
`BACK` from it returns to the history.

The car page shows the car's name with its PI, drivetrain, drive count,
duration, and date, then its headline as the `RESULT` metric with the text
below it: the qualified problem and its instruction when the car has one.
Otherwise it shows `MOST FREQUENT:` followed by the name of the pattern that
has the highest share of problems among the patterns with at least 10 checked
opportunities and at least 3 problems, for example `MOST FREQUENT: FRONT SCRUB`, with the pattern text below it, such as
`Front scrub — steering more than the front tires can take — in 18 of 133
checks (14%). Becomes a reported problem above 40%.` When no pattern reaches
that support, the car keeps its result copy, such as
`NOT ENOUGH ELIGIBLE MANEUVERS`.

Below the headline, the `DISTANCE`, `AVERAGE`, `TOP`, and `CORNERS` metrics
of the car are followed by a `STATS` control that reveals the statistics
tables, and by the `DRIVES` table
with `ID`, `TYPE` (`CIRCUIT · N LAPS`, `SPRINT`, with ` · UNFINISHED` when no
finish line was seen), `DURATION`, `START` (local time), and `ERRORS`, the
number of checks inside the drive that ended as a problem. Selecting a drive
row opens the drive page. A car recorded before drives existed shows
`RECORDED BEFORE DRIVES`; a car without races shows
`NO RACES IN THIS RECORDING`.

### Drive map

The drive page shows the drive number with the car, drive type, and start
time, the `DURATION` and `ERRORS` metrics, and the drive map across the full
page width.
The map is built from the drive's stored samples, thinned like an Events
lap trace to one point per 100 ms plus pedal and gear changes, with slip kept
as the signed peak and curb contact kept as any contact since the previous
point. It uses the Events lap map: the white track outline, the pedal and Slip
layers, the legend row, and the hover values, without sector ticks. It needs no
Events recording.

On top of it, each check of the drive that ended as a problem is a thick
segment from the check's start to its end, colored by problem type: front
scrub orange, exit wheelspin pink, brake with steering blue-violet, and abrupt
brake release lilac. Each check that ended clean is a grey dot. Ambiguous and
incomplete checks are not shown. The legend row starts with the problem types
of the drive and `CLEAN` with their counts, followed by the pedal and Slip
layers. A drive map opens with only the problems and clean checks shown; the
layer selection works as in Events and is shared by every drive map until the
Configuration window is reloaded.

Hovering a problem segment, or a point within reach of one, shows the problem
type, its distance from the drive start, its duration, the numbers its check
recorded, and the instruction of that problem type, for example
`Steering +18% · front slip 112%` and `Response lateral −0.6 m/s² · yaw
−5 °/s`. The numbers use the check's own units: steering, pedals, and slip in
percent, lateral response in m/s², and yaw in degrees per second. Elsewhere
the hover shows the Events trace values. A list below the legend names every
problem with its distance and duration; selecting one outlines it on the map.

Drives recorded before sample positions existed have no map and show
`NO POSITION DATA WAS SAVED FOR THIS DRIVE`.

The open page and each car's `STATS` state are kept while Configuration stays
open. When the history reloads, the open page is rebuilt from it, and a page
whose recording was deleted returns to the history.

## Local persistence and deletion

The native layer stores data in the application-data `fdc.sqlite` database:

- `driver_analysis_recordings` stores one row per recording; each session
  belongs to one recording;
- `driver_analysis_sessions` stores one car's lifecycle, vehicle identity,
  algorithm version, counts, selected result, recording statistics, and
  approximate storage size;
- `driver_analysis_samples` stores the selected normalized telemetry needed to
  reproduce or improve analysis, including the car position for recordings
  made from schema version 21;
- `driver_analysis_drives` stores each drive's type, finish state, lap count,
  sample range, telemetry-clock time range, start time, and distance;
- `driver_analysis_opportunities` stores eligible windows and their context;
- `driver_analysis_evidence` stores detector, attribution, severity, and causal
  metrics.

Foreign keys use cascading deletion. There is no automatic retention limit.
The user deletes a recording with `DELETE`, which asks `ARE YOU SURE?` with
`YES` and `NO`. `NO` is selected, and Escape or a click outside the question
also answers `NO`. After `YES`, all of its
sessions, samples, opportunities, evidence, and drives are removed together.
Each session also stores the FDC version that recorded it; sessions recorded
before this was added have none.
Schema version 21 moves every earlier session into its own recording; those
sessions have no drives and no positions.

Only enable state, hotkey, and optional controller device name remain in browser storage under
`fdc.driver-analysis.settings.v1` (hotkeyLabel is trimmed to 80 characters and
stored only when the binding is a controller button).

When the analysis algorithm version changes, completed recordings with saved
samples are replayed locally once. Their raw samples, timestamps, vehicle
identity, drives, and storage metadata are preserved; only derived
opportunities, evidence, and the summary result are replaced transactionally.

## Export for feedback

Each history card has `EXPORT` between `DETAILS` and `DELETE`. It is unavailable in the same
cases as `DELETE`: while recording, while the recording has an unfinished car,
and while the history is busy. `EXPORT` opens the Windows save dialog with the
suggested name `fdc-driver-analysis-YYYYMMDD-HHMM.json.gz`, the local start
time of the recording. Cancelling the dialog changes nothing. After saving, the
status line shows `DRIVER ANALYSIS RECORDING EXPORTED` with the file size and
marks it as an error when the file is larger than 25 MB, the GitHub attachment
limit; such a file is shared through a file-sharing link instead. A two-hour
recording is about 40 MB. Exporting only reads the database; a failure shows an error and leaves
the recording unchanged, and no partial file is left behind.

The file is gzip-compressed JSON with `format` set to
`fdc-driver-analysis-export` and `formatVersion` set to `1`. It holds one
recording with every car and contains:

- the FDC version that exported it and, per car, the FDC version that recorded
  it (or `null`) and the analysis algorithm version;
- the car ordinal, PI, drivetrain, rev limit, and vehicle identity;
- the saved result, counts, confidences, severity, and statistics;
- every saved sample with all of its columns, including the position, stored
  column by column with the column names;
- the drives, opportunities, and evidence of each car.

The recording start is the only absolute time, in UTC. Other wall-clock times
are offsets from it. Game telemetry times are exported unchanged so the
analysis can be replayed exactly. Database ids are replaced by positions in
the file. Garage names, settings, paths, and other recordings are not
exported.

Drives are exported as saved and cannot be recomputed from the file, because
the non-live packets they depend on are not stored.

`tools/replay-driver-analysis.mjs` replays an exported file or a database
recording through the current analysis. Checks, their outcomes, and the result
reproduce exactly; evidence numbers and statistics can differ slightly, for
example because telemetry interruptions that reset the live analysis are not
stored. See
[Development](development.md#driver-analysis-replay).

## Current limitations

- Results are beta and may be inaccurate.
- The feature is asphalt-only by product boundary; telemetry does not prove the
  surface type.
- Short or inconsistent recordings commonly produce insufficient or ambiguous
  results.
- Steering that is not held for at least 200 ms is recorded but not checked for
  front scrub, so a driver who steers in short pulses has fewer checked
  opportunities than corners driven.
- The supported findings are bounded technique patterns, not a complete
  driving assessment.
- There is no track identity, reference lap, ideal line, score, exact time
  loss, or optimal-gear recommendation.
- A sprint abandoned through the in-game restart menu produces the same zeroed
  transition as a natural sprint finish, so it is also shown as finished.
