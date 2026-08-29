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
- The current-car block has a `VIEW` button in its lower-right corner. It
  changes to `HIDE` and reveals the current ordinal's saved configurations
  directly below the block. Escape closes that list, except while the inline
  name field owns Escape to cancel its edit. Each configuration row uses the
  Saved Cars border style and contains a Forza-style class/PI badge plus its
  recorded drivetrain. The list shows ten rows before it scrolls vertically.
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

`S32 NumCylinders` and `U32 CarGroup` are stored with the parent vehicle. Their
latest observed values replace earlier values for the same ordinal.
`S32 DrivetrainType` is retained both as the latest parent-vehicle value and as
part of each configuration identity. Garage does not retain a history of
cylinder count or CarGroup. It also cannot detect changes that leave its full
configuration identity unchanged, such as a weight reduction with unchanged
class, PI, and drivetrain.

The browser maps known numeric class values to `D`, `C`, `B`, `A`, `S1`, `S2`,
`R`, and `X`. An unrecognized numeric value remains visible as its number
rather than being guessed.

The known drivetrain values map to `FWD` (0), `RWD` (1), and `AWD` (2). An
unknown drivetrain value is left out of the current-car display rather than
being guessed.

## Shift Light association

Garage and Shift Light use the same local `fdc.sqlite` file. They retain their
separate tables and responsibilities, but a Garage configuration and Shift
Light profiles are associated by `game_id`, `car_ordinal`, and `PI`.

A Garage car may have multiple class/PI/drivetrain configurations. Each
matching configuration summarizes every persisted Shift Light tune for that car
and PI, including its
distinct RPM limits and gearbox signatures. The snapshot reports:

- `READY` when at least one calibrated per-gear target exists;
- `LEARNING` when a Shift Light tune exists without a calibrated target;
- `NOT CALIBRATED` when no Shift Light tune exists.

Shift Light remains visible only in the Shift Light tab, which provides the
live diagnostics and reset for the active numeric gearbox variant. Garage does
not render a second Shift Light status or profile control.

## Local SQLite state

Garage uses the existing FDC application-data database, `fdc.sqlite`, and
schema version 5.

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

The migration creates these tables transactionally and leaves existing Shift
Light tables and profiles intact.

Garage snapshots query `shift_light_variants` and `shift_light_profiles` to
attach the Shift Light summary by car ordinal and PI. A drivetrain change does
not alter any Shift Light key, table, or stored calibration.

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
class formatting, Shift Light summary aggregation, telemetry deduplication, and
Configuration tab structure.
