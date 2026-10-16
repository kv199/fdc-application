//! Driver Analysis storage: recordings, sessions, samples, finalized results, drives, and the
//! Tauri commands that the Driver Analysis overlay uses to create, finish, and export them.

use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::{db::*, driver_analysis_export};

const DRIVER_ANALYSIS_STATS_MAX_BYTES: usize = 16 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisSessionInput {
    pub(crate) algorithm_version: String,
    pub(crate) vehicle_identity: JsonValue,
    pub(crate) started_at_ms: i64,
    pub(crate) vehicle_ordinal: Option<i32>,
    pub(crate) vehicle_pi: Option<i32>,
    pub(crate) vehicle_drivetrain: Option<i32>,
    pub(crate) vehicle_rpm_limit: Option<f64>,
    #[serde(default)]
    pub(crate) recording_id: Option<i64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisSampleInput {
    sequence: i64,
    timestamp_ms: i64,
    speed_kmh: f64,
    throttle: f64,
    brake: f64,
    steer: f64,
    gear: i32,
    rpm: f64,
    rpm_max: f64,
    acceleration_x: f64,
    acceleration_y: f64,
    acceleration_z: f64,
    yaw_rate: f64,
    slip_ratio: [f64; 4],
    slip_angle: [f64; 4],
    combined_slip: [f64; 4],
    tire_temp_c: [f64; 4],
    suspension: [f64; 4],
    rumble: [bool; 4],
    puddle: [f64; 4],
    lap_time: f64,
    lap_number: i32,
    lap_distance: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    position: Option<[f64; 3]>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisOpportunityInput {
    maneuver_id: String,
    opportunity_type: String,
    started_at_ms: i64,
    finished_at_ms: i64,
    speed_bin: Option<i32>,
    gear: Option<i32>,
    outcome: String,
    valid: bool,
    invalid_reason: Option<String>,
    context_json: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisEvidenceInput {
    opportunity_index: usize,
    problem_type: String,
    primary: bool,
    detector_confidence: f64,
    attribution_confidence: f64,
    severity: f64,
    metrics_json: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisFinalResultInput {
    result: String,
    main_kind: Option<String>,
    label: String,
    instruction: String,
    detector_confidence: Option<f64>,
    attribution_confidence: Option<f64>,
    severity: Option<f64>,
    #[serde(default)]
    stats_json: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisDriveInput {
    kind: String,
    finished: bool,
    lap_count: Option<i32>,
    first_sequence: i64,
    last_sequence: i64,
    started_at_ms: i64,
    finished_at_ms: i64,
    started_wall_ms: i64,
    distance_m: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriverAnalysisDriveRecord {
    id: i64,
    drive_index: i32,
    kind: String,
    finished: bool,
    lap_count: Option<i32>,
    started_at_ms: i64,
    finished_at_ms: i64,
    started_wall_ms: i64,
    duration_ms: i64,
    distance_m: f64,
    first_sequence: i64,
    last_sequence: i64,
    problem_counts: JsonValue,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisHistoryRecord {
    id: i64,
    recorded_at: i64,
    started_at: i64,
    finished_at: Option<i64>,
    duration_ms: i64,
    status: String,
    result: Option<String>,
    main_kind: Option<String>,
    label: String,
    instruction: String,
    sample_count: i64,
    maneuver_count: i64,
    opportunity_count: i64,
    evidence_count: i64,
    detector_confidence: Option<f64>,
    attribution_confidence: Option<f64>,
    severity: Option<f64>,
    storage_bytes: i64,
    algorithm_version: String,
    vehicle_identity: JsonValue,
    stats: Option<JsonValue>,
    recording_id: i64,
    vehicle_name: Option<String>,
    drives_recorded: bool,
    drives: Vec<DriverAnalysisDriveRecord>,
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn validate_finite(value: f64, field: &str) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("Driver Analysis {field} must be finite"))
    }
}

fn validate_confidence(value: Option<f64>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        validate_finite(value, field)?;
        if !(0.0..=1.0).contains(&value) {
            return Err(format!("Driver Analysis {field} must be between 0 and 1"));
        }
    }
    Ok(())
}

fn validate_json_text(value: Option<&str>, field: &str) -> Result<String, String> {
    let text = value.unwrap_or("{}");
    let parsed: JsonValue = serde_json::from_str(text)
        .map_err(|error| format!("Driver Analysis {field} must be valid JSON: {error}"))?;
    serde_json::to_string(&parsed)
        .map_err(|error| format!("Driver Analysis {field} cannot be serialized: {error}"))
}

fn validate_stats_json(value: &str) -> Result<String, String> {
    let text = validate_json_text(Some(value), "statsJson")?;
    if !text.starts_with('{') {
        return Err("Driver Analysis statsJson must be an object".to_string());
    }
    if text.len() > DRIVER_ANALYSIS_STATS_MAX_BYTES {
        return Err("Driver Analysis statsJson is too large".to_string());
    }
    Ok(text)
}

fn json_identity(value: &JsonValue) -> Result<String, String> {
    if value.is_null() {
        return Err("Driver Analysis vehicle identity is required".to_string());
    }
    let text = serde_json::to_string(value)
        .map_err(|error| format!("Driver Analysis vehicle identity is invalid: {error}"))?;
    if text.len() > 4096 {
        return Err("Driver Analysis vehicle identity is too large".to_string());
    }
    Ok(text)
}

fn validate_sample(sample: &DriverAnalysisSampleInput) -> Result<(), String> {
    if sample.sequence < 0 || sample.timestamp_ms < 0 {
        return Err(
            "Driver Analysis sample sequence and timestamp must be non-negative".to_string(),
        );
    }
    if sample.gear < 0 || sample.lap_number < 0 {
        return Err("Driver Analysis sample gear and lap number must be non-negative".to_string());
    }
    for (field, value) in [
        ("speedKmh", sample.speed_kmh),
        ("throttle", sample.throttle),
        ("brake", sample.brake),
        ("steer", sample.steer),
        ("rpm", sample.rpm),
        ("rpmMax", sample.rpm_max),
        ("accelerationX", sample.acceleration_x),
        ("accelerationY", sample.acceleration_y),
        ("accelerationZ", sample.acceleration_z),
        ("yawRate", sample.yaw_rate),
        ("lapTime", sample.lap_time),
        ("lapDistance", sample.lap_distance),
    ] {
        validate_finite(value, field)?;
    }
    for (name, values) in [
        ("slipRatio", &sample.slip_ratio),
        ("slipAngle", &sample.slip_angle),
        ("combinedSlip", &sample.combined_slip),
        ("tireTempC", &sample.tire_temp_c),
        ("suspension", &sample.suspension),
        ("puddle", &sample.puddle),
    ] {
        for value in values {
            validate_finite(*value, name)?;
        }
    }
    if let Some([x, y, z]) = sample.position {
        validate_finite(x, "position[0]")?;
        validate_finite(y, "position[1]")?;
        validate_finite(z, "position[2]")?;
    }
    Ok(())
}

fn validate_session_input(input: &DriverAnalysisSessionInput) -> Result<String, String> {
    if input.started_at_ms < 0 {
        return Err("Driver Analysis session start time must be non-negative".to_string());
    }
    let algorithm_version = input.algorithm_version.trim();
    if algorithm_version.is_empty() || algorithm_version.len() > 120 {
        return Err("Driver Analysis algorithm version is invalid".to_string());
    }
    if let Some(value) = input.vehicle_rpm_limit {
        validate_finite(value, "vehicleRpmLimit")?;
        if value < 0.0 {
            return Err("Driver Analysis vehicle RPM limit must be non-negative".to_string());
        }
    }
    if input.vehicle_ordinal.is_some_and(|value| value <= 0)
        || input.vehicle_pi.is_some_and(|value| value < 0)
        || input.vehicle_drivetrain.is_some_and(|value| value < 0)
    {
        return Err("Driver Analysis vehicle identity fields are invalid".to_string());
    }
    json_identity(&input.vehicle_identity)?;
    Ok(algorithm_version.to_string())
}

pub(crate) fn create_driver_analysis_session_in_connection(
    connection: &mut Connection,
    input: &DriverAnalysisSessionInput,
) -> Result<i64, String> {
    let algorithm_version = validate_session_input(input)?;
    let recording_id = if let Some(id) = input.recording_id {
        if id <= 0 {
            return Err("Driver Analysis recording id must be positive".to_string());
        }
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM driver_analysis_recordings WHERE id = ?1)",
                params![id],
                |row| row.get(0),
            )
            .map_err(|error| format!("unable to verify Driver Analysis recording: {error}"))?;
        if !exists {
            return Err("Driver Analysis recording does not exist".to_string());
        }
        id
    } else {
        let now = now_epoch_ms();
        connection
            .execute(
                "INSERT INTO driver_analysis_recordings (started_at_ms) VALUES (?1)",
                params![now],
            )
            .map_err(|error| format!("unable to create Driver Analysis recording: {error}"))?;
        connection.last_insert_rowid()
    };
    connection
        .execute(
            "INSERT INTO driver_analysis_sessions
               (started_at_ms, status, algorithm_version, vehicle_identity,
                vehicle_ordinal, vehicle_pi, vehicle_drivetrain, vehicle_rpm_limit, recording_id, app_version)
             VALUES (?1, 'recording', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.started_at_ms,
                algorithm_version,
                serde_json::to_string(&input.vehicle_identity).unwrap(),
                input.vehicle_ordinal,
                input.vehicle_pi,
                input.vehicle_drivetrain,
                input.vehicle_rpm_limit,
                recording_id,
                env!("CARGO_PKG_VERSION"),
            ],
        )
        .map_err(|error| format!("unable to create Driver Analysis session: {error}"))?;
    Ok(connection.last_insert_rowid())
}

fn append_driver_analysis_samples_in_connection(
    connection: &mut Connection,
    session_id: i64,
    samples: &[DriverAnalysisSampleInput],
) -> Result<usize, String> {
    if session_id <= 0 {
        return Err("Driver Analysis session id must be positive".to_string());
    }
    if samples.is_empty() {
        return Err("Driver Analysis sample batch cannot be empty".to_string());
    }
    for sample in samples {
        validate_sample(sample)?;
    }
    let status: Option<String> = connection
        .query_row(
            "SELECT status FROM driver_analysis_sessions WHERE id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("unable to inspect Driver Analysis session: {error}"))?;
    if status.as_deref() != Some("recording") {
        return Err("Driver Analysis session is not recording".to_string());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Driver Analysis sample batch: {error}"))?;
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO driver_analysis_samples
               (session_id, sequence, timestamp_ms, speed_kmh, throttle, brake, steer,
                gear, rpm, rpm_max, acceleration_x, acceleration_y, acceleration_z, yaw_rate,
                slip_ratio_fl, slip_ratio_fr, slip_ratio_rl, slip_ratio_rr,
                slip_angle_fl, slip_angle_fr, slip_angle_rl, slip_angle_rr,
                combined_slip_fl, combined_slip_fr, combined_slip_rl, combined_slip_rr,
                tire_temp_fl, tire_temp_fr, tire_temp_rl, tire_temp_rr,
                suspension_fl, suspension_fr, suspension_rl, suspension_rr,
                rumble_fl, rumble_fr, rumble_rl, rumble_rr,
                puddle_fl, puddle_fr, puddle_rl, puddle_rr,
                lap_time, lap_number, lap_distance, position_x, position_y, position_z)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                     ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
                     ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38,
                     ?39, ?40, ?41, ?42, ?43, ?44, ?45, ?46, ?47, ?48)",
        )
        .map_err(|error| format!("unable to append Driver Analysis samples: {error}"))?;
    for sample in samples {
        let (position_x, position_y, position_z) = sample
            .position
            .map(|[x, y, z]| (Some(x), Some(y), Some(z)))
            .unwrap_or((None, None, None));
        statement
            .execute(params![
                session_id,
                sample.sequence,
                sample.timestamp_ms,
                sample.speed_kmh,
                sample.throttle,
                sample.brake,
                sample.steer,
                sample.gear,
                sample.rpm,
                sample.rpm_max,
                sample.acceleration_x,
                sample.acceleration_y,
                sample.acceleration_z,
                sample.yaw_rate,
                sample.slip_ratio[0],
                sample.slip_ratio[1],
                sample.slip_ratio[2],
                sample.slip_ratio[3],
                sample.slip_angle[0],
                sample.slip_angle[1],
                sample.slip_angle[2],
                sample.slip_angle[3],
                sample.combined_slip[0],
                sample.combined_slip[1],
                sample.combined_slip[2],
                sample.combined_slip[3],
                sample.tire_temp_c[0],
                sample.tire_temp_c[1],
                sample.tire_temp_c[2],
                sample.tire_temp_c[3],
                sample.suspension[0],
                sample.suspension[1],
                sample.suspension[2],
                sample.suspension[3],
                sample.rumble[0],
                sample.rumble[1],
                sample.rumble[2],
                sample.rumble[3],
                sample.puddle[0],
                sample.puddle[1],
                sample.puddle[2],
                sample.puddle[3],
                sample.lap_time,
                sample.lap_number,
                sample.lap_distance,
                position_x,
                position_y,
                position_z,
            ])
            .map_err(|error| format!("unable to append Driver Analysis samples: {error}"))?;
    }
    drop(statement);
    let storage_bytes = (samples.len() * std::mem::size_of::<DriverAnalysisSampleInput>()) as i64;
    transaction
        .execute(
            "UPDATE driver_analysis_sessions
             SET sample_count = sample_count + ?1,
                 storage_bytes = storage_bytes + ?2
             WHERE id = ?3",
            params![samples.len() as i64, storage_bytes, session_id],
        )
        .map_err(|error| format!("unable to update Driver Analysis sample metadata: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis sample batch: {error}"))?;
    Ok(samples.len())
}

fn load_driver_analysis_samples_in_connection(
    connection: &Connection,
    session_id: i64,
    after_sequence: i64,
    limit: i64,
) -> Result<Vec<DriverAnalysisSampleInput>, String> {
    if session_id <= 0 || after_sequence < -1 || !(1..=5000).contains(&limit) {
        return Err("Driver Analysis sample page is invalid".to_string());
    }
    let mut statement = connection
        .prepare(
            "SELECT sequence, timestamp_ms, speed_kmh, throttle, brake, steer, gear, rpm, rpm_max,
                    acceleration_x, acceleration_y, acceleration_z, yaw_rate,
                    slip_ratio_fl, slip_ratio_fr, slip_ratio_rl, slip_ratio_rr,
                    slip_angle_fl, slip_angle_fr, slip_angle_rl, slip_angle_rr,
                    combined_slip_fl, combined_slip_fr, combined_slip_rl, combined_slip_rr,
                    tire_temp_fl, tire_temp_fr, tire_temp_rl, tire_temp_rr,
                    suspension_fl, suspension_fr, suspension_rl, suspension_rr,
                    rumble_fl, rumble_fr, rumble_rl, rumble_rr,
                    puddle_fl, puddle_fr, puddle_rl, puddle_rr,
                    lap_time, lap_number, lap_distance, position_x, position_y, position_z
               FROM driver_analysis_samples
              WHERE session_id = ?1 AND sequence > ?2
              ORDER BY sequence
              LIMIT ?3",
        )
        .map_err(|error| format!("unable to prepare Driver Analysis sample replay: {error}"))?;
    let rows = statement
        .query_map(params![session_id, after_sequence, limit], |row| {
            let x: Option<f64> = row.get(44)?;
            let y: Option<f64> = row.get(45)?;
            let z: Option<f64> = row.get(46)?;
            Ok(DriverAnalysisSampleInput {
                sequence: row.get(0)?,
                timestamp_ms: row.get(1)?,
                speed_kmh: row.get(2)?,
                throttle: row.get(3)?,
                brake: row.get(4)?,
                steer: row.get(5)?,
                gear: row.get(6)?,
                rpm: row.get(7)?,
                rpm_max: row.get(8)?,
                acceleration_x: row.get(9)?,
                acceleration_y: row.get(10)?,
                acceleration_z: row.get(11)?,
                yaw_rate: row.get(12)?,
                slip_ratio: [row.get(13)?, row.get(14)?, row.get(15)?, row.get(16)?],
                slip_angle: [row.get(17)?, row.get(18)?, row.get(19)?, row.get(20)?],
                combined_slip: [row.get(21)?, row.get(22)?, row.get(23)?, row.get(24)?],
                tire_temp_c: [row.get(25)?, row.get(26)?, row.get(27)?, row.get(28)?],
                suspension: [row.get(29)?, row.get(30)?, row.get(31)?, row.get(32)?],
                rumble: [row.get(33)?, row.get(34)?, row.get(35)?, row.get(36)?],
                puddle: [row.get(37)?, row.get(38)?, row.get(39)?, row.get(40)?],
                lap_time: row.get(41)?,
                lap_number: row.get(42)?,
                lap_distance: row.get(43)?,
                position: match (x, y, z) {
                    (Some(x), Some(y), Some(z)) => Some([x, y, z]),
                    _ => None,
                },
            })
        })
        .map_err(|error| format!("unable to load Driver Analysis sample replay: {error}"))?;
    rows.map(|row| {
        row.map_err(|error| format!("unable to read Driver Analysis sample replay: {error}"))
    })
    .collect()
}

fn validate_final_result(input: &DriverAnalysisFinalResultInput) -> Result<(), String> {
    if !matches!(
        input.result.as_str(),
        "issue" | "insufficient" | "ambiguous" | "no_recurring_problem" | "interrupted"
    ) {
        return Err("unknown Driver Analysis result".to_string());
    }
    validate_confidence(input.detector_confidence, "detectorConfidence")?;
    validate_confidence(input.attribution_confidence, "attributionConfidence")?;
    validate_confidence(input.severity, "severity")?;
    if input.label.len() > 240 || input.instruction.len() > 1000 {
        return Err("Driver Analysis result text is too long".to_string());
    }
    if input.result == "issue" {
        if input.main_kind.as_deref().unwrap_or("").trim().is_empty()
            || input.label.trim().is_empty()
            || input.instruction.trim().is_empty()
        {
            return Err(
                "Driver Analysis issue result requires kind, label, and instruction".to_string(),
            );
        }
    }
    Ok(())
}

fn validate_drives(drives: &[DriverAnalysisDriveInput]) -> Result<(), String> {
    for (idx, drive) in drives.iter().enumerate() {
        if !matches!(drive.kind.as_str(), "circuit" | "sprint") {
            return Err(format!(
                "Driver Analysis drive {idx} kind must be 'circuit' or 'sprint'"
            ));
        }
        if let Some(lap_count) = drive.lap_count {
            if lap_count < 1 {
                return Err(format!("Driver Analysis drive {idx} lapCount must be >= 1"));
            }
        }
        if drive.first_sequence < 0 || drive.last_sequence < drive.first_sequence {
            return Err(format!(
                "Driver Analysis drive {idx} sequences must be non-negative and ordered"
            ));
        }
        if drive.started_at_ms < 0 || drive.finished_at_ms < drive.started_at_ms {
            return Err(format!("Driver Analysis drive {idx} times must be ordered"));
        }
        validate_finite(drive.distance_m, "distanceM")?;
        if drive.distance_m < 0.0 {
            return Err(format!("Driver Analysis drive {idx} distance must be >= 0"));
        }
    }
    Ok(())
}

fn save_driver_analysis_result_in_connection(
    connection: &mut Connection,
    session_id: i64,
    opportunities: &[DriverAnalysisOpportunityInput],
    evidence: &[DriverAnalysisEvidenceInput],
    result: &DriverAnalysisFinalResultInput,
    algorithm_version: Option<&str>,
    drives: Option<&[DriverAnalysisDriveInput]>,
) -> Result<DriverAnalysisHistoryRecord, String> {
    if session_id <= 0 {
        return Err("Driver Analysis session id must be positive".to_string());
    }
    let algorithm_version = match algorithm_version {
        Some(value) => {
            let value = value.trim();
            if value.is_empty() || value.len() > 120 {
                return Err("Driver Analysis algorithm version is invalid".to_string());
            }
            Some(value)
        }
        None => None,
    };
    validate_final_result(result)?;
    let stats_json = result
        .stats_json
        .as_deref()
        .map(validate_stats_json)
        .transpose()?;
    if let Some(drives_list) = drives {
        validate_drives(drives_list)?;
    }
    let mut maneuver_ids = HashSet::new();
    for opportunity in opportunities {
        if opportunity.maneuver_id.trim().is_empty() || opportunity.maneuver_id.len() > 120 {
            return Err("Driver Analysis maneuver id is invalid".to_string());
        }
        if opportunity.opportunity_type.trim().is_empty() || opportunity.opportunity_type.len() > 80
        {
            return Err("Driver Analysis opportunity type is invalid".to_string());
        }
        if opportunity.started_at_ms < 0 || opportunity.finished_at_ms < opportunity.started_at_ms {
            return Err("Driver Analysis opportunity time range is invalid".to_string());
        }
        if !matches!(
            opportunity.outcome.as_str(),
            "clean" | "problem" | "ambiguous" | "incomplete"
        ) {
            return Err("unknown Driver Analysis opportunity outcome".to_string());
        }
        let context_json = validate_json_text(opportunity.context_json.as_deref(), "contextJson")?;
        if !opportunity.valid
            && opportunity
                .invalid_reason
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            return Err("invalid Driver Analysis opportunities require a reason".to_string());
        }
        if opportunity.valid && opportunity.outcome == "incomplete" {
            return Err("complete Driver Analysis opportunities cannot be incomplete".to_string());
        }
        let _ = context_json;
        maneuver_ids.insert(opportunity.maneuver_id.clone());
    }
    for item in evidence {
        if item.opportunity_index >= opportunities.len() {
            return Err("Driver Analysis evidence references an unknown opportunity".to_string());
        }
        if item.problem_type.trim().is_empty() || item.problem_type.len() > 80 {
            return Err("Driver Analysis evidence problem type is invalid".to_string());
        }
        validate_confidence(Some(item.detector_confidence), "detectorConfidence")?;
        validate_confidence(Some(item.attribution_confidence), "attributionConfidence")?;
        validate_confidence(Some(item.severity), "severity")?;
        validate_json_text(item.metrics_json.as_deref(), "metricsJson")?;
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Driver Analysis finalization: {error}"))?;
    let current_state: Option<(String, String, i64)> = transaction
        .query_row(
            "SELECT status, algorithm_version, sample_count
               FROM driver_analysis_sessions WHERE id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| format!("unable to inspect Driver Analysis session: {error}"))?;
    let Some((current_status, current_algorithm_version, sample_count)) = current_state else {
        return Err("Driver Analysis session does not exist".to_string());
    };
    if let Some(target_version) = algorithm_version {
        if current_status != "completed" || sample_count <= 0 {
            return Err("Driver Analysis session is not eligible for reanalysis".to_string());
        }
        if current_algorithm_version == target_version {
            transaction.commit().map_err(|error| {
                format!("unable to finish Driver Analysis reanalysis check: {error}")
            })?;
            return load_driver_analysis_session_from_connection(connection, session_id);
        }
        transaction
            .execute(
                "DELETE FROM driver_analysis_opportunities WHERE session_id = ?1",
                params![session_id],
            )
            .map_err(|error| format!("unable to replace Driver Analysis opportunities: {error}"))?;
    } else if current_status != "recording" {
        return Err("Driver Analysis session is not recording".to_string());
    }

    // Delete existing drives if reanalyzing or if new drives are provided
    if let Some(drives_list) = drives {
        transaction
            .execute(
                "DELETE FROM driver_analysis_drives WHERE session_id = ?1",
                params![session_id],
            )
            .map_err(|error| format!("unable to replace Driver Analysis drives: {error}"))?;
        let mut statement = transaction
            .prepare_cached(
                "INSERT INTO driver_analysis_drives
                   (session_id, drive_index, kind, finished, lap_count, first_sequence, last_sequence,
                    started_at_ms, finished_at_ms, started_wall_ms, distance_m)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .map_err(|error| format!("unable to save Driver Analysis drive: {error}"))?;
        for (drive_index, drive) in drives_list.iter().enumerate() {
            statement
                .execute(params![
                    session_id,
                    drive_index as i32,
                    drive.kind,
                    drive.finished as i32,
                    drive.lap_count,
                    drive.first_sequence,
                    drive.last_sequence,
                    drive.started_at_ms,
                    drive.finished_at_ms,
                    drive.started_wall_ms,
                    drive.distance_m,
                ])
                .map_err(|error| format!("unable to save Driver Analysis drive: {error}"))?;
        }
    }

    let mut opportunity_ids = Vec::with_capacity(opportunities.len());
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO driver_analysis_opportunities
               (session_id, maneuver_id, opportunity_type, started_at_ms, finished_at_ms,
                speed_bin, gear, outcome, valid, invalid_reason, context_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .map_err(|error| format!("unable to save Driver Analysis opportunity: {error}"))?;
    for opportunity in opportunities {
        let context_json = validate_json_text(opportunity.context_json.as_deref(), "contextJson")?;
        statement
            .execute(params![
                session_id,
                opportunity.maneuver_id,
                opportunity.opportunity_type,
                opportunity.started_at_ms,
                opportunity.finished_at_ms,
                opportunity.speed_bin,
                opportunity.gear,
                opportunity.outcome,
                opportunity.valid,
                opportunity.invalid_reason,
                context_json,
            ])
            .map_err(|error| format!("unable to save Driver Analysis opportunity: {error}"))?;
        opportunity_ids.push(transaction.last_insert_rowid());
    }
    drop(statement);
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO driver_analysis_evidence
               (opportunity_id, problem_type, is_primary, detector_confidence,
                attribution_confidence, severity, metrics_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(|error| format!("unable to save Driver Analysis evidence: {error}"))?;
    for item in evidence {
        let metrics_json = validate_json_text(item.metrics_json.as_deref(), "metricsJson")?;
        statement
            .execute(params![
                opportunity_ids[item.opportunity_index],
                item.problem_type,
                item.primary,
                item.detector_confidence,
                item.attribution_confidence,
                item.severity,
                metrics_json,
            ])
            .map_err(|error| format!("unable to save Driver Analysis evidence: {error}"))?;
    }
    drop(statement);
    let finished_at_ms = now_epoch_ms();
    let primary_evidence_count = evidence.iter().filter(|item| item.primary).count();
    let status = if result.result == "interrupted" {
        "interrupted"
    } else {
        "completed"
    };
    let main_kind = if result.result == "issue" {
        result.main_kind.as_deref()
    } else {
        None
    };
    let label = if result.result == "issue" {
        result.label.trim()
    } else {
        ""
    };
    let instruction = if result.result == "issue" {
        result.instruction.trim()
    } else {
        ""
    };
    let drives_recorded_flag = if drives.is_some() { 1 } else { 0 };
    transaction
        .execute(
            "UPDATE driver_analysis_sessions
             SET finished_at_ms = COALESCE(?1, finished_at_ms), status = ?2, result = ?3, main_kind = ?4,
                 label = ?5, instruction = ?6, maneuver_count = ?7,
                 opportunity_count = ?8, evidence_count = ?9,
                 detector_confidence = ?10, attribution_confidence = ?11, severity = ?12,
                 algorithm_version = COALESCE(?13, algorithm_version),
                 stats_json = COALESCE(?15, stats_json),
                 drives_recorded = CASE WHEN ?16 = 1 THEN 1 ELSE drives_recorded END
             WHERE id = ?14",
            params![
                if algorithm_version.is_some() { None } else { Some(finished_at_ms) },
                status,
                result.result,
                main_kind,
                label,
                instruction,
                maneuver_ids.len() as i64,
                opportunities.len() as i64,
                primary_evidence_count as i64,
                result.detector_confidence,
                result.attribution_confidence,
                result.severity,
                algorithm_version,
                session_id,
                stats_json,
                drives_recorded_flag,
            ],
        )
        .map_err(|error| format!("unable to finalize Driver Analysis session: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis finalization: {error}"))?;
    load_driver_analysis_session_from_connection(connection, session_id)
}

fn finalize_driver_analysis_session_in_connection(
    connection: &mut Connection,
    session_id: i64,
    opportunities: &[DriverAnalysisOpportunityInput],
    evidence: &[DriverAnalysisEvidenceInput],
    result: &DriverAnalysisFinalResultInput,
    drives: Option<&[DriverAnalysisDriveInput]>,
) -> Result<DriverAnalysisHistoryRecord, String> {
    save_driver_analysis_result_in_connection(
        connection,
        session_id,
        opportunities,
        evidence,
        result,
        None,
        drives,
    )
}

fn history_record_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<DriverAnalysisHistoryRecord> {
    let started_at: i64 = row.get(1)?;
    let finished_at: Option<i64> = row.get(2)?;
    let vehicle_identity_text: String = row.get(17)?;
    let vehicle_identity = serde_json::from_str(&vehicle_identity_text)
        .unwrap_or(JsonValue::String(vehicle_identity_text));
    let stats = row
        .get::<_, Option<String>>(19)?
        .and_then(|text| serde_json::from_str::<JsonValue>(&text).ok())
        .filter(JsonValue::is_object);
    let recording_id: i64 = row.get(20)?;
    let vehicle_name: Option<String> = row.get(21)?;
    let drives_recorded: i32 = row.get(22)?;
    Ok(DriverAnalysisHistoryRecord {
        id: row.get(0)?,
        recorded_at: started_at,
        started_at,
        finished_at,
        duration_ms: finished_at.map_or(0, |value| value.saturating_sub(started_at)),
        status: row.get(3)?,
        result: row.get(4)?,
        main_kind: row.get(5)?,
        label: row.get(6)?,
        instruction: row.get(7)?,
        sample_count: row.get(8)?,
        maneuver_count: row.get(9)?,
        opportunity_count: row.get(10)?,
        evidence_count: row.get(11)?,
        detector_confidence: row.get(12)?,
        attribution_confidence: row.get(13)?,
        severity: row.get(14)?,
        storage_bytes: row.get(15)?,
        algorithm_version: row.get(16)?,
        vehicle_identity,
        stats,
        recording_id,
        vehicle_name,
        drives_recorded: drives_recorded != 0,
        drives: Vec::new(),
    })
}

const DRIVER_ANALYSIS_HISTORY_SELECT: &str =
    "SELECT id, started_at_ms, finished_at_ms, status, result, main_kind, label, instruction,
            sample_count, maneuver_count, opportunity_count, evidence_count,
            detector_confidence, attribution_confidence, severity, storage_bytes,
            algorithm_version, vehicle_identity, vehicle_ordinal, stats_json,
            recording_id, garage_cars.display_name, drives_recorded
       FROM driver_analysis_sessions
       LEFT JOIN garage_cars
         ON garage_cars.game_id = 'fh6'
        AND garage_cars.car_ordinal = driver_analysis_sessions.vehicle_ordinal";

fn load_drives_for_session(
    connection: &Connection,
    session_id: i64,
) -> Result<Vec<DriverAnalysisDriveRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, drive_index, kind, finished, lap_count, started_at_ms, finished_at_ms,
                    started_wall_ms, distance_m, first_sequence, last_sequence
               FROM driver_analysis_drives
              WHERE session_id = ?1
              ORDER BY drive_index",
        )
        .map_err(|error| format!("unable to prepare Driver Analysis drives query: {error}"))?;
    let rows = statement
        .query_map(params![session_id], |row| {
            let started: i64 = row.get(5)?;
            let finished: i64 = row.get(6)?;
            Ok(DriverAnalysisDriveRecord {
                id: row.get(0)?,
                drive_index: row.get(1)?,
                kind: row.get(2)?,
                finished: row.get::<_, i32>(3)? != 0,
                lap_count: row.get(4)?,
                started_at_ms: started,
                finished_at_ms: finished,
                started_wall_ms: row.get(7)?,
                duration_ms: finished.saturating_sub(started),
                distance_m: row.get(8)?,
                first_sequence: row.get(9)?,
                last_sequence: row.get(10)?,
                problem_counts: JsonValue::Object(Default::default()),
            })
        })
        .map_err(|error| format!("unable to load Driver Analysis drives: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to read Driver Analysis drives: {error}"))?;

    // Load problem counts for each drive
    let mut drives = rows;
    for drive in &mut drives {
        let mut counts: std::collections::BTreeMap<String, i32> = std::collections::BTreeMap::new();
        let mut stmt = connection
            .prepare(
                "SELECT opportunity_type, COUNT(*)
                   FROM driver_analysis_opportunities
                  WHERE session_id = ?1
                    AND outcome = 'problem'
                    AND started_at_ms >= ?2
                    AND started_at_ms <= ?3
                  GROUP BY opportunity_type",
            )
            .map_err(|error| format!("unable to prepare problem count query: {error}"))?;
        let mut rows = stmt
            .query(params![
                session_id,
                drive.started_at_ms,
                drive.finished_at_ms
            ])
            .map_err(|error| format!("unable to query problem counts: {error}"))?;
        while let Some(row) = rows
            .next()
            .map_err(|error| format!("unable to read problem count row: {error}"))?
        {
            let opp_type: String = row
                .get(0)
                .map_err(|error| format!("unable to read opportunity type: {error}"))?;
            let count: i32 = row
                .get(1)
                .map_err(|error| format!("unable to read problem count: {error}"))?;
            counts.insert(opp_type, count);
        }
        drive.problem_counts =
            serde_json::to_value(counts).unwrap_or(JsonValue::Object(Default::default()));
    }
    Ok(drives)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisCheckRecord {
    id: i64,
    opportunity_type: String,
    started_at_ms: i64,
    finished_at_ms: i64,
    outcome: String,
    problem_type: Option<String>,
    metrics: Option<JsonValue>,
}

// The checks of one drive for its map: every valid clean or problem opportunity that starts inside the time range,
// with the metrics its evidence recorded.
fn load_driver_analysis_checks_in_connection(
    connection: &Connection,
    session_id: i64,
    started_at_ms: i64,
    finished_at_ms: i64,
) -> Result<Vec<DriverAnalysisCheckRecord>, String> {
    if session_id <= 0 || started_at_ms < 0 || finished_at_ms < started_at_ms {
        return Err("Driver Analysis check range is invalid".to_string());
    }
    let mut statement = connection
        .prepare(
            "SELECT opportunities.id, opportunities.opportunity_type, opportunities.started_at_ms,
                    opportunities.finished_at_ms, opportunities.outcome,
                    evidence.problem_type, evidence.metrics_json
               FROM driver_analysis_opportunities AS opportunities
               LEFT JOIN driver_analysis_evidence AS evidence
                 ON evidence.opportunity_id = opportunities.id
              WHERE opportunities.session_id = ?1
                AND opportunities.valid = 1
                AND opportunities.outcome IN ('clean', 'problem')
                AND opportunities.started_at_ms BETWEEN ?2 AND ?3
              ORDER BY opportunities.started_at_ms, opportunities.id",
        )
        .map_err(|error| format!("unable to prepare Driver Analysis checks query: {error}"))?;
    statement
        .query_map(params![session_id, started_at_ms, finished_at_ms], |row| {
            let metrics_json: Option<String> = row.get(6)?;
            Ok(DriverAnalysisCheckRecord {
                id: row.get(0)?,
                opportunity_type: row.get(1)?,
                started_at_ms: row.get(2)?,
                finished_at_ms: row.get(3)?,
                outcome: row.get(4)?,
                problem_type: row.get(5)?,
                metrics: metrics_json
                    .and_then(|text| serde_json::from_str::<JsonValue>(&text).ok())
                    .filter(JsonValue::is_object),
            })
        })
        .map_err(|error| format!("unable to load Driver Analysis checks: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to read Driver Analysis checks: {error}"))
}

fn load_driver_analysis_sessions_from_connection(
    connection: &Connection,
) -> Result<Vec<DriverAnalysisHistoryRecord>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{DRIVER_ANALYSIS_HISTORY_SELECT} ORDER BY started_at_ms DESC, id DESC"
        ))
        .map_err(|error| format!("unable to load Driver Analysis history: {error}"))?;
    let mut records = statement
        .query_map([], history_record_from_row)
        .map_err(|error| format!("unable to load Driver Analysis history: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to read Driver Analysis history: {error}"))?;

    for record in &mut records {
        record.drives = load_drives_for_session(connection, record.id)?;
    }
    Ok(records)
}

pub(crate) fn recover_driver_analysis_sessions_in_connection(
    connection: &Connection,
) -> Result<usize, String> {
    let now = now_epoch_ms();
    connection
        .execute(
            "UPDATE driver_analysis_sessions
             SET status = 'interrupted', result = 'interrupted',
                 finished_at_ms = COALESCE(finished_at_ms, ?1)
             WHERE status = 'recording'",
            params![now],
        )
        .map_err(|error| format!("unable to recover Driver Analysis sessions: {error}"))
}

fn load_driver_analysis_session_from_connection(
    connection: &Connection,
    session_id: i64,
) -> Result<DriverAnalysisHistoryRecord, String> {
    if session_id <= 0 {
        return Err("Driver Analysis session id must be positive".to_string());
    }
    let mut record = connection
        .query_row(
            &format!("{DRIVER_ANALYSIS_HISTORY_SELECT} WHERE id = ?1"),
            params![session_id],
            history_record_from_row,
        )
        .map_err(|error| format!("unable to load Driver Analysis session: {error}"))?;
    record.drives = load_drives_for_session(connection, session_id)?;
    Ok(record)
}

fn save_driver_analysis_stats_in_connection(
    connection: &Connection,
    session_id: i64,
    stats_json: &str,
) -> Result<DriverAnalysisHistoryRecord, String> {
    if session_id <= 0 {
        return Err("Driver Analysis session id must be positive".to_string());
    }
    let stats_json = validate_stats_json(stats_json)?;
    let changed = connection
        .execute(
            "UPDATE driver_analysis_sessions SET stats_json = ?1
             WHERE id = ?2 AND status <> 'recording'",
            params![stats_json, session_id],
        )
        .map_err(|error| format!("unable to save Driver Analysis statistics: {error}"))?;
    if changed == 0 {
        return Err("Driver Analysis session is not eligible for statistics".to_string());
    }
    load_driver_analysis_session_from_connection(connection, session_id)
}

fn create_driver_analysis_recording_in_connection(
    connection: &mut Connection,
    started_at_ms: i64,
) -> Result<i64, String> {
    if started_at_ms < 0 {
        return Err("Driver Analysis recording start time must be non-negative".to_string());
    }
    connection
        .execute(
            "INSERT INTO driver_analysis_recordings (started_at_ms) VALUES (?1)",
            params![started_at_ms],
        )
        .map_err(|error| format!("unable to create Driver Analysis recording: {error}"))?;
    Ok(connection.last_insert_rowid())
}

fn delete_driver_analysis_recording_in_connection(
    connection: &mut Connection,
    recording_id: i64,
) -> Result<(), String> {
    if recording_id <= 0 {
        return Err("Driver Analysis recording id must be positive".to_string());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Driver Analysis recording deletion: {error}"))?;
    let changed = transaction
        .execute(
            "DELETE FROM driver_analysis_recordings WHERE id = ?1",
            params![recording_id],
        )
        .map_err(|error| format!("unable to delete Driver Analysis recording: {error}"))?;
    if changed == 0 {
        return Err("Driver Analysis recording does not exist".to_string());
    }
    transaction
        .execute(
            "DELETE FROM driver_analysis_sessions WHERE recording_id = ?1",
            params![recording_id],
        )
        .map_err(|error| format!("unable to delete Driver Analysis sessions: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis recording deletion: {error}"))
}

#[tauri::command(async)]
pub(crate) fn create_driver_analysis_session(
    app: AppHandle,
    input: DriverAnalysisSessionInput,
) -> Result<i64, String> {
    let mut connection = open_shift_light_db(&app)?;
    create_driver_analysis_session_in_connection(&mut connection, &input)
}

#[tauri::command(async)]
pub(crate) fn append_driver_analysis_samples(
    app: AppHandle,
    session_id: i64,
    samples: Vec<DriverAnalysisSampleInput>,
) -> Result<usize, String> {
    let mut connection = open_shift_light_db(&app)?;
    append_driver_analysis_samples_in_connection(&mut connection, session_id, &samples)
}

#[tauri::command(async)]
pub(crate) fn finalize_driver_analysis_session(
    app: AppHandle,
    session_id: i64,
    opportunities: Vec<DriverAnalysisOpportunityInput>,
    evidence: Vec<DriverAnalysisEvidenceInput>,
    result: DriverAnalysisFinalResultInput,
    drives: Option<Vec<DriverAnalysisDriveInput>>,
) -> Result<DriverAnalysisHistoryRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    finalize_driver_analysis_session_in_connection(
        &mut connection,
        session_id,
        &opportunities,
        &evidence,
        &result,
        drives.as_deref(),
    )
}

#[tauri::command(async)]
pub(crate) fn load_driver_analysis_checks(
    app: AppHandle,
    session_id: i64,
    started_at_ms: i64,
    finished_at_ms: i64,
) -> Result<Vec<DriverAnalysisCheckRecord>, String> {
    let connection = open_shift_light_db(&app)?;
    load_driver_analysis_checks_in_connection(
        &connection,
        session_id,
        started_at_ms,
        finished_at_ms,
    )
}

#[tauri::command(async)]
pub(crate) fn load_driver_analysis_samples(
    app: AppHandle,
    session_id: i64,
    after_sequence: i64,
    limit: i64,
) -> Result<Vec<DriverAnalysisSampleInput>, String> {
    let connection = open_shift_light_db(&app)?;
    load_driver_analysis_samples_in_connection(&connection, session_id, after_sequence, limit)
}

#[tauri::command(async)]
pub(crate) fn reanalyze_driver_analysis_session(
    app: AppHandle,
    session_id: i64,
    algorithm_version: String,
    opportunities: Vec<DriverAnalysisOpportunityInput>,
    evidence: Vec<DriverAnalysisEvidenceInput>,
    result: DriverAnalysisFinalResultInput,
) -> Result<DriverAnalysisHistoryRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    save_driver_analysis_result_in_connection(
        &mut connection,
        session_id,
        &opportunities,
        &evidence,
        &result,
        Some(&algorithm_version),
        None,
    )
}

#[tauri::command(async)]
pub(crate) fn save_driver_analysis_stats(
    app: AppHandle,
    session_id: i64,
    stats_json: String,
) -> Result<DriverAnalysisHistoryRecord, String> {
    let connection = open_shift_light_db(&app)?;
    save_driver_analysis_stats_in_connection(&connection, session_id, &stats_json)
}

#[tauri::command(async)]
pub(crate) fn load_driver_analysis_sessions(
    app: AppHandle,
) -> Result<Vec<DriverAnalysisHistoryRecord>, String> {
    let connection = open_shift_light_db(&app)?;
    load_driver_analysis_sessions_from_connection(&connection)
}

#[tauri::command(async)]
pub(crate) fn create_driver_analysis_recording(
    app: AppHandle,
    started_at_ms: i64,
) -> Result<i64, String> {
    let mut connection = open_shift_light_db(&app)?;
    create_driver_analysis_recording_in_connection(&mut connection, started_at_ms)
}

#[tauri::command(async)]
pub(crate) fn delete_driver_analysis_recording(
    app: AppHandle,
    recording_id: i64,
) -> Result<(), String> {
    let mut connection = open_shift_light_db(&app)?;
    delete_driver_analysis_recording_in_connection(&mut connection, recording_id)
}

// Discards a car's session that is still being recorded, such as a car shown on a car-selection screen that nobody
// drove. A finished session is never touched.
fn discard_driver_analysis_session_in_connection(
    connection: &Connection,
    session_id: i64,
) -> Result<(), String> {
    if session_id <= 0 {
        return Err("Driver Analysis session id must be positive".to_string());
    }
    let changed = connection
        .execute(
            "DELETE FROM driver_analysis_sessions WHERE id = ?1 AND status = 'recording'",
            params![session_id],
        )
        .map_err(|error| format!("unable to discard Driver Analysis session: {error}"))?;
    if changed == 0 {
        return Err("Driver Analysis session is not an unfinished recording".to_string());
    }
    Ok(())
}

// Discards a recording that ended without any car session.
fn discard_driver_analysis_recording_in_connection(
    connection: &mut Connection,
    recording_id: i64,
) -> Result<(), String> {
    if recording_id <= 0 {
        return Err("Driver Analysis recording id must be positive".to_string());
    }
    let changed = connection
        .execute(
            "DELETE FROM driver_analysis_recordings WHERE id = ?1
             AND NOT EXISTS (SELECT 1 FROM driver_analysis_sessions WHERE recording_id = ?1)",
            params![recording_id],
        )
        .map_err(|error| format!("unable to discard Driver Analysis recording: {error}"))?;
    if changed == 0 {
        return Err("Driver Analysis recording does not exist or still has cars".to_string());
    }
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn discard_driver_analysis_session(
    app: AppHandle,
    session_id: i64,
) -> Result<(), String> {
    let connection = open_shift_light_db(&app)?;
    discard_driver_analysis_session_in_connection(&connection, session_id)
}

#[tauri::command(async)]
pub(crate) fn discard_driver_analysis_recording(
    app: AppHandle,
    recording_id: i64,
) -> Result<(), String> {
    let mut connection = open_shift_light_db(&app)?;
    discard_driver_analysis_recording_in_connection(&mut connection, recording_id)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriverAnalysisExportOutcome {
    cancelled: bool,
    bytes: u64,
}

// The save dialog and the export run off the async runtime because both block until they finish.
#[tauri::command]
pub(crate) async fn export_driver_analysis_recording(
    app: AppHandle,
    recording_id: i64,
    file_name: String,
) -> Result<DriverAnalysisExportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        driver_analysis_export::validate_file_name(&file_name)?;
        driver_analysis_export::check_recording(&open_shift_light_db(&app)?, recording_id)?;
        let Some(chosen) = app
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("FDC Driver Analysis export", &["gz"])
            .blocking_save_file()
        else {
            return Ok(DriverAnalysisExportOutcome {
                cancelled: true,
                bytes: 0,
            });
        };
        let target = driver_analysis_export::export_path(
            chosen
                .into_path()
                .map_err(|error| format!("unable to use the chosen export file: {error}"))?,
        );
        let bytes = driver_analysis_export::write_recording_export(
            &open_shift_light_db(&app)?,
            recording_id,
            env!("CARGO_PKG_VERSION"),
            &target,
        )?;
        Ok(DriverAnalysisExportOutcome {
            cancelled: false,
            bytes,
        })
    })
    .await
    .map_err(|error| format!("unable to export Driver Analysis recording: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;
    use std::{fs, path::PathBuf};

    // The app deletes whole recordings; deleting one session directly checks that the
    // schema cascades a session's samples, opportunities, and evidence.
    fn delete_driver_analysis_session_in_connection(
        connection: &Connection,
        session_id: i64,
    ) -> Result<(), String> {
        if session_id <= 0 {
            return Err("Driver Analysis session id must be positive".to_string());
        }
        let changed = connection
            .execute(
                "DELETE FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
            )
            .map_err(|error| format!("unable to delete Driver Analysis session: {error}"))?;
        if changed == 0 {
            return Err("Driver Analysis session does not exist".to_string());
        }
        Ok(())
    }

    fn driver_analysis_sample(sequence: i64) -> DriverAnalysisSampleInput {
        DriverAnalysisSampleInput {
            sequence,
            timestamp_ms: 1000 + sequence,
            speed_kmh: 120.0,
            throttle: 0.5,
            brake: 0.1,
            steer: 0.2,
            gear: 4,
            rpm: 6500.0,
            rpm_max: 10300.0,
            acceleration_x: 0.1,
            acceleration_y: 0.2,
            acceleration_z: 0.0,
            yaw_rate: 0.3,
            slip_ratio: [0.01; 4],
            slip_angle: [0.02; 4],
            combined_slip: [0.03; 4],
            tire_temp_c: [80.0; 4],
            suspension: [0.5; 4],
            rumble: [false; 4],
            puddle: [0.0; 4],
            lap_time: 30.0,
            lap_number: 1,
            lap_distance: 100.0,
            position: None,
        }
    }

    fn driver_analysis_opportunity() -> DriverAnalysisOpportunityInput {
        DriverAnalysisOpportunityInput {
            maneuver_id: "m1".to_string(),
            opportunity_type: "front_scrub".to_string(),
            started_at_ms: 1100,
            finished_at_ms: 1300,
            speed_bin: Some(100),
            gear: Some(4),
            outcome: "problem".to_string(),
            valid: true,
            invalid_reason: None,
            context_json: Some("{\"surface\":\"clean\"}".to_string()),
        }
    }

    fn driver_analysis_result(result: &str) -> DriverAnalysisFinalResultInput {
        DriverAnalysisFinalResultInput {
            result: result.to_string(),
            main_kind: (result == "issue").then(|| "front_scrub".to_string()),
            label: if result == "issue" { "Front Scrub" } else { "" }.to_string(),
            instruction: if result == "issue" {
                "Reduce steering"
            } else {
                ""
            }
            .to_string(),
            detector_confidence: Some(0.9),
            attribution_confidence: Some(0.8),
            severity: Some(0.6),
            stats_json: None,
        }
    }

    #[test]
    fn driver_analysis_creates_session_and_appends_batch_transactionally() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        assert_eq!(
            append_driver_analysis_samples_in_connection(
                &mut connection,
                session_id,
                &[driver_analysis_sample(0), driver_analysis_sample(1)],
            )
            .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT sample_count FROM driver_analysis_sessions WHERE id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM driver_analysis_samples WHERE session_id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
    }

    #[test]
    fn driver_analysis_sample_replay_is_ordered_and_paginated() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[
                driver_analysis_sample(0),
                driver_analysis_sample(1),
                driver_analysis_sample(2),
            ],
        )
        .unwrap();

        let first =
            load_driver_analysis_samples_in_connection(&connection, session_id, -1, 2).unwrap();
        let second = load_driver_analysis_samples_in_connection(
            &connection,
            session_id,
            first.last().unwrap().sequence,
            2,
        )
        .unwrap();
        assert_eq!(
            first
                .iter()
                .map(|sample| sample.sequence)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(
            second
                .iter()
                .map(|sample| sample.sequence)
                .collect::<Vec<_>>(),
            vec![2]
        );
    }

    #[test]
    fn driver_analysis_finalization_is_atomic_and_saves_result() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        let opportunities = vec![driver_analysis_opportunity()];
        let bad_evidence = vec![DriverAnalysisEvidenceInput {
            opportunity_index: 2,
            problem_type: "front_scrub".to_string(),
            primary: true,
            detector_confidence: 0.9,
            attribution_confidence: 0.8,
            severity: 0.6,
            metrics_json: None,
        }];
        assert!(
            finalize_driver_analysis_session_in_connection(
                &mut connection,
                session_id,
                &opportunities,
                &bad_evidence,
                &driver_analysis_result("issue"),
                None,
            )
            .is_err()
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM driver_analysis_opportunities WHERE session_id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        let evidence = vec![DriverAnalysisEvidenceInput {
            opportunity_index: 0,
            problem_type: "front_scrub".to_string(),
            primary: true,
            detector_confidence: 0.9,
            attribution_confidence: 0.8,
            severity: 0.6,
            metrics_json: Some("{\"steeringGrowth\":0.2}".to_string()),
        }];
        let record = finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &opportunities,
            &evidence,
            &driver_analysis_result("issue"),
            None,
        )
        .unwrap();
        assert_eq!(record.result.as_deref(), Some("issue"));
        assert_eq!(record.evidence_count, 1);
        assert_eq!(record.opportunity_count, 1);
    }

    #[test]
    fn driver_analysis_reanalysis_replaces_derived_data_and_preserves_raw_session() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0), driver_analysis_sample(1)],
        )
        .unwrap();
        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_opportunity()],
            &[],
            &driver_analysis_result("insufficient"),
            None,
        )
        .unwrap();
        let before = load_driver_analysis_session_from_connection(&connection, session_id).unwrap();

        let record = save_driver_analysis_result_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("no_recurring_problem"),
            Some("driver-analysis-rules-v3"),
            None,
        )
        .unwrap();
        assert_eq!(record.result.as_deref(), Some("no_recurring_problem"));
        assert_eq!(record.algorithm_version, "driver-analysis-rules-v3");
        assert_eq!(record.finished_at, before.finished_at);
        assert_eq!(record.sample_count, before.sample_count);
        assert_eq!(record.storage_bytes, before.storage_bytes);
        assert_eq!(record.opportunity_count, 0);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM driver_analysis_samples WHERE session_id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );

        let repeated = save_driver_analysis_result_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("no_recurring_problem"),
            Some("driver-analysis-rules-v3"),
            None,
        )
        .unwrap();
        assert_eq!(repeated.opportunity_count, 0);
    }

    #[test]
    fn driver_analysis_history_is_newest_first_and_startup_recovers_recording_sessions() {
        let mut connection = driver_analysis_connection();
        let older = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        let newer = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(2_000),
        )
        .unwrap();
        let live_history = load_driver_analysis_sessions_from_connection(&connection).unwrap();
        assert!(
            live_history
                .iter()
                .all(|record| record.status == "recording")
        );
        assert_eq!(
            recover_driver_analysis_sessions_in_connection(&connection).unwrap(),
            2
        );
        let history = load_driver_analysis_sessions_from_connection(&connection).unwrap();
        assert_eq!(history[0].id, newer);
        assert_eq!(history[1].id, older);
        assert!(history.iter().all(|record| record.status == "interrupted"));
        assert!(
            history
                .iter()
                .all(|record| record.result.as_deref() == Some("interrupted"))
        );
    }

    #[test]
    fn driver_analysis_delete_cascades_samples_opportunities_and_evidence() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();
        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_opportunity()],
            &[DriverAnalysisEvidenceInput {
                opportunity_index: 0,
                problem_type: "front_scrub".to_string(),
                primary: true,
                detector_confidence: 0.9,
                attribution_confidence: 0.8,
                severity: 0.6,
                metrics_json: None,
            }],
            &driver_analysis_result("issue"),
            None,
        )
        .unwrap();
        delete_driver_analysis_session_in_connection(&connection, session_id).unwrap();
        for table in ["driver_analysis_samples", "driver_analysis_opportunities"] {
            assert_eq!(
                connection
                    .query_row(
                        &format!("SELECT COUNT(*) FROM {table} WHERE session_id = ?1"),
                        params![session_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM driver_analysis_evidence AS evidence
                     JOIN driver_analysis_opportunities AS opportunities
                       ON opportunities.id = evidence.opportunity_id
                     WHERE opportunities.session_id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn driver_analysis_discard_removes_an_unfinished_session_and_its_samples() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();
        // Discard the unfinished session
        discard_driver_analysis_session_in_connection(&connection, session_id).unwrap();
        // Verify the session is gone
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(count, 0, "session should be deleted");
        // Verify its samples are gone (by cascade)
        let sample_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_samples WHERE session_id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(sample_count, 0, "samples should be deleted by cascade");
    }

    #[test]
    fn driver_analysis_discard_keeps_a_finished_session() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();
        // Finalize the session (changes status from 'recording' to 'completed')
        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("insufficient"),
            None,
        )
        .unwrap();
        // Try to discard a finished session
        let result = discard_driver_analysis_session_in_connection(&connection, session_id);
        assert!(
            result.is_err(),
            "discard should fail for a finished session"
        );
        assert_eq!(
            result.unwrap_err(),
            "Driver Analysis session is not an unfinished recording"
        );
        // Verify the session still exists
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(count, 1, "finished session should not be deleted");
    }

    #[test]
    fn driver_analysis_discard_recording_only_without_sessions() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        // Get the recording_id from the session
        let recording_id: i64 = connection
            .query_row(
                "SELECT recording_id FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        // Try to discard the recording while it still has a session
        let result = discard_driver_analysis_recording_in_connection(&mut connection, recording_id);
        assert!(
            result.is_err(),
            "discard should fail while recording has sessions"
        );
        assert_eq!(
            result.unwrap_err(),
            "Driver Analysis recording does not exist or still has cars"
        );
        // Verify the recording still exists
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(count, 1, "recording should still exist");
        // Delete the session
        delete_driver_analysis_session_in_connection(&connection, session_id).unwrap();
        // Now discarding the recording should succeed
        discard_driver_analysis_recording_in_connection(&mut connection, recording_id).unwrap();
        // Verify the recording is gone
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(count, 0, "recording should be deleted");
    }

    #[test]
    fn driver_analysis_finalization_saves_stats_json() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let mut result = driver_analysis_result("issue");
        result.stats_json = Some("{\"version\":1,\"distanceM\":1200.5}".to_string());

        let record = finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &result,
            None,
        )
        .unwrap();

        assert!(record.stats.is_some());
        let stats_obj = record.stats.unwrap();
        assert_eq!(stats_obj.get("version").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(
            stats_obj.get("distanceM").and_then(|v| v.as_f64()),
            Some(1200.5)
        );

        let mut reanalysis_result = driver_analysis_result("no_recurring_problem");
        reanalysis_result.stats_json = None;

        let reanalyzed = save_driver_analysis_result_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &reanalysis_result,
            Some("driver-analysis-rules-v3"),
            None,
        )
        .unwrap();

        assert!(reanalyzed.stats.is_some());
        let stats_obj = reanalyzed.stats.unwrap();
        assert_eq!(stats_obj.get("version").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(
            stats_obj.get("distanceM").and_then(|v| v.as_f64()),
            Some(1200.5)
        );
    }

    #[test]
    fn driver_analysis_rejects_invalid_stats_json() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();

        let mut result_non_json = driver_analysis_result("issue");
        result_non_json.stats_json = Some("not json at all".to_string());

        assert!(
            finalize_driver_analysis_session_in_connection(
                &mut connection,
                session_id,
                &[],
                &[],
                &result_non_json,
                None,
            )
            .is_err()
        );
        let status: String = connection
            .query_row(
                "SELECT status FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "recording");

        let mut result_array = driver_analysis_result("issue");
        result_array.stats_json = Some("[1,2,3]".to_string());

        assert!(
            finalize_driver_analysis_session_in_connection(
                &mut connection,
                session_id,
                &[],
                &[],
                &result_array,
                None,
            )
            .is_err()
        );
        let status: String = connection
            .query_row(
                "SELECT status FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "recording");

        let mut result_too_large = driver_analysis_result("issue");
        let large_object = format!(
            "{{\"data\":\"{}\"}}",
            "x".repeat(DRIVER_ANALYSIS_STATS_MAX_BYTES)
        );
        result_too_large.stats_json = Some(large_object);

        assert!(
            finalize_driver_analysis_session_in_connection(
                &mut connection,
                session_id,
                &[],
                &[],
                &result_too_large,
                None,
            )
            .is_err()
        );
        let status: String = connection
            .query_row(
                "SELECT status FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "recording");
    }

    #[test]
    fn driver_analysis_stats_backfill_updates_only_finished_sessions() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();

        // Saving stats on 'recording' session should fail
        assert!(
            save_driver_analysis_stats_in_connection(&connection, session_id, "{\"test\":1}")
                .is_err()
        );

        // Saving stats on non-existent session should fail
        assert!(
            save_driver_analysis_stats_in_connection(&connection, 999, "{\"test\":1}").is_err()
        );

        // Finalize the session to mark it as completed with some data
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let result = finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_opportunity()],
            &[],
            &driver_analysis_result("insufficient"),
            None,
        )
        .unwrap();
        let opportunity_count_before = result.opportunity_count;
        let result_before = result.result.clone();
        let status_before = result.status.clone();

        // Now saving stats on the finished session should succeed
        let updated = save_driver_analysis_stats_in_connection(
            &connection,
            session_id,
            "{\"version\":2,\"testData\":true}",
        )
        .unwrap();

        assert!(updated.stats.is_some());
        let stats_obj = updated.stats.unwrap();
        assert_eq!(stats_obj.get("version").and_then(|v| v.as_i64()), Some(2));
        assert_eq!(
            stats_obj.get("testData").and_then(|v| v.as_bool()),
            Some(true)
        );
        // Verify nothing else changed
        assert_eq!(updated.result.as_deref(), result_before.as_deref());
        assert_eq!(updated.status, status_before);
        assert_eq!(updated.opportunity_count, opportunity_count_before);
    }

    #[test]
    fn driver_analysis_session_with_recording_id_links_to_existing_recording() {
        let mut connection = driver_analysis_connection();
        let recording_id =
            create_driver_analysis_recording_in_connection(&mut connection, 2000).unwrap();
        let mut input = driver_analysis_session_input(1_000);
        input.recording_id = Some(recording_id);
        let session_id =
            create_driver_analysis_session_in_connection(&mut connection, &input).unwrap();

        let (linked_rec_id, linked_rec_exists): (i64, bool) = connection
            .query_row(
                "SELECT s.recording_id, EXISTS(SELECT 1 FROM driver_analysis_recordings WHERE id = s.recording_id)
                 FROM driver_analysis_sessions s WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(linked_rec_id, recording_id);
        assert!(linked_rec_exists);
    }

    #[test]
    fn driver_analysis_session_without_recording_id_creates_new_recording() {
        let mut connection = driver_analysis_connection();
        let input = driver_analysis_session_input(1_000);
        let session_id =
            create_driver_analysis_session_in_connection(&mut connection, &input).unwrap();

        let (recording_id, rec_started_at): (i64, i64) = connection
            .query_row(
                "SELECT s.recording_id, r.started_at_ms
                 FROM driver_analysis_sessions s
                 JOIN driver_analysis_recordings r ON r.id = s.recording_id
                 WHERE s.id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(recording_id > 0);
        assert!(rec_started_at >= 0);
    }

    #[test]
    fn driver_analysis_sample_with_position_round_trips() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        let mut sample = driver_analysis_sample(0);
        sample.position = Some([10.5, 20.3, 30.1]);
        append_driver_analysis_samples_in_connection(&mut connection, session_id, &[sample])
            .unwrap();

        let loaded =
            load_driver_analysis_samples_in_connection(&connection, session_id, -1, 10).unwrap();
        assert_eq!(loaded[0].position, Some([10.5, 20.3, 30.1]));
    }

    #[test]
    fn driver_analysis_sample_without_position_stored_as_null() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        let sample = driver_analysis_sample(0);
        append_driver_analysis_samples_in_connection(&mut connection, session_id, &[sample])
            .unwrap();

        let loaded =
            load_driver_analysis_samples_in_connection(&connection, session_id, -1, 10).unwrap();
        assert_eq!(loaded[0].position, None);
    }

    #[test]
    fn driver_analysis_finalize_with_drives_saves_and_sets_flag() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let drives = vec![DriverAnalysisDriveInput {
            kind: "circuit".to_string(),
            finished: true,
            lap_count: Some(3),
            first_sequence: 0,
            last_sequence: 100,
            started_at_ms: 1000,
            finished_at_ms: 2000,
            started_wall_ms: 1609459200000,
            distance_m: 5000.0,
        }];

        let record = finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("insufficient"),
            Some(&drives),
        )
        .unwrap();

        assert_eq!(record.drives_recorded, true);
        assert_eq!(record.drives.len(), 1);
        assert_eq!(record.drives[0].kind, "circuit");
        assert_eq!(record.drives[0].lap_count, Some(3));
        assert_eq!(record.drives[0].distance_m, 5000.0);
    }

    #[test]
    fn driver_analysis_finalize_without_drives_leaves_flag_false() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let record = finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("insufficient"),
            None,
        )
        .unwrap();

        assert_eq!(record.drives_recorded, false);
        assert_eq!(record.drives.len(), 0);
    }

    #[test]
    fn driver_analysis_finalize_invalid_drive_rejected_atomically() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let bad_drives = vec![DriverAnalysisDriveInput {
            kind: "invalid".to_string(),
            finished: true,
            lap_count: Some(3),
            first_sequence: 0,
            last_sequence: 100,
            started_at_ms: 1000,
            finished_at_ms: 2000,
            started_wall_ms: 1609459200000,
            distance_m: 5000.0,
        }];

        let result = finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("insufficient"),
            Some(&bad_drives),
        );

        assert!(result.is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM driver_analysis_drives WHERE session_id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn driver_analysis_reanalysis_does_not_touch_drives() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let drives = vec![DriverAnalysisDriveInput {
            kind: "sprint".to_string(),
            finished: true,
            lap_count: None,
            first_sequence: 0,
            last_sequence: 50,
            started_at_ms: 1000,
            finished_at_ms: 2000,
            started_wall_ms: 1609459200000,
            distance_m: 3000.0,
        }];

        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("insufficient"),
            Some(&drives),
        )
        .unwrap();

        save_driver_analysis_result_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("no_recurring_problem"),
            Some("v3"),
            None,
        )
        .unwrap();

        let record = load_driver_analysis_session_from_connection(&connection, session_id).unwrap();
        assert_eq!(record.drives.len(), 1);
        assert_eq!(record.drives[0].kind, "sprint");
    }

    #[test]
    fn driver_analysis_delete_recording_cascades_all_data() {
        let mut connection = driver_analysis_connection();
        let recording_id =
            create_driver_analysis_recording_in_connection(&mut connection, 1000).unwrap();
        let mut input = driver_analysis_session_input(1_000);
        input.recording_id = Some(recording_id);
        let session_id =
            create_driver_analysis_session_in_connection(&mut connection, &input).unwrap();

        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let drives = vec![DriverAnalysisDriveInput {
            kind: "circuit".to_string(),
            finished: true,
            lap_count: Some(1),
            first_sequence: 0,
            last_sequence: 10,
            started_at_ms: 1000,
            finished_at_ms: 1100,
            started_wall_ms: 1609459200000,
            distance_m: 1000.0,
        }];

        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &[],
            &[],
            &driver_analysis_result("insufficient"),
            Some(&drives),
        )
        .unwrap();

        delete_driver_analysis_recording_in_connection(&mut connection, recording_id).unwrap();

        let session_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(session_count, 0);

        let sample_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_samples WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sample_count, 0);

        let drive_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_drives WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(drive_count, 0);

        let recording_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_recordings WHERE id = ?1",
                params![recording_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recording_count, 0);
    }

    #[test]
    fn driver_analysis_checks_load_clean_and_problem_opportunities_in_range() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        let opportunity = |id: &str, started_at_ms: i64, outcome: &str, valid: bool| {
            DriverAnalysisOpportunityInput {
                maneuver_id: id.to_string(),
                opportunity_type: "front_scrub".to_string(),
                started_at_ms,
                finished_at_ms: started_at_ms + 100,
                speed_bin: None,
                gear: None,
                outcome: outcome.to_string(),
                valid,
                invalid_reason: (!valid).then(|| "incomplete_opportunity".to_string()),
                context_json: None,
            }
        };
        let opportunities = vec![
            opportunity("clean", 1_100, "clean", true),
            opportunity("problem", 1_200, "problem", true),
            opportunity("ambiguous", 1_300, "ambiguous", true),
            opportunity("invalid", 1_400, "incomplete", false),
            opportunity("outside", 5_000, "problem", true),
        ];
        let evidence = vec![DriverAnalysisEvidenceInput {
            opportunity_index: 1,
            problem_type: "front_scrub".to_string(),
            primary: true,
            detector_confidence: 0.9,
            attribution_confidence: 0.8,
            severity: 0.5,
            metrics_json: Some("{\"peakFrontSlip\":1.12}".to_string()),
        }];
        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &opportunities,
            &evidence,
            &driver_analysis_result("issue"),
            None,
        )
        .unwrap();

        let checks =
            load_driver_analysis_checks_in_connection(&connection, session_id, 1_000, 2_000)
                .unwrap();
        assert_eq!(
            checks
                .iter()
                .map(|check| (check.outcome.as_str(), check.started_at_ms))
                .collect::<Vec<_>>(),
            vec![("clean", 1_100), ("problem", 1_200)]
        );
        assert_eq!(checks[0].problem_type, None);
        assert_eq!(checks[1].problem_type.as_deref(), Some("front_scrub"));
        assert_eq!(checks[1].metrics.as_ref().unwrap()["peakFrontSlip"], 1.12);
        assert!(
            load_driver_analysis_checks_in_connection(&connection, session_id, 2_000, 1_000)
                .is_err()
        );
    }

    #[test]
    fn driver_analysis_problem_counts_computed_per_drive_by_time_range() {
        let mut connection = driver_analysis_connection();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();
        append_driver_analysis_samples_in_connection(
            &mut connection,
            session_id,
            &[driver_analysis_sample(0)],
        )
        .unwrap();

        let opportunities = vec![
            DriverAnalysisOpportunityInput {
                maneuver_id: "m1".to_string(),
                opportunity_type: "front_scrub".to_string(),
                started_at_ms: 1050,
                finished_at_ms: 1150,
                speed_bin: None,
                gear: None,
                outcome: "problem".to_string(),
                valid: true,
                invalid_reason: None,
                context_json: None,
            },
            DriverAnalysisOpportunityInput {
                maneuver_id: "m2".to_string(),
                opportunity_type: "front_scrub".to_string(),
                started_at_ms: 2050,
                finished_at_ms: 2150,
                speed_bin: None,
                gear: None,
                outcome: "problem".to_string(),
                valid: true,
                invalid_reason: None,
                context_json: None,
            },
            DriverAnalysisOpportunityInput {
                maneuver_id: "m3".to_string(),
                opportunity_type: "rear_slip".to_string(),
                started_at_ms: 1100,
                finished_at_ms: 1200,
                speed_bin: None,
                gear: None,
                outcome: "problem".to_string(),
                valid: true,
                invalid_reason: None,
                context_json: None,
            },
        ];

        let drives = vec![
            DriverAnalysisDriveInput {
                kind: "circuit".to_string(),
                finished: true,
                lap_count: Some(1),
                first_sequence: 0,
                last_sequence: 50,
                started_at_ms: 1000,
                finished_at_ms: 1200,
                started_wall_ms: 1609459200000,
                distance_m: 1000.0,
            },
            DriverAnalysisDriveInput {
                kind: "sprint".to_string(),
                finished: true,
                lap_count: None,
                first_sequence: 51,
                last_sequence: 100,
                started_at_ms: 2000,
                finished_at_ms: 2200,
                started_wall_ms: 1609459201000,
                distance_m: 2000.0,
            },
        ];

        finalize_driver_analysis_session_in_connection(
            &mut connection,
            session_id,
            &opportunities,
            &[],
            &driver_analysis_result("issue"),
            Some(&drives),
        )
        .unwrap();

        let record = load_driver_analysis_session_from_connection(&connection, session_id).unwrap();
        assert_eq!(record.drives.len(), 2);

        let drive1_counts = record.drives[0].problem_counts.as_object().unwrap();
        assert_eq!(
            drive1_counts.get("front_scrub").and_then(|v| v.as_i64()),
            Some(1)
        );
        assert_eq!(
            drive1_counts.get("rear_slip").and_then(|v| v.as_i64()),
            Some(1)
        );

        let drive2_counts = record.drives[1].problem_counts.as_object().unwrap();
        assert_eq!(
            drive2_counts.get("front_scrub").and_then(|v| v.as_i64()),
            Some(1)
        );
        assert!(!drive2_counts.contains_key("rear_slip"));
    }

    fn export_test_folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("fdc-export-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    fn read_export(path: &std::path::Path) -> serde_json::Value {
        let mut text = String::new();
        std::io::Read::read_to_string(
            &mut flate2::read::GzDecoder::new(fs::File::open(path).unwrap()),
            &mut text,
        )
        .unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn driver_analysis_table_fingerprint(connection: &Connection) -> Vec<i64> {
        [
            "driver_analysis_recordings",
            "driver_analysis_sessions",
            "driver_analysis_samples",
            "driver_analysis_drives",
            "driver_analysis_opportunities",
            "driver_analysis_evidence",
        ]
        .iter()
        .map(|table| {
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap()
        })
        .chain(std::iter::once(
            connection
                .query_row("SELECT total_changes()", [], |row| row.get(0))
                .unwrap(),
        ))
        .collect()
    }

    fn assert_no_database_keys(value: &serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    assert!(
                        ![
                            "id",
                            "session_id",
                            "recording_id",
                            "legacy_id",
                            "created_at"
                        ]
                        .contains(&key.as_str()),
                        "export contains {key}"
                    );
                    assert_no_database_keys(child);
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(assert_no_database_keys),
            _ => {}
        }
    }

    // Records one car with samples, a drive, two checks, and evidence through the normal save path.
    fn record_export_car(
        connection: &mut Connection,
        recording_id: i64,
        started_at_ms: i64,
        positions: bool,
    ) -> i64 {
        let mut input = driver_analysis_session_input(started_at_ms);
        input.recording_id = Some(recording_id);
        let session_id = create_driver_analysis_session_in_connection(connection, &input).unwrap();
        let samples: Vec<_> = (0..3)
            .map(|sequence| DriverAnalysisSampleInput {
                position: positions.then_some([sequence as f64, 2.5, -1.25]),
                ..driver_analysis_sample(sequence)
            })
            .collect();
        append_driver_analysis_samples_in_connection(connection, session_id, &samples).unwrap();
        let clean = DriverAnalysisOpportunityInput {
            maneuver_id: "m0".to_string(),
            outcome: "clean".to_string(),
            ..driver_analysis_opportunity()
        };
        let evidence = vec![DriverAnalysisEvidenceInput {
            opportunity_index: 1,
            problem_type: "front_scrub".to_string(),
            primary: true,
            detector_confidence: 0.91,
            attribution_confidence: 0.82,
            severity: 0.4,
            metrics_json: Some("{\"peakFrontSlip\":1.12}".to_string()),
        }];
        let mut result = driver_analysis_result("issue");
        result.stats_json = Some("{\"version\":7,\"distanceM\":1200.5}".to_string());
        let drives = vec![DriverAnalysisDriveInput {
            kind: "circuit".to_string(),
            finished: true,
            lap_count: Some(2),
            first_sequence: 0,
            last_sequence: 2,
            started_at_ms: 1000,
            finished_at_ms: 1002,
            started_wall_ms: started_at_ms + 500,
            distance_m: 4.5,
        }];
        finalize_driver_analysis_session_in_connection(
            connection,
            session_id,
            &[clean, driver_analysis_opportunity()],
            &evidence,
            &result,
            Some(&drives),
        )
        .unwrap();
        session_id
    }

    #[test]
    fn driver_analysis_export_writes_one_recording_in_format_v1() {
        let mut connection = driver_analysis_connection();
        let recording_id =
            create_driver_analysis_recording_in_connection(&mut connection, 1_000).unwrap();
        let first = record_export_car(&mut connection, recording_id, 1_000, true);
        let second = record_export_car(&mut connection, recording_id, 9_000, false);
        // Another recording in the same database must not leak into the file.
        let other =
            create_driver_analysis_recording_in_connection(&mut connection, 50_000).unwrap();
        record_export_car(&mut connection, other, 50_000, true);
        let before = driver_analysis_table_fingerprint(&connection);

        let folder = export_test_folder("format");
        let target = folder.join("fdc-driver-analysis-1.json.gz");
        let bytes = driver_analysis_export::write_recording_export(
            &connection,
            recording_id,
            "9.9.9",
            &target,
        )
        .unwrap();

        assert_eq!(bytes, fs::metadata(&target).unwrap().len());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
        assert_eq!(driver_analysis_table_fingerprint(&connection), before);
        let export = read_export(&target);
        assert_no_database_keys(&export);
        assert_eq!(export["format"], "fdc-driver-analysis-export");
        assert_eq!(export["formatVersion"], 1);
        assert_eq!(export["exportedWith"]["fdcVersion"], "9.9.9");
        assert_eq!(export["recording"]["startedAt"], "1970-01-01T00:00:01.000Z");
        let finished: Vec<i64> = [first, second]
            .iter()
            .map(|id| {
                connection
                    .query_row(
                        "SELECT finished_at_ms FROM driver_analysis_sessions WHERE id = ?1",
                        params![id],
                        |row| row.get(0),
                    )
                    .unwrap()
            })
            .collect();
        assert_eq!(export["recording"]["durationMs"], finished[1] - 1_000);

        let sessions = export["recording"]["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 2);
        let car = &sessions[1];
        assert_eq!(car["index"], 1);
        assert_eq!(car["startedOffsetMs"], 8_000);
        assert_eq!(car["finishedOffsetMs"], finished[1] - 1_000);
        assert_eq!(car["recordedWith"]["fdcVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(
            car["recordedWith"]["algorithmVersion"],
            "driver-analysis-rules-v2"
        );
        assert_eq!(car["vehicle"]["identity"]["ordinal"], 3766);
        assert_eq!(car["vehicle"]["rpmLimit"], 10_300.0);
        assert_eq!(car["result"], "issue");
        assert_eq!(car["counts"]["drives"], 1);
        assert_eq!(car["stats"]["distanceM"], 1200.5);

        let columns: Vec<&str> = car["samples"]["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|column| column.as_str().unwrap())
            .collect();
        assert_eq!(columns[..2], ["sequence", "timestamp_ms"]);
        assert!(columns.contains(&"position_x") && columns.contains(&"rumble_rr"));
        let column = |name: &str| {
            &car["samples"]["values"][columns.iter().position(|c| *c == name).unwrap()]
        };
        assert_eq!(column("sequence"), &serde_json::json!([0, 1, 2]));
        assert_eq!(
            column("timestamp_ms"),
            &serde_json::json!([1000, 1001, 1002])
        );
        assert_eq!(column("rumble_fl"), &serde_json::json!([0, 0, 0]));
        assert_eq!(column("position_x"), &serde_json::json!([null, null, null]));
        assert_eq!(
            sessions[0]["samples"]["values"]
                [columns.iter().position(|c| *c == "position_x").unwrap()],
            serde_json::json!([0.0, 1.0, 2.0])
        );

        assert_eq!(car["drives"][0]["startedOffsetMs"], 8_500);
        assert_eq!(car["drives"][0]["startedAtMs"], 1000);
        assert_eq!(car["drives"][0]["lapCount"], 2);
        assert_eq!(car["opportunities"][0]["maneuverId"], "m0");
        assert_eq!(car["opportunities"][1]["index"], 1);
        assert_eq!(car["opportunities"][1]["context"]["surface"], "clean");
        let evidence = car["evidence"].as_array().unwrap();
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0]["opportunityIndex"], 1);
        assert_eq!(evidence[0]["metrics"]["peakFrontSlip"], 1.12);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn driver_analysis_export_rejects_recordings_it_cannot_export() {
        let mut connection = driver_analysis_connection();
        let empty = create_driver_analysis_recording_in_connection(&mut connection, 1_000).unwrap();
        let live = create_driver_analysis_recording_in_connection(&mut connection, 2_000).unwrap();
        let mut input = driver_analysis_session_input(2_000);
        input.recording_id = Some(live);
        create_driver_analysis_session_in_connection(&mut connection, &input).unwrap();

        let folder = export_test_folder("rejects");
        for recording_id in [empty, live, 999] {
            assert!(driver_analysis_export::check_recording(&connection, recording_id).is_err());
            let target = folder.join("fdc-driver-analysis-1.json.gz");
            assert!(
                driver_analysis_export::write_recording_export(
                    &connection,
                    recording_id,
                    "1",
                    &target
                )
                .is_err()
            );
        }
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn driver_analysis_export_failure_leaves_no_file() {
        let mut connection = driver_analysis_connection();
        let recording_id =
            create_driver_analysis_recording_in_connection(&mut connection, 1_000).unwrap();
        record_export_car(&mut connection, recording_id, 1_000, true);
        let folder = export_test_folder("failure");
        let target = folder.join("missing").join("fdc-driver-analysis-1.json.gz");

        assert!(
            driver_analysis_export::write_recording_export(&connection, recording_id, "1", &target)
                .is_err()
        );
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
        fs::remove_dir_all(folder).unwrap();
    }
}
