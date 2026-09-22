# Driver Analysis

## Purpose and product boundary

Driver Analysis is a local, zero-reference review tool for asphalt driving in
Forza Horizon 6. It is an MVP/beta feature. The driver enables it and explicitly
starts and stops each recording from Configuration or with the global hotkey.

The feature does not identify the road surface, track, ideal line, apex, or
optimal gear. It does not produce a driving score or an exact time-loss claim.
The driver must record on asphalt. Each completed recording shows at most one
dominant, recurring technique problem.

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
- Samples are appended to SQLite in ordered batches rather than one command per
  packet.
- Raw packets that share a game timestamp are retained for reproducibility, but
  only the first packet at that timestamp advances the maneuver analysis.
- A telemetry gap invalidates the active maneuver evidence and recording can
  continue.
- A vehicle-identity change ends the session as interrupted. Completed
  opportunities remain available in the saved recording.
- An unfinished `recording` row found after restart is recovered as
  `interrupted` when history is loaded.

The default hotkey is `Ctrl+Shift+F9`. Windows-key combinations, bare keys,
`Alt+F4`, `Alt+Tab`, `Ctrl+Escape`, and `Ctrl+Shift+Escape` are rejected.

## Opportunity and evidence model

The map-free state engine segments telemetry into straight, braking, turn-in,
rotation, and exit phases. It creates bounded opportunities for four supported
problem types:

| Problem | Driver input and observed response | User instruction |
| --- | --- | --- |
| `FRONT SCRUB` | More steering/front slip without improving lateral or yaw response | Reduce steering and let the front recover |
| `EXIT WHEELSPIN` | More throttle/driven-wheel slip with weak acceleration response | Build throttle after the car is settled |
| `BRAKE + STEERING OVERLOAD` | Brake and steering overlap with high combined front slip and stalled response | Release brake as steering builds |
| `ABRUPT BRAKE RELEASE` | Sharp brake release followed by response/yaw loss or rear-slip growth | Release brake smoothly through rotation |

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
| `OVERVIEW` | Distance, average speed over moving time (at least 5 km/h), and maximum speed. Distance uses the game's distance delta when it is consistent with speed and falls back to integrated speed otherwise. The recording duration is shown in the card metadata. |
| `PEDALS` | Share of moving time with full throttle (at least 95%), partial throttle, coasting, and braking. The brake share also shows the part with steering applied. |
| `BRAKING` | Braking events that start at 40 km/h or more and last 0.3–15 s: median peak deceleration, duration, release time (from the last brake level at or above 80% of that event's peak until release), and the share of events with at least 150 ms of trail braking. |
| `CORNERS` | Maneuvers of at least 0.3 s: median and 90th-percentile peak lateral acceleration, the share of turning time in which the front slip angle exceeds the rear, and how many corners were taken flat-out (full throttle and no brake throughout the turning phases). |
| `EXIT` | Corners with a throttle lift or brake application in which full throttle was reached afterwards: median time from the corner's minimum speed to full throttle and median peak longitudinal acceleration afterwards. Flat-out corners are excluded. |

The `BRAKING`, `CORNERS`, and `EXIT` rows are hidden when fewer than three
events were measured. Each row shows its event count, and hovering a row
shows the 10th–90th percentile range. The statistics are stored as versioned
JSON in the session's `stats_json` column. Finished recordings with saved samples
but missing or outdated statistics are replayed locally once to compute them.
Their results are not changed.

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

Only enable state and hotkey remain in browser storage under
`fdc.driver-analysis.settings.v1`. Results created by the previous MVP are
imported once from `fdc.driver-analysis.history.v1` into SQLite and the legacy
browser history is then cleared.

When the analysis algorithm version changes, completed recordings with saved
samples are replayed locally once. Their raw samples, timestamps, vehicle
identity, and storage metadata are preserved; only derived opportunities,
evidence, and the summary result are replaced transactionally.

## Current limitations

- Results are beta/MVP and may be inaccurate.
- The feature is asphalt-only by product boundary; telemetry does not prove the
  surface type.
- Short or inconsistent recordings commonly produce insufficient or ambiguous
  results.
- The supported findings are bounded technique patterns, not a complete
  driving assessment.
- There is no map, track identity, reference lap, ideal line, score, exact time
  loss, or optimal-gear recommendation.
