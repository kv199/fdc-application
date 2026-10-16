//! Events: the FDC-local Event catalog, saved Event runs with their laps and trace points,
//! and the Event best-lap, best-sector, and theoretical-best queries.

use std::collections::HashSet;

use rusqlite::{
    Connection, Error as SqliteError, OptionalExtension, Transaction, TransactionBehavior, params,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::*;

const EVENT_CLASSES: [&str; 9] = ["Any", "D", "C", "B", "A", "S1", "S2", "R", "X"];
const EVENT_ROUTES: [&str; 3] = ["Asphalt", "Rally", "Offroad"];
const EVENT_MODES: [&str; 6] = [
    "Any",
    "Rivals",
    "Online",
    "EventLab",
    "Official",
    "Blueprint",
];

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewEvent {
    pub(crate) name: String,
    pub(crate) class: String,
    pub(crate) route: String,
    pub(crate) mode: String,
    pub(crate) notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventRecord {
    pub(crate) id: i64,
    pub(crate) name: String,
    class: String,
    route: String,
    mode: String,
    notes: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventRunTracePointInput {
    sample_index: i32,
    elapsed_ms: i64,
    distance: f64,
    position_x: f64,
    position_y: f64,
    position_z: f64,
    throttle: f64,
    brake: f64,
    #[serde(default)]
    speed_kmh: Option<f64>,
    #[serde(default)]
    gear: Option<i32>,
    #[serde(default)]
    rpm: Option<f64>,
    #[serde(default)]
    steer: Option<f64>,
    #[serde(default)]
    acceleration_x: Option<f64>,
    #[serde(default)]
    acceleration_y: Option<f64>,
    #[serde(default)]
    acceleration_z: Option<f64>,
    #[serde(default)]
    yaw_rate: Option<f64>,
    #[serde(default)]
    slip_angle_fl: Option<f64>,
    #[serde(default)]
    slip_angle_fr: Option<f64>,
    #[serde(default)]
    slip_angle_rl: Option<f64>,
    #[serde(default)]
    slip_angle_rr: Option<f64>,
    #[serde(default)]
    slip_ratio_fl: Option<f64>,
    #[serde(default)]
    slip_ratio_fr: Option<f64>,
    #[serde(default)]
    slip_ratio_rl: Option<f64>,
    #[serde(default)]
    slip_ratio_rr: Option<f64>,
    #[serde(default)]
    combined_slip_fl: Option<f64>,
    #[serde(default)]
    combined_slip_fr: Option<f64>,
    #[serde(default)]
    combined_slip_rl: Option<f64>,
    #[serde(default)]
    combined_slip_rr: Option<f64>,
    #[serde(default)]
    tire_temp_c_fl: Option<f64>,
    #[serde(default)]
    tire_temp_c_fr: Option<f64>,
    #[serde(default)]
    tire_temp_c_rl: Option<f64>,
    #[serde(default)]
    tire_temp_c_rr: Option<f64>,
    #[serde(default)]
    suspension_fl: Option<f64>,
    #[serde(default)]
    suspension_fr: Option<f64>,
    #[serde(default)]
    suspension_rl: Option<f64>,
    #[serde(default)]
    suspension_rr: Option<f64>,
    #[serde(default)]
    puddle_fl: Option<f64>,
    #[serde(default)]
    puddle_fr: Option<f64>,
    #[serde(default)]
    puddle_rl: Option<f64>,
    #[serde(default)]
    puddle_rr: Option<f64>,
    #[serde(default)]
    rumble_fl: Option<bool>,
    #[serde(default)]
    rumble_fr: Option<bool>,
    #[serde(default)]
    rumble_rl: Option<bool>,
    #[serde(default)]
    rumble_rr: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventRunTracePoint {
    sample_index: i32,
    elapsed_ms: i64,
    distance: f64,
    position_x: f64,
    position_y: f64,
    position_z: f64,
    throttle: f64,
    brake: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed_kmh: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gear: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rpm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    steer: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    acceleration_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    acceleration_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    acceleration_z: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    yaw_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_angle_fl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_angle_fr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_angle_rl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_angle_rr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_ratio_fl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_ratio_fr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_ratio_rl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slip_ratio_rr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    combined_slip_fl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    combined_slip_fr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    combined_slip_rl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    combined_slip_rr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tire_temp_c_fl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tire_temp_c_fr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tire_temp_c_rl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tire_temp_c_rr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suspension_fl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suspension_fr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suspension_rl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suspension_rr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    puddle_fl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    puddle_fr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    puddle_rl: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    puddle_rr: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rumble_fl: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rumble_fr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rumble_rl: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rumble_rr: Option<bool>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventRunLapInput {
    lap_number: i32,
    lap_time_ms: i64,
    #[serde(default)]
    sector_1_time_ms: Option<i64>,
    #[serde(default)]
    sector_2_time_ms: Option<i64>,
    #[serde(default)]
    sector_3_time_ms: Option<i64>,
    #[serde(default)]
    trace_points: Vec<EventRunTracePointInput>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewEventRun {
    pub(crate) event_id: i64,
    pub(crate) car_ordinal: i32,
    pub(crate) car_class: i32,
    pub(crate) car_pi: i32,
    pub(crate) drivetrain: i32,
    pub(crate) started_at: String,
    pub(crate) run_type: String,
    pub(crate) result: String,
    pub(crate) result_time_ms: Option<i64>,
    #[serde(default)]
    pub(crate) result_time_approximate: Option<bool>,
    #[serde(default)]
    pub(crate) laps: Vec<EventRunLapInput>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventRunLap {
    lap_number: i32,
    lap_time_ms: i64,
    sector_1_time_ms: Option<i64>,
    sector_2_time_ms: Option<i64>,
    sector_3_time_ms: Option<i64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    trace_points: Vec<EventRunTracePoint>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventRunRecord {
    pub(crate) id: i64,
    event_id: i64,
    car_ordinal: i32,
    car_name: Option<String>,
    car_class: i32,
    car_pi: i32,
    drivetrain: i32,
    started_at: String,
    run_type: String,
    result: String,
    pub(crate) result_time_ms: Option<i64>,
    pub(crate) result_time_approximate: bool,
    created_at: String,
    laps: Vec<EventRunLap>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventAbsoluteBestReference {
    event_id: i64,
    run_id: i64,
    run_type: String,
    lap_number: Option<i32>,
    time_ms: i64,
    trace_points: Vec<EventRunTracePoint>,
    best_sectors: EventBestSectors,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventBestSectors {
    sector_1_time_ms: Option<i64>,
    sector_2_time_ms: Option<i64>,
    sector_3_time_ms: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventTheoreticalBest {
    event_id: i64,
    total_ms: Option<i64>,
    sectors: Vec<EventTheoreticalBestSector>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventTheoreticalBestSector {
    sector: i32,
    time_ms: Option<i64>,
    run_id: Option<i64>,
    lap_number: Option<i32>,
    run_type: Option<String>,
    car_ordinal: Option<i64>,
    car_name: Option<String>,
    has_trace: bool,
}

fn validate_event_choice(value: &str, field: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("unknown Event {field}"))
    }
}

fn normalize_event_input(mut event: NewEvent) -> Result<NewEvent, String> {
    event.name = event.name.trim().to_string();
    if event.name.is_empty() {
        return Err("Event name must not be empty".to_string());
    }
    event.class = event.class.trim().to_string();
    event.route = event.route.trim().to_string();
    event.mode = event.mode.trim().to_string();
    event.notes = event
        .notes
        .map(|notes| notes.trim().to_string())
        .filter(|notes| !notes.is_empty());
    validate_event_choice(&event.class, "class", &EVENT_CLASSES)?;
    validate_event_choice(&event.route, "route", &EVENT_ROUTES)?;
    validate_event_choice(&event.mode, "mode", &EVENT_MODES)?;
    Ok(event)
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventRecord> {
    Ok(EventRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        class: row.get(2)?,
        route: row.get(3)?,
        mode: row.get(4)?,
        notes: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub(crate) fn load_event_from_connection(
    connection: &Connection,
    event_id: i64,
) -> Result<EventRecord, String> {
    if event_id <= 0 {
        return Err("Event ID must be positive".to_string());
    }
    connection
        .query_row(
            "SELECT id, name, class, route, mode, notes,
                    created_at, updated_at
             FROM events WHERE id = ?1 AND deleted_at IS NULL",
            params![event_id],
            event_from_row,
        )
        .map_err(|error| match error {
            SqliteError::QueryReturnedNoRows => format!("Event {event_id} does not exist"),
            other => format!("unable to load Event {event_id}: {other}"),
        })
}

fn load_events_from_connection(connection: &Connection) -> Result<Vec<EventRecord>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, class, route, mode, notes,
                    created_at, updated_at
             FROM events
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|error| format!("unable to prepare Event list query: {error}"))?;
    statement
        .query_map([], event_from_row)
        .map_err(|error| format!("unable to load Events: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Events: {error}"))
}

pub(crate) fn create_event_in_connection(
    connection: &mut Connection,
    event: NewEvent,
) -> Result<EventRecord, String> {
    let event = normalize_event_input(event)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Event creation: {error}"))?;
    transaction
        .execute(
            "INSERT INTO events (name, class, route, mode, notes)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                event.name,
                event.class,
                event.route,
                event.mode,
                event.notes
            ],
        )
        .map_err(|error| format!("unable to create Event: {error}"))?;
    let event_id = transaction.last_insert_rowid();
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event creation: {error}"))?;
    load_event_from_connection(connection, event_id)
}

fn rename_event_in_connection(
    connection: &Connection,
    event_id: i64,
    name: String,
) -> Result<EventRecord, String> {
    if event_id <= 0 {
        return Err("Event ID must be positive".to_string());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Event name must not be empty".to_string());
    }
    let changed = connection
        .execute(
            "UPDATE events
             SET name = ?1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?2 AND deleted_at IS NULL",
            params![name, event_id],
        )
        .map_err(|error| format!("unable to rename Event: {error}"))?;
    if changed == 0 {
        return Err(format!("Event {event_id} does not exist"));
    }
    load_event_from_connection(connection, event_id)
}

fn delete_event_in_connection(connection: &Connection, event_id: i64) -> Result<(), String> {
    if event_id <= 0 {
        return Err("Event ID must be positive".to_string());
    }
    let changed = connection
        .execute(
            "UPDATE events
             SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND deleted_at IS NULL",
            params![event_id],
        )
        .map_err(|error| format!("unable to delete Event: {error}"))?;
    if changed == 0 {
        return Err(format!("Event {event_id} does not exist"));
    }
    Ok(())
}

fn validate_event_run_lap(lap: &EventRunLapInput) -> Result<(), String> {
    if lap.lap_number <= 0 || lap.lap_time_ms <= 0 {
        return Err("Event run lap number and time must be positive".to_string());
    }
    if [
        lap.sector_1_time_ms,
        lap.sector_2_time_ms,
        lap.sector_3_time_ms,
    ]
    .into_iter()
    .flatten()
    .any(|time| time <= 0)
    {
        return Err("Event run sector times must be positive".to_string());
    }
    if lap.trace_points.len() > 10_000 {
        return Err("Event run lap trace must contain 10,000 points or fewer".to_string());
    }
    let mut sample_indexes = HashSet::with_capacity(lap.trace_points.len());
    for point in &lap.trace_points {
        if point.sample_index < 0 || point.elapsed_ms < 0 || point.distance < 0.0 {
            return Err(
                "Event run lap trace indexes, elapsed time, and distance must not be negative"
                    .to_string(),
            );
        }
        if ![
            point.distance,
            point.position_x,
            point.position_y,
            point.position_z,
            point.throttle,
            point.brake,
        ]
        .into_iter()
        .all(f64::is_finite)
        {
            return Err("Event run lap trace values must be finite".to_string());
        }
        if !(0.0..=1.0).contains(&point.throttle) || !(0.0..=1.0).contains(&point.brake) {
            return Err(
                "Event run lap trace throttle and brake must be between 0 and 1".to_string(),
            );
        }
        if let Some(speed) = point.speed_kmh {
            if !speed.is_finite() || speed < 0.0 {
                return Err("Event run lap trace speed must be finite and non-negative".to_string());
            }
        }
        if let Some(gear) = point.gear {
            if gear < 0 {
                return Err("Event run lap trace gear must not be negative".to_string());
            }
        }
        if let Some(rpm) = point.rpm {
            if !rpm.is_finite() || rpm < 0.0 {
                return Err("Event run lap trace rpm must be finite and non-negative".to_string());
            }
        }
        let extended_numeric = [
            point.steer,
            point.acceleration_x,
            point.acceleration_y,
            point.acceleration_z,
            point.yaw_rate,
            point.slip_angle_fl,
            point.slip_angle_fr,
            point.slip_angle_rl,
            point.slip_angle_rr,
            point.slip_ratio_fl,
            point.slip_ratio_fr,
            point.slip_ratio_rl,
            point.slip_ratio_rr,
            point.combined_slip_fl,
            point.combined_slip_fr,
            point.combined_slip_rl,
            point.combined_slip_rr,
            point.tire_temp_c_fl,
            point.tire_temp_c_fr,
            point.tire_temp_c_rl,
            point.tire_temp_c_rr,
            point.suspension_fl,
            point.suspension_fr,
            point.suspension_rl,
            point.suspension_rr,
            point.puddle_fl,
            point.puddle_fr,
            point.puddle_rl,
            point.puddle_rr,
        ];
        if extended_numeric
            .into_iter()
            .flatten()
            .any(|v| !v.is_finite())
        {
            return Err("Event run lap trace extended values must be finite".to_string());
        }
        if !sample_indexes.insert(point.sample_index) {
            return Err("Event run lap trace sample indexes must be unique".to_string());
        }
    }
    Ok(())
}

fn validate_event_run_outcome(
    run_type: &str,
    result: &str,
    result_time_ms: Option<i64>,
    result_time_approximate: bool,
    lap_count: usize,
) -> Result<(), String> {
    if !["circuit", "sprint"].contains(&run_type) {
        return Err("unknown Event run type".to_string());
    }
    if result_time_ms.is_some_and(|time| time <= 0) {
        return Err("Event run result time must be positive".to_string());
    }
    if result_time_approximate && run_type != "sprint" {
        return Err("Only Sprint Event run results can be approximate".to_string());
    }
    match run_type {
        "circuit" => {
            if result != "completed" {
                return Err("Circuit Event runs must have a completed result".to_string());
            }
            if lap_count == 0 {
                return Err("Circuit Event runs require at least one completed lap".to_string());
            }
        }
        "sprint" => {
            if result != "confirmed" {
                return Err("Sprint Event runs require a confirmed result".to_string());
            }
            if result_time_ms.is_none() {
                return Err("Confirmed Sprint Event runs require a result time".to_string());
            }
        }
        _ => return Err("unknown Event run type".to_string()),
    }
    Ok(())
}

fn normalize_event_run_input(mut run: NewEventRun) -> Result<NewEventRun, String> {
    if run.event_id <= 0 {
        return Err("Event run Event ID must be positive".to_string());
    }
    if run.car_ordinal <= 0 {
        return Err("Event run car ordinal must be positive".to_string());
    }
    if run.car_class < 0 || run.car_pi < 0 || run.drivetrain < 0 {
        return Err("Event run car class, PI, and drivetrain must not be negative".to_string());
    }
    run.started_at = run.started_at.trim().to_string();
    if run.started_at.is_empty() {
        return Err("Event run start date/time must not be empty".to_string());
    }
    if run.started_at.chars().count() > 80 {
        return Err("Event run start date/time must be 80 characters or fewer".to_string());
    }
    run.run_type = run.run_type.trim().to_ascii_lowercase();
    run.result = run.result.trim().to_ascii_lowercase();
    let mut lap_numbers = HashSet::with_capacity(run.laps.len());
    for lap in &run.laps {
        validate_event_run_lap(lap)?;
        if !lap_numbers.insert(lap.lap_number) {
            return Err("Event run lap numbers must be unique".to_string());
        }
    }
    run.laps.sort_by_key(|lap| lap.lap_number);
    validate_event_run_outcome(
        &run.run_type,
        &run.result,
        run.result_time_ms,
        run.result_time_approximate.unwrap_or(false),
        run.laps.len(),
    )?;
    Ok(run)
}

fn event_run_laps_from_connection(
    connection: &Connection,
    run_id: i64,
    include_trace: bool,
) -> Result<Vec<EventRunLap>, String> {
    let mut statement = connection
        .prepare(
            "SELECT lap_number, lap_time_ms,
                    sector_1_time_ms, sector_2_time_ms, sector_3_time_ms
             FROM event_run_laps
             WHERE run_id = ?1
             ORDER BY lap_number ASC",
        )
        .map_err(|error| format!("unable to prepare Event run lap query: {error}"))?;
    let laps = statement
        .query_map(params![run_id], |row| {
            Ok(EventRunLap {
                lap_number: row.get(0)?,
                lap_time_ms: row.get(1)?,
                sector_1_time_ms: row.get(2)?,
                sector_2_time_ms: row.get(3)?,
                sector_3_time_ms: row.get(4)?,
                trace_points: Vec::new(),
            })
        })
        .map_err(|error| format!("unable to load Event run laps: {error}"))?;
    let mut laps = laps
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Event run laps: {error}"))?;
    if include_trace {
        for lap in &mut laps {
            lap.trace_points =
                event_run_trace_points_from_connection(connection, run_id, lap.lap_number)?;
        }
    }
    Ok(laps)
}

fn event_run_trace_points_from_connection(
    connection: &Connection,
    run_id: i64,
    lap_number: i32,
) -> Result<Vec<EventRunTracePoint>, String> {
    let mut statement = connection
        .prepare(
            "SELECT sample_index, elapsed_ms, distance,
                    position_x, position_y, position_z, throttle, brake,
                    speed_kmh, gear, rpm, steer,
                    acceleration_x, acceleration_y, acceleration_z, yaw_rate,
                    slip_angle_fl, slip_angle_fr, slip_angle_rl, slip_angle_rr,
                    slip_ratio_fl, slip_ratio_fr, slip_ratio_rl, slip_ratio_rr,
                    combined_slip_fl, combined_slip_fr, combined_slip_rl, combined_slip_rr,
                    tire_temp_c_fl, tire_temp_c_fr, tire_temp_c_rl, tire_temp_c_rr,
                    suspension_fl, suspension_fr, suspension_rl, suspension_rr,
                    puddle_fl, puddle_fr, puddle_rl, puddle_rr,
                    rumble_fl, rumble_fr, rumble_rl, rumble_rr
             FROM event_run_lap_trace_points
             WHERE run_id = ?1 AND lap_number = ?2
             ORDER BY sample_index ASC",
        )
        .map_err(|error| format!("unable to prepare Event run trace query: {error}"))?;
    statement
        .query_map(params![run_id, lap_number], |row| {
            Ok(EventRunTracePoint {
                sample_index: row.get(0)?,
                elapsed_ms: row.get(1)?,
                distance: row.get(2)?,
                position_x: row.get(3)?,
                position_y: row.get(4)?,
                position_z: row.get(5)?,
                throttle: row.get(6)?,
                brake: row.get(7)?,
                speed_kmh: row.get(8)?,
                gear: row.get(9)?,
                rpm: row.get(10)?,
                steer: row.get(11)?,
                acceleration_x: row.get(12)?,
                acceleration_y: row.get(13)?,
                acceleration_z: row.get(14)?,
                yaw_rate: row.get(15)?,
                slip_angle_fl: row.get(16)?,
                slip_angle_fr: row.get(17)?,
                slip_angle_rl: row.get(18)?,
                slip_angle_rr: row.get(19)?,
                slip_ratio_fl: row.get(20)?,
                slip_ratio_fr: row.get(21)?,
                slip_ratio_rl: row.get(22)?,
                slip_ratio_rr: row.get(23)?,
                combined_slip_fl: row.get(24)?,
                combined_slip_fr: row.get(25)?,
                combined_slip_rl: row.get(26)?,
                combined_slip_rr: row.get(27)?,
                tire_temp_c_fl: row.get(28)?,
                tire_temp_c_fr: row.get(29)?,
                tire_temp_c_rl: row.get(30)?,
                tire_temp_c_rr: row.get(31)?,
                suspension_fl: row.get(32)?,
                suspension_fr: row.get(33)?,
                suspension_rl: row.get(34)?,
                suspension_rr: row.get(35)?,
                puddle_fl: row.get(36)?,
                puddle_fr: row.get(37)?,
                puddle_rl: row.get(38)?,
                puddle_rr: row.get(39)?,
                rumble_fl: row.get::<_, Option<i32>>(40)?.map(|v| v != 0),
                rumble_fr: row.get::<_, Option<i32>>(41)?.map(|v| v != 0),
                rumble_rl: row.get::<_, Option<i32>>(42)?.map(|v| v != 0),
                rumble_rr: row.get::<_, Option<i32>>(43)?.map(|v| v != 0),
            })
        })
        .map_err(|error| format!("unable to load Event run trace points: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Event run trace points: {error}"))
}

fn event_run_trace_points_base_fields_from_connection(
    connection: &Connection,
    run_id: i64,
    lap_number: i32,
) -> Result<Vec<EventRunTracePoint>, String> {
    let mut statement = connection
        .prepare(
            "SELECT sample_index, elapsed_ms, distance,
                    position_x, position_y, position_z, throttle, brake
             FROM event_run_lap_trace_points
             WHERE run_id = ?1 AND lap_number = ?2
             ORDER BY sample_index ASC",
        )
        .map_err(|error| format!("unable to prepare Event run trace base query: {error}"))?;
    statement
        .query_map(params![run_id, lap_number], |row| {
            Ok(EventRunTracePoint {
                sample_index: row.get(0)?,
                elapsed_ms: row.get(1)?,
                distance: row.get(2)?,
                position_x: row.get(3)?,
                position_y: row.get(4)?,
                position_z: row.get(5)?,
                throttle: row.get(6)?,
                brake: row.get(7)?,
                speed_kmh: None,
                gear: None,
                rpm: None,
                steer: None,
                acceleration_x: None,
                acceleration_y: None,
                acceleration_z: None,
                yaw_rate: None,
                slip_angle_fl: None,
                slip_angle_fr: None,
                slip_angle_rl: None,
                slip_angle_rr: None,
                slip_ratio_fl: None,
                slip_ratio_fr: None,
                slip_ratio_rl: None,
                slip_ratio_rr: None,
                combined_slip_fl: None,
                combined_slip_fr: None,
                combined_slip_rl: None,
                combined_slip_rr: None,
                tire_temp_c_fl: None,
                tire_temp_c_fr: None,
                tire_temp_c_rl: None,
                tire_temp_c_rr: None,
                suspension_fl: None,
                suspension_fr: None,
                suspension_rl: None,
                suspension_rr: None,
                puddle_fl: None,
                puddle_fr: None,
                puddle_rl: None,
                puddle_rr: None,
                rumble_fl: None,
                rumble_fr: None,
                rumble_rl: None,
                rumble_rr: None,
            })
        })
        .map_err(|error| format!("unable to load Event run trace base points: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Event run trace base points: {error}"))
}

fn event_run_values_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(
    i64,
    i64,
    i32,
    Option<String>,
    i32,
    i32,
    i32,
    String,
    String,
    String,
    Option<i64>,
    String,
    bool,
)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
    ))
}

fn event_run_from_values(
    connection: &Connection,
    values: (
        i64,
        i64,
        i32,
        Option<String>,
        i32,
        i32,
        i32,
        String,
        String,
        String,
        Option<i64>,
        String,
        bool,
    ),
    include_trace: bool,
) -> Result<EventRunRecord, String> {
    let (
        id,
        event_id,
        car_ordinal,
        car_name,
        car_class,
        car_pi,
        drivetrain,
        started_at,
        run_type,
        result,
        result_time_ms,
        created_at,
        result_time_approximate,
    ) = values;
    Ok(EventRunRecord {
        id,
        event_id,
        car_ordinal,
        car_name,
        car_class,
        car_pi,
        drivetrain,
        started_at,
        run_type,
        result,
        result_time_ms,
        result_time_approximate,
        created_at,
        laps: event_run_laps_from_connection(connection, id, include_trace)?,
    })
}

pub(crate) fn load_event_run_from_connection(
    connection: &Connection,
    run_id: i64,
) -> Result<EventRunRecord, String> {
    load_event_run_record_from_connection(connection, run_id, true)
}

// Appends and result updates return the run without trace points so each per-lap
// save event stays small; the detail page loads traces through load_event_run.
fn load_event_run_record_from_connection(
    connection: &Connection,
    run_id: i64,
    include_trace: bool,
) -> Result<EventRunRecord, String> {
    if run_id <= 0 {
        return Err("Event run ID must be positive".to_string());
    }
    let mut statement = connection
        .prepare(
            "SELECT event_runs.id, event_runs.event_id, event_runs.car_ordinal,
                    garage_cars.display_name,
                    event_runs.car_class, event_runs.car_pi, event_runs.drivetrain,
                    event_runs.started_at, event_runs.run_type, event_runs.result,
                    event_runs.result_time_ms, event_runs.created_at,
                    event_runs.result_time_approximate
             FROM event_runs
             LEFT JOIN garage_cars
               ON garage_cars.game_id = 'fh6'
              AND garage_cars.car_ordinal = event_runs.car_ordinal
             WHERE event_runs.id = ?1",
        )
        .map_err(|error| format!("unable to prepare Event run query: {error}"))?;
    let values = statement
        .query_row(params![run_id], event_run_values_from_row)
        .map_err(|error| match error {
            SqliteError::QueryReturnedNoRows => format!("Event run {run_id} does not exist"),
            other => format!("unable to load Event run {run_id}: {other}"),
        })?;
    drop(statement);
    event_run_from_values(connection, values, include_trace)
}

fn load_event_runs_from_connection(
    connection: &Connection,
    event_id: Option<i64>,
) -> Result<Vec<EventRunRecord>, String> {
    if event_id.is_some_and(|id| id <= 0) {
        return Err("Event run Event ID must be positive".to_string());
    }
    let mut statement = connection
        .prepare(
            "SELECT event_runs.id, event_runs.event_id, event_runs.car_ordinal,
                    garage_cars.display_name,
                    event_runs.car_class, event_runs.car_pi, event_runs.drivetrain,
                    event_runs.started_at, event_runs.run_type, event_runs.result,
                    event_runs.result_time_ms, event_runs.created_at,
                    event_runs.result_time_approximate
             FROM event_runs
             LEFT JOIN garage_cars
               ON garage_cars.game_id = 'fh6'
              AND garage_cars.car_ordinal = event_runs.car_ordinal
             WHERE (?1 IS NULL OR event_runs.event_id = ?1)
             ORDER BY event_runs.started_at DESC, event_runs.id DESC",
        )
        .map_err(|error| format!("unable to prepare Event run list query: {error}"))?;
    let rows = statement
        .query_map(params![event_id], event_run_values_from_row)
        .map_err(|error| format!("unable to load Event runs: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Event runs: {error}"))?;
    drop(statement);
    rows.into_iter()
        .map(|values| event_run_from_values(connection, values, false))
        .collect()
}

const EVENT_REFERENCE_DISTANCE_RATIO: f64 = 0.97;

fn ensure_event_is_active(connection: &Connection, event_id: i64) -> Result<(), String> {
    let event_exists: bool = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM events
               WHERE id = ?1 AND deleted_at IS NULL
             )",
            params![event_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to verify Event: {error}"))?;
    if !event_exists {
        return Err(format!("Event {event_id} does not exist"));
    }
    Ok(())
}

fn load_event_absolute_best_from_connection(
    connection: &Connection,
    event_id: i64,
) -> Result<Option<EventAbsoluteBestReference>, String> {
    if event_id <= 0 {
        return Err("Event ID must be positive".to_string());
    }
    ensure_event_is_active(connection, event_id)?;

    // A circuit candidate is each saved completed lap. A sprint candidate is
    // its confirmed final result; MIN(lap_number) is used only to locate the
    // optional synthetic sprint trace row. When the Event has traces, a
    // candidate must cover nearly the longest traced distance, so an abandoned
    // attempt saved with a short time never becomes the reference.
    let candidate = connection
        .query_row(
            "WITH spans AS (
                SELECT points.run_id AS run_id,
                       points.lap_number AS lap_number,
                       MAX(points.distance) - MIN(points.distance) AS span
                FROM event_run_lap_trace_points AS points
                JOIN event_runs ON event_runs.id = points.run_id
                WHERE event_runs.event_id = ?1
                GROUP BY points.run_id, points.lap_number
            ),
            candidates AS (
                SELECT event_runs.id AS run_id,
                       event_runs.event_id AS event_id,
                       event_runs.run_type AS run_type,
                       event_run_laps.lap_number AS lap_number,
                       event_run_laps.lap_time_ms AS time_ms
                FROM event_runs
                JOIN event_run_laps ON event_run_laps.run_id = event_runs.id
                WHERE event_runs.event_id = ?1
                  AND event_runs.run_type = 'circuit'
                  AND event_runs.result = 'completed'
                  AND event_run_laps.lap_time_ms > 0
                UNION ALL
                SELECT event_runs.id AS run_id,
                       event_runs.event_id AS event_id,
                       event_runs.run_type AS run_type,
                       MIN(event_run_laps.lap_number) AS lap_number,
                       event_runs.result_time_ms AS time_ms
                FROM event_runs
                LEFT JOIN event_run_laps ON event_run_laps.run_id = event_runs.id
                WHERE event_runs.event_id = ?1
                  AND event_runs.run_type = 'sprint'
                  AND event_runs.result = 'confirmed'
                  AND event_runs.result_time_ms > 0
                GROUP BY event_runs.id
            )
            SELECT candidates.event_id, candidates.run_id, candidates.run_type,
                   candidates.lap_number, candidates.time_ms
            FROM candidates
            LEFT JOIN spans
              ON spans.run_id = candidates.run_id
             AND spans.lap_number = candidates.lap_number
            WHERE (SELECT MAX(span) FROM spans) IS NULL
               OR spans.span >= (SELECT MAX(span) FROM spans) * ?2
            ORDER BY candidates.time_ms ASC, candidates.run_id DESC,
                     candidates.lap_number ASC
            LIMIT 1",
            params![event_id, EVENT_REFERENCE_DISTANCE_RATIO],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i32>>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("unable to load Event absolute best: {error}"))?;

    let Some((event_id, run_id, run_type, lap_number, time_ms)) = candidate else {
        return Ok(None);
    };
    let trace_points = lap_number
        .map(|lap_number| {
            event_run_trace_points_base_fields_from_connection(connection, run_id, lap_number)
        })
        .transpose()?
        .unwrap_or_default();
    let best_sectors = load_event_best_sectors_from_connection(connection, event_id)?;
    Ok(Some(EventAbsoluteBestReference {
        event_id,
        run_id,
        run_type,
        lap_number,
        time_ms,
        trace_points,
        best_sectors,
    }))
}

// The Event's eligible laps: completed circuit laps and confirmed sprint laps,
// restricted to the longest traced distance when the Event has traces. Both the
// Delta sector reference and the Event page's Theoretical Best read this one
// source so they always agree. Bind the Event ID to ?1 and
// EVENT_REFERENCE_DISTANCE_RATIO to ?2.
const EVENT_ELIGIBLE_LAPS_CTE: &str = "spans AS (
    SELECT points.run_id AS run_id,
           points.lap_number AS lap_number,
           MAX(points.distance) - MIN(points.distance) AS span
    FROM event_run_lap_trace_points AS points
    JOIN event_runs ON event_runs.id = points.run_id
    WHERE event_runs.event_id = ?1
    GROUP BY points.run_id, points.lap_number
),
eligible_laps AS (
    SELECT event_runs.id AS run_id,
           event_runs.started_at AS started_at,
           event_runs.car_ordinal AS car_ordinal,
           event_runs.run_type AS run_type,
           event_run_laps.lap_number AS lap_number,
           event_run_laps.sector_1_time_ms AS sector_1_time_ms,
           event_run_laps.sector_2_time_ms AS sector_2_time_ms,
           event_run_laps.sector_3_time_ms AS sector_3_time_ms,
           spans.run_id IS NOT NULL AS has_trace
    FROM event_runs
    JOIN event_run_laps ON event_run_laps.run_id = event_runs.id
    LEFT JOIN spans
      ON spans.run_id = event_runs.id
     AND spans.lap_number = event_run_laps.lap_number
    WHERE event_runs.event_id = ?1
      AND (
        (event_runs.run_type = 'circuit'
         AND event_runs.result = 'completed'
         AND event_run_laps.lap_time_ms > 0)
        OR
        (event_runs.run_type = 'sprint'
         AND event_runs.result = 'confirmed'
         AND event_runs.result_time_ms > 0)
      )
      AND ((SELECT MAX(span) FROM spans) IS NULL
           OR spans.span >= (SELECT MAX(span) FROM spans) * ?2)
)";

// Each sector is the quickest saved value across the Event's eligible laps,
// independently of the others and regardless of car. A tie goes to the
// earliest source: earliest run start, then lowest run ID, then lowest lap.
fn load_event_theoretical_best_sector_from_connection(
    connection: &Connection,
    event_id: i64,
    sector: i32,
    sector_column: &str,
) -> Result<EventTheoreticalBestSector, String> {
    let sql = format!(
        "WITH {EVENT_ELIGIBLE_LAPS_CTE}
         SELECT eligible_laps.run_id, eligible_laps.lap_number,
                eligible_laps.run_type, eligible_laps.car_ordinal,
                garage_cars.display_name,
                eligible_laps.{sector_column}, eligible_laps.has_trace
         FROM eligible_laps
         LEFT JOIN garage_cars
           ON garage_cars.game_id = 'fh6'
          AND garage_cars.car_ordinal = eligible_laps.car_ordinal
         WHERE eligible_laps.{sector_column} > 0
         ORDER BY eligible_laps.{sector_column} ASC,
                  eligible_laps.started_at ASC,
                  eligible_laps.run_id ASC,
                  eligible_laps.lap_number ASC
         LIMIT 1"
    );
    let source = connection
        .query_row(
            &sql,
            params![event_id, EVENT_REFERENCE_DISTANCE_RATIO],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, bool>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("unable to load Event theoretical best: {error}"))?;

    Ok(match source {
        Some((run_id, lap_number, run_type, car_ordinal, car_name, time_ms, has_trace)) => {
            EventTheoreticalBestSector {
                sector,
                time_ms: Some(time_ms),
                run_id: Some(run_id),
                lap_number: Some(lap_number),
                run_type: Some(run_type),
                car_ordinal: Some(car_ordinal),
                car_name,
                has_trace,
            }
        }
        None => EventTheoreticalBestSector {
            sector,
            time_ms: None,
            run_id: None,
            lap_number: None,
            run_type: None,
            car_ordinal: None,
            car_name: None,
            has_trace: false,
        },
    })
}

// Returns Sectors 1 to 3 in order. The Event must already be verified as active.
fn load_event_theoretical_sectors_from_connection(
    connection: &Connection,
    event_id: i64,
) -> Result<Vec<EventTheoreticalBestSector>, String> {
    [
        (1, "sector_1_time_ms"),
        (2, "sector_2_time_ms"),
        (3, "sector_3_time_ms"),
    ]
    .into_iter()
    .map(|(sector, sector_column)| {
        load_event_theoretical_best_sector_from_connection(
            connection,
            event_id,
            sector,
            sector_column,
        )
    })
    .collect()
}

fn load_event_theoretical_best_from_connection(
    connection: &Connection,
    event_id: i64,
) -> Result<EventTheoreticalBest, String> {
    if event_id <= 0 {
        return Err("Event ID must be positive".to_string());
    }
    ensure_event_is_active(connection, event_id)?;

    let sectors = load_event_theoretical_sectors_from_connection(connection, event_id)?;
    // The total exists only when every sector has a source.
    let total_ms = sectors
        .iter()
        .map(|sector| sector.time_ms)
        .sum::<Option<i64>>();
    Ok(EventTheoreticalBest {
        event_id,
        total_ms,
        sectors,
    })
}

fn load_event_best_sectors_from_connection(
    connection: &Connection,
    event_id: i64,
) -> Result<EventBestSectors, String> {
    let sectors = load_event_theoretical_sectors_from_connection(connection, event_id)?;
    Ok(EventBestSectors {
        sector_1_time_ms: sectors[0].time_ms,
        sector_2_time_ms: sectors[1].time_ms,
        sector_3_time_ms: sectors[2].time_ms,
    })
}

fn insert_event_run_lap(
    transaction: &Transaction<'_>,
    run_id: i64,
    lap: EventRunLapInput,
) -> Result<(), String> {
    let lap_number = lap.lap_number;
    transaction
        .execute(
            "INSERT INTO event_run_laps
               (run_id, lap_number, lap_time_ms,
                sector_1_time_ms, sector_2_time_ms, sector_3_time_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                run_id,
                lap_number,
                lap.lap_time_ms,
                lap.sector_1_time_ms,
                lap.sector_2_time_ms,
                lap.sector_3_time_ms,
            ],
        )
        .map_err(|error| format!("unable to record Event run lap: {error}"))?;
    let mut statement = transaction
        .prepare_cached(
            "INSERT INTO event_run_lap_trace_points
               (run_id, lap_number, sample_index, elapsed_ms, distance,
                position_x, position_y, position_z, throttle, brake,
                speed_kmh, gear, rpm, steer,
                acceleration_x, acceleration_y, acceleration_z, yaw_rate,
                slip_angle_fl, slip_angle_fr, slip_angle_rl, slip_angle_rr,
                slip_ratio_fl, slip_ratio_fr, slip_ratio_rl, slip_ratio_rr,
                combined_slip_fl, combined_slip_fr, combined_slip_rl, combined_slip_rr,
                tire_temp_c_fl, tire_temp_c_fr, tire_temp_c_rl, tire_temp_c_rr,
                suspension_fl, suspension_fr, suspension_rl, suspension_rr,
                puddle_fl, puddle_fr, puddle_rl, puddle_rr,
                rumble_fl, rumble_fr, rumble_rl, rumble_rr)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                     ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                     ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
                     ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34,
                     ?35, ?36, ?37, ?38, ?39, ?40, ?41, ?42,
                     ?43, ?44, ?45, ?46)",
        )
        .map_err(|error| format!("unable to record Event run trace point: {error}"))?;
    for point in lap.trace_points {
        statement
            .execute(params![
                run_id,
                lap_number,
                point.sample_index,
                point.elapsed_ms,
                point.distance,
                point.position_x,
                point.position_y,
                point.position_z,
                point.throttle,
                point.brake,
                point.speed_kmh,
                point.gear,
                point.rpm,
                point.steer,
                point.acceleration_x,
                point.acceleration_y,
                point.acceleration_z,
                point.yaw_rate,
                point.slip_angle_fl,
                point.slip_angle_fr,
                point.slip_angle_rl,
                point.slip_angle_rr,
                point.slip_ratio_fl,
                point.slip_ratio_fr,
                point.slip_ratio_rl,
                point.slip_ratio_rr,
                point.combined_slip_fl,
                point.combined_slip_fr,
                point.combined_slip_rl,
                point.combined_slip_rr,
                point.tire_temp_c_fl,
                point.tire_temp_c_fr,
                point.tire_temp_c_rl,
                point.tire_temp_c_rr,
                point.suspension_fl,
                point.suspension_fr,
                point.suspension_rl,
                point.suspension_rr,
                point.puddle_fl,
                point.puddle_fr,
                point.puddle_rl,
                point.puddle_rr,
                point.rumble_fl.map(|v| if v { 1 } else { 0 }),
                point.rumble_fr.map(|v| if v { 1 } else { 0 }),
                point.rumble_rl.map(|v| if v { 1 } else { 0 }),
                point.rumble_rr.map(|v| if v { 1 } else { 0 }),
            ])
            .map_err(|error| format!("unable to record Event run trace point: {error}"))?;
    }
    Ok(())
}

pub(crate) fn record_event_run_in_connection(
    connection: &mut Connection,
    run: NewEventRun,
) -> Result<EventRunRecord, String> {
    let run = normalize_event_run_input(run)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Event run record: {error}"))?;
    let event_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM events
               WHERE id = ?1 AND deleted_at IS NULL
             )",
            params![run.event_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to verify Event run Event: {error}"))?;
    if !event_exists {
        return Err(format!("Event {} does not exist", run.event_id));
    }
    transaction
        .execute(
            "INSERT INTO event_runs
               (event_id, car_ordinal, car_name, car_class, car_pi, drivetrain,
                started_at, run_type, result, result_time_ms, result_time_approximate)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                run.event_id,
                run.car_ordinal,
                run.car_class,
                run.car_pi,
                run.drivetrain,
                run.started_at,
                run.run_type,
                run.result,
                run.result_time_ms,
                run.result_time_approximate.unwrap_or(false),
            ],
        )
        .map_err(|error| format!("unable to record Event run: {error}"))?;
    let run_id = transaction.last_insert_rowid();
    for lap in run.laps {
        insert_event_run_lap(&transaction, run_id, lap)?;
    }
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event run record: {error}"))?;
    load_event_run_from_connection(connection, run_id)
}

fn append_event_run_lap_in_connection(
    connection: &mut Connection,
    run_id: i64,
    lap: EventRunLapInput,
) -> Result<EventRunRecord, String> {
    if run_id <= 0 {
        return Err("Event run ID must be positive".to_string());
    }
    validate_event_run_lap(&lap)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Event run lap record: {error}"))?;
    let run_type: String = transaction
        .query_row(
            "SELECT event_runs.run_type
             FROM event_runs
             JOIN events ON events.id = event_runs.event_id
             WHERE event_runs.id = ?1 AND events.deleted_at IS NULL",
            params![run_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            SqliteError::QueryReturnedNoRows => format!("Event run {run_id} does not exist"),
            other => format!("unable to verify Event run {run_id}: {other}"),
        })?;
    if run_type != "circuit" {
        return Err("Only circuit Event runs accept completed laps".to_string());
    }
    let lap_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM event_run_laps
               WHERE run_id = ?1 AND lap_number = ?2
             )",
            params![run_id, lap.lap_number],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to verify Event run lap: {error}"))?;
    if lap_exists {
        return Err(format!("Event run lap {} is already saved", lap.lap_number));
    }
    insert_event_run_lap(&transaction, run_id, lap)?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event run lap record: {error}"))?;
    load_event_run_record_from_connection(connection, run_id, false)
}

fn update_event_run_result_in_connection(
    connection: &mut Connection,
    run_id: i64,
    run_type: &str,
    result: &str,
    result_time_ms: Option<i64>,
    result_time_approximate: bool,
) -> Result<EventRunRecord, String> {
    if run_id <= 0 {
        return Err("Event run ID must be positive".to_string());
    }
    let run_type = run_type.trim().to_ascii_lowercase();
    let result = result.trim().to_ascii_lowercase();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("unable to start Event run result update: {error}"))?;
    let lap_count: i64 = transaction
        .query_row(
            "SELECT (SELECT COUNT(*) FROM event_run_laps WHERE run_id = event_runs.id)
             FROM event_runs
             JOIN events ON events.id = event_runs.event_id
             WHERE event_runs.id = ?1 AND events.deleted_at IS NULL",
            params![run_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            SqliteError::QueryReturnedNoRows => format!("Event run {run_id} does not exist"),
            other => format!("unable to verify Event run {run_id}: {other}"),
        })?;
    validate_event_run_outcome(
        &run_type,
        &result,
        result_time_ms,
        result_time_approximate,
        usize::try_from(lap_count).unwrap_or(0),
    )?;
    transaction
        .execute(
            "UPDATE event_runs
             SET run_type = ?2, result = ?3, result_time_ms = ?4, result_time_approximate = ?5
             WHERE id = ?1",
            params![
                run_id,
                run_type,
                result,
                result_time_ms,
                result_time_approximate,
            ],
        )
        .map_err(|error| format!("unable to update Event run result: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event run result update: {error}"))?;
    load_event_run_record_from_connection(connection, run_id, false)
}

#[tauri::command(async)]
pub(crate) fn record_event_run(app: AppHandle, run: NewEventRun) -> Result<EventRunRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    record_event_run_in_connection(&mut connection, run)
}

#[tauri::command(async)]
pub(crate) fn append_event_run_lap(
    app: AppHandle,
    run_id: i64,
    lap: EventRunLapInput,
) -> Result<EventRunRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    append_event_run_lap_in_connection(&mut connection, run_id, lap)
}

#[tauri::command(async)]
pub(crate) fn update_event_run_result(
    app: AppHandle,
    run_id: i64,
    run_type: String,
    result: String,
    result_time_ms: Option<i64>,
    result_time_approximate: bool,
) -> Result<EventRunRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    update_event_run_result_in_connection(
        &mut connection,
        run_id,
        &run_type,
        &result,
        result_time_ms,
        result_time_approximate,
    )
}

#[tauri::command(async)]
pub(crate) fn load_event_runs(
    app: AppHandle,
    event_id: Option<i64>,
) -> Result<Vec<EventRunRecord>, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_runs_from_connection(&connection, event_id)
}

#[tauri::command(async)]
pub(crate) fn load_event_run(app: AppHandle, run_id: i64) -> Result<EventRunRecord, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_run_from_connection(&connection, run_id)
}

#[tauri::command(async)]
pub(crate) fn load_event_absolute_best(
    app: AppHandle,
    event_id: i64,
) -> Result<Option<EventAbsoluteBestReference>, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_absolute_best_from_connection(&connection, event_id)
}

#[tauri::command(async)]
pub(crate) fn load_event_theoretical_best(
    app: AppHandle,
    event_id: i64,
) -> Result<EventTheoreticalBest, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_theoretical_best_from_connection(&connection, event_id)
}

#[tauri::command(async)]
pub(crate) fn create_event(
    app: AppHandle,
    name: String,
    class: String,
    route: String,
    mode: String,
    notes: Option<String>,
) -> Result<EventRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    create_event_in_connection(
        &mut connection,
        NewEvent {
            name,
            class,
            route,
            mode,
            notes,
        },
    )
}

#[tauri::command(async)]
pub(crate) fn load_events(app: AppHandle) -> Result<Vec<EventRecord>, String> {
    let connection = open_shift_light_db(&app)?;
    load_events_from_connection(&connection)
}

#[tauri::command(async)]
pub(crate) fn load_event(app: AppHandle, event_id: i64) -> Result<EventRecord, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_from_connection(&connection, event_id)
}

// Stays on the main thread: overlapping renames from Settings must apply in call order.
#[tauri::command]
pub(crate) fn rename_event(
    app: AppHandle,
    event_id: i64,
    name: String,
) -> Result<EventRecord, String> {
    let connection = open_shift_light_db(&app)?;
    rename_event_in_connection(&connection, event_id, name)
}

#[tauri::command(async)]
pub(crate) fn delete_event(app: AppHandle, event_id: i64) -> Result<(), String> {
    let connection = open_shift_light_db(&app)?;
    delete_event_in_connection(&connection, event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn event_reference_coverage_threshold_is_97_percent() {
        assert_eq!(EVENT_REFERENCE_DISTANCE_RATIO, 0.97);
    }

    fn test_event_trace_point(
        sample_index: i32,
        elapsed_ms: i64,
        distance: f64,
        position_x: f64,
        position_y: f64,
        position_z: f64,
        throttle: f64,
        brake: f64,
    ) -> EventRunTracePointInput {
        EventRunTracePointInput {
            sample_index,
            elapsed_ms,
            distance,
            position_x,
            position_y,
            position_z,
            throttle,
            brake,
            speed_kmh: None,
            gear: None,
            rpm: None,
            steer: None,
            acceleration_x: None,
            acceleration_y: None,
            acceleration_z: None,
            yaw_rate: None,
            slip_angle_fl: None,
            slip_angle_fr: None,
            slip_angle_rl: None,
            slip_angle_rr: None,
            slip_ratio_fl: None,
            slip_ratio_fr: None,
            slip_ratio_rl: None,
            slip_ratio_rr: None,
            combined_slip_fl: None,
            combined_slip_fr: None,
            combined_slip_rl: None,
            combined_slip_rr: None,
            tire_temp_c_fl: None,
            tire_temp_c_fr: None,
            tire_temp_c_rl: None,
            tire_temp_c_rr: None,
            suspension_fl: None,
            suspension_fr: None,
            suspension_rl: None,
            suspension_rr: None,
            puddle_fl: None,
            puddle_fr: None,
            puddle_rl: None,
            puddle_rr: None,
            rumble_fl: None,
            rumble_fr: None,
            rumble_rl: None,
            rumble_rr: None,
        }
    }

    #[test]
    fn event_runs_require_qualified_results_and_round_trip_laps() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Sunday run", "S1", "Asphalt", "Rivals", None),
        )
        .unwrap();

        connection
            .execute(
                "INSERT INTO garage_cars
                   (game_id, car_ordinal, display_name, first_seen_sequence, last_seen_sequence)
                 VALUES ('fh6', 260, 'Test Car', 1, 1)",
                [],
            )
            .unwrap();

        assert!(
            record_event_run_in_connection(
                &mut connection,
                test_event_run(event.id, "circuit", "completed", None, Vec::new()),
            )
            .is_err()
        );
        assert!(
            record_event_run_in_connection(
                &mut connection,
                test_event_run(
                    event.id,
                    "circuit",
                    "completed",
                    None,
                    vec![
                        EventRunLapInput {
                            lap_number: 1,
                            lap_time_ms: 91_000,
                            sector_1_time_ms: None,
                            sector_2_time_ms: None,
                            sector_3_time_ms: None,
                            trace_points: Vec::new(),
                        },
                        EventRunLapInput {
                            lap_number: 1,
                            lap_time_ms: 90_000,
                            sector_1_time_ms: None,
                            sector_2_time_ms: None,
                            sector_3_time_ms: None,
                            trace_points: Vec::new(),
                        },
                    ],
                ),
            )
            .is_err()
        );
        assert!(
            record_event_run_in_connection(
                &mut connection,
                test_event_run(event.id, "sprint", "completed", Some(75_000), Vec::new()),
            )
            .is_err()
        );

        let circuit = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![
                    EventRunLapInput {
                        lap_number: 2,
                        lap_time_ms: 89_500,
                        sector_1_time_ms: Some(30_000),
                        sector_2_time_ms: Some(29_500),
                        sector_3_time_ms: Some(30_000),
                        trace_points: Vec::new(),
                    },
                    EventRunLapInput {
                        lap_number: 1,
                        lap_time_ms: 91_000,
                        sector_1_time_ms: Some(31_000),
                        sector_2_time_ms: Some(30_000),
                        sector_3_time_ms: Some(30_000),
                        trace_points: Vec::new(),
                    },
                ],
            ),
        )
        .unwrap();
        assert_eq!(circuit.car_ordinal, 260);
        assert_eq!(circuit.car_name.as_deref(), Some("Test Car"));
        assert_eq!(circuit.car_class, 8);
        assert_eq!(circuit.car_pi, 700);
        assert_eq!(circuit.drivetrain, 2);
        assert_eq!(circuit.result, "completed");
        assert_eq!(circuit.laps[0].lap_number, 1);
        assert_eq!(circuit.laps[0].lap_time_ms, 91_000);
        assert_eq!(circuit.laps[0].sector_1_time_ms, Some(31_000));
        assert_eq!(circuit.laps[0].sector_2_time_ms, Some(30_000));
        assert_eq!(circuit.laps[0].sector_3_time_ms, Some(30_000));
        assert_eq!(circuit.laps[1].lap_number, 2);
        assert_eq!(circuit.laps[1].lap_time_ms, 89_500);
        assert_eq!(circuit.laps[1].sector_1_time_ms, Some(30_000));

        let sprint = record_event_run_in_connection(
            &mut connection,
            test_event_run(event.id, "sprint", "confirmed", Some(75_000), Vec::new()),
        )
        .unwrap();
        assert_eq!(sprint.result, "confirmed");
        assert_eq!(sprint.result_time_ms, Some(75_000));
        assert_eq!(
            load_event_runs_from_connection(&connection, Some(event.id))
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            load_event_runs_from_connection(&connection, None)
                .unwrap()
                .len(),
            2
        );

        connection
            .execute(
                "INSERT INTO garage_cars
                   (game_id, car_ordinal, display_name, first_seen_sequence, last_seen_sequence)
                 VALUES ('fh6', 261, 'Garage name', 1, 1)",
                [],
            )
            .unwrap();
        let mut garage_named_run = test_event_run(
            event.id,
            "circuit",
            "completed",
            None,
            vec![EventRunLapInput {
                lap_number: 1,
                lap_time_ms: 90_000,
                sector_1_time_ms: None,
                sector_2_time_ms: None,
                sector_3_time_ms: None,
                trace_points: Vec::new(),
            }],
        );
        garage_named_run.car_ordinal = 261;
        assert_eq!(
            record_event_run_in_connection(&mut connection, garage_named_run)
                .unwrap()
                .car_name
                .as_deref(),
            Some("Garage name")
        );

        delete_event_in_connection(&connection, event.id).unwrap();
        assert_eq!(
            load_event_runs_from_connection(&connection, None)
                .unwrap()
                .len(),
            3
        );
        assert!(
            record_event_run_in_connection(
                &mut connection,
                test_event_run(event.id, "sprint", "confirmed", Some(74_000), Vec::new()),
            )
            .is_err()
        );
    }

    #[test]
    fn event_run_trace_points_round_trip_only_on_selected_run_load() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Trace run", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let saved = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 90_000,
                    sector_1_time_ms: Some(30_000),
                    sector_2_time_ms: Some(30_000),
                    sector_3_time_ms: Some(30_000),
                    trace_points: vec![test_event_trace_point(
                        0, 250, 12.5, 1.0, 2.0, 3.0, 0.75, 0.0,
                    )],
                }],
            ),
        )
        .unwrap();
        assert_eq!(saved.laps[0].trace_points.len(), 1);
        assert!(
            load_event_runs_from_connection(&connection, Some(event.id)).unwrap()[0].laps[0]
                .trace_points
                .is_empty()
        );
        let loaded = load_event_run_from_connection(&connection, saved.id).unwrap();
        assert_eq!(loaded.laps[0].trace_points.len(), 1);
        assert_eq!(loaded.laps[0].trace_points[0].sample_index, 0);
        assert_eq!(loaded.laps[0].trace_points[0].elapsed_ms, 250);
        assert_eq!(loaded.laps[0].trace_points[0].position_z, 3.0);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM event_run_lap_trace_points",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn event_absolute_best_selects_fastest_lap_or_sprint_and_loads_its_trace() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Absolute best", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();

        let trace =
            |distance: f64| test_event_trace_point(0, 500, distance, 1.0, 2.0, 3.0, 0.75, 0.0);
        let circuit = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 80_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: vec![trace(100.0)],
                }],
            ),
        )
        .unwrap();
        let sprint = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "sprint",
                "confirmed",
                Some(75_000),
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 75_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: vec![trace(150.0)],
                }],
            ),
        )
        .unwrap();
        let sprint_best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(sprint_best.event_id, event.id);
        assert_eq!(sprint_best.run_id, sprint.id);
        assert_eq!(sprint_best.run_type, "sprint");
        assert_eq!(sprint_best.lap_number, Some(1));
        assert_eq!(sprint_best.time_ms, 75_000);
        assert_eq!(sprint_best.trace_points.len(), 1);
        assert_eq!(sprint_best.trace_points[0].distance, 150.0);

        let faster_circuit = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 70_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: vec![trace(200.0)],
                }],
            ),
        )
        .unwrap();
        let circuit_best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(circuit_best.run_id, faster_circuit.id);
        assert_eq!(circuit_best.run_type, "circuit");
        assert_eq!(circuit_best.lap_number, Some(1));
        assert_eq!(circuit_best.time_ms, 70_000);
        assert_eq!(circuit_best.trace_points.len(), 1);
        assert_eq!(circuit_best.trace_points[0].distance, 200.0);
        assert_ne!(circuit_best.run_id, circuit.id);
    }

    #[test]
    fn event_absolute_best_ignores_results_that_cover_a_partial_distance() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Partial best", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();

        let trace = |end_distance: f64| {
            vec![0.0, end_distance]
                .into_iter()
                .enumerate()
                .map(|(index, distance)| {
                    test_event_trace_point(
                        index as i32,
                        index as i64 * 1000,
                        distance,
                        1.0,
                        2.0,
                        3.0,
                        0.75,
                        0.0,
                    )
                })
                .collect::<Vec<_>>()
        };
        let lap = |lap_time_ms: i64, end_distance: f64| EventRunLapInput {
            lap_number: 1,
            lap_time_ms,
            sector_1_time_ms: None,
            sector_2_time_ms: None,
            sector_3_time_ms: None,
            trace_points: trace(end_distance),
        };
        let full = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(139_155, 5_948.0)],
            ),
        )
        .unwrap();
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "sprint",
                "confirmed",
                Some(29_350),
                vec![lap(29_350, 1_236.0)],
            ),
        )
        .unwrap();

        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.run_id, full.id);
        assert_eq!(best.time_ms, 139_155);
    }

    #[test]
    fn event_absolute_best_returns_none_for_event_without_saved_results() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("No best", "Any", "Asphalt", "Any", None),
        )
        .unwrap();
        assert!(
            load_event_absolute_best_from_connection(&connection, event.id)
                .unwrap()
                .is_none()
        );
        assert!(load_event_absolute_best_from_connection(&connection, 999).is_err());
    }

    #[test]
    fn event_best_sectors_take_independent_minima_across_eligible_laps() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Best sectors", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let lap = |lap_number: i32, lap_time_ms: i64, sectors: [Option<i64>; 3]| EventRunLapInput {
            lap_number,
            lap_time_ms,
            sector_1_time_ms: sectors[0],
            sector_2_time_ms: sectors[1],
            sector_3_time_ms: sectors[2],
            trace_points: Vec::new(),
        };
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![
                    lap(1, 90_000, [Some(30_000), Some(31_000), Some(19_000)]),
                    lap(2, 89_000, [None, Some(29_000), Some(20_000)]),
                ],
            ),
        )
        .unwrap();
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(1, 88_000, [Some(32_000), Some(28_000), None])],
            ),
        )
        .unwrap();

        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.time_ms, 88_000);
        assert_eq!(best.best_sectors.sector_1_time_ms, Some(30_000));
        assert_eq!(best.best_sectors.sector_2_time_ms, Some(28_000));
        assert_eq!(best.best_sectors.sector_3_time_ms, Some(19_000));
        let serialized = serde_json::to_value(&best).unwrap();
        assert_eq!(serialized["bestSectors"]["sector1TimeMs"], 30_000);
        assert_eq!(serialized["bestSectors"]["sector2TimeMs"], 28_000);
        assert_eq!(serialized["bestSectors"]["sector3TimeMs"], 19_000);
    }

    #[test]
    fn event_best_sectors_exclude_partial_distance_laps() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Partial sectors", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();

        let trace = |end_distance: f64| {
            vec![0.0, end_distance]
                .into_iter()
                .enumerate()
                .map(|(index, distance)| {
                    test_event_trace_point(
                        index as i32,
                        index as i64 * 1000,
                        distance,
                        1.0,
                        2.0,
                        3.0,
                        0.75,
                        0.0,
                    )
                })
                .collect::<Vec<_>>()
        };
        let lap =
            |lap_time_ms: i64, sectors: [i64; 3], end_distance: Option<f64>| EventRunLapInput {
                lap_number: 1,
                lap_time_ms,
                sector_1_time_ms: Some(sectors[0]),
                sector_2_time_ms: Some(sectors[1]),
                sector_3_time_ms: Some(sectors[2]),
                trace_points: end_distance.map(trace).unwrap_or_default(),
            };
        let full = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(139_155, [40_000, 40_000, 40_000], Some(5_948.0))],
            ),
        )
        .unwrap();
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(60_000, [10_000, 10_000, 10_000], Some(1_236.0))],
            ),
        )
        .unwrap();
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(150_000, [5_000, 5_000, 5_000], None)],
            ),
        )
        .unwrap();

        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.run_id, full.id);
        assert_eq!(best.best_sectors.sector_1_time_ms, Some(40_000));
        assert_eq!(best.best_sectors.sector_2_time_ms, Some(40_000));
        assert_eq!(best.best_sectors.sector_3_time_ms, Some(40_000));
    }

    #[test]
    fn event_best_sectors_include_only_confirmed_sprint_results() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Sprint sectors", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let lap = |sectors: [i64; 3]| EventRunLapInput {
            lap_number: 1,
            lap_time_ms: 75_000,
            sector_1_time_ms: Some(sectors[0]),
            sector_2_time_ms: Some(sectors[1]),
            sector_3_time_ms: Some(sectors[2]),
            trace_points: Vec::new(),
        };
        let sprint = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "sprint",
                "confirmed",
                Some(75_000),
                vec![lap([25_000, 26_000, 24_000])],
            ),
        )
        .unwrap();
        // The schema accepts only 'completed' and 'confirmed' results, so an
        // unconfirmed sprint attempt is stored here with a non-confirmed result.
        connection
            .execute(
                "INSERT INTO event_runs (event_id, car_ordinal, car_class, car_pi,
                   drivetrain, started_at, run_type, result, result_time_ms)
                 VALUES (?1, 260, 8, 700, 2, '2026-08-30T12:00:00Z',
                   'sprint', 'completed', NULL)",
                params![event.id],
            )
            .unwrap();
        let unconfirmed_run_id = connection.last_insert_rowid();
        connection
            .execute(
                "INSERT INTO event_run_laps (run_id, lap_number, lap_time_ms,
                   sector_1_time_ms, sector_2_time_ms, sector_3_time_ms)
                 VALUES (?1, 1, 70000, 20000, 20000, 20000)",
                params![unconfirmed_run_id],
            )
            .unwrap();

        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.run_id, sprint.id);
        assert_eq!(best.run_type, "sprint");
        assert_eq!(best.best_sectors.sector_1_time_ms, Some(25_000));
        assert_eq!(best.best_sectors.sector_2_time_ms, Some(26_000));
        assert_eq!(best.best_sectors.sector_3_time_ms, Some(24_000));
    }

    #[test]
    fn event_best_sectors_are_none_without_sector_values() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("No sectors", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 90_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: Vec::new(),
                }],
            ),
        )
        .unwrap();

        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.time_ms, 90_000);
        assert_eq!(best.best_sectors.sector_1_time_ms, None);
        assert_eq!(best.best_sectors.sector_2_time_ms, None);
        assert_eq!(best.best_sectors.sector_3_time_ms, None);
    }

    #[test]
    fn event_theoretical_best_picks_sources_per_sector_with_car_names() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Theoretical sources", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        connection
            .execute(
                "INSERT INTO garage_cars
                   (game_id, car_ordinal, first_seen_sequence, last_seen_sequence, display_name)
                 VALUES ('fh6', 260, 1, 1, 'Named car')",
                [],
            )
            .unwrap();
        let lap = |lap_number: i32, lap_time_ms: i64, sectors: [Option<i64>; 3]| EventRunLapInput {
            lap_number,
            lap_time_ms,
            sector_1_time_ms: sectors[0],
            sector_2_time_ms: sectors[1],
            sector_3_time_ms: sectors[2],
            trace_points: Vec::new(),
        };
        let first = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![
                    lap(1, 90_000, [Some(30_000), Some(31_000), Some(19_000)]),
                    lap(2, 89_000, [None, Some(29_000), Some(20_000)]),
                ],
            ),
        )
        .unwrap();
        // A different car without a Garage record: its name stays unknown.
        let mut second_run = test_event_run(
            event.id,
            "circuit",
            "completed",
            None,
            vec![lap(1, 88_000, [Some(32_000), Some(28_000), None])],
        );
        second_run.car_ordinal = 300;
        let second = record_event_run_in_connection(&mut connection, second_run).unwrap();

        let theoretical =
            load_event_theoretical_best_from_connection(&connection, event.id).unwrap();
        assert_eq!(theoretical.event_id, event.id);
        assert_eq!(theoretical.total_ms, Some(77_000));
        assert_eq!(theoretical.sectors.len(), 3);
        assert_eq!(theoretical.sectors[0].sector, 1);
        assert_eq!(theoretical.sectors[0].time_ms, Some(30_000));
        assert_eq!(theoretical.sectors[0].run_id, Some(first.id));
        assert_eq!(theoretical.sectors[0].lap_number, Some(1));
        assert_eq!(theoretical.sectors[0].run_type.as_deref(), Some("circuit"));
        assert_eq!(theoretical.sectors[0].car_ordinal, Some(260));
        assert_eq!(
            theoretical.sectors[0].car_name.as_deref(),
            Some("Named car")
        );
        assert!(!theoretical.sectors[0].has_trace);
        assert_eq!(theoretical.sectors[1].sector, 2);
        assert_eq!(theoretical.sectors[1].time_ms, Some(28_000));
        assert_eq!(theoretical.sectors[1].run_id, Some(second.id));
        assert_eq!(theoretical.sectors[1].lap_number, Some(1));
        assert_eq!(theoretical.sectors[1].car_ordinal, Some(300));
        assert_eq!(theoretical.sectors[1].car_name, None);
        assert_eq!(theoretical.sectors[2].sector, 3);
        assert_eq!(theoretical.sectors[2].time_ms, Some(19_000));
        assert_eq!(theoretical.sectors[2].run_id, Some(first.id));
        assert_eq!(theoretical.sectors[2].lap_number, Some(1));

        let serialized = serde_json::to_value(&theoretical).unwrap();
        assert_eq!(serialized["eventId"], event.id);
        assert_eq!(serialized["totalMs"], 77_000);
        assert_eq!(serialized["sectors"][0]["timeMs"], 30_000);
        assert_eq!(serialized["sectors"][0]["carName"], "Named car");
        assert_eq!(serialized["sectors"][0]["hasTrace"], false);
        assert!(serialized["sectors"][1]["carName"].is_null());

        // Delta's best sector reference and the Event page's Theoretical Best
        // come from the same eligible laps.
        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.best_sectors.sector_1_time_ms, Some(30_000));
        assert_eq!(best.best_sectors.sector_2_time_ms, Some(28_000));
        assert_eq!(best.best_sectors.sector_3_time_ms, Some(19_000));
    }

    #[test]
    fn event_theoretical_best_breaks_ties_by_earliest_run_then_run_id_then_lap() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Theoretical ties", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let lap = |lap_number: i32, lap_time_ms: i64, sectors: [i64; 3]| EventRunLapInput {
            lap_number,
            lap_time_ms,
            sector_1_time_ms: Some(sectors[0]),
            sector_2_time_ms: Some(sectors[1]),
            sector_3_time_ms: Some(sectors[2]),
            trace_points: Vec::new(),
        };
        let run_at = |started_at: &str, laps: Vec<EventRunLapInput>| {
            let mut run = test_event_run(event.id, "circuit", "completed", None, laps);
            run.started_at = started_at.to_string();
            run
        };

        // Saved first with the lowest run ID, but it started latest.
        let late_start = record_event_run_in_connection(
            &mut connection,
            run_at(
                "2026-08-30T13:00:00Z",
                vec![lap(1, 90_000, [20_000, 25_000, 25_000])],
            ),
        )
        .unwrap();
        // Same start as the next run; lap 1 and lap 2 tie on Sector 1.
        let earliest_a = record_event_run_in_connection(
            &mut connection,
            run_at(
                "2026-08-30T12:00:00Z",
                vec![
                    lap(1, 90_000, [20_000, 30_000, 40_000]),
                    lap(2, 91_000, [20_000, 35_000, 41_000]),
                ],
            ),
        )
        .unwrap();
        // Same start as earliest_a with a higher run ID.
        let earliest_b = record_event_run_in_connection(
            &mut connection,
            run_at(
                "2026-08-30T12:00:00Z",
                vec![lap(1, 90_000, [20_000, 30_000, 40_000])],
            ),
        )
        .unwrap();
        assert!(late_start.id < earliest_a.id && earliest_a.id < earliest_b.id);

        let theoretical =
            load_event_theoretical_best_from_connection(&connection, event.id).unwrap();
        assert_eq!(theoretical.sectors[0].time_ms, Some(20_000));
        assert_eq!(theoretical.sectors[0].run_id, Some(earliest_a.id));
        assert_eq!(theoretical.sectors[0].lap_number, Some(1));
        assert_eq!(theoretical.sectors[1].time_ms, Some(25_000));
        assert_eq!(theoretical.sectors[1].run_id, Some(late_start.id));
        assert_eq!(theoretical.sectors[2].time_ms, Some(25_000));
        assert_eq!(theoretical.sectors[2].run_id, Some(late_start.id));
        assert_eq!(theoretical.total_ms, Some(70_000));
    }

    #[test]
    fn event_theoretical_best_uses_eligible_laps_and_reports_trace_sources() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Theoretical traces", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();

        let trace = |end_distance: f64| {
            vec![0.0, end_distance]
                .into_iter()
                .enumerate()
                .map(|(index, distance)| {
                    test_event_trace_point(
                        index as i32,
                        index as i64 * 1000,
                        distance,
                        1.0,
                        2.0,
                        3.0,
                        0.75,
                        0.0,
                    )
                })
                .collect::<Vec<_>>()
        };
        let lap =
            |lap_time_ms: i64, sectors: [i64; 3], end_distance: Option<f64>| EventRunLapInput {
                lap_number: 1,
                lap_time_ms,
                sector_1_time_ms: Some(sectors[0]),
                sector_2_time_ms: Some(sectors[1]),
                sector_3_time_ms: Some(sectors[2]),
                trace_points: end_distance.map(trace).unwrap_or_default(),
            };
        let full = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(139_155, [40_000, 40_000, 40_000], Some(5_948.0))],
            ),
        )
        .unwrap();
        // Partial distance: excluded despite its faster sectors.
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(60_000, [10_000, 10_000, 10_000], Some(1_236.0))],
            ),
        )
        .unwrap();
        // No trace while the Event has traces: excluded as well.
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![lap(150_000, [5_000, 5_000, 5_000], None)],
            ),
        )
        .unwrap();
        let sprint = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "sprint",
                "confirmed",
                Some(75_000),
                vec![lap(75_000, [35_000, 41_000, 39_000], Some(5_948.0))],
            ),
        )
        .unwrap();

        let theoretical =
            load_event_theoretical_best_from_connection(&connection, event.id).unwrap();
        assert_eq!(theoretical.total_ms, Some(114_000));
        assert_eq!(theoretical.sectors[0].time_ms, Some(35_000));
        assert_eq!(theoretical.sectors[0].run_id, Some(sprint.id));
        assert_eq!(theoretical.sectors[0].run_type.as_deref(), Some("sprint"));
        assert!(theoretical.sectors[0].has_trace);
        assert_eq!(theoretical.sectors[1].time_ms, Some(40_000));
        assert_eq!(theoretical.sectors[1].run_id, Some(full.id));
        assert_eq!(theoretical.sectors[1].run_type.as_deref(), Some("circuit"));
        assert!(theoretical.sectors[1].has_trace);
        assert_eq!(theoretical.sectors[2].time_ms, Some(39_000));
        assert_eq!(theoretical.sectors[2].run_id, Some(sprint.id));
        assert!(theoretical.sectors[2].has_trace);
    }

    #[test]
    fn event_theoretical_best_total_is_none_when_a_sector_has_no_source() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Missing sector", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let lap = |lap_number: i32, sectors: [Option<i64>; 3]| EventRunLapInput {
            lap_number,
            lap_time_ms: 90_000,
            sector_1_time_ms: sectors[0],
            sector_2_time_ms: sectors[1],
            sector_3_time_ms: sectors[2],
            trace_points: Vec::new(),
        };
        record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![
                    lap(1, [Some(20_000), None, Some(18_000)]),
                    lap(2, [Some(21_000), None, None]),
                ],
            ),
        )
        .unwrap();

        let theoretical =
            load_event_theoretical_best_from_connection(&connection, event.id).unwrap();
        assert_eq!(theoretical.total_ms, None);
        assert_eq!(theoretical.sectors[0].time_ms, Some(20_000));
        assert_eq!(theoretical.sectors[1].sector, 2);
        assert_eq!(theoretical.sectors[1].time_ms, None);
        assert_eq!(theoretical.sectors[1].run_id, None);
        assert_eq!(theoretical.sectors[1].lap_number, None);
        assert_eq!(theoretical.sectors[1].run_type, None);
        assert_eq!(theoretical.sectors[1].car_ordinal, None);
        assert_eq!(theoretical.sectors[1].car_name, None);
        assert!(!theoretical.sectors[1].has_trace);
        assert_eq!(theoretical.sectors[2].time_ms, Some(18_000));

        let serialized = serde_json::to_value(&theoretical).unwrap();
        assert!(serialized["totalMs"].is_null());

        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.best_sectors.sector_1_time_ms, Some(20_000));
        assert_eq!(best.best_sectors.sector_2_time_ms, None);
        assert_eq!(best.best_sectors.sector_3_time_ms, Some(18_000));
    }

    #[test]
    fn event_theoretical_best_is_empty_without_eligible_laps_and_rejects_invalid_events() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("No runs", "Any", "Asphalt", "Any", None),
        )
        .unwrap();

        let theoretical =
            load_event_theoretical_best_from_connection(&connection, event.id).unwrap();
        assert_eq!(theoretical.event_id, event.id);
        assert_eq!(theoretical.total_ms, None);
        assert_eq!(theoretical.sectors.len(), 3);
        for (index, sector) in theoretical.sectors.iter().enumerate() {
            assert_eq!(sector.sector, index as i32 + 1);
            assert_eq!(sector.time_ms, None);
            assert_eq!(sector.run_id, None);
            assert!(!sector.has_trace);
        }

        assert!(load_event_theoretical_best_from_connection(&connection, 0).is_err());
        assert!(load_event_theoretical_best_from_connection(&connection, 999).is_err());

        connection
            .execute(
                "UPDATE events SET deleted_at = '2026-10-01T00:00:00Z' WHERE id = ?1",
                params![event.id],
            )
            .unwrap();
        assert!(load_event_theoretical_best_from_connection(&connection, event.id).is_err());
    }

    #[test]
    fn event_runs_resolve_current_garage_name_after_run_save() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Garage rename", "Any", "Asphalt", "Any", None),
        )
        .unwrap();

        let run = test_event_run(event.id, "sprint", "confirmed", Some(75_000), Vec::new());
        let saved = record_event_run_in_connection(&mut connection, run).unwrap();
        assert_eq!(saved.car_name, None);

        // The Garage record can be created after the run has already been saved.
        connection
            .execute(
                "INSERT INTO garage_cars
                   (game_id, car_ordinal, first_seen_sequence, last_seen_sequence)
                 VALUES ('fh6', 260, 1, 1)",
                [],
            )
            .unwrap();
        assert_eq!(
            load_event_run_from_connection(&connection, saved.id)
                .unwrap()
                .car_name,
            None
        );

        connection
            .execute(
                "UPDATE garage_cars SET display_name = 'Named after run'
                 WHERE game_id = 'fh6' AND car_ordinal = 260",
                [],
            )
            .unwrap();
        assert_eq!(
            load_event_run_from_connection(&connection, saved.id)
                .unwrap()
                .car_name
                .as_deref(),
            Some("Named after run")
        );
        assert_eq!(
            load_event_runs_from_connection(&connection, Some(event.id)).unwrap()[0]
                .car_name
                .as_deref(),
            Some("Named after run")
        );

        connection
            .execute(
                "UPDATE garage_cars SET display_name = 'Renamed again'
                 WHERE game_id = 'fh6' AND car_ordinal = 260",
                [],
            )
            .unwrap();
        assert_eq!(
            load_event_runs_from_connection(&connection, Some(event.id)).unwrap()[0]
                .car_name
                .as_deref(),
            Some("Renamed again")
        );

        connection
            .execute(
                "UPDATE garage_cars SET display_name = NULL
                 WHERE game_id = 'fh6' AND car_ordinal = 260",
                [],
            )
            .unwrap();
        assert_eq!(
            load_event_run_from_connection(&connection, saved.id)
                .unwrap()
                .car_name,
            None
        );
    }

    #[test]
    fn events_validate_rename_and_soft_delete() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        assert!(
            create_event_in_connection(
                &mut connection,
                test_event("   ", "Any", "Asphalt", "Any", None),
            )
            .is_err()
        );
        for (field, value) in [
            ("class", "Invalid"),
            ("route", "Street"),
            ("mode", "Practice"),
        ] {
            let mut event = test_event("Valid", "Any", "Asphalt", "Any", None);
            match field {
                "class" => event.class = value.to_string(),
                "route" => event.route = value.to_string(),
                "mode" => event.mode = value.to_string(),
                _ => unreachable!(),
            }
            assert!(create_event_in_connection(&mut connection, event).is_err());
        }

        let created = create_event_in_connection(
            &mut connection,
            test_event(
                "  Club Night  ",
                "S1",
                "Rally",
                "EventLab",
                Some("  wet route  "),
            ),
        )
        .unwrap();
        assert_eq!(created.name, "Club Night");
        assert_eq!(created.class, "S1");
        assert_eq!(created.route, "Rally");
        assert_eq!(created.mode, "EventLab");
        assert_eq!(created.notes.as_deref(), Some("wet route"));

        let detail = load_event_from_connection(&connection, created.id).unwrap();
        assert_eq!(detail.id, created.id);
        assert_eq!(detail.name, "Club Night");
        assert_eq!(load_events_from_connection(&connection).unwrap().len(), 1);

        let renamed =
            rename_event_in_connection(&connection, created.id, "  Night Sprint  ".to_string())
                .unwrap();
        assert_eq!(renamed.name, "Night Sprint");

        assert_eq!(load_events_from_connection(&connection).unwrap().len(), 1);

        delete_event_in_connection(&connection, created.id).unwrap();
        assert!(load_event_from_connection(&connection, created.id).is_err());
        assert_eq!(load_events_from_connection(&connection).unwrap().len(), 0);
        let stored_deleted_at: Option<String> = connection
            .query_row(
                "SELECT deleted_at FROM events WHERE id = ?1",
                params![created.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(stored_deleted_at.is_some());
        assert!(delete_event_in_connection(&connection, created.id).is_err());
        assert!(
            rename_event_in_connection(&connection, created.id, "Visible again".to_string())
                .is_err()
        );

        let recreated = create_event_in_connection(
            &mut connection,
            test_event("Recreated", "Any", "Asphalt", "Any", None),
        )
        .unwrap();
        assert!(recreated.id > created.id);
    }

    #[test]
    fn events_accept_all_supported_filter_values_and_normalize_empty_notes() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        for class in EVENT_CLASSES {
            let event = create_event_in_connection(
                &mut connection,
                test_event(class, class, "Asphalt", "Any", Some("  ")),
            )
            .unwrap();
            assert_eq!(event.class, class);
            assert_eq!(event.notes, None);
            delete_event_in_connection(&connection, event.id).unwrap();
        }
        for route in EVENT_ROUTES {
            let event = create_event_in_connection(
                &mut connection,
                test_event(route, "Any", route, "Any", None),
            )
            .unwrap();
            assert_eq!(event.route, route);
            delete_event_in_connection(&connection, event.id).unwrap();
        }
        for mode in EVENT_MODES {
            let event = create_event_in_connection(
                &mut connection,
                test_event(mode, "Any", "Asphalt", mode, None),
            )
            .unwrap();
            assert_eq!(event.mode, mode);
            delete_event_in_connection(&connection, event.id).unwrap();
        }
    }

    #[test]
    fn event_run_trace_points_extended_fields_round_trip() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Extended trace run", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let saved = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 90_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: vec![EventRunTracePointInput {
                        sample_index: 0,
                        elapsed_ms: 250,
                        distance: 12.5,
                        position_x: 1.0,
                        position_y: 2.0,
                        position_z: 3.0,
                        throttle: 0.75,
                        brake: 0.0,
                        speed_kmh: Some(150.25),
                        gear: Some(3),
                        rpm: Some(5500.0),
                        steer: Some(-0.125),
                        acceleration_x: Some(1.234),
                        acceleration_y: Some(2.345),
                        acceleration_z: Some(3.456),
                        yaw_rate: Some(0.0123),
                        slip_angle_fl: Some(0.100),
                        slip_angle_fr: Some(0.200),
                        slip_angle_rl: Some(-0.050),
                        slip_angle_rr: Some(-0.075),
                        slip_ratio_fl: Some(0.010),
                        slip_ratio_fr: Some(0.020),
                        slip_ratio_rl: Some(-0.005),
                        slip_ratio_rr: Some(-0.010),
                        combined_slip_fl: Some(0.105),
                        combined_slip_fr: Some(0.210),
                        combined_slip_rl: Some(0.055),
                        combined_slip_rr: Some(0.085),
                        tire_temp_c_fl: Some(85.5),
                        tire_temp_c_fr: Some(86.3),
                        tire_temp_c_rl: Some(82.1),
                        tire_temp_c_rr: Some(81.9),
                        suspension_fl: Some(0.450),
                        suspension_fr: Some(0.460),
                        suspension_rl: Some(0.550),
                        suspension_rr: Some(0.560),
                        puddle_fl: Some(0.100),
                        puddle_fr: Some(0.050),
                        puddle_rl: Some(0.200),
                        puddle_rr: Some(0.150),
                        rumble_fl: Some(false),
                        rumble_fr: Some(true),
                        rumble_rl: Some(false),
                        rumble_rr: Some(true),
                    }],
                }],
            ),
        )
        .unwrap();
        let loaded = load_event_run_from_connection(&connection, saved.id).unwrap();
        assert_eq!(loaded.laps[0].trace_points.len(), 1);
        let point = &loaded.laps[0].trace_points[0];
        assert_eq!(point.speed_kmh, Some(150.25));
        assert_eq!(point.gear, Some(3));
        assert_eq!(point.rpm, Some(5500.0));
        assert_eq!(point.steer, Some(-0.125));
        assert_eq!(point.rumble_fl, Some(false));
        assert_eq!(point.rumble_fr, Some(true));
    }

    #[test]
    fn event_run_trace_points_without_extended_fields_serializes_clean() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Base only trace", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let saved = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 90_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: vec![EventRunTracePointInput {
                        sample_index: 0,
                        elapsed_ms: 250,
                        distance: 12.5,
                        position_x: 1.0,
                        position_y: 2.0,
                        position_z: 3.0,
                        throttle: 0.75,
                        brake: 0.0,
                        speed_kmh: None,
                        gear: None,
                        rpm: None,
                        steer: None,
                        acceleration_x: None,
                        acceleration_y: None,
                        acceleration_z: None,
                        yaw_rate: None,
                        slip_angle_fl: None,
                        slip_angle_fr: None,
                        slip_angle_rl: None,
                        slip_angle_rr: None,
                        slip_ratio_fl: None,
                        slip_ratio_fr: None,
                        slip_ratio_rl: None,
                        slip_ratio_rr: None,
                        combined_slip_fl: None,
                        combined_slip_fr: None,
                        combined_slip_rl: None,
                        combined_slip_rr: None,
                        tire_temp_c_fl: None,
                        tire_temp_c_fr: None,
                        tire_temp_c_rl: None,
                        tire_temp_c_rr: None,
                        suspension_fl: None,
                        suspension_fr: None,
                        suspension_rl: None,
                        suspension_rr: None,
                        puddle_fl: None,
                        puddle_fr: None,
                        puddle_rl: None,
                        puddle_rr: None,
                        rumble_fl: None,
                        rumble_fr: None,
                        rumble_rl: None,
                        rumble_rr: None,
                    }],
                }],
            ),
        )
        .unwrap();
        let loaded = load_event_run_from_connection(&connection, saved.id).unwrap();
        let point = &loaded.laps[0].trace_points[0];
        let serialized = serde_json::to_value(point).unwrap();
        assert!(!serialized.get("speedKmh").is_some());
        assert!(!serialized.get("gear").is_some());
        assert!(!serialized.get("rpm").is_some());
        assert!(serialized.get("distance").is_some());
        assert!(serialized.get("throttle").is_some());
    }

    #[test]
    fn event_run_trace_validation_rejects_non_finite_extended_values() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Validation test", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let mut invalid_run = test_event_run(
            event.id,
            "circuit",
            "completed",
            None,
            vec![EventRunLapInput {
                lap_number: 1,
                lap_time_ms: 90_000,
                sector_1_time_ms: None,
                sector_2_time_ms: None,
                sector_3_time_ms: None,
                trace_points: vec![EventRunTracePointInput {
                    sample_index: 0,
                    elapsed_ms: 250,
                    distance: 12.5,
                    position_x: 1.0,
                    position_y: 2.0,
                    position_z: 3.0,
                    throttle: 0.75,
                    brake: 0.0,
                    speed_kmh: Some(f64::NAN),
                    gear: None,
                    rpm: None,
                    steer: None,
                    acceleration_x: None,
                    acceleration_y: None,
                    acceleration_z: None,
                    yaw_rate: None,
                    slip_angle_fl: None,
                    slip_angle_fr: None,
                    slip_angle_rl: None,
                    slip_angle_rr: None,
                    slip_ratio_fl: None,
                    slip_ratio_fr: None,
                    slip_ratio_rl: None,
                    slip_ratio_rr: None,
                    combined_slip_fl: None,
                    combined_slip_fr: None,
                    combined_slip_rl: None,
                    combined_slip_rr: None,
                    tire_temp_c_fl: None,
                    tire_temp_c_fr: None,
                    tire_temp_c_rl: None,
                    tire_temp_c_rr: None,
                    suspension_fl: None,
                    suspension_fr: None,
                    suspension_rl: None,
                    suspension_rr: None,
                    puddle_fl: None,
                    puddle_fr: None,
                    puddle_rl: None,
                    puddle_rr: None,
                    rumble_fl: None,
                    rumble_fr: None,
                    rumble_rl: None,
                    rumble_rr: None,
                }],
            }],
        );
        assert!(record_event_run_in_connection(&mut connection, invalid_run.clone()).is_err());

        invalid_run.laps[0].trace_points[0].speed_kmh = None;
        invalid_run.laps[0].trace_points[0].speed_kmh = Some(-10.0);
        assert!(record_event_run_in_connection(&mut connection, invalid_run).is_err());
    }

    #[test]
    fn event_absolute_best_reference_returns_only_base_fields() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Absolute best ref", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let _saved = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 90_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: vec![EventRunTracePointInput {
                        sample_index: 0,
                        elapsed_ms: 250,
                        distance: 12.5,
                        position_x: 1.0,
                        position_y: 2.0,
                        position_z: 3.0,
                        throttle: 0.75,
                        brake: 0.0,
                        speed_kmh: Some(150.25),
                        gear: Some(3),
                        rpm: Some(5500.0),
                        steer: Some(-0.125),
                        acceleration_x: None,
                        acceleration_y: None,
                        acceleration_z: None,
                        yaw_rate: None,
                        slip_angle_fl: None,
                        slip_angle_fr: None,
                        slip_angle_rl: None,
                        slip_angle_rr: None,
                        slip_ratio_fl: None,
                        slip_ratio_fr: None,
                        slip_ratio_rl: None,
                        slip_ratio_rr: None,
                        combined_slip_fl: None,
                        combined_slip_fr: None,
                        combined_slip_rl: None,
                        combined_slip_rr: None,
                        tire_temp_c_fl: None,
                        tire_temp_c_fr: None,
                        tire_temp_c_rl: None,
                        tire_temp_c_rr: None,
                        suspension_fl: None,
                        suspension_fr: None,
                        suspension_rl: None,
                        suspension_rr: None,
                        puddle_fl: None,
                        puddle_fr: None,
                        puddle_rl: None,
                        puddle_rr: None,
                        rumble_fl: None,
                        rumble_fr: None,
                        rumble_rl: None,
                        rumble_rr: None,
                    }],
                }],
            ),
        )
        .unwrap();
        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.trace_points.len(), 1);
        let point = &best.trace_points[0];
        assert_eq!(point.speed_kmh, None);
        assert_eq!(point.gear, None);
        assert_eq!(point.rpm, None);
        assert_eq!(point.throttle, 0.75);
    }

    #[test]
    fn event_run_append_keeps_lap_order_and_traces_and_feeds_absolute_best() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Append run", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let lap = |lap_number: i32, lap_time_ms: i64| EventRunLapInput {
            lap_number,
            lap_time_ms,
            sector_1_time_ms: Some(10_000),
            sector_2_time_ms: Some(10_000),
            sector_3_time_ms: Some(lap_time_ms - 20_000),
            trace_points: vec![
                test_event_trace_point(0, 0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0),
                test_event_trace_point(1, 50_000, 1_000.0, 1_000.0, 0.0, 0.0, 0.5, 0.0),
            ],
        };
        let saved = record_event_run_in_connection(
            &mut connection,
            test_event_run(event.id, "circuit", "completed", None, vec![lap(1, 90_000)]),
        )
        .unwrap();

        let appended =
            append_event_run_lap_in_connection(&mut connection, saved.id, lap(3, 88_000)).unwrap();
        assert_eq!(
            appended
                .laps
                .iter()
                .map(|lap| lap.lap_number)
                .collect::<Vec<_>>(),
            vec![1, 3]
        );
        assert!(appended.laps.iter().all(|lap| lap.trace_points.is_empty()));
        let appended =
            append_event_run_lap_in_connection(&mut connection, saved.id, lap(2, 89_000)).unwrap();
        assert_eq!(
            appended
                .laps
                .iter()
                .map(|lap| lap.lap_number)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );

        let loaded = load_event_run_from_connection(&connection, saved.id).unwrap();
        assert_eq!(
            loaded
                .laps
                .iter()
                .map(|lap| lap.lap_number)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(loaded.laps.iter().all(|lap| lap.trace_points.len() == 2));
        let best = load_event_absolute_best_from_connection(&connection, event.id)
            .unwrap()
            .unwrap();
        assert_eq!(best.time_ms, 88_000);
        assert_eq!(best.lap_number, Some(3));
        assert_eq!(best.trace_points.len(), 2);
        assert_eq!(best.best_sectors.sector_1_time_ms, Some(10_000));
    }

    #[test]
    fn event_run_append_rejects_duplicates_sprints_and_unknown_runs() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Guarded run", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let lap = |lap_number: i32, lap_time_ms: i64| EventRunLapInput {
            lap_number,
            lap_time_ms,
            sector_1_time_ms: None,
            sector_2_time_ms: None,
            sector_3_time_ms: None,
            trace_points: Vec::new(),
        };
        let circuit = record_event_run_in_connection(
            &mut connection,
            test_event_run(event.id, "circuit", "completed", None, vec![lap(1, 90_000)]),
        )
        .unwrap();
        let sprint = record_event_run_in_connection(
            &mut connection,
            test_event_run(event.id, "sprint", "confirmed", Some(74_000), Vec::new()),
        )
        .unwrap();

        let duplicate =
            append_event_run_lap_in_connection(&mut connection, circuit.id, lap(1, 89_000))
                .err()
                .expect("expected an error");
        assert!(duplicate.contains("already saved"), "{duplicate}");
        let sprint_error =
            append_event_run_lap_in_connection(&mut connection, sprint.id, lap(1, 74_000))
                .err()
                .expect("expected an error");
        assert!(sprint_error.contains("circuit"), "{sprint_error}");
        let unknown = append_event_run_lap_in_connection(&mut connection, 9_999, lap(2, 89_000))
            .err()
            .expect("expected an error");
        assert!(unknown.contains("does not exist"), "{unknown}");
        let invalid = append_event_run_lap_in_connection(&mut connection, circuit.id, lap(2, 0))
            .err()
            .expect("expected an error");
        assert!(invalid.contains("must be positive"), "{invalid}");

        let runs = load_event_runs_from_connection(&connection, Some(event.id)).unwrap();
        let stored = runs.iter().find(|run| run.id == circuit.id).unwrap();
        assert_eq!(
            stored
                .laps
                .iter()
                .map(|lap| lap.lap_number)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn event_run_result_update_round_trips_the_approximate_flag() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Result run", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let mut approximate =
            test_event_run(event.id, "sprint", "confirmed", Some(68_953), Vec::new());
        approximate.result_time_approximate = Some(true);
        let approximate = record_event_run_in_connection(&mut connection, approximate).unwrap();
        assert!(approximate.result_time_approximate);
        let exact = record_event_run_in_connection(
            &mut connection,
            test_event_run(event.id, "sprint", "confirmed", Some(74_000), Vec::new()),
        )
        .unwrap();
        assert!(!exact.result_time_approximate);

        let updated = update_event_run_result_in_connection(
            &mut connection,
            exact.id,
            " Sprint ",
            "CONFIRMED",
            Some(73_500),
            true,
        )
        .unwrap();
        assert_eq!(updated.result_time_ms, Some(73_500));
        assert!(updated.result_time_approximate);
        assert!(updated.laps.is_empty());
        let reloaded = load_event_run_from_connection(&connection, exact.id).unwrap();
        assert!(reloaded.result_time_approximate);

        let circuit = record_event_run_in_connection(
            &mut connection,
            test_event_run(
                event.id,
                "circuit",
                "completed",
                None,
                vec![EventRunLapInput {
                    lap_number: 1,
                    lap_time_ms: 90_000,
                    sector_1_time_ms: None,
                    sector_2_time_ms: None,
                    sector_3_time_ms: None,
                    trace_points: Vec::new(),
                }],
            ),
        )
        .unwrap();
        assert!(
            update_event_run_result_in_connection(
                &mut connection,
                circuit.id,
                "circuit",
                "completed",
                None,
                true
            )
            .is_err()
        );
        assert!(
            update_event_run_result_in_connection(
                &mut connection,
                exact.id,
                "sprint",
                "completed",
                Some(73_500),
                false
            )
            .is_err()
        );
        assert!(
            update_event_run_result_in_connection(
                &mut connection,
                exact.id,
                "sprint",
                "confirmed",
                None,
                false
            )
            .is_err()
        );
        assert!(
            update_event_run_result_in_connection(
                &mut connection,
                9_999,
                "sprint",
                "confirmed",
                Some(73_500),
                false
            )
            .is_err()
        );
    }
}
