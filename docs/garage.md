# Garage

Garage is FDC's local vehicle library. It records the vehicles observed through
Forza Horizon 6 Data Out and presents them in the Configuration window.

## User experience

Garage is the Configuration tab immediately to the right of HUD.

- **Current car** updates immediately when a new valid vehicle telemetry sample
  is observed. It shows an empty square reserved for a future image, then the
  saved vehicle name or its numeric car ordinal. A positive current `CarGroup`
  value is displayed below that name as `GROUP <value>`, followed by a paired
  Forza-style class and performance-index badge, drivetrain label, and cylinder
  count. It does not carry a Last Used badge.
- The current-car block has a right-aligned `VIEW` button in the same detail row
  as its class/PI badge, drivetrain, and cylinder count. It changes to `HIDE`
  and reveals a separate framed configuration area directly below the block.
  Escape closes that area, except while the inline name field owns Escape to
  cancel its edit. Each configuration row uses the Saved Cars border style and
  shows, from left to right, a Forza-style class/PI badge, its recorded
  drivetrain, and its recorded cylinder count. The list shows ten rows before
  it scrolls vertically.
- Clicking the current vehicle name or ordinal opens an inline name field. Enter
  or leaving the field saves the name; Escape cancels the edit. An empty saved
  name returns the display to the numeric ordinal.
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

Forza Data Out does not provide a stock car name. A saved name is a local user
label for the matching car ordinal; it does not modify the game.

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
shape was introduced through schema versions 4–6; the current shared database
schema is version 15.

```text
garage_cars
  game_id + car_ordinal                 primary key
  car_group
  drivetrain_type
  num_cylinders
  display_name                          nullable local label
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
- `rename_garage_car` stores or clears a local name for one existing ordinal.

Garage rejects non-positive ordinals and negative class or PI values. Names are
trimmed and limited to 80 characters.

## Verification

Garage changes require the standard runtime release verification cycle. Focused
coverage includes packet decoding for `CarGroup`, schema migration,
one-car/multiple-configuration persistence including drivetrain, latest-used
ordering, renaming, configuration-list keyboard behavior and scrolling, UI
class formatting and detail order, Shift Light summary aggregation, telemetry
deduplication, and Configuration tab structure.
