# Events

Events is FDC's local library of player-created Forza Horizon 6 events. It is
available as the Events tab in Configuration, directly after Garage. Events do
not receive telemetry, identify tracks, or add a transport outside FDC's
existing local runtime boundary.

## User experience

- **Events** shows active events as responsive tiles in the Garage card style.
  Selecting a tile opens that event.
- The Events heading has a right-aligned **CREATE** action. It opens a creation
  area at the bottom of the page.
- Creation requires an event name, Class, Route Type, and Mode. Notes are
  optional. A blank name or an unselected required field cannot be submitted.
- Class values are `Any`, `D`, `C`, `B`, `A`, `S1`, `S2`, `R`, and `X`.
- Route Type values are `Asphalt`, `Rally`, and `Offroad`. Asphalt includes the
  Road, Street, and Touge context selected by the player.
- Mode values are `Any`, `Rivals`, `Online`, `EventLab`, `Official`, and
  `Blueprint`. `Official` is an unchanged game-authored event; `Blueprint` is
  a game event with player-chosen parameters.
- A successful Create saves the event and opens its page immediately.
- An event page is intentionally empty beyond its identity tile, which shows
  the name, Mode, and Route Type. Pressing Escape returns to the Events list.
- Selecting the event title starts inline renaming. Enter or leaving the input
  saves a non-empty name; Escape cancels that rename without leaving the page.
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
timestamp. Existing Garage and Shift Light data is retained during migration.

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

Each command operates only on the existing local `fdc.sqlite` database. No
event operation modifies the Direct Data Out packet contract or the normalized
`queueTelemetry` path.
