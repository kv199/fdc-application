//! Shift Light configuration and calibration: resolves the per-car learning key, loads and
//! saves calibration samples, and clears or resets a learned profile.

use std::collections::HashSet;

use rusqlite::{Connection, Error as SqliteError, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db::*;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftLightVariantResolution {
    pub(crate) variant_id: i64,
    pub(crate) status: String,
    pub(crate) ratio_features: Option<String>,
}

const SHIFT_LIGHT_LEARNING_MODEL_VERSION: i32 = 4;
const MAX_SHIFT_LIGHT_CEILING_SAMPLES: usize = 12;
const MAX_SHIFT_LIGHT_GEAR_TARGETS: usize = 9;
const MAX_SHIFT_LIGHT_SHIFT_SAMPLES: usize = 64;

#[derive(Clone, Copy)]
struct ShiftLightConfigIdentity {
    car_ordinal: i32,
    car_class: i32,
    car_performance_index: i32,
    drivetrain_type: i32,
    num_cylinders: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftLightCalibration {
    pub(crate) model_version: i32,
    pub(crate) reported_redline_rpm: Option<i32>,
    pub(crate) usable_ceiling: Option<i32>,
    pub(crate) ceiling_samples: Vec<i32>,
    pub(crate) gear_targets: Vec<ShiftLightGearTarget>,
    pub(crate) shift_samples: Vec<ShiftLightShiftSample>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftLightGearTarget {
    pub(crate) source_gear: i32,
    pub(crate) destination_gear: i32,
    pub(crate) status: String,
    pub(crate) candidate_rpm: Option<i32>,
    pub(crate) optimal_rpm: Option<i32>,
    pub(crate) confirmation_count: i32,
    /// Model-computed shift point of the pair, independent of its status.
    #[serde(default, deserialize_with = "deserialize_model_rpm")]
    pub(crate) model_rpm: Option<i32>,
}

/// A model point is optional, so a malformed value becomes NULL instead of
/// rejecting the whole calibration request.
fn deserialize_model_rpm<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(positive_rpm(&value))
}

fn positive_rpm(value: &serde_json::Value) -> Option<i32> {
    let rpm = if let Some(integer) = value.as_i64() {
        integer
    } else {
        let float = value.as_f64()?;
        if !float.is_finite() || float.fract() != 0.0 {
            return None;
        }
        float as i64
    };
    i32::try_from(rpm).ok().filter(|rpm| *rpm > 0)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftLightShiftSample {
    pub(crate) source_gear: i32,
    pub(crate) destination_gear: i32,
    pub(crate) before_timestamp_ms: i64,
    pub(crate) after_timestamp_ms: i64,
    pub(crate) before_rpm: f64,
    pub(crate) after_rpm: f64,
    #[serde(alias = "powerBeforeW")]
    pub(crate) before_power: f64,
    #[serde(alias = "powerAfterW")]
    pub(crate) after_power: f64,
    pub(crate) delta_percent: f64,
    pub(crate) classification: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftLightCalibrationRequest {
    pub(crate) key: String,
    pub(crate) config_id: i64,
    pub(crate) reported_redline_rpm: Option<i32>,
    pub(crate) usable_ceiling: Option<i32>,
    #[serde(default)]
    pub(crate) ceiling_samples: Vec<i32>,
    #[serde(default)]
    pub(crate) gear_targets: Vec<ShiftLightGearTarget>,
    #[serde(default)]
    pub(crate) shift_samples: Vec<ShiftLightShiftSample>,
}

fn parse_shift_light_config_key(key: &str) -> Result<ShiftLightConfigIdentity, String> {
    let parts = key.split(':').collect::<Vec<_>>();
    if parts.first().copied() != Some("fh6") || !(parts.len() == 6 || parts.len() == 7) {
        return Err("invalid Shift Light configuration key".to_string());
    }
    let parse = |value: Option<&str>| {
        value
            .ok_or_else(|| "invalid Shift Light configuration key".to_string())?
            .parse::<i32>()
            .map_err(|_| "invalid Shift Light configuration key".to_string())
    };
    let identity = ShiftLightConfigIdentity {
        car_ordinal: parse(parts.get(1).copied())?,
        car_class: parse(parts.get(2).copied())?,
        car_performance_index: parse(parts.get(3).copied())?,
        drivetrain_type: parse(parts.get(4).copied())?,
        num_cylinders: parse(parts.get(5).copied())?,
    };
    if identity.car_ordinal <= 0
        || identity.car_class < 0
        || identity.car_performance_index <= 0
        || identity.drivetrain_type < 0
        || identity.num_cylinders <= 0
    {
        return Err("invalid Shift Light configuration key".to_string());
    }
    Ok(identity)
}

fn key_reported_redline_rpm(key: &str) -> Result<Option<i32>, String> {
    let parts = key.split(':').collect::<Vec<_>>();
    parse_shift_light_config_key(key)?;
    if parts.len() == 7 {
        let value = parts[6]
            .parse::<i32>()
            .map_err(|_| "invalid Shift Light configuration key".to_string())?;
        if value <= 0 {
            return Err("invalid Shift Light configuration key".to_string());
        }
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn read_shift_light_config_identity(
    connection: &Connection,
    config_id: i64,
) -> Result<(ShiftLightConfigIdentity, Option<i32>, Option<i32>), String> {
    connection
        .query_row(
            "SELECT car_ordinal, car_class, car_performance_index, drivetrain_type,
                    num_cylinders, reported_redline_rpm, usable_ceiling_rpm
             FROM shift_light_configs WHERE id = ?1",
            params![config_id],
            |row| {
                Ok((
                    ShiftLightConfigIdentity {
                        car_ordinal: row.get(0)?,
                        car_class: row.get(1)?,
                        car_performance_index: row.get(2)?,
                        drivetrain_type: row.get(3)?,
                        num_cylinders: row.get(4)?,
                    },
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .map_err(|error| match error {
            SqliteError::QueryReturnedNoRows => {
                format!("Shift Light configuration {config_id} does not exist")
            }
            other => format!("unable to resolve Shift Light configuration {config_id}: {other}"),
        })
}

fn assert_shift_light_config_matches_key(
    connection: &Connection,
    config_id: i64,
    key: &str,
) -> Result<(ShiftLightConfigIdentity, Option<i32>, Option<i32>), String> {
    let (identity, reported_redline_rpm, usable_ceiling_rpm) =
        read_shift_light_config_identity(connection, config_id)?;
    let expected = parse_shift_light_config_key(key)?;
    if identity.car_ordinal != expected.car_ordinal
        || identity.car_class != expected.car_class
        || identity.car_performance_index != expected.car_performance_index
        || identity.drivetrain_type != expected.drivetrain_type
        || identity.num_cylinders != expected.num_cylinders
    {
        return Err(format!(
            "Shift Light configuration {config_id} does not match its key"
        ));
    }
    Ok((identity, reported_redline_rpm, usable_ceiling_rpm))
}

#[tauri::command(async)]
pub(crate) fn resolve_shift_light_config(
    app: AppHandle,
    key: String,
    observed_gear: i32,
    reported_redline_rpm: Option<i32>,
) -> Result<ShiftLightVariantResolution, String> {
    let mut connection = open_shift_light_db(&app)?;
    let resolution =
        resolve_shift_light_config_in_connection(&mut connection, &key, observed_gear)?;
    if let Some(redline) = reported_redline_rpm.filter(|value| *value > 0) {
        connection
            .execute(
                "UPDATE shift_light_configs SET reported_redline_rpm = ?1 WHERE id = ?2",
                params![redline, resolution.variant_id],
            )
            .map_err(|error| format!("unable to save Shift Light redline: {error}"))?;
    }
    Ok(resolution)
}

pub(crate) fn resolve_shift_light_config_in_connection(
    connection: &mut Connection,
    key: &str,
    observed_gear: i32,
) -> Result<ShiftLightVariantResolution, String> {
    if !(1..=10).contains(&observed_gear) {
        return Err("invalid observed Shift Light gear".to_string());
    }
    let identity = parse_shift_light_config_key(key)?;
    let key_redline = key_reported_redline_rpm(key)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| {
            format!("unable to start Shift Light configuration resolution: {error}")
        })?;
    let existing: Option<i64> = transaction
        .query_row(
            "SELECT id FROM shift_light_configs
             WHERE game_id = 'fh6' AND car_ordinal = ?1 AND car_class = ?2
               AND car_performance_index = ?3 AND drivetrain_type = ?4
               AND num_cylinders = ?5
             ORDER BY last_seen_at DESC, id DESC LIMIT 1",
            params![
                identity.car_ordinal,
                identity.car_class,
                identity.car_performance_index,
                identity.drivetrain_type,
                identity.num_cylinders
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("unable to resolve current Shift Light configuration: {error}"))?;
    let config_id = if let Some(existing) = existing {
        existing
    } else {
        transaction
            .execute(
                "INSERT INTO shift_light_configs
                 (game_id, car_ordinal, car_class, car_performance_index, drivetrain_type,
                  num_cylinders, reported_redline_rpm, model_version)
                 VALUES ('fh6', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    identity.car_ordinal,
                    identity.car_class,
                    identity.car_performance_index,
                    identity.drivetrain_type,
                    identity.num_cylinders,
                    key_redline,
                    SHIFT_LIGHT_LEARNING_MODEL_VERSION
                ],
            )
            .map_err(|error| {
                format!("unable to create current Shift Light configuration: {error}")
            })?;
        transaction.last_insert_rowid()
    };
    if let Some(redline) = key_redline {
        transaction
            .execute(
                "UPDATE shift_light_configs
                 SET reported_redline_rpm = ?1, last_seen_at = CURRENT_TIMESTAMP
                 WHERE id = ?2",
                params![redline, config_id],
            )
            .map_err(|error| format!("unable to update current Shift Light redline: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE shift_light_configs SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![config_id],
        )
        .map_err(|error| format!("unable to update current Shift Light configuration: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit current Shift Light configuration: {error}"))?;
    Ok(ShiftLightVariantResolution {
        variant_id: config_id,
        status: "ready".to_string(),
        ratio_features: None,
    })
}

pub(crate) fn load_shift_light_calibration_from_connection(
    connection: &Connection,
    key: &str,
    config_id: i64,
) -> Result<ShiftLightCalibration, String> {
    assert_shift_light_config_matches_key(connection, config_id, key)?;
    let (reported_redline_rpm, usable_ceiling): (Option<i32>, Option<i32>) = connection
        .query_row(
            "SELECT reported_redline_rpm, usable_ceiling_rpm
               FROM shift_light_configs WHERE id = ?1",
            params![config_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("unable to load Shift Light configuration: {error}"))?;
    let ceiling_samples = connection
        .prepare(
            "SELECT rpm FROM shift_light_ceiling_samples
              WHERE config_id = ?1 ORDER BY id ASC",
        )
        .and_then(|mut statement| {
            statement
                .query_map(params![config_id], |row| row.get(0))
                .and_then(|rows| rows.collect::<Result<Vec<i32>, _>>())
        })
        .map_err(|error| format!("unable to load Shift Light ceiling samples: {error}"))?;
    let mut target_statement = connection
        .prepare(
            "SELECT source_gear, destination_gear, status, candidate_rpm,
                    optimal_rpm, confirmation_count, model_rpm
               FROM shift_light_gear_targets
              WHERE config_id = ?1 ORDER BY source_gear, destination_gear",
        )
        .map_err(|error| format!("unable to prepare Shift Light target query: {error}"))?;
    let gear_targets = target_statement
        .query_map(params![config_id], |row| {
            Ok(ShiftLightGearTarget {
                source_gear: row.get(0)?,
                destination_gear: row.get(1)?,
                status: row.get(2)?,
                candidate_rpm: row.get(3)?,
                optimal_rpm: row.get(4)?,
                confirmation_count: row.get(5)?,
                model_rpm: row.get(6)?,
            })
        })
        .map_err(|error| format!("unable to load Shift Light targets: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Shift Light targets: {error}"))?;
    let mut sample_statement = connection
        .prepare(
            "SELECT source_gear, destination_gear, before_timestamp_ms,
                    after_timestamp_ms, before_rpm, after_rpm, before_power_w,
                    after_power_w, delta_percent, classification
               FROM shift_light_shift_samples
              WHERE config_id = ?1 ORDER BY id ASC",
        )
        .map_err(|error| format!("unable to prepare Shift Light sample query: {error}"))?;
    let shift_samples = sample_statement
        .query_map(params![config_id], |row| {
            Ok(ShiftLightShiftSample {
                source_gear: row.get(0)?,
                destination_gear: row.get(1)?,
                before_timestamp_ms: row.get(2)?,
                after_timestamp_ms: row.get(3)?,
                before_rpm: row.get(4)?,
                after_rpm: row.get(5)?,
                before_power: row.get(6)?,
                after_power: row.get(7)?,
                delta_percent: row.get(8)?,
                classification: row.get(9)?,
            })
        })
        .map_err(|error| format!("unable to load Shift Light samples: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Shift Light samples: {error}"))?;
    Ok(ShiftLightCalibration {
        model_version: SHIFT_LIGHT_LEARNING_MODEL_VERSION,
        reported_redline_rpm,
        usable_ceiling,
        ceiling_samples,
        gear_targets,
        shift_samples,
    })
}

pub(crate) fn save_shift_light_calibration_in_connection(
    connection: &mut Connection,
    request: &ShiftLightCalibrationRequest,
) -> Result<(), String> {
    if request.config_id < 1 {
        return Err("invalid Shift Light configuration id".to_string());
    }
    assert_shift_light_config_matches_key(connection, request.config_id, &request.key)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Shift Light calibration save: {error}"))?;
    transaction
        .execute(
            "UPDATE shift_light_configs
                SET reported_redline_rpm = COALESCE(?1, reported_redline_rpm),
                    usable_ceiling_rpm = ?2,
                    model_version = ?3, last_seen_at = CURRENT_TIMESTAMP
              WHERE id = ?4",
            params![
                request.reported_redline_rpm.filter(|value| *value > 0),
                request.usable_ceiling.filter(|value| *value > 0),
                SHIFT_LIGHT_LEARNING_MODEL_VERSION,
                request.config_id
            ],
        )
        .map_err(|error| format!("unable to update Shift Light calibration: {error}"))?;
    for table in [
        "shift_light_ceiling_samples",
        "shift_light_gear_targets",
        "shift_light_shift_samples",
    ] {
        transaction
            .execute(
                &format!("DELETE FROM {table} WHERE config_id = ?1"),
                params![request.config_id],
            )
            .map_err(|error| format!("unable to replace Shift Light calibration: {error}"))?;
    }
    // Requests arrive oldest first, so keep the latest observations by skipping the oldest.
    let positive_ceiling_samples: Vec<i32> = request
        .ceiling_samples
        .iter()
        .copied()
        .filter(|rpm| *rpm > 0)
        .collect();
    let keep_from = positive_ceiling_samples
        .len()
        .saturating_sub(MAX_SHIFT_LIGHT_CEILING_SAMPLES);
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO shift_light_ceiling_samples (config_id, rpm)
             VALUES (?1, ?2)",
        )
        .map_err(|error| format!("unable to save Shift Light ceiling sample: {error}"))?;
    for rpm in positive_ceiling_samples.into_iter().skip(keep_from) {
        statement
            .execute(params![request.config_id, rpm])
            .map_err(|error| format!("unable to save Shift Light ceiling sample: {error}"))?;
    }
    drop(statement);
    let mut target_pairs = HashSet::new();
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO shift_light_gear_targets
               (config_id, source_gear, destination_gear, status, candidate_rpm,
                optimal_rpm, confirmation_count, model_rpm)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(|error| format!("unable to save Shift Light target: {error}"))?;
    for target in request
        .gear_targets
        .iter()
        .take(MAX_SHIFT_LIGHT_GEAR_TARGETS)
    {
        if !(1..=9).contains(&target.source_gear)
            || !(1..=10).contains(&target.destination_gear)
            || target.destination_gear != target.source_gear + 1
            || !matches!(target.status.as_str(), "learning" | "potential" | "optimal")
            || !match target.status.as_str() {
                "learning" => {
                    target.candidate_rpm.is_none()
                        && target.optimal_rpm.is_none()
                        && target.confirmation_count == 0
                }
                "potential" => {
                    target.candidate_rpm.is_some_and(|value| value > 0)
                        && target.optimal_rpm.is_none()
                        && (1..=2).contains(&target.confirmation_count)
                }
                "optimal" => {
                    target.candidate_rpm.is_some_and(|value| value > 0)
                        && target.optimal_rpm.is_some_and(|value| value > 0)
                        && target.confirmation_count == 3
                }
                _ => false,
            }
            || !target_pairs.insert((target.source_gear, target.destination_gear))
        {
            continue;
        }
        statement
            .execute(params![
                request.config_id,
                target.source_gear,
                target.destination_gear,
                target.status,
                target.candidate_rpm.filter(|value| *value > 0),
                target.optimal_rpm.filter(|value| *value > 0),
                target.confirmation_count.clamp(0, 3),
                target.model_rpm.filter(|value| *value > 0)
            ])
            .map_err(|error| format!("unable to save Shift Light target: {error}"))?;
    }
    drop(statement);
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO shift_light_shift_samples
               (config_id, source_gear, destination_gear, before_timestamp_ms,
                after_timestamp_ms, before_rpm, after_rpm, before_power_w,
                after_power_w, delta_percent, classification)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .map_err(|error| format!("unable to save Shift Light sample: {error}"))?;
    for sample in request
        .shift_samples
        .iter()
        .take(MAX_SHIFT_LIGHT_SHIFT_SAMPLES)
    {
        if !(1..=9).contains(&sample.source_gear)
            || !(1..=10).contains(&sample.destination_gear)
            || sample.destination_gear != sample.source_gear + 1
            || sample.before_timestamp_ms < 0
            || sample.after_timestamp_ms < 0
            || sample.after_timestamp_ms < sample.before_timestamp_ms
            || sample.before_rpm <= 0.0
            || sample.after_rpm <= 0.0
            || !sample.before_power.is_finite()
            || !sample.after_power.is_finite()
            || sample.before_power <= 0.0
            || sample.after_power <= 0.0
            || !sample.delta_percent.is_finite()
            || !matches!(sample.classification.as_str(), "not_better" | "crossover")
            || (sample.classification == "crossover" && sample.delta_percent < 0.0)
            || (sample.classification == "not_better" && sample.delta_percent >= 0.0)
        {
            continue;
        }
        statement
            .execute(params![
                request.config_id,
                sample.source_gear,
                sample.destination_gear,
                sample.before_timestamp_ms,
                sample.after_timestamp_ms,
                sample.before_rpm,
                sample.after_rpm,
                sample.before_power,
                sample.after_power,
                sample.delta_percent,
                sample.classification
            ])
            .map_err(|error| format!("unable to save Shift Light sample: {error}"))?;
    }
    drop(statement);
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light calibration: {error}"))
}

#[tauri::command(async)]
pub(crate) fn load_shift_light_calibration(
    app: AppHandle,
    key: String,
    config_id: i64,
) -> Result<ShiftLightCalibration, String> {
    let connection = open_shift_light_db(&app)?;
    load_shift_light_calibration_from_connection(&connection, &key, config_id)
}

#[tauri::command(async)]
pub(crate) fn save_shift_light_calibration(
    app: AppHandle,
    request: ShiftLightCalibrationRequest,
) -> Result<(), String> {
    let mut connection = open_shift_light_db(&app)?;
    save_shift_light_calibration_in_connection(&mut connection, &request)
}

#[tauri::command(async)]
pub(crate) fn clear_shift_light_config(
    app: AppHandle,
    config_id: i64,
    gearbox_signature: Option<String>,
) -> Result<(), String> {
    let _ = gearbox_signature;
    let mut connection = open_shift_light_db(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Shift Light configuration clear: {error}"))?;
    for table in [
        "shift_light_ceiling_samples",
        "shift_light_gear_targets",
        "shift_light_shift_samples",
    ] {
        transaction
            .execute(
                &format!("DELETE FROM {table} WHERE config_id = ?1"),
                params![config_id],
            )
            .map_err(|error| format!("unable to clear Shift Light learning data: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE shift_light_configs
                SET reported_redline_rpm = reported_redline_rpm,
                    usable_ceiling_rpm = NULL,
                    last_seen_at = CURRENT_TIMESTAMP
              WHERE id = ?1",
            params![config_id],
        )
        .map_err(|error| format!("unable to update Shift Light configuration: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light configuration clear: {error}"))
}

#[tauri::command]
pub(crate) fn reset_shift_light(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main HUD window is not available".to_string());
    };
    window
        .eval("window.HudOverlay?.resetShiftLight?.()")
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_shift_light_key_accepts_optional_redline_without_identity_change() {
        let identity = parse_shift_light_config_key("fh6:3766:1:800:1:10").unwrap();
        let other = parse_shift_light_config_key("fh6:3766:1:800:1:10:10300").unwrap();
        assert_eq!(identity.car_ordinal, other.car_ordinal);
        assert_eq!(key_reported_redline_rpm("fh6:3766:1:800:1:10"), Ok(None));
        assert_eq!(
            key_reported_redline_rpm("fh6:3766:1:800:1:10:10300"),
            Ok(Some(10300))
        );
    }

    #[test]
    fn saves_the_latest_twelve_ceiling_samples_in_order() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let key = "fh6:3766:1:800:1:10:10300";
        let config = resolve_shift_light_config_in_connection(&mut connection, key, 4).unwrap();
        let oldest_to_latest: Vec<i32> = (9001..=9014).collect();
        let request = ShiftLightCalibrationRequest {
            key: key.to_string(),
            config_id: config.variant_id,
            reported_redline_rpm: Some(10300),
            usable_ceiling: Some(9010),
            ceiling_samples: oldest_to_latest.clone(),
            gear_targets: Vec::new(),
            shift_samples: Vec::new(),
        };
        save_shift_light_calibration_in_connection(&mut connection, &request).unwrap();
        let loaded =
            load_shift_light_calibration_from_connection(&connection, key, config.variant_id)
                .unwrap();
        assert_eq!(loaded.ceiling_samples, oldest_to_latest[2..].to_vec());
        assert_eq!(
            loaded.ceiling_samples.len(),
            MAX_SHIFT_LIGHT_CEILING_SAMPLES
        );
        assert_eq!(loaded.ceiling_samples.first(), Some(&9003));
        assert_eq!(loaded.ceiling_samples.last(), Some(&9014));
    }

    fn saved_model_points(request: serde_json::Value) -> (Vec<(i32, Option<i32>)>, String) {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let key = "fh6:3766:1:800:1:10:10300";
        let config = resolve_shift_light_config_in_connection(&mut connection, key, 4).unwrap();
        let mut request = request;
        request["key"] = serde_json::json!(key);
        request["configId"] = serde_json::json!(config.variant_id);
        let request: ShiftLightCalibrationRequest = serde_json::from_value(request).unwrap();
        save_shift_light_calibration_in_connection(&mut connection, &request).unwrap();
        let loaded =
            load_shift_light_calibration_from_connection(&connection, key, config.variant_id)
                .unwrap();
        let points = loaded
            .gear_targets
            .iter()
            .map(|target| (target.source_gear, target.model_rpm))
            .collect();
        (points, serde_json::to_string(&loaded).unwrap())
    }

    #[test]
    fn round_trips_the_model_point_of_each_gear_pair() {
        let (points, json) = saved_model_points(serde_json::json!({
            "reportedRedlineRpm": 10300,
            "usableCeiling": 10250,
            "gearTargets": [
                { "sourceGear": 1, "destinationGear": 2, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": 7500 },
                { "sourceGear": 2, "destinationGear": 3, "status": "optimal",
                  "candidateRpm": 9000, "optimalRpm": 9050, "confirmationCount": 3,
                  "modelRpm": 9001 },
                { "sourceGear": 3, "destinationGear": 4, "status": "potential",
                  "candidateRpm": 9100, "optimalRpm": null, "confirmationCount": 1,
                  "modelRpm": null }
            ]
        }));
        assert_eq!(points, vec![(1, Some(7500)), (2, Some(9001)), (3, None)]);
        assert!(json.contains("\"modelRpm\":7500"));
        assert!(json.contains("\"modelRpm\":null"));
    }

    #[test]
    fn saves_targets_without_a_model_point_and_drops_malformed_ones_to_null() {
        let (points, json) = saved_model_points(serde_json::json!({
            "reportedRedlineRpm": 10300,
            "usableCeiling": null,
            "gearTargets": [
                { "sourceGear": 1, "destinationGear": 2, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0 },
                { "sourceGear": 2, "destinationGear": 3, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": 0 },
                { "sourceGear": 3, "destinationGear": 4, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": -7000 },
                { "sourceGear": 4, "destinationGear": 5, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": "7500" },
                { "sourceGear": 5, "destinationGear": 6, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": 7500.5 },
                { "sourceGear": 6, "destinationGear": 7, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": 99999999999u64 },
                { "sourceGear": 7, "destinationGear": 8, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": 8200.0 },
                { "sourceGear": 8, "destinationGear": 10, "status": "learning",
                  "candidateRpm": null, "optimalRpm": null, "confirmationCount": 0,
                  "modelRpm": 8000 }
            ]
        }));
        assert_eq!(
            points,
            vec![
                (1, None),
                (2, None),
                (3, None),
                (4, None),
                (5, None),
                (6, None),
                (7, Some(8200))
            ]
        );
        assert!(!json.contains("\"modelRpm\":8000"));
    }
}
