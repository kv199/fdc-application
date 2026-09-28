# Vehicle catalog

FDC names Forza Horizon 6 cars from a vehicle catalog that is built into the
application. Forza Data Out reports only a numeric `S32 CarOrdinal`; the catalog
turns that ordinal into the car's name and car type. Users cannot rename cars.

## Display rules

| Case | Name shown | Car type line (Garage current car only) |
| --- | --- | --- |
| The ordinal has a catalog entry with a car type | Catalog name, e.g. `1969 Toyota 2000GT` | Car type, e.g. `Rare Classics` |
| The ordinal has a catalog entry without a car type | Catalog name | `GROUP <value>` when the current `CarGroup` is positive |
| The ordinal is not in the catalog | `#<ordinal>`, e.g. `#4239` | `GROUP <value>` when the current `CarGroup` is positive |

The same name appears everywhere FDC shows a car: Garage, Events runs, Driver
Analysis history, and the Shift Light tab. Class and performance index always
come from live telemetry, never from the catalog.

## Data flow

```text
src-tauri/data/vehicle-catalog.json  (embedded in the executable at build time)
                    |
                    v
native vehicle catalog lookup (ordinal -> name, car type)
                    |
                    v
Garage snapshot, Event run reads, Driver Analysis history reads
                    |
                    v
Configuration window
```

The lookup happens when native commands read records. `fdc.sqlite` stores only
car ordinals, so a catalog update renames existing Garage, Events, and Driver
Analysis records without a data migration. The browser code has no car table
of its own; it formats `#<ordinal>` only for a car the native side has not
named yet, such as a run that is still being recorded.

The catalog does not add a network connection or a telemetry transport. FDC
never downloads catalog data at runtime.

## Catalog contents

`src-tauri/data/vehicle-catalog.json` lists one entry per ordinal:

```json
{ "ordinal": 247, "name": "1969 Toyota 2000GT", "carType": "Rare Classics" }
```

`carType` is `null` when the official car list has no matching car. The file
header records the source revision and fetch date.

- Placeholder entries such as `NUL_CAR_00` and AI traffic vehicles marked
  `(Traffic)` are left out; FDC shows such an ordinal as `#<ordinal>`.
- Game variants without their own official entry, such as Touge Edition or
  unobtainable versions, use the name and car type of their base car.
- The official list spells two car types inconsistently; the catalog uses
  `Rods & Customs` and `Eclectic Domestics`.

## Sources

- [HDR's Forza Horizon 6 Car Ordinals](https://gist.github.com/HDR/0659d1717bc61504bf83750628963f4f)
  maps car names to ordinals.
- The [official Forza Horizon 6 car list](https://forza.net/fh6cars) provides
  official car names and car types.

Attribution and license terms are in [Third-party notices](../THIRD_PARTY_NOTICES.md).
The catalog data is not covered by FDC's MIT License.

## Updating the catalog

`tools/update-vehicle-catalog.mjs` downloads both sources on the developer's
machine and matches each HDR name to an official name after normalizing case,
diacritics, and punctuation. Names that do not match exactly are resolved by
hand in `tools/vehicle-catalog-overrides.json`, which maps an ordinal to an
official car name, or to `null` to keep the HDR name without a car type.

1. Run a dry run and read the summary of added, removed, and changed cars:

   ```powershell
   node tools/update-vehicle-catalog.mjs
   ```

2. For every unresolved ordinal the tool lists up to five official
   candidates. Add a decision for each one to
   `tools/vehicle-catalog-overrides.json`. The tool also reports overrides that
   no longer match its sources.
3. Write the catalog. The tool refuses to write while any ordinal is unresolved
   or any override is stale:

   ```powershell
   node tools/update-vehicle-catalog.mjs --write
   ```

4. Review the `vehicle-catalog.json` diff. The catalog is compiled into the
   executable, so an update is a runtime change: it takes a patch version bump,
   an `Improved` changelog entry, and the full release verification cycle
   described in [Development](development.md).
