# FDC Events

## Summary

Events is a new FDC menu for a single player to create and keep a local library
of Forza Horizon 6 events. An event records the basic context of a race or
session and opens as its own, initially empty page.

## Problem and current situation

The player has no dedicated place in FDC to register the events they use. The
first version creates a stable local event record and a clear place to enter
after creation, without inventing event analysis or telemetry behavior.

## Intended user

### FDC player

- Goal: create and revisit a named event with its key race context.
- Context: using the standalone local FDC application while playing Forza
  Horizon 6.
- Key actions: browse Events, create an event, open it, rename it, archive it,
  or delete it.

## Main scenario

### Create and enter an event

- Actor: FDC player.
- Trigger: the player wants to register a race or session in FDC.
- Starting situation: the player is on the Events page, which shows event
  tiles and a Create button on the right.
- Flow:
  1. The player selects Create.
  2. A creation area opens at the bottom of the Events page.
  3. The player supplies a required event name, class, route type, and mode;
     notes are optional.
  4. The player selects Create.
  5. FDC stores the event locally and opens that event's page.
  6. The player can press Escape to return to the Events page.
- Successful result: a persisted event exists and the player is inside it.
- Important exceptions: an event cannot be created without each required
  value, including a non-empty name.

## First-version scope

### Must have

- A new Events menu; existing FDC navigation remains in its current location
  and is not redesigned for this work.
- An Events page showing a tile grid, styled consistently with Garage tiles,
  and a right-aligned Create button.
- A bottom creation area with the following fields:
  - Event name: required.
  - Class: required; `Any`, `D`, `C`, `B`, `A`, `S1`, `S2`, `R`, or `X`.
  - Route Type: required; `Asphalt`, `Rally`, or `Offroad`.
  - Mode: required; `Any`, `Rivals`, `Online`, `EventLab`, `Official`, or
    `Blueprint`.
  - Notes: optional.
  - Create action.
- Local persistence of the created event, including its entered metadata and
  optional notes.
- Navigation into the newly created event after successful creation.
- An event page that is otherwise empty in this version. It contains:
  - Escape navigation back to Events.
  - A clickable event title for inline renaming.
  - Archive and Delete actions in the upper-right area.
  - One event tile showing its name, Mode, and Route Type.
- Mode-based visual color identity, used consistently for the event tile and
  Mode representation:
  - `Any`: the existing Forza B-class color.
  - `Rivals`: the existing Forza D-class blue.
  - `Online`: the existing Forza C-class yellow.
  - `EventLab`: white.
  - `Official`: the existing Forza A-class red.
  - `Blueprint`: the existing Forza S1-class purple.

### Later

- Content, tools, analysis, telemetry behavior, or other functionality inside
  an event page.
- Additional event attributes and event-list management beyond the actions
  stated above.

### Out of scope

- A new telemetry transport, external dependency, game integration, account,
  or shared event workspace.
- Changes to existing FDC navigation structure.

## Delivery expectations

- Intended use: a small working FDC feature the player can use locally.
- Non-negotiable quality: events are persisted locally and can be entered
  immediately after creation.

## Core information

### Event

- Meaning: a player-created local record for one Forza race or session.
- Created by: the FDC player.
- Used for: recognizing and opening a known event from the Events library.
- Lifecycle: created, renamed, archived, or deleted by the player.

## Constraints and dependencies

- Events must stay within FDC's existing local application and persistence
  boundary.
- Existing FDC navigation remains unchanged.
- The event page is intentionally empty except for the required event identity
  and management controls.

## Success criteria

- A player can create an event with all required context, see it persisted in
  the Events library, enter it automatically, and return to the library with
  Escape.
- A player can identify a tile's Mode and Route Type, and Mode color is
  predictable from the confirmed mapping.
- A player can rename, archive, or delete an event from inside that event.

## Decisions

- The menu is named `Events`.
- The race-context fields are named `Class`, `Route Type`, and `Mode`.
- `Official` means a ready-made, game-authored race used without changes.
- `Blueprint` means a ready-made race whose player-controlled parameters have
  been customized.
- Asphalt includes Road, Street, and Touge races for this feature.
- The event tile displays name, Mode, and Route Type.
- Event title editing is initiated by selecting the title while inside the
  event.

## Assumptions

- Events belong to one local FDC player and are not shared. Impact if wrong:
  ownership, access, and synchronization requirements would be needed.
- Optional notes are persisted with the event but are not displayed on the
  otherwise empty event page in this version. Impact if wrong: the event page
  or tile needs an additional Notes presentation rule.

## Open questions

- What does Archive do to the default Events grid (for example, hide the event
  from it or keep it visible with an archived state)? This changes the library
  behavior.
- Does Delete require a confirmation step? This changes the irreversible-action
  flow.
