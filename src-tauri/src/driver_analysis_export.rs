// Driver Analysis export: one recording with every car, written as gzip-compressed JSON (format version 1).
// The file is streamed one car at a time, so a long recording is never held in memory as a whole.

use flate2::{Compression, write::GzEncoder};
use rusqlite::{Connection, Row, params, types::ValueRef};
use serde_json::{Map as JsonMap, Value as JsonValue, json};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

pub const EXPORT_FORMAT: &str = "fdc-driver-analysis-export";
pub const EXPORT_FORMAT_VERSION: i64 = 1;
const FILE_NAME_PREFIX: &str = "fdc-driver-analysis-";
const FILE_NAME_SUFFIX: &str = ".json.gz";

// The suggested name comes from the Configuration window and must stay a plain dated file name.
pub fn validate_file_name(name: &str) -> Result<(), String> {
    let stamp = name
        .strip_prefix(FILE_NAME_PREFIX)
        .and_then(|rest| rest.strip_suffix(FILE_NAME_SUFFIX));
    match stamp {
        Some(stamp)
            if !stamp.is_empty() && stamp.chars().all(|c| c.is_ascii_digit() || c == '-') =>
        {
            Ok(())
        }
        _ => Err("Driver Analysis export file name is invalid".to_string()),
    }
}

// The save dialog may drop or replace the double extension; the file always ends in .json.gz.
pub fn export_path(chosen: PathBuf) -> PathBuf {
    let name = chosen
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.to_ascii_lowercase().ends_with(FILE_NAME_SUFFIX) {
        return chosen;
    }
    let lower = name.to_ascii_lowercase();
    let stem_length = [".json.gz", ".gz", ".json"]
        .iter()
        .find(|suffix| lower.ends_with(*suffix))
        .map_or(name.len(), |suffix| name.len() - suffix.len());
    chosen.with_file_name(format!("{}{FILE_NAME_SUFFIX}", &name[..stem_length]))
}

struct RecordingHeader {
    started_at_ms: i64,
    session_ids: Vec<i64>,
    duration_ms: Option<i64>,
}

fn load_recording(connection: &Connection, recording_id: i64) -> Result<RecordingHeader, String> {
    let started_at_ms: i64 = connection
        .query_row(
            "SELECT started_at_ms FROM driver_analysis_recordings WHERE id = ?1",
            params![recording_id],
            |row| row.get(0),
        )
        .map_err(|_| "Driver Analysis recording does not exist".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, status, finished_at_ms FROM driver_analysis_sessions
              WHERE recording_id = ?1
              ORDER BY started_at_ms, id",
        )
        .map_err(|error| format!("unable to prepare Driver Analysis export: {error}"))?;
    let sessions = statement
        .query_map(params![recording_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|error| format!("unable to read Driver Analysis export cars: {error}"))?;
    if sessions.is_empty() {
        return Err("Driver Analysis recording has no cars".to_string());
    }
    if sessions.iter().any(|(_, status, _)| status == "recording") {
        return Err("Driver Analysis recording is still in progress".to_string());
    }
    let finishes: Option<Vec<i64>> = sessions.iter().map(|(_, _, finished)| *finished).collect();
    Ok(RecordingHeader {
        started_at_ms,
        session_ids: sessions.iter().map(|(id, _, _)| *id).collect(),
        duration_ms: finishes
            .and_then(|finishes| finishes.into_iter().max())
            .map(|finished| finished - started_at_ms),
    })
}

// Checked before the save dialog opens so an unexportable recording fails without asking for a file.
pub fn check_recording(connection: &Connection, recording_id: i64) -> Result<(), String> {
    load_recording(connection, recording_id).map(|_| ())
}

// Writes the export next to the target and renames it over the target only when it is complete.
pub fn write_recording_export(
    connection: &Connection,
    recording_id: i64,
    fdc_version: &str,
    target: &Path,
) -> Result<u64, String> {
    // One read transaction keeps every car of the file from the same database state.
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("unable to start Driver Analysis export: {error}"))?;
    let header = load_recording(&transaction, recording_id)?;
    let name = target
        .file_name()
        .ok_or_else(|| "Driver Analysis export path is invalid".to_string())?;
    let partial = target.with_file_name(format!(".{}.partial", name.to_string_lossy()));
    let written = (|| {
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&partial)
            .map_err(|error| format!("unable to create Driver Analysis export file: {error}"))?;
        let mut encoder = GzEncoder::new(BufWriter::new(file), Compression::default());
        write_export(&transaction, &header, fdc_version, &mut encoder)?;
        let file = encoder
            .finish()
            .map_err(|error| format!("unable to compress Driver Analysis export: {error}"))?
            .into_inner()
            .map_err(|error| format!("unable to write Driver Analysis export: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("unable to save Driver Analysis export: {error}"))?;
        fs::rename(&partial, target)
            .map_err(|error| format!("unable to save Driver Analysis export: {error}"))
    })();
    if let Err(error) = written {
        let _ = fs::remove_file(&partial);
        return Err(error);
    }
    fs::metadata(target)
        .map(|metadata| metadata.len())
        .map_err(|error| format!("unable to read Driver Analysis export size: {error}"))
}

fn io_error(error: std::io::Error) -> String {
    format!("unable to write Driver Analysis export: {error}")
}

fn write_json(out: &mut impl Write, value: &JsonValue) -> Result<(), String> {
    serde_json::to_writer(&mut *out, value)
        .map_err(|error| format!("unable to write Driver Analysis export: {error}"))
}

// Writes `"key":` so objects can be emitted field by field around the streamed samples.
fn write_key(out: &mut impl Write, key: &str, first: bool) -> Result<(), String> {
    if !first {
        out.write_all(b",").map_err(io_error)?;
    }
    write_json(out, &JsonValue::String(key.to_string()))?;
    out.write_all(b":").map_err(io_error)
}

fn write_export(
    connection: &Connection,
    header: &RecordingHeader,
    fdc_version: &str,
    out: &mut impl Write,
) -> Result<(), String> {
    let columns = sample_columns(connection)?;
    out.write_all(b"{").map_err(io_error)?;
    write_key(out, "format", true)?;
    write_json(out, &json!(EXPORT_FORMAT))?;
    write_key(out, "formatVersion", false)?;
    write_json(out, &json!(EXPORT_FORMAT_VERSION))?;
    write_key(out, "exportedWith", false)?;
    write_json(out, &json!({ "fdcVersion": fdc_version }))?;
    write_key(out, "recording", false)?;
    out.write_all(b"{").map_err(io_error)?;
    write_key(out, "startedAt", true)?;
    write_json(out, &json!(iso_utc(header.started_at_ms)))?;
    write_key(out, "durationMs", false)?;
    write_json(out, &json!(header.duration_ms))?;
    write_key(out, "sessions", false)?;
    out.write_all(b"[").map_err(io_error)?;
    for (index, session_id) in header.session_ids.iter().enumerate() {
        if index > 0 {
            out.write_all(b",").map_err(io_error)?;
        }
        write_session(connection, header, &columns, index, *session_id, out)?;
    }
    out.write_all(b"]}}").map_err(io_error)
}

fn parse_json_text(text: Option<String>, fallback: JsonValue) -> JsonValue {
    text.and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(fallback)
}

fn session_fields(
    row: &Row,
    index: usize,
    recording_start: i64,
) -> rusqlite::Result<JsonMap<String, JsonValue>> {
    let identity_text: String = row.get("vehicle_identity")?;
    let finished_at_ms: Option<i64> = row.get("finished_at_ms")?;
    let fields = json!({
        "index": index,
        "startedOffsetMs": row.get::<_, i64>("started_at_ms")? - recording_start,
        "finishedOffsetMs": finished_at_ms.map(|finished| finished - recording_start),
        "recordedWith": {
            "fdcVersion": row.get::<_, Option<String>>("app_version")?,
            "algorithmVersion": row.get::<_, String>("algorithm_version")?,
        },
        "vehicle": {
            "identity": parse_json_text(Some(identity_text.clone()), JsonValue::String(identity_text)),
            "ordinal": row.get::<_, Option<i64>>("vehicle_ordinal")?,
            "pi": row.get::<_, Option<i64>>("vehicle_pi")?,
            "drivetrain": row.get::<_, Option<i64>>("vehicle_drivetrain")?,
            "rpmLimit": row.get::<_, Option<f64>>("vehicle_rpm_limit")?,
        },
        "status": row.get::<_, String>("status")?,
        "result": row.get::<_, Option<String>>("result")?,
        "mainKind": row.get::<_, Option<String>>("main_kind")?,
        "label": row.get::<_, String>("label")?,
        "instruction": row.get::<_, String>("instruction")?,
        "detectorConfidence": row.get::<_, Option<f64>>("detector_confidence")?,
        "attributionConfidence": row.get::<_, Option<f64>>("attribution_confidence")?,
        "severity": row.get::<_, Option<f64>>("severity")?,
        "counts": {
            "samples": row.get::<_, i64>("sample_count")?,
            "maneuvers": row.get::<_, i64>("maneuver_count")?,
            "opportunities": row.get::<_, i64>("opportunity_count")?,
            "evidence": row.get::<_, i64>("evidence_count")?,
            "drives": row.get::<_, i64>("drives_recorded")?,
        },
        "storageBytes": row.get::<_, i64>("storage_bytes")?,
        "stats": parse_json_text(row.get("stats_json")?, JsonValue::Null),
    });
    Ok(match fields {
        JsonValue::Object(map) => map,
        _ => JsonMap::new(),
    })
}

fn write_session(
    connection: &Connection,
    header: &RecordingHeader,
    columns: &[String],
    index: usize,
    session_id: i64,
    out: &mut impl Write,
) -> Result<(), String> {
    let mut fields = connection
        .query_row(
            "SELECT * FROM driver_analysis_sessions WHERE id = ?1",
            params![session_id],
            |row| session_fields(row, index, header.started_at_ms),
        )
        .map_err(|error| format!("unable to read Driver Analysis export car: {error}"))?;
    fields.insert(
        "drives".to_string(),
        JsonValue::Array(load_drives(connection, session_id, header.started_at_ms)?),
    );
    let (opportunities, evidence) = load_checks(connection, session_id)?;
    fields.insert("opportunities".to_string(), JsonValue::Array(opportunities));
    fields.insert("evidence".to_string(), JsonValue::Array(evidence));

    out.write_all(b"{").map_err(io_error)?;
    for (position, (key, value)) in fields.iter().enumerate() {
        write_key(out, key, position == 0)?;
        write_json(out, value)?;
    }
    write_key(out, "samples", false)?;
    write_samples(connection, columns, session_id, out)?;
    out.write_all(b"}").map_err(io_error)
}

// Every sample column except the row ids, so columns added later are exported without a format change.
fn sample_columns(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT name FROM pragma_table_info('driver_analysis_samples') ORDER BY cid")
        .map_err(|error| format!("unable to read Driver Analysis sample columns: {error}"))?;
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map(|names| {
            names
                .into_iter()
                .filter(|name| name != "id" && name != "session_id")
                .collect()
        })
        .map_err(|error| format!("unable to read Driver Analysis sample columns: {error}"))
}

fn sample_value(value: ValueRef) -> JsonValue {
    match value {
        ValueRef::Integer(number) => JsonValue::from(number),
        ValueRef::Real(number) => {
            serde_json::Number::from_f64(number).map_or(JsonValue::Null, JsonValue::Number)
        }
        ValueRef::Text(text) => JsonValue::String(String::from_utf8_lossy(text).into_owned()),
        ValueRef::Null | ValueRef::Blob(_) => JsonValue::Null,
    }
}

// Samples are written column by column: { "columns": [...], "values": [[...], ...] }.
fn write_samples(
    connection: &Connection,
    columns: &[String],
    session_id: i64,
    out: &mut impl Write,
) -> Result<(), String> {
    let quoted: Vec<String> = columns.iter().map(|name| format!("\"{name}\"")).collect();
    let mut statement = connection
        .prepare(&format!(
            "SELECT {} FROM driver_analysis_samples WHERE session_id = ?1 ORDER BY sequence",
            quoted.join(", ")
        ))
        .map_err(|error| format!("unable to read Driver Analysis export samples: {error}"))?;
    let mut values: Vec<Vec<JsonValue>> = vec![Vec::new(); columns.len()];
    let mut rows = statement
        .query(params![session_id])
        .map_err(|error| format!("unable to read Driver Analysis export samples: {error}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("unable to read Driver Analysis export samples: {error}"))?
    {
        for (position, column) in values.iter_mut().enumerate() {
            let value = row.get_ref(position).map_err(|error| {
                format!("unable to read Driver Analysis export samples: {error}")
            })?;
            column.push(sample_value(value));
        }
    }
    out.write_all(b"{").map_err(io_error)?;
    write_key(out, "columns", true)?;
    write_json(out, &json!(columns))?;
    write_key(out, "values", false)?;
    out.write_all(b"[").map_err(io_error)?;
    for (position, column) in values.into_iter().enumerate() {
        if position > 0 {
            out.write_all(b",").map_err(io_error)?;
        }
        write_json(out, &JsonValue::Array(column))?;
    }
    out.write_all(b"]}").map_err(io_error)
}

fn load_drives(
    connection: &Connection,
    session_id: i64,
    recording_start: i64,
) -> Result<Vec<JsonValue>, String> {
    let mut statement = connection
        .prepare(
            "SELECT drive_index, kind, finished, lap_count, first_sequence, last_sequence,
                    started_at_ms, finished_at_ms, started_wall_ms, distance_m
               FROM driver_analysis_drives
              WHERE session_id = ?1
              ORDER BY drive_index",
        )
        .map_err(|error| format!("unable to read Driver Analysis export drives: {error}"))?;
    statement
        .query_map(params![session_id], |row| {
            Ok(json!({
                "index": row.get::<_, i64>(0)?,
                "kind": row.get::<_, String>(1)?,
                "finished": row.get::<_, bool>(2)?,
                "lapCount": row.get::<_, Option<i64>>(3)?,
                "firstSequence": row.get::<_, i64>(4)?,
                "lastSequence": row.get::<_, i64>(5)?,
                "startedAtMs": row.get::<_, i64>(6)?,
                "finishedAtMs": row.get::<_, i64>(7)?,
                "startedOffsetMs": row.get::<_, i64>(8)? - recording_start,
                "distanceM": row.get::<_, f64>(9)?,
            }))
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|error| format!("unable to read Driver Analysis export drives: {error}"))
}

// Opportunities in saved order and the evidence of this car only, linked by opportunity position.
fn load_checks(
    connection: &Connection,
    session_id: i64,
) -> Result<(Vec<JsonValue>, Vec<JsonValue>), String> {
    let mut statement = connection
        .prepare(
            "SELECT id, maneuver_id, opportunity_type, started_at_ms, finished_at_ms, speed_bin, gear,
                    outcome, valid, invalid_reason, context_json
               FROM driver_analysis_opportunities
              WHERE session_id = ?1
              ORDER BY id",
        )
        .map_err(|error| format!("unable to read Driver Analysis export checks: {error}"))?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                json!({
                    "maneuverId": row.get::<_, String>(1)?,
                    "opportunityType": row.get::<_, String>(2)?,
                    "startedAtMs": row.get::<_, i64>(3)?,
                    "finishedAtMs": row.get::<_, i64>(4)?,
                    "speedBin": row.get::<_, Option<i64>>(5)?,
                    "gear": row.get::<_, Option<i64>>(6)?,
                    "outcome": row.get::<_, String>(7)?,
                    "valid": row.get::<_, bool>(8)?,
                    "invalidReason": row.get::<_, Option<String>>(9)?,
                    "context": parse_json_text(row.get(10)?, json!({})),
                }),
            ))
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|error| format!("unable to read Driver Analysis export checks: {error}"))?;
    let positions: HashMap<i64, usize> = rows
        .iter()
        .enumerate()
        .map(|(position, (id, _))| (*id, position))
        .collect();
    let opportunities = rows
        .into_iter()
        .enumerate()
        .map(|(position, (_, mut opportunity))| {
            opportunity["index"] = json!(position);
            opportunity
        })
        .collect();

    let mut statement = connection
        .prepare(
            "SELECT evidence.opportunity_id, evidence.problem_type, evidence.is_primary,
                    evidence.detector_confidence, evidence.attribution_confidence, evidence.severity,
                    evidence.metrics_json
               FROM driver_analysis_evidence evidence
               JOIN driver_analysis_opportunities opportunity ON opportunity.id = evidence.opportunity_id
              WHERE opportunity.session_id = ?1
              ORDER BY opportunity.id, evidence.id",
        )
        .map_err(|error| format!("unable to read Driver Analysis export evidence: {error}"))?;
    let evidence = statement
        .query_map(params![session_id], |row| {
            Ok(json!({
                "opportunityIndex": positions.get(&row.get::<_, i64>(0)?),
                "problemType": row.get::<_, String>(1)?,
                "primary": row.get::<_, bool>(2)?,
                "detectorConfidence": row.get::<_, f64>(3)?,
                "attributionConfidence": row.get::<_, f64>(4)?,
                "severity": row.get::<_, f64>(5)?,
                "metrics": parse_json_text(row.get(6)?, json!({})),
            }))
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|error| format!("unable to read Driver Analysis export evidence: {error}"))?;
    Ok((opportunities, evidence))
}

// UTC ISO-8601 with milliseconds, using the days-to-civil conversion so no date library is needed.
fn iso_utc(epoch_ms: i64) -> String {
    let days = epoch_ms.div_euclid(86_400_000);
    let day_ms = epoch_ms.rem_euclid(86_400_000);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        day_ms / 3_600_000,
        day_ms / 60_000 % 60,
        day_ms / 1_000 % 60,
        day_ms % 1_000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_utc_formats_known_instants() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(946_684_800_123), "2000-01-01T00:00:00.123Z");
        assert_eq!(iso_utc(1_709_210_096_789), "2024-02-29T12:34:56.789Z");
        assert_eq!(iso_utc(4_102_444_800_000), "2100-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(4_107_542_400_000), "2100-03-01T00:00:00.000Z");
    }

    #[test]
    fn export_file_names_are_plain_dated_names() {
        assert!(validate_file_name("fdc-driver-analysis-20261002-1830.json.gz").is_ok());
        for name in [
            "../fdc-driver-analysis-1.json.gz",
            "fdc-driver-analysis-.json.gz",
            "fdc-driver-analysis-1.txt",
            "a.json.gz",
            "fdc-driver-analysis-1\\x.json.gz",
        ] {
            assert!(validate_file_name(name).is_err(), "{name}");
        }
    }

    #[test]
    fn export_path_always_ends_with_json_gz() {
        let folder = PathBuf::from("exports");
        for (chosen, expected) in [
            ("a.json.gz", "a.json.gz"),
            ("a.JSON.GZ", "a.JSON.GZ"),
            ("a.gz", "a.json.gz"),
            ("a.json", "a.json.gz"),
            ("a", "a.json.gz"),
        ] {
            assert_eq!(export_path(folder.join(chosen)), folder.join(expected));
        }
    }
}
