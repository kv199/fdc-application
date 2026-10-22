// Shift Lab export: the drives of one car from fdc-lab.sqlite, written as a gzip-compressed SQLite
// file with the same schema so tools/shift-lab.mjs --lab can replay it. The copy is made from one
// read transaction on the recorder's database, so it never holds a half-written drive.

use flate2::{Compression, write::GzEncoder};
use rusqlite::{Connection, OpenFlags, params, params_from_iter, types::Value};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{self, BufWriter},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::shift_lab::LAB_SCHEMA_SQL;

const FILE_NAME_PREFIX: &str = "fdc-shift-lab-";
const FILE_NAME_SUFFIX: &str = ".sqlite.gz";
const LAB_FILE_NAME: &str = "fdc-lab.sqlite";
const NO_DRIVES_MESSAGE: &str = "No Shift Lab drives are recorded for this car";
const LAB_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
// Column counts of the two copied tables; they match LAB_SCHEMA_SQL.
const SESSION_COLUMNS: usize = 11;
const PACKET_COLUMNS: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CarKey {
    ordinal: i64,
    class: i64,
    pi: i64,
    drivetrain: i64,
    cylinders: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftLabExportOutcome {
    cancelled: bool,
    bytes: u64,
}

// The suggested name comes from the Shift Light tab and must stay a plain dated file name.
pub(crate) fn validate_file_name(name: &str) -> Result<(), String> {
    let stamp = name
        .strip_prefix(FILE_NAME_PREFIX)
        .and_then(|rest| rest.strip_suffix(FILE_NAME_SUFFIX));
    match stamp {
        Some(stamp)
            if !stamp.is_empty() && stamp.chars().all(|c| c.is_ascii_digit() || c == '-') =>
        {
            Ok(())
        }
        _ => Err("Shift Lab export file name is invalid".to_string()),
    }
}

// The save dialog may drop or replace the double extension; the file always ends in .sqlite.gz.
pub(crate) fn export_path(chosen: PathBuf) -> PathBuf {
    let name = chosen
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(FILE_NAME_SUFFIX) {
        return chosen;
    }
    let stem_length = [".sqlite.gz", ".gz", ".sqlite"]
        .iter()
        .find(|suffix| lower.ends_with(*suffix))
        .map_or(name.len(), |suffix| name.len() - suffix.len());
    chosen.with_file_name(format!("{}{FILE_NAME_SUFFIX}", &name[..stem_length]))
}

// The Shift Light car key is fh6:<ordinal>:<class>:<pi>:<drivetrain>:<cylinders>.
pub(crate) fn parse_car_key(key: &str) -> Result<CarKey, String> {
    const INVALID: &str = "Shift Light car key is invalid";
    let parts: Vec<&str> = key.split(':').collect();
    let [game, ordinal, class, pi, drivetrain, cylinders] = parts.as_slice() else {
        return Err(INVALID.to_string());
    };
    if *game != "fh6" {
        return Err(INVALID.to_string());
    }
    let number = |text: &str| text.parse::<i64>().map_err(|_| INVALID.to_string());
    Ok(CarKey {
        ordinal: number(ordinal)?,
        class: number(class)?,
        pi: number(pi)?,
        drivetrain: number(drivetrain)?,
        cylinders: number(cylinders)?,
    })
}

pub(crate) fn count_car_sessions(lab: &Connection, car: CarKey) -> Result<i64, String> {
    lab.query_row(
        "SELECT COUNT(*) FROM lab_sessions
          WHERE car_ordinal = ?1 AND car_class = ?2 AND car_pi = ?3
            AND car_drivetrain = ?4 AND car_cylinders = ?5",
        params![
            car.ordinal,
            car.class,
            car.pi,
            car.drivetrain,
            car.cylinders
        ],
        |row| row.get(0),
    )
    .map_err(|error| format!("unable to read Shift Lab drives: {error}"))
}

fn open_lab(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("unable to open Shift Lab SQLite database: {error}"))?;
    connection
        .busy_timeout(LAB_BUSY_TIMEOUT)
        .map_err(|error| format!("unable to configure Shift Lab SQLite database: {error}"))?;
    Ok(connection)
}

// Checked before the save dialog opens so a car without drives fails without asking for a file.
pub(crate) fn check_car_has_drives(lab_path: &Path, car: CarKey) -> Result<(), String> {
    let lab = open_lab(lab_path)?;
    if count_car_sessions(&lab, car)? == 0 {
        return Err(NO_DRIVES_MESSAGE.to_string());
    }
    Ok(())
}

// Writes the car's drives to target. Nothing is written when the car has no drives. The temporary
// SQLite file is removed on success and on error; a failed gzip step removes the partial target.
pub(crate) fn write_car_export(lab_path: &Path, car: CarKey, target: &Path) -> Result<u64, String> {
    let mut lab = open_lab(lab_path)?;
    let source = lab
        .transaction()
        .map_err(|error| format!("unable to read Shift Lab drives: {error}"))?;
    if count_car_sessions(&source, car)? == 0 {
        return Err(NO_DRIVES_MESSAGE.to_string());
    }

    let name = target
        .file_name()
        .ok_or_else(|| "Shift Lab export path is invalid".to_string())?;
    let partial = target.with_file_name(format!("{}.partial", name.to_string_lossy()));
    let _ = fs::remove_file(&partial);
    let copied = copy_car_to_sqlite(&source, car, &partial);
    // The read transaction blocks the recorder's commits, so it ends before the slower compression.
    drop(source);
    drop(lab);
    let written = copied.and_then(|()| {
        let result = gzip_file(&partial, target);
        if result.is_err() {
            let _ = fs::remove_file(target);
        }
        result
    });
    let _ = fs::remove_file(&partial);
    written
}

// Creates the copy with the recorder's schema and moves the matching sessions and packets into it,
// keeping their ids. Sessions go first because packets reference them.
fn copy_car_to_sqlite(source: &Connection, car: CarKey, partial: &Path) -> Result<(), String> {
    let mut copy = Connection::open(partial)
        .map_err(|error| format!("unable to create Shift Lab export file: {error}"))?;
    copy.execute_batch("PRAGMA foreign_keys = ON;")
        .and_then(|()| copy.execute_batch(LAB_SCHEMA_SQL))
        .map_err(|error| format!("unable to create Shift Lab export schema: {error}"))?;

    let transaction = copy
        .transaction()
        .map_err(|error| format!("unable to write Shift Lab export: {error}"))?;
    transaction
        .execute("DELETE FROM lab_schema_version", [])
        .map_err(|error| format!("unable to write Shift Lab export: {error}"))?;
    copy_rows(
        source,
        &transaction,
        "SELECT version FROM lab_schema_version ORDER BY rowid",
        "INSERT INTO lab_schema_version (version) VALUES (?1)",
        1,
        params![],
    )?;
    copy_rows(
        source,
        &transaction,
        "SELECT id, started_at_ms, finished_at_ms, app_version, shift_light_model_version,
                car_ordinal, car_class, car_pi, car_drivetrain, car_cylinders, packet_count
           FROM lab_sessions
          WHERE car_ordinal = ?1 AND car_class = ?2 AND car_pi = ?3
            AND car_drivetrain = ?4 AND car_cylinders = ?5
          ORDER BY id",
        "INSERT INTO lab_sessions (
           id, started_at_ms, finished_at_ms, app_version, shift_light_model_version,
           car_ordinal, car_class, car_pi, car_drivetrain, car_cylinders, packet_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        SESSION_COLUMNS,
        params![
            car.ordinal,
            car.class,
            car.pi,
            car.drivetrain,
            car.cylinders
        ],
    )?;
    copy_rows(
        source,
        &transaction,
        // The session subquery lets SQLite read only this car's packets through the
        // (session_id, sequence) index instead of scanning the whole table.
        "SELECT id, session_id, sequence, received_at_ms, packet
           FROM lab_packets
          WHERE session_id IN (
                SELECT id FROM lab_sessions
                 WHERE car_ordinal = ?1 AND car_class = ?2 AND car_pi = ?3
                   AND car_drivetrain = ?4 AND car_cylinders = ?5)
          ORDER BY session_id, sequence",
        "INSERT INTO lab_packets (id, session_id, sequence, received_at_ms, packet)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        PACKET_COLUMNS,
        params![
            car.ordinal,
            car.class,
            car.pi,
            car.drivetrain,
            car.cylinders
        ],
    )?;
    transaction
        .commit()
        .map_err(|error| format!("unable to write Shift Lab export: {error}"))?;
    copy.close()
        .map_err(|(_, error)| format!("unable to finish Shift Lab export file: {error}"))
}

// Streams every row of `select` from the source into `insert` on the copy. Each column is copied
// as its stored value, so the copy keeps the source's types, NULLs and blobs unchanged.
fn copy_rows(
    source: &Connection,
    copy: &Connection,
    select: &str,
    insert: &str,
    columns: usize,
    select_params: impl rusqlite::Params,
) -> Result<(), String> {
    let mut select_statement = source
        .prepare(select)
        .map_err(|error| format!("unable to read Shift Lab drives: {error}"))?;
    let mut insert_statement = copy
        .prepare(insert)
        .map_err(|error| format!("unable to write Shift Lab export: {error}"))?;
    let mut rows = select_statement
        .query(select_params)
        .map_err(|error| format!("unable to read Shift Lab drives: {error}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("unable to read Shift Lab drives: {error}"))?
    {
        let values = (0..columns)
            .map(|index| row.get::<_, Value>(index))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("unable to read Shift Lab drives: {error}"))?;
        insert_statement
            .execute(params_from_iter(values))
            .map_err(|error| format!("unable to write Shift Lab export: {error}"))?;
    }
    Ok(())
}

fn gzip_file(source: &Path, target: &Path) -> Result<u64, String> {
    let mut input = File::open(source)
        .map_err(|error| format!("unable to read Shift Lab export file: {error}"))?;
    let output = File::create(target)
        .map_err(|error| format!("unable to create Shift Lab export: {error}"))?;
    let mut encoder = GzEncoder::new(BufWriter::new(output), Compression::default());
    io::copy(&mut input, &mut encoder)
        .map_err(|error| format!("unable to compress Shift Lab export: {error}"))?;
    let writer = encoder
        .finish()
        .map_err(|error| format!("unable to compress Shift Lab export: {error}"))?;
    let file = writer
        .into_inner()
        .map_err(|error| format!("unable to write Shift Lab export: {}", error.error()))?;
    file.sync_all()
        .map_err(|error| format!("unable to save Shift Lab export: {error}"))?;
    fs::metadata(target)
        .map(|metadata| metadata.len())
        .map_err(|error| format!("unable to read Shift Lab export size: {error}"))
}

// The save dialog and the export run off the async runtime because both block until they finish.
#[tauri::command]
pub(crate) async fn export_shift_lab_drives(
    app: AppHandle,
    car_key: String,
    file_name: String,
) -> Result<ShiftLabExportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_file_name(&file_name)?;
        let car = parse_car_key(&car_key)?;
        let lab_path = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("unable to locate the Shift Lab database: {error}"))?
            .join(LAB_FILE_NAME);
        if !lab_path.is_file() {
            return Err(NO_DRIVES_MESSAGE.to_string());
        }
        check_car_has_drives(&lab_path, car)?;
        let Some(chosen) = app
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("FDC Shift Lab export", &["gz"])
            .blocking_save_file()
        else {
            return Ok(ShiftLabExportOutcome {
                cancelled: true,
                bytes: 0,
            });
        };
        let target = export_path(
            chosen
                .into_path()
                .map_err(|error| format!("unable to use the chosen export file: {error}"))?,
        );
        let bytes = write_car_export(&lab_path, car, &target)?;
        Ok(ShiftLabExportOutcome {
            cancelled: false,
            bytes,
        })
    })
    .await
    .map_err(|error| format!("unable to export Shift Lab drives: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::GzDecoder;

    const CAR_A: CarKey = CarKey {
        ordinal: 3766,
        class: 1,
        pi: 800,
        drivetrain: 1,
        cylinders: 10,
    };
    const CAR_B: CarKey = CarKey {
        ordinal: 1234,
        class: 2,
        pi: 650,
        drivetrain: 2,
        cylinders: 8,
    };
    const CAR_UNRECORDED: CarKey = CarKey {
        ordinal: 9999,
        class: 1,
        pi: 800,
        drivetrain: 1,
        cylinders: 10,
    };

    fn test_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "fdc-shift-lab-export-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    // Two cars in one lab: session 1 and 3 belong to CAR_A (2 and 1 packets), session 2 to CAR_B (3).
    fn two_car_lab(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection.execute_batch(LAB_SCHEMA_SQL).unwrap();
        let sessions: [(i64, CarKey, i64); 3] = [(1, CAR_A, 2), (2, CAR_B, 3), (3, CAR_A, 1)];
        for (id, car, packets) in sessions {
            connection
                .execute(
                    "INSERT INTO lab_sessions (
                       id, started_at_ms, finished_at_ms, app_version, shift_light_model_version,
                       car_ordinal, car_class, car_pi, car_drivetrain, car_cylinders, packet_count
                     ) VALUES (?1, ?1, ?1, 'test', 4, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        id,
                        car.ordinal,
                        car.class,
                        car.pi,
                        car.drivetrain,
                        car.cylinders,
                        packets
                    ],
                )
                .unwrap();
            for sequence in 0..packets {
                connection
                    .execute(
                        "INSERT INTO lab_packets (session_id, sequence, received_at_ms, packet)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![id, sequence, sequence * 16, vec![0_u8; 324]],
                    )
                    .unwrap();
            }
        }
    }

    fn count(connection: &Connection, sql: &str) -> i64 {
        connection.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn export_file_names_are_plain_dated_names() {
        assert!(validate_file_name("fdc-shift-lab-20261002-1830.sqlite.gz").is_ok());
        for name in [
            "../fdc-shift-lab-1.sqlite.gz",
            "fdc-shift-lab-.sqlite.gz",
            "fdc-shift-lab-1.sqlite",
            "fdc-shift-lab-1.json.gz",
            "a.sqlite.gz",
            "fdc-shift-lab-1\\x.sqlite.gz",
        ] {
            assert_eq!(
                validate_file_name(name),
                Err("Shift Lab export file name is invalid".to_string()),
                "{name}"
            );
        }
    }

    #[test]
    fn export_path_always_ends_with_sqlite_gz() {
        let folder = PathBuf::from("exports");
        for (chosen, expected) in [
            ("a.sqlite.gz", "a.sqlite.gz"),
            ("a.SQLITE.GZ", "a.SQLITE.GZ"),
            ("a.gz", "a.sqlite.gz"),
            ("a.sqlite", "a.sqlite.gz"),
            ("a", "a.sqlite.gz"),
        ] {
            assert_eq!(export_path(folder.join(chosen)), folder.join(expected));
        }
    }

    #[test]
    fn car_keys_parse_six_integer_fields() {
        assert_eq!(parse_car_key("fh6:3766:1:800:1:10"), Ok(CAR_A));
        for key in [
            "",
            "fh5:3766:1:800:1:10",
            "fh6:3766:1:800:1",
            "fh6:3766:1:800:1:10:4",
            "fh6:3766:1:800:x:10",
            "fh6:3766:1:800:1:",
        ] {
            assert_eq!(
                parse_car_key(key),
                Err("Shift Light car key is invalid".to_string()),
                "{key}"
            );
        }
    }

    #[test]
    fn export_copies_only_the_chosen_car() {
        let directory = test_directory("chosen-car");
        let lab_path = directory.join("fdc-lab.sqlite");
        two_car_lab(&lab_path);
        let target = directory.join("fdc-shift-lab-20261002-1830.sqlite.gz");

        let bytes = write_car_export(&lab_path, CAR_A, &target).unwrap();
        assert_eq!(bytes, fs::metadata(&target).unwrap().len());

        let expanded = directory.join("expanded.sqlite");
        let mut decoder = GzDecoder::new(File::open(&target).unwrap());
        io::copy(&mut decoder, &mut File::create(&expanded).unwrap()).unwrap();
        let copy = Connection::open(&expanded).unwrap();
        assert_eq!(count(&copy, "SELECT COUNT(*) FROM lab_schema_version"), 1);
        assert_eq!(count(&copy, "SELECT version FROM lab_schema_version"), 1);
        assert_eq!(count(&copy, "SELECT COUNT(*) FROM lab_sessions"), 2);
        assert_eq!(count(&copy, "SELECT COUNT(*) FROM lab_packets"), 3);
        assert_eq!(
            count(
                &copy,
                "SELECT COUNT(*) FROM lab_sessions WHERE car_ordinal <> 3766"
            ),
            0
        );
        let ids: Vec<i64> = copy
            .prepare("SELECT id FROM lab_sessions ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ids, vec![1, 3]);
        assert_eq!(
            count(
                &copy,
                "SELECT COUNT(*) FROM lab_packets WHERE session_id = 3"
            ),
            1
        );
        drop(copy);

        assert!(
            !directory
                .join("fdc-shift-lab-20261002-1830.sqlite.gz.partial")
                .exists()
        );
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn car_without_drives_writes_nothing() {
        let directory = test_directory("no-drives");
        let lab_path = directory.join("fdc-lab.sqlite");
        two_car_lab(&lab_path);
        let target = directory.join("fdc-shift-lab-20261002-1830.sqlite.gz");

        assert_eq!(
            write_car_export(&lab_path, CAR_UNRECORDED, &target),
            Err(NO_DRIVES_MESSAGE.to_string())
        );
        assert_eq!(
            check_car_has_drives(&lab_path, CAR_UNRECORDED),
            Err(NO_DRIVES_MESSAGE.to_string())
        );
        assert!(!target.exists());
        assert!(
            !directory
                .join("fdc-shift-lab-20261002-1830.sqlite.gz.partial")
                .exists()
        );
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn lab_database_stays_unchanged_by_the_export() {
        let directory = test_directory("read-only");
        let lab_path = directory.join("fdc-lab.sqlite");
        two_car_lab(&lab_path);
        let target = directory.join("car.sqlite.gz");

        write_car_export(&lab_path, CAR_B, &target).unwrap();

        let lab = Connection::open(&lab_path).unwrap();
        assert_eq!(count(&lab, "SELECT COUNT(*) FROM lab_sessions"), 3);
        assert_eq!(count(&lab, "SELECT COUNT(*) FROM lab_packets"), 6);
        drop(lab);
        let _ = fs::remove_dir_all(&directory);
    }
}
