# Garage

Garage is FDC's local vehicle library. It records the vehicles observed through
Forza Horizon 6 Data Out and presents them in the Configuration window.

## User experience

Garage is the Configuration tab immediately to the right of HUD.

- **Current car** updates immediately when a new valid vehicle telemetry sample
  is observed. It shows an empty square reserved for a future image, then the
  car name from the [vehicle catalog](vehicle-catalog.md), or `#<ordinal>` for a
  car the catalog does not know. Below the name it shows the catalog car type,
  or `GROUP <value>` for a positive current `CarGroup` when the car type is
  unknown, followed by a paired Forza-style class and performance-index badge,
  drivetrain label, and cylinder count. It does not carry a Last Used badge.
- The current-car block has a right-aligned `VIEW` button in the same detail row
  as its class/PI badge, drivetrain, and cylinder count. It changes to `HIDE`
  and reveals a separate framed configuration area directly below the block.
  Escape closes that area. Each configuration row uses the Saved Cars border style and
  shows, from left to right, a Forza-style class/PI badge, its recorded
  drivetrain, and its recorded cylinder count. The list shows ten rows before
  it scrolls vertically.
- Car names are not editable. A long current-car name wraps to two lines and a
  long saved-card name stays on one line; both end with an ellipsis when cut,
  and the full name is available as a tooltip.
- **Saved cars** is a responsive grid with one card per car ordinal. Its heading
  shows the saved count. The most recently observed car is first and carries a
  `LAST USED` badge in its upper-right corner. Every saved card is as tall as
  its image placeholder and is not editable.
- Class and performance index are displayed as the paired Forza-style badge:
  D is light blue, C yellow, B orange, A red, S1 purple, S2 dark blue, R pink,
  and X bright green. The class color also marks the left edge of a saved card.
- UI text uses player-facing values only: for example, `2112`, `S1`, and `900`.
  The `S32` and `U32` field names are internal telemetry contract terms and are
  not rendered in cards.

Forza Data Out does not provide a car name. Garage resolves the name and car
type from the built-in [vehicle catalog](vehicle-catalog.md) each time it builds
a snapshot, so it stores no names.

## Data flow

Garage does not add a telemetry transport. It is a local consumer of the
existing normalized `queueTelemetry` path:

```text
FH6 Data Out → native decoder → direct_telemetry → queueTelemetry
                                                   |
                                                   v
                                            Garage runtime
                                                   |
                                                   v
                                          local Tauri command
                                                   |
                                                   v
                                               fdc.sqlite
                                                   |
                                                   v
                                  hud_garage local event → Configuration
```

`overlay/garage-runtime.js` deduplicates consecutive observations of the same
car metadata and variant before calling the native store. The Settings window
also loads a snapshot when it opens, so it can display Garage state observed
before the window was shown.

`hud_garage` is an FDC-local browser event used only to refresh Configuration.
It is not a telemetry source and does not leave the local application.

## Vehicle identity and variants

`S32 CarOrdinal` is the unique Garage vehicle identity. A single ordinal can
have multiple observed configurations. A configuration is the distinct
combination of `S32 CarClass`, `S32 CarPerformanceIndex`, and
`S32 DrivetrainType` for that ordinal.

`U32 CarGroup` is stored with the parent vehicle and its latest observed value
replaces earlier values for the same ordinal. `S32 DrivetrainType` is retained
both as the latest parent-vehicle value and as part of each configuration
identity. `S32 NumCylinders` is retained as the latest parent-vehicle value and
as the latest observed value for each configuration, but it does not create a
new configuration. Garage does not retain a history of CarGroup or prior
cylinder counts for the same configuration. It also cannot detect changes that
leave its full configuration identity unchanged, such as a weight reduction
with unchanged class, PI, and drivetrain.

The browser maps known numeric class values to `D`, `C`, `B`, `A`, `S1`, `S2`,
`R`, and `X`. An unrecognized numeric value remains visible as its number
rather than being guessed.

The known drivetrain values map to `FWD` (0), `RWD` (1), and `AWD` (2). An
unknown drivetrain value is left out of the current-car display rather than
being guessed.

## Shift Light association

Garage and Shift Light use the same local `fdc.sqlite` file. They retain their
separate tables and responsibilities. The Shift Light learner itself uses its
full six-field configuration identity, while the Garage summary intentionally
aggregates all Shift Light configurations with the same FH6 car ordinal and PI.

A Garage car may have multiple class/PI/drivetrain configurations. Variants
with the same ordinal and PI therefore display the same aggregate Shift Light
summary even when their class, drivetrain, or cylinder count differs. The
snapshot reports:

- `READY` when at least one `OPTIMAL` per-pair target exists;
- `LEARNING` when a Shift Light configuration exists without an `OPTIMAL`
  target;
- `NOT CALIBRATED` when no Shift Light configuration exists.

Shift Light remains visible only in the Shift Light tab, which provides the
live diagnostics and reset for the active numeric configuration. Garage does
not render a second Shift Light status or profile control.

## Local SQLite state

Garage uses the existing FDC application-data database, `fdc.sqlite`. Its table
shape was introduced through schema versions 4–6; schema version 22 removes the
former user-entered `display_name` column. The current shared database schema
is version 22.

```text
garage_cars
  game_id + car_ordinal                 primary key
  car_group
  drivetrain_type
  num_cylinders
  first_seen_sequence
  last_seen_sequence

garage_variants
  id
  game_id + car_ordinal + car_class + pi + drivetrain_type unique
  num_cylinders                          latest observed for this configuration
  first_seen_sequence
  last_seen_sequence

garage_sequence
  single monotonic next_sequence value
```

The monotonic sequence determines the `LAST USED` order without relying on
second-resolution timestamps. The most recent car and its most recent
configuration are the current Garage state while FDC receives live telemetry;
after a restart, the saved snapshot displays the last observed state until a new
sample arrives.

The migration creates these tables transactionally and does not make Garage
data depend on Shift Light learning facts.

Garage snapshots query `shift_light_configs` and `shift_light_gear_targets` to
attach the aggregate Shift Light summary by car ordinal and PI. Retired Shift
Light variant/profile tables are not part of the Garage contract.

## Native commands

- `record_garage_vehicle` validates and records a vehicle observation, then
  returns a complete Garage snapshot.
- `load_garage_snapshot` returns the saved snapshot for Configuration startup.

Each snapshot car carries `name` (the catalog name or `#<ordinal>`) and
`carType` (the catalog car type or null). Garage rejects non-positive ordinals
and negative class or PI values.

## Verification

Garage changes require the standard runtime release verification cycle. Focused
coverage includes packet decoding for `CarGroup`, schema migration,
one-car/multiple-configuration persistence including drivetrain, latest-used
ordering, catalog names and car types, configuration-list keyboard behavior and
scrolling, UI class formatting and detail order, Shift Light summary aggregation, telemetry
deduplication, and Configuration tab structure.
