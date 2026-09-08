#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashSet,
    fs,
    net::UdpSocket,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use rusqlite::{Connection, Error as SqliteError, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, State,
    WebviewWindow, Window, WindowEvent, menu::MenuBuilder, tray::TrayIconBuilder,
};

const SETTINGS_WINDOW_STATE_FILE: &str = "settings-window-size.json";
#[cfg(test)]
const SETTINGS_DEFAULT_WIDTH: u32 = 820;
#[cfg(test)]
const SETTINGS_DEFAULT_HEIGHT: u32 = 620;
const SETTINGS_MIN_WIDTH: u32 = 460;
const SETTINGS_MIN_HEIGHT: u32 = 560;
const SETTINGS_MAX_WIDTH: u32 = 8192;
const SETTINGS_MAX_HEIGHT: u32 = 8192;
const DIRECT_UDP_BIND: &str = "127.0.0.1:5301";
const DIRECT_TELEMETRY_EVENT: &str = "direct_telemetry";
const DIRECT_STATUS_EVENT: &str = "direct_status";

#[derive(Default)]
struct DirectSourceState {
    run: Mutex<Option<DirectSourceRun>>,
}

struct DirectSourceRun {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectQuad {
    fl: f32,
    fr: f32,
    rl: f32,
    rr: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectVec3 {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectRumble {
    fl: bool,
    fr: bool,
    rl: bool,
    rr: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectCar {
    ordinal: i32,
    class: i32,
    pi: i32,
    car_group: u32,
    drivetrain: i32,
    cylinders: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectLap {
    number: u16,
    race_position: u8,
    current: f32,
    last: f32,
    best: f32,
    race_time: f32,
    distance: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectTelemetry {
    is_race_on: bool,
    timestamp_ms: u32,
    rpm: f32,
    rpm_max: f32,
    rpm_idle: f32,
    speed_kmh: f32,
    power: f32,
    torque: f32,
    boost: f32,
    gear: u8,
    throttle: f32,
    brake: f32,
    clutch: f32,
    hand_brake: f32,
    steer: f32,
    driving_line: i8,
    ai_brake_difference: i8,
    suspension: DirectQuad,
    suspension_meters: DirectQuad,
    slip_ratio: DirectQuad,
    slip_angle: DirectQuad,
    combined_slip: DirectQuad,
    tire_temp_c: DirectQuad,
    wheel_rotation: DirectQuad,
    rumble: DirectRumble,
    puddle: DirectQuad,
    yaw: f32,
    pitch: f32,
    roll: f32,
    position: DirectVec3,
    velocity: DirectVec3,
    acceleration: DirectVec3,
    angular_velocity: DirectVec3,
    car: DirectCar,
    lap: DirectLap,
    fuel: f32,
    raw_length: usize,
}

#[derive(Clone, Serialize)]
struct DirectStatus {
    state: &'static str,
    message: Option<String>,
}

fn emit_direct_status(app: &AppHandle, state: &'static str, message: Option<String>) {
    let _ = app.emit(DIRECT_STATUS_EVENT, DirectStatus { state, message });
}

fn read_quad(read: &dyn Fn(usize) -> f32, offset: usize) -> DirectQuad {
    DirectQuad {
        fl: read(offset),
        fr: read(offset + 4),
        rl: read(offset + 8),
        rr: read(offset + 12),
    }
}

fn decode_direct_packet(buf: &[u8]) -> Option<DirectTelemetry> {
    if buf.len() != 324 {
        return None;
    }

    let f32_at = |offset: usize| f32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap());
    let u8_at = |offset: usize| buf[offset];
    let i8_at = |offset: usize| buf[offset] as i8;
    let i32_at = |offset: usize| i32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap());
    let u16_at = |offset: usize| u16::from_le_bytes(buf[offset..offset + 2].try_into().unwrap());
    let u32_at = |offset: usize| u32::from_le_bytes(buf[offset..offset + 4].try_into().unwrap());
    let read_quad = |offset: usize| read_quad(&f32_at, offset);
    let dash = 244;
    let fahrenheit_to_celsius = |value: f32| (value - 32.0) * 5.0 / 9.0;
    let mut tire_temp_c = read_quad(dash + 24);
    tire_temp_c.fl = fahrenheit_to_celsius(tire_temp_c.fl);
    tire_temp_c.fr = fahrenheit_to_celsius(tire_temp_c.fr);
    tire_temp_c.rl = fahrenheit_to_celsius(tire_temp_c.rl);
    tire_temp_c.rr = fahrenheit_to_celsius(tire_temp_c.rr);

    Some(DirectTelemetry {
        is_race_on: i32_at(0) == 1,
        timestamp_ms: u32_at(4),
        rpm_max: f32_at(8),
        rpm_idle: f32_at(12),
        rpm: f32_at(16),
        speed_kmh: f32_at(dash + 12) * 3.6,
        power: f32_at(dash + 16),
        torque: f32_at(dash + 20),
        boost: f32_at(dash + 40),
        gear: u8_at(dash + 75),
        throttle: u8_at(dash + 71) as f32 / 255.0,
        brake: u8_at(dash + 72) as f32 / 255.0,
        clutch: u8_at(dash + 73) as f32 / 255.0,
        hand_brake: u8_at(dash + 74) as f32 / 255.0,
        steer: i8_at(dash + 76) as f32 / 127.0,
        driving_line: i8_at(dash + 77),
        ai_brake_difference: i8_at(dash + 78),
        suspension: read_quad(68),
        suspension_meters: read_quad(196),
        slip_ratio: read_quad(84),
        slip_angle: read_quad(164),
        combined_slip: read_quad(180),
        tire_temp_c,
        wheel_rotation: read_quad(100),
        rumble: DirectRumble {
            fl: f32_at(116) > 0.0,
            fr: f32_at(120) > 0.0,
            rl: f32_at(124) > 0.0,
            rr: f32_at(128) > 0.0,
        },
        puddle: read_quad(132),
        yaw: f32_at(56),
        pitch: f32_at(60),
        roll: f32_at(64),
        position: DirectVec3 {
            x: f32_at(dash),
            y: f32_at(dash + 4),
            z: f32_at(dash + 8),
        },
        velocity: DirectVec3 {
            x: f32_at(32),
            y: f32_at(36),
            z: f32_at(40),
        },
        acceleration: DirectVec3 {
            x: f32_at(20),
            y: f32_at(24),
            z: f32_at(28),
        },
        angular_velocity: DirectVec3 {
            x: f32_at(44),
            y: f32_at(48),
            z: f32_at(52),
        },
        car: DirectCar {
            ordinal: i32_at(212),
            class: i32_at(216),
            pi: i32_at(220),
            car_group: u32_at(232),
            drivetrain: i32_at(224),
            cylinders: i32_at(228),
        },
        lap: DirectLap {
            distance: f32_at(dash + 48),
            best: f32_at(dash + 52),
            last: f32_at(dash + 56),
            current: f32_at(dash + 60),
            race_time: f32_at(dash + 64),
            number: u16_at(dash + 68),
            race_position: u8_at(dash + 70),
        },
        fuel: f32_at(dash + 44),
        raw_length: buf.len(),
    })
}

fn stop_direct_source_internal(state: &DirectSourceState) {
    let run = state
        .run
        .lock()
        .expect("direct source state poisoned")
        .take();
    let Some(mut run) = run else { return };
    run.stop.store(true, Ordering::Relaxed);
    if let Some(handle) = run.handle.take() {
        let _ = handle.join();
    }
}

#[tauri::command]
fn start_direct_source(app: AppHandle, state: State<'_, DirectSourceState>) -> Result<(), String> {
    let mut guard = state
        .run
        .lock()
        .map_err(|_| "direct source state poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let socket = UdpSocket::bind(DIRECT_UDP_BIND)
        .map_err(|error| format!("Unable to bind UDP {DIRECT_UDP_BIND}: {error}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|error| format!("Unable to configure UDP receiver: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_app = app.clone();
    let handle = thread::Builder::new()
        .name("forza-direct-udp".to_string())
        .spawn(move || {
            let mut buffer = [0_u8; 2048];
            let mut last_packet_at: Option<Instant> = None;
            let mut live = false;
            let mut incompatible_packet_reported = false;
            emit_direct_status(&thread_app, "is-waiting", None);

            while !thread_stop.load(Ordering::Relaxed) {
                match socket.recv(&mut buffer) {
                    Ok(length) => {
                        let Some(telemetry) = decode_direct_packet(&buffer[..length]) else {
                            if !incompatible_packet_reported {
                                incompatible_packet_reported = true;
                                emit_direct_status(
                                    &thread_app,
                                    "is-error",
                                    Some("Incompatible Forza Data Out packet format; expected a 324-byte FH6 packet.".to_string()),
                                );
                            }
                            continue;
                        };
                        incompatible_packet_reported = false;
                        last_packet_at = Some(Instant::now());
                        if !live {
                            live = true;
                            emit_direct_status(&thread_app, "is-live", None);
                        }
                        let _ = thread_app.emit(DIRECT_TELEMETRY_EVENT, telemetry);
                    }
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            || error.kind() == std::io::ErrorKind::TimedOut => {}
                    Err(error) => {
                        emit_direct_status(&thread_app, "is-offline", Some(error.to_string()));
                        break;
                    }
                }

                if live && last_packet_at.is_some_and(|at| at.elapsed() > Duration::from_secs(1)) {
                    live = false;
                    emit_direct_status(&thread_app, "is-stale", None);
                }
            }

            emit_direct_status(&thread_app, "is-offline", None);
        })
        .map_err(|error| format!("Unable to start UDP receiver: {error}"))?;

    *guard = Some(DirectSourceRun {
        stop,
        handle: Some(handle),
    });
    Ok(())
}

#[tauri::command]
fn stop_direct_source(state: State<'_, DirectSourceState>) -> Result<(), String> {
    stop_direct_source_internal(&state);
    Ok(())
}

#[tauri::command]
fn retry_direct_source(app: AppHandle, state: State<'_, DirectSourceState>) -> Result<(), String> {
    stop_direct_source_internal(&state);
    eval_main(&app, "window.HudOverlay?.retryDirectSource?.()")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightVariantResolution {
    variant_id: i64,
    status: String,
    ratio_features: Option<String>,
}

const SHIFT_LIGHT_LEARNING_MODEL_VERSION: i32 = 4;
const HUD_SCHEMA_VERSION: i32 = 15;
const MAX_SHIFT_LIGHT_CEILING_SAMPLES: usize = 3;
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
struct ShiftLightCalibration {
    model_version: i32,
    reported_redline_rpm: Option<i32>,
    usable_ceiling: Option<i32>,
    ceiling_samples: Vec<i32>,
    gear_targets: Vec<ShiftLightGearTarget>,
    shift_samples: Vec<ShiftLightShiftSample>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightGearTarget {
    source_gear: i32,
    destination_gear: i32,
    status: String,
    candidate_rpm: Option<i32>,
    optimal_rpm: Option<i32>,
    confirmation_count: i32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightShiftSample {
    source_gear: i32,
    destination_gear: i32,
    before_timestamp_ms: i64,
    after_timestamp_ms: i64,
    before_rpm: f64,
    after_rpm: f64,
    #[serde(alias = "powerBeforeW")]
    before_power: f64,
    #[serde(alias = "powerAfterW")]
    after_power: f64,
    delta_percent: f64,
    classification: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightCalibrationRequest {
    key: String,
    config_id: i64,
    reported_redline_rpm: Option<i32>,
    usable_ceiling: Option<i32>,
    #[serde(default)]
    ceiling_samples: Vec<i32>,
    #[serde(default)]
    gear_targets: Vec<ShiftLightGearTarget>,
    #[serde(default)]
    shift_samples: Vec<ShiftLightShiftSample>,
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

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
             )",
            params![table],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to inspect HUD SQLite schema: {error}"))
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("unable to inspect HUD SQLite columns: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("unable to inspect HUD SQLite columns: {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("unable to inspect HUD SQLite columns: {error}"))? == column
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn create_shift_light_config_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS shift_light_configs (
               id INTEGER PRIMARY KEY,
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               car_class INTEGER NOT NULL,
               car_performance_index INTEGER NOT NULL,
               drivetrain_type INTEGER NOT NULL,
               num_cylinders INTEGER NOT NULL,
               reported_redline_rpm INTEGER,
               usable_ceiling_rpm INTEGER,
               model_version INTEGER NOT NULL DEFAULT 4,
               first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               UNIQUE (game_id, car_ordinal, car_class, car_performance_index,
                       drivetrain_type, num_cylinders)
             );
             CREATE INDEX IF NOT EXISTS idx_shift_light_configs_latest
               ON shift_light_configs
               (game_id, car_ordinal, car_class, car_performance_index,
                drivetrain_type, num_cylinders, last_seen_at DESC);
             CREATE TABLE IF NOT EXISTS shift_light_ceiling_samples (
               id INTEGER PRIMARY KEY,
               config_id INTEGER NOT NULL,
               rpm INTEGER NOT NULL CHECK (rpm > 0),
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_shift_light_ceiling_samples_config
               ON shift_light_ceiling_samples(config_id, id DESC);
             CREATE TABLE IF NOT EXISTS shift_light_gear_targets (
               config_id INTEGER NOT NULL,
               source_gear INTEGER NOT NULL CHECK (source_gear BETWEEN 1 AND 9),
               destination_gear INTEGER NOT NULL CHECK (destination_gear = source_gear + 1),
               status TEXT NOT NULL CHECK (status IN ('learning', 'potential', 'optimal')),
               candidate_rpm INTEGER,
               optimal_rpm INTEGER,
               confirmation_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_count BETWEEN 0 AND 3),
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               CHECK (
                 (status = 'learning' AND candidate_rpm IS NULL AND optimal_rpm IS NULL AND confirmation_count = 0)
                 OR (status = 'potential' AND candidate_rpm > 0 AND optimal_rpm IS NULL AND confirmation_count BETWEEN 1 AND 2)
                 OR (status = 'optimal' AND candidate_rpm > 0 AND optimal_rpm > 0 AND confirmation_count = 3)
               ),
               PRIMARY KEY (config_id, source_gear, destination_gear),
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_shift_samples (
               id INTEGER PRIMARY KEY,
               config_id INTEGER NOT NULL,
               source_gear INTEGER NOT NULL CHECK (source_gear BETWEEN 1 AND 9),
               destination_gear INTEGER NOT NULL CHECK (destination_gear = source_gear + 1),
               before_timestamp_ms INTEGER NOT NULL,
               after_timestamp_ms INTEGER NOT NULL,
               before_rpm REAL NOT NULL CHECK (before_rpm > 0),
               after_rpm REAL NOT NULL CHECK (after_rpm > 0),
               before_power_w REAL NOT NULL CHECK (before_power_w > 0),
               after_power_w REAL NOT NULL CHECK (after_power_w > 0),
               delta_percent REAL NOT NULL,
               classification TEXT NOT NULL CHECK (classification IN ('not_better', 'crossover')),
               CHECK (
                 (classification = 'crossover' AND delta_percent >= 0)
                 OR (classification = 'not_better' AND delta_percent < 0)
               ),
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_shift_light_shift_samples_config
               ON shift_light_shift_samples(config_id, id DESC);",
        )
        .map_err(|error| format!("unable to create Shift Light configuration schema: {error}"))
}

fn create_garage_tables(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS garage_cars (
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               car_group INTEGER NOT NULL DEFAULT 0,
               drivetrain_type INTEGER NOT NULL DEFAULT 0,
               num_cylinders INTEGER NOT NULL DEFAULT 0,
               display_name TEXT,
               first_seen_sequence INTEGER NOT NULL,
               last_seen_sequence INTEGER NOT NULL,
               PRIMARY KEY (game_id, car_ordinal)
             );
             CREATE TABLE IF NOT EXISTS garage_variants (
               id INTEGER PRIMARY KEY,
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               car_class INTEGER NOT NULL,
               pi INTEGER NOT NULL,
               drivetrain_type INTEGER NOT NULL DEFAULT 0,
               num_cylinders INTEGER NOT NULL DEFAULT 0,
               first_seen_sequence INTEGER NOT NULL,
               last_seen_sequence INTEGER NOT NULL,
               UNIQUE (game_id, car_ordinal, car_class, pi, drivetrain_type),
               FOREIGN KEY (game_id, car_ordinal)
                 REFERENCES garage_cars(game_id, car_ordinal)
                 ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS garage_sequence (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               next_sequence INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO garage_sequence (id, next_sequence)
             VALUES (1, 1);",
        )
        .map_err(|error| format!("unable to create Garage schema: {error}"))
}

fn create_event_tables(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
               id INTEGER PRIMARY KEY,
               name TEXT NOT NULL CHECK (length(trim(name)) > 0),
               class TEXT NOT NULL CHECK (class IN ('Any', 'D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X')),
               route TEXT NOT NULL CHECK (route IN ('Asphalt', 'Rally', 'Offroad')),
               mode TEXT NOT NULL CHECK (mode IN ('Any', 'Rivals', 'Online', 'EventLab', 'Official', 'Blueprint')),
               notes TEXT,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .map_err(|error| format!("unable to create Events schema: {error}"))
}

fn create_event_run_tables(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS event_runs (
               id INTEGER PRIMARY KEY,
               event_id INTEGER NOT NULL,
               car_ordinal INTEGER NOT NULL CHECK (car_ordinal > 0),
               car_name TEXT,
               car_class INTEGER NOT NULL CHECK (car_class >= 0),
               car_pi INTEGER NOT NULL CHECK (car_pi >= 0),
               drivetrain INTEGER NOT NULL CHECK (drivetrain >= 0),
               started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
               run_type TEXT NOT NULL CHECK (run_type IN ('circuit', 'sprint')),
               result TEXT NOT NULL CHECK (result IN ('completed', 'confirmed')),
               result_time_ms INTEGER CHECK (result_time_ms IS NULL OR result_time_ms > 0),
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (event_id)
                 REFERENCES events(id)
                 ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS event_run_laps (
               run_id INTEGER NOT NULL,
               lap_number INTEGER NOT NULL CHECK (lap_number > 0),
               lap_time_ms INTEGER NOT NULL CHECK (lap_time_ms > 0),
               sector_1_time_ms INTEGER CHECK (sector_1_time_ms IS NULL OR sector_1_time_ms > 0),
               sector_2_time_ms INTEGER CHECK (sector_2_time_ms IS NULL OR sector_2_time_ms > 0),
               sector_3_time_ms INTEGER CHECK (sector_3_time_ms IS NULL OR sector_3_time_ms > 0),
               PRIMARY KEY (run_id, lap_number),
               FOREIGN KEY (run_id)
                 REFERENCES event_runs(id)
                 ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_event_runs_event_started
               ON event_runs (event_id, started_at DESC, id DESC);",
        )
        .map_err(|error| format!("unable to create Event run schema: {error}"))
}

fn migrate_events_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Events schema migration: {error}"))?;
    create_event_tables(&transaction)?;
    transaction
        .execute("UPDATE hud_schema_version SET version = 7", [])
        .map_err(|error| format!("unable to update Events schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Events schema migration: {error}"))
}

fn migrate_event_runs_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Event run schema migration: {error}"))?;
    create_event_tables(&transaction)?;
    create_event_run_tables(&transaction)?;
    transaction
        .execute("UPDATE hud_schema_version SET version = 8", [])
        .map_err(|error| format!("unable to update Event run schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event run schema migration: {error}"))
}

fn migrate_event_sectors_schema(connection: &mut Connection) -> Result<(), String> {
    let remove_archived_at = table_has_column(connection, "events", "archived_at")?;
    let mut missing_sector_columns = Vec::new();
    for (column, definition) in [
        (
            "sector_1_time_ms",
            "INTEGER CHECK (sector_1_time_ms IS NULL OR sector_1_time_ms > 0)",
        ),
        (
            "sector_2_time_ms",
            "INTEGER CHECK (sector_2_time_ms IS NULL OR sector_2_time_ms > 0)",
        ),
        (
            "sector_3_time_ms",
            "INTEGER CHECK (sector_3_time_ms IS NULL OR sector_3_time_ms > 0)",
        ),
    ] {
        if !table_has_column(connection, "event_run_laps", column)? {
            missing_sector_columns.push((column, definition));
        }
    }
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Event sector schema migration: {error}"))?;
    create_event_tables(&transaction)?;
    create_event_run_tables(&transaction)?;
    if remove_archived_at {
        transaction
            .execute("ALTER TABLE events DROP COLUMN archived_at", [])
            .map_err(|error| format!("unable to remove archived Event data: {error}"))?;
    }
    for (column, definition) in missing_sector_columns {
        transaction
            .execute(
                &format!("ALTER TABLE event_run_laps ADD COLUMN {column} {definition}"),
                [],
            )
            .map_err(|error| format!("unable to add Event sector data: {error}"))?;
    }
    transaction
        .execute("UPDATE hud_schema_version SET version = 9", [])
        .map_err(|error| format!("unable to update Event sector schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event sector schema migration: {error}"))
}

fn create_event_trace_tables(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS event_run_lap_trace_points (
               run_id INTEGER NOT NULL,
               lap_number INTEGER NOT NULL,
               sample_index INTEGER NOT NULL CHECK (sample_index >= 0),
               elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0),
               distance REAL NOT NULL CHECK (distance >= 0),
               position_x REAL NOT NULL,
               position_y REAL NOT NULL,
               position_z REAL NOT NULL,
               throttle REAL NOT NULL CHECK (throttle >= 0 AND throttle <= 1),
               brake REAL NOT NULL CHECK (brake >= 0 AND brake <= 1),
               PRIMARY KEY (run_id, lap_number, sample_index),
               FOREIGN KEY (run_id, lap_number)
                 REFERENCES event_run_laps(run_id, lap_number)
                 ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_event_run_lap_trace_points_order
               ON event_run_lap_trace_points (run_id, lap_number, sample_index);",
        )
        .map_err(|error| format!("unable to create Event run trace schema: {error}"))
}

fn migrate_event_trace_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Event trace schema migration: {error}"))?;
    create_event_tables(&transaction)?;
    create_event_run_tables(&transaction)?;
    create_event_trace_tables(&transaction)?;
    transaction
        .execute("UPDATE hud_schema_version SET version = 10", [])
        .map_err(|error| format!("unable to update Event trace schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event trace schema migration: {error}"))
}

fn migrate_garage_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Garage schema migration: {error}"))?;
    create_garage_tables(&transaction)?;
    transaction
        .execute("UPDATE hud_schema_version SET version = 4", [])
        .map_err(|error| format!("unable to update Garage schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Garage schema migration: {error}"))
}

fn migrate_garage_variant_schema(connection: &mut Connection) -> Result<(), String> {
    if table_has_column(connection, "garage_variants", "drivetrain_type")? {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start Garage variant schema check: {error}"))?;
        transaction
            .execute("UPDATE hud_schema_version SET version = 5", [])
            .map_err(|error| format!("unable to update Garage schema version: {error}"))?;
        return transaction
            .commit()
            .map_err(|error| format!("unable to commit Garage variant schema check: {error}"));
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Garage variant schema migration: {error}"))?;
    let orphaned_variant: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1
               FROM garage_variants AS variants
               LEFT JOIN garage_cars AS cars
                 ON cars.game_id = variants.game_id
                AND cars.car_ordinal = variants.car_ordinal
               WHERE cars.game_id IS NULL
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to validate Garage variants: {error}"))?;
    if orphaned_variant {
        return Err(
            "unable to migrate Garage variants: one or more rows have no parent car".to_string(),
        );
    }

    transaction
        .execute_batch(
            "CREATE TABLE garage_variants_new (
               id INTEGER PRIMARY KEY,
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               car_class INTEGER NOT NULL,
               pi INTEGER NOT NULL,
               drivetrain_type INTEGER NOT NULL DEFAULT 0,
               first_seen_sequence INTEGER NOT NULL,
               last_seen_sequence INTEGER NOT NULL,
               UNIQUE (game_id, car_ordinal, car_class, pi, drivetrain_type),
               FOREIGN KEY (game_id, car_ordinal)
                 REFERENCES garage_cars(game_id, car_ordinal)
                 ON DELETE CASCADE
             );
             INSERT INTO garage_variants_new
               (id, game_id, car_ordinal, car_class, pi, drivetrain_type,
                first_seen_sequence, last_seen_sequence)
             SELECT variants.id, variants.game_id, variants.car_ordinal,
                    variants.car_class, variants.pi, cars.drivetrain_type,
                    variants.first_seen_sequence, variants.last_seen_sequence
             FROM garage_variants AS variants
             JOIN garage_cars AS cars
               ON cars.game_id = variants.game_id
              AND cars.car_ordinal = variants.car_ordinal;
             DROP TABLE garage_variants;
             ALTER TABLE garage_variants_new RENAME TO garage_variants;",
        )
        .map_err(|error| format!("unable to migrate Garage variants: {error}"))?;
    transaction
        .execute("UPDATE hud_schema_version SET version = 5", [])
        .map_err(|error| format!("unable to update Garage schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Garage variant schema migration: {error}"))
}

fn migrate_garage_variant_cylinder_schema(connection: &mut Connection) -> Result<(), String> {
    if table_has_column(connection, "garage_variants", "num_cylinders")? {
        let transaction = connection.transaction().map_err(|error| {
            format!("unable to start Garage variant cylinder schema check: {error}")
        })?;
        transaction
            .execute("UPDATE hud_schema_version SET version = 6", [])
            .map_err(|error| format!("unable to update Garage schema version: {error}"))?;
        return transaction.commit().map_err(|error| {
            format!("unable to commit Garage variant cylinder schema check: {error}")
        });
    }

    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Garage variant cylinder schema migration: {error}")
    })?;
    let orphaned_variant: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1
               FROM garage_variants AS variants
               LEFT JOIN garage_cars AS cars
                 ON cars.game_id = variants.game_id
                AND cars.car_ordinal = variants.car_ordinal
               WHERE cars.game_id IS NULL
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to validate Garage variants: {error}"))?;
    if orphaned_variant {
        return Err(
            "unable to migrate Garage variants: one or more rows have no parent car".to_string(),
        );
    }

    transaction
        .execute_batch(
            "CREATE TABLE garage_variants_new (
               id INTEGER PRIMARY KEY,
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               car_class INTEGER NOT NULL,
               pi INTEGER NOT NULL,
               drivetrain_type INTEGER NOT NULL DEFAULT 0,
               num_cylinders INTEGER NOT NULL DEFAULT 0,
               first_seen_sequence INTEGER NOT NULL,
               last_seen_sequence INTEGER NOT NULL,
               UNIQUE (game_id, car_ordinal, car_class, pi, drivetrain_type),
               FOREIGN KEY (game_id, car_ordinal)
                 REFERENCES garage_cars(game_id, car_ordinal)
                 ON DELETE CASCADE
             );
             INSERT INTO garage_variants_new
               (id, game_id, car_ordinal, car_class, pi, drivetrain_type,
                num_cylinders, first_seen_sequence, last_seen_sequence)
             SELECT variants.id, variants.game_id, variants.car_ordinal,
                    variants.car_class, variants.pi, variants.drivetrain_type,
                    cars.num_cylinders, variants.first_seen_sequence,
                    variants.last_seen_sequence
             FROM garage_variants AS variants
             JOIN garage_cars AS cars
               ON cars.game_id = variants.game_id
              AND cars.car_ordinal = variants.car_ordinal;
             DROP TABLE garage_variants;
             ALTER TABLE garage_variants_new RENAME TO garage_variants;",
        )
        .map_err(|error| format!("unable to migrate Garage variants: {error}"))?;
    transaction
        .execute("UPDATE hud_schema_version SET version = 6", [])
        .map_err(|error| format!("unable to update Garage schema version: {error}"))?;
    transaction.commit().map_err(|error| {
        format!("unable to commit Garage variant cylinder schema migration: {error}")
    })
}

/// Rebuild only the Shift Light persistence boundary for schema v15. Legacy
/// learner facts are intentionally discarded because their meaning differs
/// from the compact crossover model. Garage and Events tables are untouched.
fn migrate_shift_light_v15(connection: &mut Connection) -> Result<(), String> {
    let old_config = table_exists(connection, "shift_light_configs")?
        && table_has_column(connection, "shift_light_configs", "rpm_max")?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light v15 migration: {error}"))?;
    transaction
        .execute_batch(
            "DROP TABLE IF EXISTS shift_light_shift_samples;
             DROP TABLE IF EXISTS shift_light_ceiling_samples;
             DROP TABLE IF EXISTS shift_light_gear_targets;
             DROP TABLE IF EXISTS shift_light_learning_state;
             DROP TABLE IF EXISTS shift_light_gear_learning;
             DROP TABLE IF EXISTS shift_light_power_bins;
             DROP TABLE IF EXISTS shift_light_shift_evidence;
             DROP TABLE IF EXISTS shift_light_config_profile_samples;
             DROP TABLE IF EXISTS shift_light_config_profiles;
             DROP TABLE IF EXISTS shift_light_profile_samples;
             DROP TABLE IF EXISTS shift_light_profiles;
             DROP TABLE IF EXISTS shift_light_variants;
             DROP TABLE IF EXISTS shift_light_cars;
             DROP TABLE IF EXISTS shift_light_profiles_legacy;
             DROP TABLE IF EXISTS shift_light_configs_legacy;",
        )
        .map_err(|error| format!("unable to remove legacy Shift Light tables: {error}"))?;
    if old_config {
        transaction
            .execute(
                "ALTER TABLE shift_light_configs RENAME TO shift_light_configs_legacy",
                [],
            )
            .map_err(|error| format!("unable to preserve legacy Shift Light configs: {error}"))?;
    }
    create_shift_light_config_tables(&transaction)?;
    if old_config {
        transaction
            .execute(
                "INSERT OR IGNORE INTO shift_light_configs
                   (id, game_id, car_ordinal, car_class, car_performance_index,
                    drivetrain_type, num_cylinders, reported_redline_rpm,
                    usable_ceiling_rpm, model_version, first_seen_at, last_seen_at)
                 SELECT id, game_id, car_ordinal, car_class, car_performance_index,
                        drivetrain_type, num_cylinders,
                        CASE WHEN rpm_max > 0 THEN rpm_max ELSE NULL END,
                        NULL, 4, first_seen_at, last_seen_at
                   FROM shift_light_configs_legacy",
                [],
            )
            .map_err(|error| format!("unable to migrate Shift Light config identity: {error}"))?;
        transaction
            .execute("DROP TABLE shift_light_configs_legacy", [])
            .map_err(|error| format!("unable to remove legacy Shift Light configs: {error}"))?;
    }
    transaction
        .execute("UPDATE hud_schema_version SET version = 15", [])
        .map_err(|error| format!("unable to update Shift Light schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light v15 migration: {error}"))
}

fn initialize_shift_light_schema(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS hud_schema_version (
               version INTEGER NOT NULL
             );
             INSERT INTO hud_schema_version (version)
             SELECT 15
             WHERE NOT EXISTS (SELECT 1 FROM hud_schema_version);",
        )
        .map_err(|error| format!("unable to initialize HUD SQLite metadata: {error}"))?;

    let version: i32 = connection
        .query_row(
            "SELECT version FROM hud_schema_version LIMIT 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to read HUD SQLite schema version: {error}"))?;
    if version < 4 {
        migrate_garage_schema(connection)?;
    } else {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start Garage schema check: {error}"))?;
        create_garage_tables(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("unable to commit Garage schema check: {error}"))?;
    }
    if version < 5 {
        migrate_garage_variant_schema(connection)?;
    }
    if version < 6 {
        migrate_garage_variant_cylinder_schema(connection)?;
    }
    if version < 7 {
        migrate_events_schema(connection)?;
    } else if version < 8 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start Events schema check: {error}"))?;
        create_event_tables(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("unable to commit Events schema check: {error}"))?;
    }
    if version < 8 {
        migrate_event_runs_schema(connection)?;
    } else {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start Event run schema check: {error}"))?;
        create_event_tables(&transaction)?;
        create_event_run_tables(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("unable to commit Event run schema check: {error}"))?;
    }
    if version < 9 {
        migrate_event_sectors_schema(connection)?;
    }
    if version < 10 {
        migrate_event_trace_schema(connection)?;
    } else {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start Event trace schema check: {error}"))?;
        create_event_tables(&transaction)?;
        create_event_run_tables(&transaction)?;
        create_event_trace_tables(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("unable to commit Event trace schema check: {error}"))?;
    }
    // A fresh database starts at the current Shift Light version, so the
    // historical version gates above must still materialize Garage and Events.
    {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start current schema check: {error}"))?;
        create_garage_tables(&transaction)?;
        create_event_tables(&transaction)?;
        create_event_run_tables(&transaction)?;
        create_event_trace_tables(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("unable to commit current schema check: {error}"))?;
    }
    if version < HUD_SCHEMA_VERSION {
        migrate_shift_light_v15(connection)?;
    } else {
        create_shift_light_config_tables(connection)?;
    }
    Ok(())
}

fn open_shift_light_db<R: Runtime>(app: &AppHandle<R>) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("unable to resolve HUD data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("unable to create HUD data directory: {error}"))?;
    let path = directory.join("fdc.sqlite");
    let mut connection = Connection::open(path)
        .map_err(|error| format!("unable to open HUD SQLite database: {error}"))?;
    initialize_shift_light_schema(&mut connection)?;
    Ok(connection)
}

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
struct NewEvent {
    name: String,
    class: String,
    route: String,
    mode: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventRecord {
    id: i64,
    name: String,
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
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventRunLapInput {
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
struct NewEventRun {
    event_id: i64,
    car_ordinal: i32,
    car_name: Option<String>,
    car_class: i32,
    car_pi: i32,
    drivetrain: i32,
    started_at: String,
    run_type: String,
    result: String,
    result_time_ms: Option<i64>,
    #[serde(default)]
    laps: Vec<EventRunLapInput>,
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
struct EventRunRecord {
    id: i64,
    event_id: i64,
    car_ordinal: i32,
    car_name: Option<String>,
    car_class: i32,
    car_pi: i32,
    drivetrain: i32,
    started_at: String,
    run_type: String,
    result: String,
    result_time_ms: Option<i64>,
    created_at: String,
    laps: Vec<EventRunLap>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventAbsoluteBestReference {
    event_id: i64,
    run_id: i64,
    run_type: String,
    lap_number: Option<i32>,
    time_ms: i64,
    trace_points: Vec<EventRunTracePoint>,
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

fn load_event_from_connection(
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
             FROM events WHERE id = ?1",
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
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|error| format!("unable to prepare Event list query: {error}"))?;
    statement
        .query_map([], event_from_row)
        .map_err(|error| format!("unable to load Events: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Events: {error}"))
}

fn create_event_in_connection(
    connection: &mut Connection,
    event: NewEvent,
) -> Result<EventRecord, String> {
    let event = normalize_event_input(event)?;
    let transaction = connection
        .transaction()
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
             WHERE id = ?2",
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
        .execute("DELETE FROM events WHERE id = ?1", params![event_id])
        .map_err(|error| format!("unable to delete Event: {error}"))?;
    if changed == 0 {
        return Err(format!("Event {event_id} does not exist"));
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
    run.car_name = run
        .car_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    if run
        .car_name
        .as_ref()
        .is_some_and(|name| name.chars().count() > 80)
    {
        return Err("Event run car name must be 80 characters or fewer".to_string());
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
    if !["circuit", "sprint"].contains(&run.run_type.as_str()) {
        return Err("unknown Event run type".to_string());
    }
    if run.result_time_ms.is_some_and(|time| time <= 0) {
        return Err("Event run result time must be positive".to_string());
    }
    let mut lap_numbers = HashSet::with_capacity(run.laps.len());
    for lap in &run.laps {
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
        if !lap_numbers.insert(lap.lap_number) {
            return Err("Event run lap numbers must be unique".to_string());
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
            if !sample_indexes.insert(point.sample_index) {
                return Err("Event run lap trace sample indexes must be unique".to_string());
            }
        }
    }
    run.laps.sort_by_key(|lap| lap.lap_number);
    match run.run_type.as_str() {
        "circuit" => {
            if run.result != "completed" {
                return Err("Circuit Event runs must have a completed result".to_string());
            }
            if run.laps.is_empty() {
                return Err("Circuit Event runs require at least one completed lap".to_string());
            }
        }
        "sprint" => {
            if run.result != "confirmed" {
                return Err("Sprint Event runs require a confirmed result".to_string());
            }
            if run.result_time_ms.is_none() {
                return Err("Confirmed Sprint Event runs require a result time".to_string());
            }
        }
        _ => unreachable!(),
    }
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
                    position_x, position_y, position_z, throttle, brake
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
            })
        })
        .map_err(|error| format!("unable to load Event run trace points: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Event run trace points: {error}"))
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
        created_at,
        laps: event_run_laps_from_connection(connection, id, include_trace)?,
    })
}

fn load_event_run_from_connection(
    connection: &Connection,
    run_id: i64,
) -> Result<EventRunRecord, String> {
    if run_id <= 0 {
        return Err("Event run ID must be positive".to_string());
    }
    let mut statement = connection
        .prepare(
            "SELECT event_runs.id, event_runs.event_id, event_runs.car_ordinal,
                    COALESCE(garage_cars.display_name, event_runs.car_name),
                    event_runs.car_class, event_runs.car_pi, event_runs.drivetrain,
                    event_runs.started_at, event_runs.run_type, event_runs.result,
                    event_runs.result_time_ms, event_runs.created_at
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
    event_run_from_values(connection, values, true)
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
                    COALESCE(garage_cars.display_name, event_runs.car_name),
                    event_runs.car_class, event_runs.car_pi, event_runs.drivetrain,
                    event_runs.started_at, event_runs.run_type, event_runs.result,
                    event_runs.result_time_ms, event_runs.created_at
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

fn load_event_absolute_best_from_connection(
    connection: &Connection,
    event_id: i64,
) -> Result<Option<EventAbsoluteBestReference>, String> {
    if event_id <= 0 {
        return Err("Event ID must be positive".to_string());
    }

    let event_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
            params![event_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to verify Event: {error}"))?;
    if !event_exists {
        return Err(format!("Event {event_id} does not exist"));
    }

    // A circuit candidate is each saved completed lap. A sprint candidate is
    // its confirmed final result; MIN(lap_number) is used only to locate the
    // optional synthetic sprint trace row.
    let candidate = connection
        .query_row(
            "WITH candidates AS (
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
            SELECT event_id, run_id, run_type, lap_number, time_ms
            FROM candidates
            ORDER BY time_ms ASC, run_id DESC, lap_number ASC
            LIMIT 1",
            params![event_id],
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
        .map(|lap_number| event_run_trace_points_from_connection(connection, run_id, lap_number))
        .transpose()?
        .unwrap_or_default();
    Ok(Some(EventAbsoluteBestReference {
        event_id,
        run_id,
        run_type,
        lap_number,
        time_ms,
        trace_points,
    }))
}

fn record_event_run_in_connection(
    connection: &mut Connection,
    run: NewEventRun,
) -> Result<EventRunRecord, String> {
    let run = normalize_event_run_input(run)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Event run record: {error}"))?;
    let event_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE id = ?1)",
            params![run.event_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to verify Event run Event: {error}"))?;
    if !event_exists {
        return Err(format!("Event {} does not exist", run.event_id));
    }
    let car_name = match run.car_name {
        Some(name) => Some(name),
        None => transaction
            .query_row(
                "SELECT display_name
                 FROM garage_cars
                 WHERE game_id = 'fh6' AND car_ordinal = ?1",
                params![run.car_ordinal],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| format!("unable to load Event run Garage name: {error}"))?
            .flatten(),
    };
    transaction
        .execute(
            "INSERT INTO event_runs
               (event_id, car_ordinal, car_name, car_class, car_pi, drivetrain,
                started_at, run_type, result, result_time_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                run.event_id,
                run.car_ordinal,
                car_name,
                run.car_class,
                run.car_pi,
                run.drivetrain,
                run.started_at,
                run.run_type,
                run.result,
                run.result_time_ms,
            ],
        )
        .map_err(|error| format!("unable to record Event run: {error}"))?;
    let run_id = transaction.last_insert_rowid();
    for lap in run.laps {
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
        for point in lap.trace_points {
            transaction
                .execute(
                    "INSERT INTO event_run_lap_trace_points
                       (run_id, lap_number, sample_index, elapsed_ms, distance,
                        position_x, position_y, position_z, throttle, brake)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
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
                    ],
                )
                .map_err(|error| format!("unable to record Event run trace point: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event run record: {error}"))?;
    load_event_run_from_connection(connection, run_id)
}

#[tauri::command]
fn record_event_run(app: AppHandle, run: NewEventRun) -> Result<EventRunRecord, String> {
    let mut connection = open_shift_light_db(&app)?;
    record_event_run_in_connection(&mut connection, run)
}

#[tauri::command]
fn load_event_runs(app: AppHandle, event_id: Option<i64>) -> Result<Vec<EventRunRecord>, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_runs_from_connection(&connection, event_id)
}

#[tauri::command]
fn load_event_run(app: AppHandle, run_id: i64) -> Result<EventRunRecord, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_run_from_connection(&connection, run_id)
}

#[tauri::command]
fn load_event_absolute_best(
    app: AppHandle,
    event_id: i64,
) -> Result<Option<EventAbsoluteBestReference>, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_absolute_best_from_connection(&connection, event_id)
}

#[tauri::command]
fn create_event(
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

#[tauri::command]
fn load_events(app: AppHandle) -> Result<Vec<EventRecord>, String> {
    let connection = open_shift_light_db(&app)?;
    load_events_from_connection(&connection)
}

#[tauri::command]
fn load_event(app: AppHandle, event_id: i64) -> Result<EventRecord, String> {
    let connection = open_shift_light_db(&app)?;
    load_event_from_connection(&connection, event_id)
}

#[tauri::command]
fn rename_event(app: AppHandle, event_id: i64, name: String) -> Result<EventRecord, String> {
    let connection = open_shift_light_db(&app)?;
    rename_event_in_connection(&connection, event_id, name)
}

#[tauri::command]
fn delete_event(app: AppHandle, event_id: i64) -> Result<(), String> {
    let connection = open_shift_light_db(&app)?;
    delete_event_in_connection(&connection, event_id)
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GarageVehicle {
    ordinal: i32,
    class: i32,
    pi: i32,
    car_group: u32,
    drivetrain: i32,
    cylinders: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GarageShiftLightSummary {
    status: String,
    tune_count: i64,
    calibrated_gear_count: i64,
    learning_gear_count: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GarageVariant {
    id: i64,
    class: i32,
    car_class: i32,
    pi: i32,
    drivetrain: i32,
    drivetrain_type: i32,
    cylinders: i32,
    num_cylinders: i32,
    first_seen_sequence: i64,
    last_seen_sequence: i64,
    is_current: bool,
    shift_light: GarageShiftLightSummary,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GarageCar {
    ordinal: i32,
    car_ordinal: i32,
    car_group: u32,
    drivetrain: i32,
    cylinders: i32,
    drivetrain_type: i32,
    num_cylinders: i32,
    name: Option<String>,
    first_seen_sequence: i64,
    last_seen_sequence: i64,
    current_variant_id: Option<i64>,
    latest_used: bool,
    variants: Vec<GarageVariant>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GarageSnapshot {
    cars: Vec<GarageCar>,
    current_car_ordinal: Option<i32>,
}

fn validate_garage_vehicle(vehicle: &GarageVehicle) -> Result<(), String> {
    if vehicle.ordinal <= 0 {
        return Err("Garage car ordinal must be positive".to_string());
    }
    if vehicle.class < 0 || vehicle.pi < 0 {
        return Err("Garage car class and PI must not be negative".to_string());
    }
    Ok(())
}

fn load_garage_shift_light_summary(
    connection: &Connection,
    car_ordinal: i32,
    pi: i32,
) -> Result<GarageShiftLightSummary, String> {
    let (tune_count, calibrated_gear_count, learning_gear_count): (i64, i64, i64) = connection
        .query_row(
            "WITH configuration_profiles AS (
                SELECT 'config:' || configs.id AS configuration_id,
                       targets.status AS status,
                       targets.optimal_rpm AS shift_rpm,
                       targets.source_gear AS gear
                FROM shift_light_configs AS configs
                LEFT JOIN shift_light_gear_targets AS targets
                  ON targets.config_id = configs.id
                WHERE configs.game_id = 'fh6'
                  AND configs.car_ordinal = ?1
                  AND configs.car_performance_index = ?2
             )
             SELECT COUNT(DISTINCT configuration_id),
                    COALESCE(SUM(CASE
                      WHEN status = 'optimal' AND shift_rpm IS NOT NULL THEN 1
                      ELSE 0
                    END), 0),
                    COALESCE(SUM(CASE
                      WHEN gear IS NOT NULL
                       AND (status <> 'optimal' OR shift_rpm IS NULL) THEN 1
                      ELSE 0
                    END), 0)
             FROM configuration_profiles",
            params![car_ordinal, pi],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("unable to summarize Garage Shift Light profiles: {error}"))?;
    let status = if calibrated_gear_count > 0 {
        "ready"
    } else if tune_count > 0 {
        "learning"
    } else {
        "none"
    };
    Ok(GarageShiftLightSummary {
        status: status.to_string(),
        tune_count,
        calibrated_gear_count,
        learning_gear_count,
    })
}

fn load_garage_snapshot_from_connection(connection: &Connection) -> Result<GarageSnapshot, String> {
    let mut car_statement = connection
        .prepare(
            "SELECT car_ordinal, car_group, display_name,
                    drivetrain_type, num_cylinders,
                    first_seen_sequence, last_seen_sequence
             FROM garage_cars
             WHERE game_id = 'fh6'
             ORDER BY last_seen_sequence DESC, car_ordinal DESC",
        )
        .map_err(|error| format!("unable to prepare Garage car query: {error}"))?;
    let cars = car_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, u32>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, i32>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|error| format!("unable to read Garage cars: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Garage cars: {error}"))?;

    let mut variant_statement = connection
        .prepare(
            "SELECT id, car_class, pi, drivetrain_type, num_cylinders,
                    first_seen_sequence, last_seen_sequence
             FROM garage_variants
             WHERE game_id = 'fh6' AND car_ordinal = ?1
             ORDER BY last_seen_sequence DESC, id DESC",
        )
        .map_err(|error| format!("unable to prepare Garage variant query: {error}"))?;
    let mut snapshot_cars = Vec::with_capacity(cars.len());
    for (
        ordinal,
        car_group,
        name,
        drivetrain,
        cylinders,
        first_seen_sequence,
        last_seen_sequence,
    ) in cars
    {
        let variants = variant_statement
            .query_map(params![ordinal], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i32>(2)?,
                    row.get::<_, i32>(3)?,
                    row.get::<_, i32>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .map_err(|error| format!("unable to read Garage variants: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("unable to decode Garage variants: {error}"))?;
        let current_variant_id = variants.first().map(|variant| variant.0);
        let mut snapshot_variants = Vec::with_capacity(variants.len());
        for (id, class, pi, drivetrain, cylinders, first_seen_sequence, last_seen_sequence) in
            variants
        {
            snapshot_variants.push(GarageVariant {
                id,
                class,
                car_class: class,
                pi,
                drivetrain,
                drivetrain_type: drivetrain,
                cylinders,
                num_cylinders: cylinders,
                first_seen_sequence,
                last_seen_sequence,
                is_current: Some(id) == current_variant_id,
                shift_light: load_garage_shift_light_summary(connection, ordinal, pi)?,
            });
        }
        snapshot_cars.push(GarageCar {
            ordinal,
            car_ordinal: ordinal,
            car_group,
            drivetrain,
            cylinders,
            drivetrain_type: drivetrain,
            num_cylinders: cylinders,
            name: name.filter(|name| !name.is_empty()),
            first_seen_sequence,
            last_seen_sequence,
            current_variant_id,
            latest_used: false,
            variants: snapshot_variants,
        });
    }
    if let Some(current) = snapshot_cars.first_mut() {
        current.latest_used = true;
    }
    Ok(GarageSnapshot {
        current_car_ordinal: snapshot_cars.first().map(|car| car.ordinal),
        cars: snapshot_cars,
    })
}

fn record_garage_vehicle_in_connection(
    connection: &mut Connection,
    vehicle: &GarageVehicle,
) -> Result<GarageSnapshot, String> {
    validate_garage_vehicle(vehicle)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Garage record: {error}"))?;
    let sequence: i64 = transaction
        .query_row(
            "SELECT next_sequence FROM garage_sequence WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to read Garage sequence: {error}"))?;
    transaction
        .execute(
            "UPDATE garage_sequence SET next_sequence = ?1 WHERE id = 1",
            params![sequence.saturating_add(1)],
        )
        .map_err(|error| format!("unable to advance Garage sequence: {error}"))?;
    transaction
        .execute(
            "INSERT INTO garage_cars
               (game_id, car_ordinal, car_group, drivetrain_type, num_cylinders,
                first_seen_sequence, last_seen_sequence)
             VALUES ('fh6', ?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT (game_id, car_ordinal) DO UPDATE SET
               car_group = excluded.car_group,
               drivetrain_type = excluded.drivetrain_type,
               num_cylinders = excluded.num_cylinders,
               last_seen_sequence = excluded.last_seen_sequence",
            params![
                vehicle.ordinal,
                vehicle.car_group,
                vehicle.drivetrain,
                vehicle.cylinders,
                sequence
            ],
        )
        .map_err(|error| format!("unable to record Garage car: {error}"))?;
    transaction
        .execute(
            "INSERT INTO garage_variants
               (game_id, car_ordinal, car_class, pi, drivetrain_type,
                num_cylinders, first_seen_sequence, last_seen_sequence)
             VALUES ('fh6', ?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT (game_id, car_ordinal, car_class, pi, drivetrain_type) DO UPDATE SET
               num_cylinders = excluded.num_cylinders,
               last_seen_sequence = excluded.last_seen_sequence",
            params![
                vehicle.ordinal,
                vehicle.class,
                vehicle.pi,
                vehicle.drivetrain,
                vehicle.cylinders,
                sequence
            ],
        )
        .map_err(|error| format!("unable to record Garage variant: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Garage record: {error}"))?;
    load_garage_snapshot_from_connection(connection)
}

#[tauri::command]
fn record_garage_vehicle(
    app: AppHandle,
    car_ordinal: i32,
    class: i32,
    pi: i32,
    car_group: Option<u32>,
    drivetrain: Option<i32>,
    cylinders: Option<i32>,
) -> Result<GarageSnapshot, String> {
    let mut connection = open_shift_light_db(&app)?;
    let vehicle = GarageVehicle {
        ordinal: car_ordinal,
        class,
        pi,
        car_group: car_group.unwrap_or_default(),
        drivetrain: drivetrain.unwrap_or_default(),
        cylinders: cylinders.unwrap_or_default(),
    };
    record_garage_vehicle_in_connection(&mut connection, &vehicle)
}

#[tauri::command]
fn load_garage_snapshot(app: AppHandle) -> Result<GarageSnapshot, String> {
    let connection = open_shift_light_db(&app)?;
    load_garage_snapshot_from_connection(&connection)
}

#[tauri::command]
fn load_garage(app: AppHandle) -> Result<GarageSnapshot, String> {
    load_garage_snapshot(app)
}

#[tauri::command]
fn rename_garage_car(
    app: AppHandle,
    car_ordinal: i32,
    name: String,
) -> Result<GarageSnapshot, String> {
    if car_ordinal <= 0 {
        return Err("Garage car ordinal must be positive".to_string());
    }
    let name = name.trim().to_string();
    if name.chars().count() > 80 {
        return Err("Garage car name must be 80 characters or fewer".to_string());
    }
    let connection = open_shift_light_db(&app)?;
    let changed = connection
        .execute(
            "UPDATE garage_cars SET display_name = ?1
             WHERE game_id = 'fh6' AND car_ordinal = ?2",
            params![(!name.is_empty()).then_some(name), car_ordinal],
        )
        .map_err(|error| format!("unable to rename Garage car: {error}"))?;
    if changed == 0 {
        return Err(format!("Garage car {car_ordinal} does not exist"));
    }
    load_garage_snapshot_from_connection(&connection)
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

#[tauri::command]
fn resolve_shift_light_config(
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

fn resolve_shift_light_config_in_connection(
    connection: &mut Connection,
    key: &str,
    observed_gear: i32,
) -> Result<ShiftLightVariantResolution, String> {
    if !(1..=10).contains(&observed_gear) {
        return Err("invalid observed Shift Light gear".to_string());
    }
    let identity = parse_shift_light_config_key(key)?;
    let key_redline = key_reported_redline_rpm(key)?;
    let transaction = connection.transaction().map_err(|error| {
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

fn load_shift_light_calibration_from_connection(
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
                    optimal_rpm, confirmation_count
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

fn save_shift_light_calibration_in_connection(
    connection: &mut Connection,
    request: &ShiftLightCalibrationRequest,
) -> Result<(), String> {
    if request.config_id < 1 {
        return Err("invalid Shift Light configuration id".to_string());
    }
    assert_shift_light_config_matches_key(connection, request.config_id, &request.key)?;
    let transaction = connection
        .transaction()
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
    for rpm in request
        .ceiling_samples
        .iter()
        .copied()
        .filter(|rpm| *rpm > 0)
        .take(MAX_SHIFT_LIGHT_CEILING_SAMPLES)
    {
        transaction
            .execute(
                "INSERT INTO shift_light_ceiling_samples (config_id, rpm)
                 VALUES (?1, ?2)",
                params![request.config_id, rpm],
            )
            .map_err(|error| format!("unable to save Shift Light ceiling sample: {error}"))?;
    }
    let mut target_pairs = HashSet::new();
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
        transaction
            .execute(
                "INSERT INTO shift_light_gear_targets
                   (config_id, source_gear, destination_gear, status, candidate_rpm,
                    optimal_rpm, confirmation_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    request.config_id,
                    target.source_gear,
                    target.destination_gear,
                    target.status,
                    target.candidate_rpm.filter(|value| *value > 0),
                    target.optimal_rpm.filter(|value| *value > 0),
                    target.confirmation_count.clamp(0, 3)
                ],
            )
            .map_err(|error| format!("unable to save Shift Light target: {error}"))?;
    }
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
        transaction
            .execute(
                "INSERT INTO shift_light_shift_samples
                   (config_id, source_gear, destination_gear, before_timestamp_ms,
                    after_timestamp_ms, before_rpm, after_rpm, before_power_w,
                    after_power_w, delta_percent, classification)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
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
                ],
            )
            .map_err(|error| format!("unable to save Shift Light sample: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light calibration: {error}"))
}

#[tauri::command]
fn load_shift_light_calibration(
    app: AppHandle,
    key: String,
    config_id: i64,
) -> Result<ShiftLightCalibration, String> {
    let connection = open_shift_light_db(&app)?;
    load_shift_light_calibration_from_connection(&connection, &key, config_id)
}

#[tauri::command]
fn save_shift_light_calibration(
    app: AppHandle,
    request: ShiftLightCalibrationRequest,
) -> Result<(), String> {
    let mut connection = open_shift_light_db(&app)?;
    save_shift_light_calibration_in_connection(&mut connection, &request)
}

#[tauri::command]
fn clear_shift_light_config(
    app: AppHandle,
    config_id: i64,
    gearbox_signature: Option<String>,
) -> Result<(), String> {
    let _ = gearbox_signature;
    let mut connection = open_shift_light_db(&app)?;
    let transaction = connection
        .transaction()
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
fn reset_shift_light(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main HUD window is not available".to_string());
    };
    window
        .eval("window.HudOverlay?.resetShiftLight?.()")
        .map_err(|error| error.to_string())
}

fn set_window_interaction<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
) -> tauri::Result<()> {
    if enabled {
        // Keep Settings above the full-screen overlay while the user drags a target.
        // The non-focusable window can still receive pointer events when click-through
        // is disabled, but it cannot steal focus from Settings.
        window.set_focusable(false)?;
        window.set_ignore_cursor_events(false)?;
    } else {
        window.set_ignore_cursor_events(true)?;
        window.set_focusable(false)?;
    }

    Ok(())
}

#[derive(Clone, Copy, Deserialize, Serialize)]
struct SettingsWindowState {
    width: u32,
    height: u32,
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
}

fn settings_window_state_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(SETTINGS_WINDOW_STATE_FILE))
}

fn is_valid_settings_window_state(state: SettingsWindowState) -> bool {
    (SETTINGS_MIN_WIDTH..=SETTINGS_MAX_WIDTH).contains(&state.width)
        && (SETTINGS_MIN_HEIGHT..=SETTINGS_MAX_HEIGHT).contains(&state.height)
}

fn is_position_on_monitor(
    position: PhysicalPosition<i32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> bool {
    let x = i64::from(position.x);
    let y = i64::from(position.y);
    let left = i64::from(monitor_position.x);
    let top = i64::from(monitor_position.y);
    let right = left + i64::from(monitor_size.width);
    let bottom = top + i64::from(monitor_size.height);

    x >= left && x < right && y >= top && y < bottom
}

fn restore_settings_window_state<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let path = settings_window_state_path(app)?;
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(());
    };
    let Ok(state) = serde_json::from_str::<SettingsWindowState>(&contents) else {
        return Ok(());
    };
    if !is_valid_settings_window_state(state) {
        return Ok(());
    }

    window.set_size(LogicalSize::new(state.width, state.height))?;

    let (Some(x), Some(y)) = (state.x, state.y) else {
        return Ok(());
    };
    let position = PhysicalPosition::new(x, y);
    let position_is_available = app
        .available_monitors()?
        .iter()
        .any(|monitor| is_position_on_monitor(position, *monitor.position(), *monitor.size()));
    if position_is_available {
        window.set_position(position)?;
    }
    Ok(())
}

fn settings_window_state<R: Runtime>(window: &Window<R>) -> tauri::Result<SettingsWindowState> {
    let size = window.inner_size()?;
    let position = window.outer_position()?;
    let scale_factor = window
        .scale_factor()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(1.0);

    Ok(SettingsWindowState {
        width: ((size.width as f64 / scale_factor).round()) as u32,
        height: ((size.height as f64 / scale_factor).round()) as u32,
        x: Some(position.x),
        y: Some(position.y),
    })
}

fn persist_settings_window_state<R: Runtime>(
    app: &AppHandle<R>,
    state: SettingsWindowState,
) -> tauri::Result<()> {
    if !is_valid_settings_window_state(state) {
        return Ok(());
    }

    let path = settings_window_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec(&state).map_err(std::io::Error::other)?;
    fs::write(path, contents)?;
    Ok(())
}

fn show_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("settings") else {
        return Ok(());
    };

    window.show()?;
    window.set_focus()?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.eval("window.HudOverlay?.syncRouteStatus?.()");
    }
    Ok(())
}

fn settings_window_context_label(context: &str) -> Option<&'static str> {
    match context {
        "hud" => Some("HUD"),
        "garage" => Some("GARAGE"),
        "events" => Some("EVENTS"),
        "shift-light" => Some("SHIFT LIGHT"),
        "settings" => Some("SETTINGS"),
        _ => None,
    }
}

fn settings_window_title(context: &str) -> String {
    format!("FDC · {context} · v{}", get_app_version())
}

fn eval_main<R: Runtime>(app: &AppHandle<R>, script: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main HUD window is not available".to_string());
    };

    window.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_edit_mode(app: AppHandle, enabled: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    set_window_interaction(&window, enabled)
}

#[tauri::command]
fn notify_layout_state(app: AppHandle, target: String, editing: bool) -> Result<(), String> {
    if !["coach", "delta", "hud"].contains(&target.as_str()) {
        return Err("unknown layout target".to_string());
    }

    let value = if editing { "true" } else { "false" };
    let script = format!(
        "window.SettingsController?.setLayoutEditingState?.('{}', {})",
        target, value
    );

    if let Some(settings) = app.get_webview_window("settings") {
        settings.eval(&script).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn layout_action(app: AppHandle, action: String, target: String) -> Result<(), String> {
    if !["coach", "delta", "hud"].contains(&target.as_str()) {
        return Err("unknown layout target".to_string());
    }

    let script = match action.as_str() {
        "edit" => match target.as_str() {
            "coach" => "window.HudLayout?.enterEditMode?.('coach')",
            "delta" => "window.HudLayout?.enterEditMode?.('delta')",
            "hud" => "window.HudLayout?.enterEditMode?.('hud')",
            _ => unreachable!(),
        },
        "save" => "window.HudLayout?.savePosition?.()",
        "cancel" => "window.HudLayout?.cancelEditMode?.()",
        "reset" => match target.as_str() {
            "coach" => "window.HudLayout?.resetPosition?.('coach')",
            "delta" => "window.HudLayout?.resetPosition?.('delta')",
            "hud" => "window.HudLayout?.resetPosition?.('hud')",
            _ => unreachable!(),
        },
        _ => return Err("unknown layout action".to_string()),
    };

    eval_main(&app, script)
}

#[tauri::command]
fn set_hud_visibility(app: AppHandle, component: String, visible: bool) -> Result<(), String> {
    let safe_component = match component.as_str() {
        "tires" | "pedals" | "steering" | "gear" | "engine" | "history" => component,
        _ => return Err("unknown HUD component".to_string()),
    };
    let value = if visible { "true" } else { "false" };
    let script = format!(
        "window.HudPreferences?.setVisibility?.('{}', {})",
        safe_component, value
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn set_overlay_visibility(app: AppHandle, component: String, visible: bool) -> Result<(), String> {
    let safe_component = match component.as_str() {
        "coach" | "delta" | "hud" => component,
        _ => return Err("unknown overlay component".to_string()),
    };
    let value = if visible { "true" } else { "false" };
    let script = format!(
        "window.HudPreferences?.setOverlayVisibility?.('{}', {})",
        safe_component, value
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn set_display_preferences(
    app: AppHandle,
    speed_unit: String,
    redline_brightness: u8,
    shift_light_brightness: u8,
    fdc_shift_light_enabled: bool,
    show_hud_with_telemetry: bool,
    hud_opacity: u8,
) -> Result<(), String> {
    let safe_speed_unit = match speed_unit.as_str() {
        "kmh" | "mph" => speed_unit,
        _ => return Err("unknown speed unit".to_string()),
    };
    if redline_brightness > 100 {
        return Err("Redline brightness must be between 0 and 100".to_string());
    }
    if shift_light_brightness > 100 {
        return Err("FDC Shift Light brightness must be between 0 and 100".to_string());
    }
    if !(1..=100).contains(&hud_opacity) {
        return Err("HUD opacity must be between 1 and 100".to_string());
    }

    let script = format!(
        "window.HudOverlay?.setDisplayPreferences?.({{ speedUnit: '{}', redlineBrightness: {}, shiftLightBrightness: {}, fdcShiftLightEnabled: {}, showHudWithTelemetry: {}, hudOpacity: {} }})",
        safe_speed_unit,
        redline_brightness,
        shift_light_brightness,
        fdc_shift_light_enabled,
        show_hud_with_telemetry,
        hud_opacity
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn set_configuration_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("settings") else {
        return Err("Configuration window is not available".to_string());
    };
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("unable to update Configuration window priority: {error}"))
}

#[tauri::command]
fn set_settings_window_context(app: AppHandle, context: String) -> Result<(), String> {
    let Some(context_label) = settings_window_context_label(&context) else {
        return Err("unknown Configuration window context".to_string());
    };
    let Some(window) = app.get_webview_window("settings") else {
        return Err("Configuration window is not available".to_string());
    };
    let title = settings_window_title(context_label);
    window
        .set_title(&title)
        .map_err(|error| format!("unable to update Configuration window title: {error}"))
}

#[tauri::command]
fn sync_route_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncRouteStatus?.()")
}

#[tauri::command]
fn sync_shift_light_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncShiftLightStatus?.()")
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn main() {
    tauri::Builder::default()
        .manage(DirectSourceState::default())
        .invoke_handler(tauri::generate_handler![
            set_window_edit_mode,
            notify_layout_state,
            layout_action,
            set_hud_visibility,
            set_overlay_visibility,
            set_display_preferences,
            set_configuration_always_on_top,
            set_settings_window_context,
            sync_route_status,
            sync_shift_light_status,
            get_app_version,
            start_direct_source,
            stop_direct_source,
            retry_direct_source,
            resolve_shift_light_config,
            load_shift_light_calibration,
            save_shift_light_calibration,
            clear_shift_light_config,
            reset_shift_light,
            create_event,
            load_events,
            load_event,
            rename_event,
            delete_event,
            record_event_run,
            load_event_runs,
            load_event_run,
            load_event_absolute_best,
            record_garage_vehicle,
            load_garage_snapshot,
            load_garage,
            rename_garage_car
        ])
        .on_window_event(|window, event| {
            if window.label() != "settings" {
                return;
            }

            if matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
                let app = window.app_handle();
                let result = settings_window_state(window)
                    .and_then(|state| persist_settings_window_state(&app, state));
                if let Err(error) = result {
                    eprintln!("unable to persist Configuration window state: {error}");
                }
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.eval("window.HudLayout?.cancelEditMode?.()");
                }
                if let Some(settings) = app.get_webview_window("settings") {
                    let _ = settings.eval("window.SettingsController?.cancelEdit?.()");
                    let _ = settings.hide();
                }
            }
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main overlay window must exist");
            let settings = app
                .get_webview_window("settings")
                .expect("settings window must exist");

            restore_settings_window_state(app.handle(), &settings)?;

            if let Some(monitor) = app.primary_monitor()? {
                let monitor_position = monitor.position();
                let monitor_size = monitor.size();

                window.set_size(*monitor_size)?;
                window.set_position(PhysicalPosition::new(
                    monitor_position.x,
                    monitor_position.y,
                ))?;
            }

            let menu = MenuBuilder::new(app)
                .text("settings", "Configuration")
                .separator()
                .text("quit", "Quit")
                .build()?;

            let mut tray = TrayIconBuilder::with_id("hud-tray")
                .menu(&menu)
                .tooltip("FDC")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                        return;
                    }

                    if event.id().as_ref() == "settings" {
                        let _ = show_settings(app);
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }

            tray.build(app)?;
            set_window_interaction(&window, false)?;
            window.show()?;

            show_settings(app.handle())?;

            let _ = settings;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FDC");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_f32(packet: &mut [u8], offset: usize, value: f32) {
        packet[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn put_i32(packet: &mut [u8], offset: usize, value: i32) {
        packet[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn accepts_default_configuration_window_state_and_rejects_unsafe_sizes() {
        let default = SettingsWindowState {
            width: SETTINGS_DEFAULT_WIDTH,
            height: SETTINGS_DEFAULT_HEIGHT,
            x: None,
            y: None,
        };
        assert!(is_valid_settings_window_state(default));
        assert!(!is_valid_settings_window_state(SettingsWindowState {
            width: SETTINGS_MIN_WIDTH - 1,
            height: SETTINGS_DEFAULT_HEIGHT,
            x: None,
            y: None,
        }));
        assert!(!is_valid_settings_window_state(SettingsWindowState {
            width: SETTINGS_DEFAULT_WIDTH,
            height: SETTINGS_MAX_HEIGHT + 1,
            x: None,
            y: None,
        }));
    }

    #[test]
    fn exposes_the_compiled_cargo_package_version() {
        assert_eq!(get_app_version(), env!("CARGO_PKG_VERSION"));
    }

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
    fn configuration_window_titles_use_known_sections_and_the_compiled_version() {
        assert_eq!(settings_window_context_label("hud"), Some("HUD"));
        assert_eq!(settings_window_context_label("garage"), Some("GARAGE"));
        assert_eq!(settings_window_context_label("events"), Some("EVENTS"));
        assert_eq!(
            settings_window_context_label("shift-light"),
            Some("SHIFT LIGHT")
        );
        assert_eq!(settings_window_context_label("settings"), Some("SETTINGS"));
        assert_eq!(settings_window_context_label("Forza Horizon 6"), None);
        assert_eq!(
            settings_window_title("GARAGE"),
            format!("FDC · GARAGE · v{}", get_app_version())
        );
    }

    #[test]
    fn serializes_configuration_window_state_for_persistence() {
        let state = SettingsWindowState {
            width: 1024,
            height: 768,
            x: Some(-1920),
            y: Some(48),
        };
        let restored =
            serde_json::from_str::<SettingsWindowState>(&serde_json::to_string(&state).unwrap())
                .unwrap();
        assert_eq!(restored.width, 1024);
        assert_eq!(restored.x, Some(-1920));
        assert_eq!(restored.y, Some(48));
    }

    #[test]
    fn accepts_legacy_configuration_window_size_without_position() {
        let state =
            serde_json::from_str::<SettingsWindowState>(r#"{"width":1024,"height":768}"#).unwrap();
        assert_eq!(state.x, None);
        assert_eq!(state.y, None);
    }

    #[test]
    fn restores_positions_only_when_their_top_left_is_on_a_monitor() {
        let monitor_position = PhysicalPosition::new(-1920, 0);
        let monitor_size = PhysicalSize::new(1920, 1080);
        assert!(is_position_on_monitor(
            PhysicalPosition::new(-1200, 400),
            monitor_position,
            monitor_size
        ));
        assert!(!is_position_on_monitor(
            PhysicalPosition::new(0, 400),
            monitor_position,
            monitor_size
        ));
    }

    #[test]
    fn rejects_non_horizon_packet_lengths() {
        assert!(decode_direct_packet(&[0; 323]).is_none());
        assert!(decode_direct_packet(&[0; 325]).is_none());
    }

    #[test]
    fn decodes_horizon_packet_units_and_controls() {
        let mut packet = [0_u8; 324];
        put_i32(&mut packet, 0, 1);
        put_f32(&mut packet, 8, 8_000.0);
        put_f32(&mut packet, 12, 900.0);
        put_f32(&mut packet, 16, 6_500.0);
        put_f32(&mut packet, 244 + 12, 50.0);
        put_f32(&mut packet, 244 + 24, 212.0);
        put_f32(&mut packet, 244 + 48, 100.5);
        put_f32(&mut packet, 244 + 52, 85.123);
        put_f32(&mut packet, 244 + 56, 86.5);
        put_f32(&mut packet, 244 + 60, 42.1);
        put_f32(&mut packet, 244 + 64, 200.0);
        packet[244 + 68..244 + 70].copy_from_slice(&3_u16.to_le_bytes());
        packet[244 + 71] = 128;
        packet[244 + 72] = 64;
        packet[244 + 76] = 127;
        packet[244 + 75] = 4;
        put_i32(&mut packet, 212, 1234);
        put_i32(&mut packet, 220, 850);
        packet[232..236].copy_from_slice(&0x8000_0001_u32.to_le_bytes());

        let telemetry = decode_direct_packet(&packet).expect("packet should decode");
        assert!(telemetry.is_race_on);
        assert_eq!(telemetry.rpm, 6_500.0);
        assert_eq!(telemetry.rpm_max, 8_000.0);
        assert_eq!(telemetry.speed_kmh, 180.0);
        assert!((telemetry.tire_temp_c.fl - 100.0).abs() < f32::EPSILON);
        assert!((telemetry.throttle - 128.0 / 255.0).abs() < f32::EPSILON);
        assert!((telemetry.brake - 64.0 / 255.0).abs() < f32::EPSILON);
        assert_eq!(telemetry.steer, 1.0);
        assert_eq!(telemetry.gear, 4);
        assert_eq!(telemetry.car.ordinal, 1234);
        assert_eq!(telemetry.car.pi, 850);
        assert_eq!(telemetry.car.car_group, 0x8000_0001);
        assert!((telemetry.lap.distance - 100.5).abs() < f32::EPSILON);
        assert!((telemetry.lap.best - 85.123).abs() < 0.001);
        assert!((telemetry.lap.last - 86.5).abs() < f32::EPSILON);
        assert!((telemetry.lap.current - 42.1).abs() < 0.001);
        assert!((telemetry.lap.race_time - 200.0).abs() < f32::EPSILON);
        assert_eq!(telemetry.lap.number, 3);
    }

    #[test]
    fn creates_v15_shift_light_schema_and_round_trips_compact_calibration() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let key = "fh6:3766:1:800:1:10:10300";
        let config = resolve_shift_light_config_in_connection(&mut connection, key, 4).unwrap();
        let request = ShiftLightCalibrationRequest {
            key: key.to_string(),
            config_id: config.variant_id,
            reported_redline_rpm: Some(10300),
            usable_ceiling: Some(10250),
            ceiling_samples: vec![10240, 10250, 10260],
            gear_targets: vec![ShiftLightGearTarget {
                source_gear: 2,
                destination_gear: 3,
                status: "optimal".to_string(),
                candidate_rpm: Some(9000),
                optimal_rpm: Some(9050),
                confirmation_count: 3,
            }],
            shift_samples: vec![
                ShiftLightShiftSample {
                    source_gear: 2,
                    destination_gear: 3,
                    before_timestamp_ms: 1000,
                    after_timestamp_ms: 1120,
                    before_rpm: 9050.0,
                    after_rpm: 6500.0,
                    before_power: 600.0,
                    after_power: 630.0,
                    delta_percent: 5.0,
                    classification: "crossover".to_string(),
                },
                ShiftLightShiftSample {
                    source_gear: 2,
                    destination_gear: 3,
                    before_timestamp_ms: 1200,
                    after_timestamp_ms: 1300,
                    before_rpm: 9000.0,
                    after_rpm: 6500.0,
                    before_power: 600.0,
                    after_power: 500.0,
                    delta_percent: -16.6667,
                    classification: "not_better".to_string(),
                },
                ShiftLightShiftSample {
                    source_gear: 2,
                    destination_gear: 4,
                    before_timestamp_ms: 1400,
                    after_timestamp_ms: 1300,
                    before_rpm: 9000.0,
                    after_rpm: 6500.0,
                    before_power: 0.0,
                    after_power: 500.0,
                    delta_percent: -10.0,
                    classification: "not_better".to_string(),
                },
            ],
        };
        save_shift_light_calibration_in_connection(&mut connection, &request).unwrap();
        let loaded =
            load_shift_light_calibration_from_connection(&connection, key, config.variant_id)
                .unwrap();
        assert_eq!(loaded.model_version, 4);
        assert_eq!(loaded.reported_redline_rpm, Some(10300));
        assert_eq!(loaded.usable_ceiling, Some(10250));
        assert_eq!(loaded.ceiling_samples, vec![10240, 10250, 10260]);
        assert_eq!(loaded.gear_targets.len(), 1);
        assert_eq!(loaded.gear_targets[0].optimal_rpm, Some(9050));
        assert_eq!(loaded.shift_samples.len(), 2);
        assert_eq!(loaded.shift_samples[0].classification, "crossover");
        assert_eq!(loaded.shift_samples[1].classification, "not_better");
        let mut cleared = request.clone();
        cleared.usable_ceiling = None;
        cleared.ceiling_samples.clear();
        cleared.gear_targets.clear();
        cleared.shift_samples.clear();
        save_shift_light_calibration_in_connection(&mut connection, &cleared).unwrap();
        let after_clear =
            load_shift_light_calibration_from_connection(&connection, key, config.variant_id)
                .unwrap();
        assert_eq!(after_clear.usable_ceiling, None);
        assert!(after_clear.ceiling_samples.is_empty());
        for table in [
            "shift_light_configs",
            "shift_light_ceiling_samples",
            "shift_light_gear_targets",
            "shift_light_shift_samples",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }
        for table in [
            "shift_light_learning_state",
            "shift_light_power_bins",
            "shift_light_shift_evidence",
        ] {
            assert!(
                !table_exists(&connection, table).unwrap(),
                "legacy table {table}"
            );
        }
    }

    #[test]
    fn v15_migration_preserves_vehicle_identity_and_drops_legacy_facts() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        connection
            .execute_batch(
                "DROP TABLE shift_light_shift_samples;
                 DROP TABLE shift_light_ceiling_samples;
                 DROP TABLE shift_light_gear_targets;
                 DROP TABLE shift_light_configs;
                 CREATE TABLE shift_light_configs (
                   id INTEGER PRIMARY KEY, game_id TEXT NOT NULL,
                   car_ordinal INTEGER NOT NULL, car_class INTEGER NOT NULL,
                   car_performance_index INTEGER NOT NULL, drivetrain_type INTEGER NOT NULL,
                   num_cylinders INTEGER NOT NULL, rpm_max INTEGER NOT NULL,
                   gear_count INTEGER NOT NULL, gearbox_signature TEXT NOT NULL DEFAULT '',
                   first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE shift_light_learning_state (config_id INTEGER PRIMARY KEY, state_json TEXT);
                 INSERT INTO shift_light_configs
                   (id, game_id, car_ordinal, car_class, car_performance_index,
                    drivetrain_type, num_cylinders, rpm_max, gear_count)
                 VALUES (42, 'fh6', 3766, 1, 800, 1, 10, 10300, 4);
                 UPDATE hud_schema_version SET version = 14;",
            )
            .unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT version FROM hud_schema_version", [], |row| row
                    .get::<_, i32>(0))
                .unwrap(),
            15
        );
        let row: (i64, Option<i32>) = connection
            .query_row(
                "SELECT id, reported_redline_rpm FROM shift_light_configs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (42, Some(10300)));
        assert!(!table_exists(&connection, "shift_light_learning_state").unwrap());
        assert!(!table_has_column(&connection, "shift_light_configs", "rpm_max").unwrap());
    }

    fn test_event(
        name: &str,
        class: &str,
        route: &str,
        mode: &str,
        notes: Option<&str>,
    ) -> NewEvent {
        NewEvent {
            name: name.to_string(),
            class: class.to_string(),
            route: route.to_string(),
            mode: mode.to_string(),
            notes: notes.map(str::to_string),
        }
    }

    fn test_event_run(
        event_id: i64,
        run_type: &str,
        result: &str,
        result_time_ms: Option<i64>,
        laps: Vec<EventRunLapInput>,
    ) -> NewEventRun {
        NewEventRun {
            event_id,
            car_ordinal: 260,
            car_name: Some("  Test Car  ".to_string()),
            car_class: 8,
            car_pi: 700,
            drivetrain: 2,
            started_at: "2026-08-30T12:00:00Z".to_string(),
            run_type: run_type.to_string(),
            result: result.to_string(),
            result_time_ms,
            laps,
        }
    }

    #[test]
    fn events_migrate_from_v6_without_touching_existing_tables() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (6);",
            )
            .unwrap();
        {
            let transaction = connection.transaction().unwrap();
            create_garage_tables(&transaction).unwrap();
            transaction.commit().unwrap();
        }
        connection
            .execute(
                "INSERT INTO garage_cars
                   (game_id, car_ordinal, first_seen_sequence, last_seen_sequence)
                 VALUES ('fh6', 260, 1, 1)",
                [],
            )
            .unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);
        assert!(table_exists(&connection, "events").unwrap());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM garage_cars", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(!table_exists(&connection, "shift_light_cars").unwrap());
    }

    #[test]
    fn event_runs_migrate_from_v7_without_touching_existing_events() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (7);",
            )
            .unwrap();
        {
            let transaction = connection.transaction().unwrap();
            create_event_tables(&transaction).unwrap();
            transaction.commit().unwrap();
        }
        let event = create_event_in_connection(
            &mut connection,
            test_event("Existing event", "A", "Asphalt", "Official", None),
        )
        .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);
        assert_eq!(
            load_event_from_connection(&connection, event.id)
                .unwrap()
                .name,
            "Existing event"
        );
        assert!(table_exists(&connection, "event_runs").unwrap());
        assert!(table_exists(&connection, "event_run_laps").unwrap());
    }

    #[test]
    fn event_sectors_migrate_from_v8_and_remove_archived_event_data() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (8);
                 CREATE TABLE events (
                   id INTEGER PRIMARY KEY,
                   name TEXT NOT NULL,
                   class TEXT NOT NULL,
                   route TEXT NOT NULL,
                   mode TEXT NOT NULL,
                   notes TEXT,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   archived_at TEXT
                 );
                 INSERT INTO events
                   (id, name, class, route, mode, created_at, updated_at, archived_at)
                 VALUES (1, 'Existing event', 'A', 'Asphalt', 'Official', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
                 CREATE TABLE event_runs (
                   id INTEGER PRIMARY KEY,
                   event_id INTEGER NOT NULL,
                   car_ordinal INTEGER NOT NULL,
                   car_name TEXT,
                   car_class INTEGER NOT NULL,
                   car_pi INTEGER NOT NULL,
                   drivetrain INTEGER NOT NULL,
                   started_at TEXT NOT NULL,
                   run_type TEXT NOT NULL,
                   result TEXT NOT NULL,
                   result_time_ms INTEGER,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
                 );
                 CREATE TABLE event_run_laps (
                   run_id INTEGER NOT NULL,
                   lap_number INTEGER NOT NULL,
                   lap_time_ms INTEGER NOT NULL,
                   PRIMARY KEY (run_id, lap_number),
                   FOREIGN KEY (run_id) REFERENCES event_runs(id) ON DELETE CASCADE
                 );",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        assert!(!table_has_column(&connection, "events", "archived_at").unwrap());
        for column in ["sector_1_time_ms", "sector_2_time_ms", "sector_3_time_ms"] {
            assert!(table_has_column(&connection, "event_run_laps", column).unwrap());
        }
        assert_eq!(
            load_event_from_connection(&connection, 1).unwrap().name,
            "Existing event"
        );
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
        garage_named_run.car_name = None;
        assert_eq!(
            record_event_run_in_connection(&mut connection, garage_named_run)
                .unwrap()
                .car_name
                .as_deref(),
            Some("Garage name")
        );

        delete_event_in_connection(&connection, event.id).unwrap();
        assert!(
            load_event_runs_from_connection(&connection, None)
                .unwrap()
                .is_empty()
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
                    trace_points: vec![EventRunTracePointInput {
                        sample_index: 0,
                        elapsed_ms: 250,
                        distance: 12.5,
                        position_x: 1.0,
                        position_y: 2.0,
                        position_z: 3.0,
                        throttle: 0.75,
                        brake: 0.0,
                    }],
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

        let trace = |distance: f64| EventRunTracePointInput {
            sample_index: 0,
            elapsed_ms: 500,
            distance,
            position_x: 1.0,
            position_y: 2.0,
            position_z: 3.0,
            throttle: 0.75,
            brake: 0.0,
        };
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
    fn event_runs_resolve_current_garage_name_after_run_save() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Garage rename", "Any", "Asphalt", "Any", None),
        )
        .unwrap();

        let mut run = test_event_run(event.id, "sprint", "confirmed", Some(75_000), Vec::new());
        run.car_name = None;
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
    }

    #[test]
    fn events_validate_and_round_trip_without_archiving() {
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
        assert!(delete_event_in_connection(&connection, created.id).is_err());
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
    fn garage_records_one_car_and_distinct_class_pi_variants() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let first = GarageVehicle {
            ordinal: 260,
            class: 8,
            pi: 600,
            car_group: 42,
            drivetrain: 1,
            cylinders: 4,
        };
        record_garage_vehicle_in_connection(&mut connection, &first).unwrap();
        let second = GarageVehicle {
            ordinal: 260,
            class: 9,
            pi: 700,
            car_group: 43,
            drivetrain: 2,
            cylinders: 6,
        };
        let snapshot = record_garage_vehicle_in_connection(&mut connection, &second).unwrap();

        assert_eq!(snapshot.current_car_ordinal, Some(260));
        assert_eq!(snapshot.cars.len(), 1);
        let car = &snapshot.cars[0];
        assert!(car.latest_used);
        assert_eq!(car.car_group, 43);
        assert_eq!(car.drivetrain, 2);
        assert_eq!(car.cylinders, 6);
        assert_eq!(car.first_seen_sequence, 1);
        assert_eq!(car.last_seen_sequence, 2);
        assert_eq!(car.variants.len(), 2);
        assert_eq!((car.variants[0].class, car.variants[0].pi), (9, 700));
        assert_eq!(car.variants[0].cylinders, 6);
        assert!(car.variants[0].is_current);
        assert!(!car.variants[1].is_current);
    }

    #[test]
    fn garage_distinguishes_same_class_pi_by_drivetrain() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let first = GarageVehicle {
            ordinal: 260,
            class: 8,
            pi: 600,
            car_group: 42,
            drivetrain: 1,
            cylinders: 4,
        };
        record_garage_vehicle_in_connection(&mut connection, &first).unwrap();
        let second = GarageVehicle {
            ordinal: 260,
            class: 8,
            pi: 600,
            car_group: 43,
            drivetrain: 2,
            cylinders: 6,
        };
        let snapshot = record_garage_vehicle_in_connection(&mut connection, &second).unwrap();

        let car = &snapshot.cars[0];
        assert_eq!(car.drivetrain, 2);
        assert_eq!(car.cylinders, 6);
        assert_eq!(car.variants.len(), 2);
        assert_eq!(
            (
                car.variants[0].class,
                car.variants[0].pi,
                car.variants[0].drivetrain
            ),
            (8, 600, 2)
        );
        assert_eq!(car.variants[0].drivetrain_type, 2);
        assert_eq!(car.variants[0].cylinders, 6);
        assert!(car.variants[0].is_current);
        assert_eq!(
            (
                car.variants[1].class,
                car.variants[1].pi,
                car.variants[1].drivetrain
            ),
            (8, 600, 1)
        );
        assert_eq!(car.variants[1].drivetrain_type, 1);
        assert_eq!(car.variants[1].cylinders, 4);
        assert!(!car.variants[1].is_current);
    }

    #[test]
    fn garage_repeat_observation_updates_variant_cylinders_without_changing_identity() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let first = GarageVehicle {
            ordinal: 260,
            class: 8,
            pi: 600,
            car_group: 42,
            drivetrain: 1,
            cylinders: 4,
        };
        let first_snapshot = record_garage_vehicle_in_connection(&mut connection, &first).unwrap();
        let first_variant_id = first_snapshot.cars[0].variants[0].id;

        let second = GarageVehicle {
            ordinal: 260,
            class: 8,
            pi: 600,
            car_group: 43,
            drivetrain: 1,
            cylinders: 6,
        };
        let snapshot = record_garage_vehicle_in_connection(&mut connection, &second).unwrap();

        assert_eq!(snapshot.cars[0].variants.len(), 1);
        assert_eq!(snapshot.cars[0].variants[0].id, first_variant_id);
        assert_eq!(snapshot.cars[0].variants[0].cylinders, 6);
        assert_eq!(snapshot.cars[0].cylinders, 6);
        assert_eq!(
            connection
                .query_row(
                    "SELECT num_cylinders FROM garage_variants
                     WHERE game_id = 'fh6' AND car_ordinal = 260
                       AND car_class = 8 AND pi = 600 AND drivetrain_type = 1",
                    [],
                    |row| row.get::<_, i32>(0),
                )
                .unwrap(),
            6
        );
    }

    #[test]
    fn garage_renaming_is_persistent_and_empty_name_clears_it() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let vehicle = GarageVehicle {
            ordinal: 260,
            class: 8,
            pi: 600,
            car_group: 42,
            drivetrain: 1,
            cylinders: 4,
        };
        record_garage_vehicle_in_connection(&mut connection, &vehicle).unwrap();
        connection
            .execute(
                "UPDATE garage_cars SET display_name = 'Road car'
                 WHERE game_id = 'fh6' AND car_ordinal = 260",
                [],
            )
            .unwrap();
        let named = load_garage_snapshot_from_connection(&connection).unwrap();
        assert_eq!(named.cars[0].name.as_deref(), Some("Road car"));

        connection
            .execute(
                "UPDATE garage_cars SET display_name = NULL
                 WHERE game_id = 'fh6' AND car_ordinal = 260",
                [],
            )
            .unwrap();
        let cleared = load_garage_snapshot_from_connection(&connection).unwrap();
        assert_eq!(cleared.cars[0].name, None);
    }

    #[test]
    fn garage_schema_migrates_atomically_from_shift_light_v3() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (3);
                 CREATE TABLE shift_light_cars (
                   game_id TEXT NOT NULL, car_ordinal INTEGER NOT NULL,
                   first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
                   PRIMARY KEY (game_id, car_ordinal)
                 );",
            )
            .unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);
        assert_eq!(
            connection
                .query_row("SELECT next_sequence FROM garage_sequence", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
    }

    #[test]
    fn garage_variant_schema_migrates_legacy_rows_to_parent_drivetrain() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (4);
                 CREATE TABLE garage_cars (
                   game_id TEXT NOT NULL,
                   car_ordinal INTEGER NOT NULL,
                   car_group INTEGER NOT NULL DEFAULT 0,
                   drivetrain_type INTEGER NOT NULL DEFAULT 0,
                   num_cylinders INTEGER NOT NULL DEFAULT 0,
                   display_name TEXT,
                   first_seen_sequence INTEGER NOT NULL,
                   last_seen_sequence INTEGER NOT NULL,
                   PRIMARY KEY (game_id, car_ordinal)
                 );
                 INSERT INTO garage_cars
                   (game_id, car_ordinal, car_group, drivetrain_type, num_cylinders,
                    first_seen_sequence, last_seen_sequence)
                 VALUES ('fh6', 260, 42, 2, 6, 1, 3);
                 CREATE TABLE garage_variants (
                   id INTEGER PRIMARY KEY,
                   game_id TEXT NOT NULL,
                   car_ordinal INTEGER NOT NULL,
                   car_class INTEGER NOT NULL,
                   pi INTEGER NOT NULL,
                   first_seen_sequence INTEGER NOT NULL,
                   last_seen_sequence INTEGER NOT NULL,
                   UNIQUE (game_id, car_ordinal, car_class, pi),
                   FOREIGN KEY (game_id, car_ordinal)
                     REFERENCES garage_cars(game_id, car_ordinal)
                     ON DELETE CASCADE
                 );
                 INSERT INTO garage_variants
                   (id, game_id, car_ordinal, car_class, pi,
                    first_seen_sequence, last_seen_sequence)
                 VALUES (77, 'fh6', 260, 8, 600, 1, 2);",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);
        let (drivetrain, cylinders, first_seen_sequence, last_seen_sequence): (i32, i32, i64, i64) =
            connection
                .query_row(
                    "SELECT drivetrain_type, num_cylinders, first_seen_sequence, last_seen_sequence
                 FROM garage_variants WHERE id = 77",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
        assert_eq!(drivetrain, 2);
        assert_eq!(cylinders, 6);
        assert_eq!((first_seen_sequence, last_seen_sequence), (1, 2));

        let migrated = load_garage_snapshot_from_connection(&connection).unwrap();
        assert_eq!(migrated.cars[0].variants.len(), 1);
        assert_eq!(migrated.cars[0].variants[0].drivetrain, 2);
        assert_eq!(migrated.cars[0].drivetrain, 2);
        assert_eq!(migrated.cars[0].cylinders, 6);
    }

    #[test]
    fn garage_variant_cylinder_schema_migrates_v5_rows_to_parent_cylinders() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (5);
                 CREATE TABLE garage_cars (
                   game_id TEXT NOT NULL,
                   car_ordinal INTEGER NOT NULL,
                   car_group INTEGER NOT NULL DEFAULT 0,
                   drivetrain_type INTEGER NOT NULL DEFAULT 0,
                   num_cylinders INTEGER NOT NULL DEFAULT 0,
                   display_name TEXT,
                   first_seen_sequence INTEGER NOT NULL,
                   last_seen_sequence INTEGER NOT NULL,
                   PRIMARY KEY (game_id, car_ordinal)
                 );
                 INSERT INTO garage_cars
                   (game_id, car_ordinal, car_group, drivetrain_type, num_cylinders,
                    first_seen_sequence, last_seen_sequence)
                 VALUES ('fh6', 260, 42, 2, 6, 1, 3);
                 CREATE TABLE garage_variants (
                   id INTEGER PRIMARY KEY,
                   game_id TEXT NOT NULL,
                   car_ordinal INTEGER NOT NULL,
                   car_class INTEGER NOT NULL,
                   pi INTEGER NOT NULL,
                   drivetrain_type INTEGER NOT NULL DEFAULT 0,
                   first_seen_sequence INTEGER NOT NULL,
                   last_seen_sequence INTEGER NOT NULL,
                   UNIQUE (game_id, car_ordinal, car_class, pi, drivetrain_type),
                   FOREIGN KEY (game_id, car_ordinal)
                     REFERENCES garage_cars(game_id, car_ordinal)
                     ON DELETE CASCADE
                 );
                 INSERT INTO garage_variants
                   (id, game_id, car_ordinal, car_class, pi, drivetrain_type,
                    first_seen_sequence, last_seen_sequence)
                 VALUES (77, 'fh6', 260, 8, 600, 2, 1, 2);",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);
        let (id, drivetrain, cylinders, first_seen_sequence, last_seen_sequence): (
            i64,
            i32,
            i32,
            i64,
            i64,
        ) = connection
            .query_row(
                "SELECT id, drivetrain_type, num_cylinders,
                        first_seen_sequence, last_seen_sequence
                 FROM garage_variants WHERE id = 77",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(id, 77);
        assert_eq!(drivetrain, 2);
        assert_eq!(cylinders, 6);
        assert_eq!((first_seen_sequence, last_seen_sequence), (1, 2));

        let migrated = load_garage_snapshot_from_connection(&connection).unwrap();
        assert_eq!(migrated.cars[0].variants[0].cylinders, 6);
    }
}
