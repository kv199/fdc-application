# Driver Analysis

## Purpose and product boundary

Driver Analysis is a local, zero-reference review tool for asphalt driving in
Forza Horizon 6. It is a beta feature. The driver enables it and explicitly
starts and stops each recording from Configuration or with the global hotkey.

The feature does not identify the road surface, track, ideal line, apex, or
optimal gear. It does not produce a driving score or an exact time-loss claim.
The driver must record on asphalt. Each completed recording shows at most one
dominant, recurring technique problem. When no problem qualifies, the recording
shows the most frequent checked pattern as an observation instead.

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

Driver Analysis is disabled by default. Its Configuration tab is second after
HUD and contains the enable toggle, `RECORD` / `STOP` control, editable hotkey,
beta/asphalt warning, and newest-first history.

The recording state machine is:

```text
OFF → READY → WAITING → RECORDING → FINALIZING → READY
                                      └────────→ ERROR
```

- `WAITING` means recording is armed but valid telemetry has not arrived. No
  empty database session is created.
- The first valid sample creates the local session and enters `RECORDING`.
  While it records, the history shows the session as `RECORDING IN PROGRESS`
  with a `LIVE` duration and a disabled `DELETE` control.
- Samples are appended to SQLite in ordered batches rather than one command per
  packet.
- Raw packets that share a game timestamp are retained for reproducibility, but
  only the first packet at that timestamp advances the maneuver analysis.
- A telemetry gap invalidates the active maneuver evidence and recording can
  continue.
- A vehicle-identity change ends the session as interrupted. Completed
  opportunities remain available in the saved recording.
- An unfinished `recording` row is recovered as `interrupted` when FDC
  starts.

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

A history card is collapsed by default and shows the recording date, duration,
storage size, a headline block, and a one-line recording summary with distance,
average speed, top speed, and corner count.

The headline block shows the qualified problem and its instruction when the
recording has one. Otherwise it shows `MOST FREQUENT` with the pattern that has
the highest share of problems among the patterns with at least 10 checked
opportunities and at least 3 problems, for example `Front scrub — steering more
than the front tyres can take — in 18 of 133 checks (14%). Becomes a reported
problem above 40%.` When no pattern reaches that support, the card keeps the
result copy of the recording, such as `NOT ENOUGH ELIGIBLE MANEUVERS`.

A `DETAILS` control expands the statistics rows below the summary and switches
to `HIDE`. The expanded state is kept per recording while Configuration stays
open. The control is absent when the recording has no statistics.

## Local persistence and deletion

The native layer stores data in the application-data `fdc.sqlite` database:

- `driver_analysis_sessions` stores lifecycle, vehicle identity, algorithm
  version, counts, selected result, recording statistics, and approximate
  storage size;
- `driver_analysis_samples` stores the selected normalized telemetry needed to
  reproduce or improve analysis;
- `driver_analysis_opportunities` stores eligible windows and their context;
- `driver_analysis_evidence` stores detector, attribution, severity, and causal
  metrics.

Foreign keys use cascading deletion. There is no automatic retention limit.
The user deletes an individual recording with `DELETE`; after confirmation the
session, samples, opportunities, and evidence are removed together.

Only enable state, hotkey, and optional controller device name remain in browser storage under
`fdc.driver-analysis.settings.v1` (hotkeyLabel is trimmed to 80 characters and
stored only when the binding is a controller button).

When the analysis algorithm version changes, completed recordings with saved
samples are replayed locally once. Their raw samples, timestamps, vehicle
identity, and storage metadata are preserved; only derived opportunities,
evidence, and the summary result are replaced transactionally.

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
- There is no map, track identity, reference lap, ideal line, score, exact time
  loss, or optimal-gear recommendation.
