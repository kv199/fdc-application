#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
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

use rusqlite::{Connection, Error as SqliteError, params};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State, WebviewWindow, WindowEvent,
    menu::MenuBuilder, tray::TrayIconBuilder,
};

const SETTINGS_MARKER: &str = "settings-first-launch-complete";
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectCar {
    ordinal: i32,
    class: i32,
    pi: i32,
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
            emit_direct_status(&thread_app, "is-waiting", None);

            while !thread_stop.load(Ordering::Relaxed) {
                match socket.recv(&mut buffer) {
                    Ok(length) => {
                        let Some(telemetry) = decode_direct_packet(&buffer[..length]) else {
                            continue;
                        };
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
fn set_telemetry_source(app: AppHandle, source: String) -> Result<(), String> {
    if !["direct", "suite"].contains(&source.as_str()) {
        return Err("unknown telemetry source".to_string());
    }

    let script = format!(
        "window.HudOverlay?.setTelemetrySource?.('{}', {{ force: true }})",
        source
    );
    if let Some(window) = app.get_webview_window("main") {
        window.eval(&script).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightProfile {
    key: String,
    gear: i32,
    shift_rpm: Option<i32>,
    sample_count: i32,
    #[serde(default = "default_shift_light_status")]
    status: String,
    #[serde(default)]
    samples: Vec<i32>,
    method: String,
    ratio_drop: Option<f64>,
    #[serde(default)]
    gearbox_signature: Option<String>,
}

fn default_shift_light_status() -> String {
    "learning".to_string()
}

fn parse_shift_light_key(key: &str) -> Result<(i32, i32, i32), String> {
    let mut parts = key.split(':');
    if parts.next() != Some("fh6") {
        return Err("invalid Shift Light profile key".to_string());
    }
    let parse = |value: Option<&str>| {
        value
            .ok_or_else(|| "invalid Shift Light profile key".to_string())?
            .parse::<i32>()
            .map_err(|_| "invalid Shift Light profile key".to_string())
    };
    let car_ordinal = parse(parts.next())?;
    let pi = parse(parts.next())?;
    let rpm_max = parse(parts.next())?;
    if parts.next().is_some() || car_ordinal <= 0 || pi <= 0 || rpm_max <= 0 {
        return Err("invalid Shift Light profile key".to_string());
    }
    Ok((car_ordinal, pi, rpm_max))
}

fn find_shift_light_variant_id(
    connection: &Connection,
    car_ordinal: i32,
    pi: i32,
    rpm_max: i32,
    gearbox_signature: &str,
) -> Result<Option<i64>, String> {
    match connection.query_row(
        "SELECT id FROM shift_light_variants
         WHERE game_id = 'fh6' AND car_ordinal = ?1 AND pi = ?2 AND rpm_max = ?3
           AND gearbox_signature = ?4",
        params![car_ordinal, pi, rpm_max, gearbox_signature],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(variant_id) => Ok(Some(variant_id)),
        Err(SqliteError::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("unable to resolve HUD car variant: {error}")),
    }
}

fn delete_shift_light_profiles(
    connection: &Connection,
    car_ordinal: i32,
    pi: i32,
    rpm_max: i32,
    gearbox_signature: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM shift_light_profiles
             WHERE variant_id IN (
               SELECT id FROM shift_light_variants
               WHERE game_id = 'fh6' AND car_ordinal = ?1 AND pi = ?2 AND rpm_max = ?3
                 AND (gearbox_signature = '' OR gearbox_signature = ?4)
             )",
            params![car_ordinal, pi, rpm_max, gearbox_signature],
        )
        .map_err(|error| format!("unable to reset Shift Light profiles: {error}"))?;
    Ok(())
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

fn create_shift_light_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS shift_light_cars (
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (game_id, car_ordinal)
             );
             CREATE TABLE IF NOT EXISTS shift_light_variants (
               id INTEGER PRIMARY KEY,
               game_id TEXT NOT NULL,
               car_ordinal INTEGER NOT NULL,
               pi INTEGER NOT NULL,
               rpm_max INTEGER NOT NULL,
               gearbox_signature TEXT NOT NULL DEFAULT '',
               first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               UNIQUE (game_id, car_ordinal, pi, rpm_max, gearbox_signature),
               FOREIGN KEY (game_id, car_ordinal)
                 REFERENCES shift_light_cars(game_id, car_ordinal)
                 ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_profiles (
               variant_id INTEGER NOT NULL,
               gear INTEGER NOT NULL,
               status TEXT NOT NULL DEFAULT 'learning',
               shift_rpm INTEGER,
               sample_count INTEGER NOT NULL DEFAULT 0,
               method TEXT NOT NULL DEFAULT 'observed',
               ratio_drop REAL,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (variant_id, gear),
               FOREIGN KEY (variant_id)
                 REFERENCES shift_light_variants(id)
                 ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_profile_samples (
               variant_id INTEGER NOT NULL,
               gear INTEGER NOT NULL,
               sample_index INTEGER NOT NULL,
               rpm INTEGER NOT NULL,
               PRIMARY KEY (variant_id, gear, sample_index),
               FOREIGN KEY (variant_id, gear)
                 REFERENCES shift_light_profiles(variant_id, gear)
                 ON DELETE CASCADE
             );",
        )
        .map_err(|error| format!("unable to create HUD Shift Light schema: {error}"))
}

fn migrate_shift_light_schema(connection: &Connection) -> Result<(), String> {
    let legacy_exists = table_exists(connection, "shift_light_profiles_legacy")?;
    let current_exists = table_exists(connection, "shift_light_profiles")?;
    if current_exists && !table_has_column(connection, "shift_light_profiles", "variant_id")? {
        connection
            .execute_batch(
                "ALTER TABLE shift_light_profiles RENAME TO shift_light_profiles_legacy;",
            )
            .map_err(|error| {
                format!("unable to preserve legacy HUD Shift Light profiles: {error}")
            })?;
    }

    create_shift_light_tables(connection)?;

    if legacy_exists || table_exists(connection, "shift_light_profiles_legacy")? {
        connection
            .execute_batch(
                "INSERT OR IGNORE INTO shift_light_cars
                   (game_id, car_ordinal, first_seen_at, last_seen_at)
                 SELECT 'fh6', car_ordinal, MIN(updated_at), MAX(updated_at)
                 FROM shift_light_profiles_legacy
                 GROUP BY car_ordinal;
                 INSERT OR IGNORE INTO shift_light_variants
                   (game_id, car_ordinal, pi, rpm_max, gearbox_signature, first_seen_at, last_seen_at)
                 SELECT 'fh6', car_ordinal, pi, rpm_max, '', MIN(updated_at), MAX(updated_at)
                 FROM shift_light_profiles_legacy
                 GROUP BY car_ordinal, pi, rpm_max;
                 INSERT OR IGNORE INTO shift_light_profiles
                   (variant_id, gear, status, shift_rpm, sample_count, method, ratio_drop, updated_at)
                 SELECT v.id, legacy.gear, 'calibrated', legacy.shift_rpm,
                        legacy.sample_count, legacy.method, legacy.ratio_drop, legacy.updated_at
                 FROM shift_light_profiles_legacy AS legacy
                 JOIN shift_light_variants AS v
                   ON v.game_id = 'fh6'
                  AND v.car_ordinal = legacy.car_ordinal
                  AND v.pi = legacy.pi
                  AND v.rpm_max = legacy.rpm_max
                  AND v.gearbox_signature = '';",
            )
            .map_err(|error| format!("unable to migrate legacy HUD Shift Light profiles: {error}"))?;
    }
    Ok(())
}

fn initialize_shift_light_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS hud_schema_version (
               version INTEGER NOT NULL
             );
             INSERT INTO hud_schema_version (version)
             SELECT 1
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
    if version < 2 {
        migrate_shift_light_schema(connection)?;
        connection
            .execute("UPDATE hud_schema_version SET version = 2", [])
            .map_err(|error| format!("unable to update HUD SQLite schema version: {error}"))?;
    } else {
        create_shift_light_tables(connection)?;
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
    let path = directory.join("hud.sqlite");
    let connection = Connection::open(path)
        .map_err(|error| format!("unable to open HUD SQLite database: {error}"))?;
    initialize_shift_light_schema(&connection)?;
    Ok(connection)
}

#[tauri::command]
fn load_shift_light_profiles(
    app: AppHandle,
    key: String,
    gearbox_signature: Option<String>,
) -> Result<Vec<ShiftLightProfile>, String> {
    let (car_ordinal, pi, rpm_max) = parse_shift_light_key(&key)?;
    let connection = open_shift_light_db(&app)?;
    let gearbox_signature = gearbox_signature.unwrap_or_default();
    let variant_id =
        find_shift_light_variant_id(&connection, car_ordinal, pi, rpm_max, &gearbox_signature)?;
    let Some(variant_id) = variant_id else {
        return Ok(Vec::new());
    };
    let mut statement = connection
        .prepare(
            "SELECT p.gear, p.status, p.shift_rpm, p.sample_count, p.method, p.ratio_drop,
                    v.gearbox_signature
             FROM shift_light_profiles AS p
             JOIN shift_light_variants AS v ON v.id = p.variant_id
             WHERE p.variant_id = ?1
             ORDER BY p.gear",
        )
        .map_err(|error| format!("unable to prepare Shift Light profile query: {error}"))?;
    let rows = statement
        .query_map(params![variant_id], |row| {
            Ok(ShiftLightProfile {
                key: key.clone(),
                gear: row.get(0)?,
                status: row.get(1)?,
                shift_rpm: row.get(2)?,
                sample_count: row.get(3)?,
                method: row.get(4)?,
                ratio_drop: row.get(5)?,
                gearbox_signature: {
                    let signature: String = row.get(6)?;
                    (!signature.is_empty()).then_some(signature)
                },
                samples: Vec::new(),
            })
        })
        .map_err(|error| format!("unable to read Shift Light profiles: {error}"))?;
    let mut profiles = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Shift Light profiles: {error}"))?;
    let mut sample_statement = connection
        .prepare(
            "SELECT gear, rpm FROM shift_light_profile_samples
             WHERE variant_id = ?1 ORDER BY gear, sample_index",
        )
        .map_err(|error| format!("unable to prepare Shift Light evidence query: {error}"))?;
    let samples = sample_statement
        .query_map(params![variant_id], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, i32>(1)?))
        })
        .map_err(|error| format!("unable to read Shift Light evidence: {error}"))?;
    for sample in samples {
        let (gear, rpm) =
            sample.map_err(|error| format!("unable to decode Shift Light evidence: {error}"))?;
        if let Some(profile) = profiles.iter_mut().find(|profile| profile.gear == gear) {
            profile.samples.push(rpm);
        }
    }
    Ok(profiles)
}

#[tauri::command]
fn save_shift_light_profile(app: AppHandle, profile: ShiftLightProfile) -> Result<(), String> {
    let (car_ordinal, pi, rpm_max) = parse_shift_light_key(&profile.key)?;
    let gearbox_signature = profile.gearbox_signature.as_deref().unwrap_or("");
    let persisted_status =
        if profile.status == "learning" && profile.sample_count >= 5 && profile.shift_rpm.is_some()
        {
            "calibrated"
        } else {
            profile.status.as_str()
        };
    if !(1..=10).contains(&profile.gear)
        || profile.shift_rpm.is_some_and(|shift_rpm| shift_rpm < 0)
        || profile.sample_count < 0
        || profile.samples.len() > 5
        || profile.samples.iter().any(|sample| *sample < 0)
        || !["learning", "calibrated"].contains(&persisted_status)
        || persisted_status == "calibrated" && profile.shift_rpm.is_none()
        || persisted_status == "learning" && profile.sample_count > 5
        || !["observed", "optimal"].contains(&profile.method.as_str())
        || gearbox_signature.len() > 256
    {
        return Err("invalid Shift Light profile".to_string());
    }

    let mut connection = open_shift_light_db(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light transaction: {error}"))?;
    transaction
        .execute(
            "INSERT INTO shift_light_cars (game_id, car_ordinal)
             VALUES ('fh6', ?1)
             ON CONFLICT (game_id, car_ordinal) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
            params![car_ordinal],
        )
        .map_err(|error| format!("unable to register HUD car: {error}"))?;
    transaction
        .execute(
            "INSERT INTO shift_light_variants
               (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
             VALUES ('fh6', ?1, ?2, ?3, ?4)
             ON CONFLICT (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
             DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
            params![car_ordinal, pi, rpm_max, gearbox_signature],
        )
        .map_err(|error| format!("unable to register HUD car variant: {error}"))?;
    let variant_id: i64 = transaction
        .query_row(
            "SELECT id FROM shift_light_variants
             WHERE game_id = 'fh6' AND car_ordinal = ?1 AND pi = ?2 AND rpm_max = ?3
               AND gearbox_signature = ?4",
            params![car_ordinal, pi, rpm_max, gearbox_signature],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to resolve HUD car variant: {error}"))?;
    transaction
        .execute(
            "INSERT INTO shift_light_profiles
               (variant_id, gear, status, shift_rpm, sample_count, method, ratio_drop, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
             ON CONFLICT (variant_id, gear) DO UPDATE SET
               status = excluded.status,
               shift_rpm = excluded.shift_rpm,
               sample_count = excluded.sample_count,
               method = excluded.method,
               ratio_drop = excluded.ratio_drop,
               updated_at = CURRENT_TIMESTAMP",
            params![
                variant_id,
                profile.gear,
                persisted_status,
                profile.shift_rpm,
                profile.sample_count,
                profile.method,
                profile.ratio_drop,
            ],
        )
        .map_err(|error| format!("unable to save Shift Light profile: {error}"))?;
    transaction
        .execute(
            "DELETE FROM shift_light_profile_samples WHERE variant_id = ?1 AND gear = ?2",
            params![variant_id, profile.gear],
        )
        .map_err(|error| format!("unable to replace Shift Light evidence: {error}"))?;
    for (sample_index, rpm) in profile.samples.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO shift_light_profile_samples
                   (variant_id, gear, sample_index, rpm)
                 VALUES (?1, ?2, ?3, ?4)",
                params![variant_id, profile.gear, sample_index as i32, rpm],
            )
            .map_err(|error| format!("unable to save Shift Light evidence: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light profile: {error}"))?;
    Ok(())
}

#[tauri::command]
fn register_shift_light_variant(
    app: AppHandle,
    key: String,
    gearbox_signature: Option<String>,
) -> Result<(), String> {
    let (car_ordinal, pi, rpm_max) = parse_shift_light_key(&key)?;
    let gearbox_signature = gearbox_signature.unwrap_or_default();
    if gearbox_signature.len() > 256 {
        return Err("invalid Shift Light gearbox signature".to_string());
    }
    let connection = open_shift_light_db(&app)?;
    connection
        .execute(
            "INSERT INTO shift_light_cars (game_id, car_ordinal)
             VALUES ('fh6', ?1)
             ON CONFLICT (game_id, car_ordinal) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
            params![car_ordinal],
        )
        .map_err(|error| format!("unable to register HUD car: {error}"))?;
    connection
        .execute(
            "INSERT INTO shift_light_variants
               (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
             VALUES ('fh6', ?1, ?2, ?3, ?4)
             ON CONFLICT (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
             DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
            params![car_ordinal, pi, rpm_max, gearbox_signature],
        )
        .map_err(|error| format!("unable to register HUD car variant: {error}"))?;
    Ok(())
}

#[tauri::command]
fn reset_shift_light_profiles(
    app: AppHandle,
    key: String,
    gearbox_signature: Option<String>,
) -> Result<(), String> {
    let (car_ordinal, pi, rpm_max) = parse_shift_light_key(&key)?;
    let connection = open_shift_light_db(&app)?;
    let gearbox_signature = gearbox_signature.unwrap_or_default();
    delete_shift_light_profiles(&connection, car_ordinal, pi, rpm_max, &gearbox_signature)
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

fn settings_marker_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(SETTINGS_MARKER))
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
        "tires" | "pedals" | "steering" | "gear" | "history" => component,
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
    shift_light_brightness: u8,
) -> Result<(), String> {
    let safe_speed_unit = match speed_unit.as_str() {
        "kmh" | "mph" => speed_unit,
        _ => return Err("unknown speed unit".to_string()),
    };
    if shift_light_brightness > 100 {
        return Err("Shift Light brightness must be between 0 and 100".to_string());
    }

    let script = format!(
        "window.HudOverlay?.setDisplayPreferences?.({{ speedUnit: '{}', shiftLightBrightness: {} }})",
        safe_speed_unit, shift_light_brightness
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn sync_route_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncRouteStatus?.()")
}

#[tauri::command]
fn sync_shift_light_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncShiftLightStatus?.()")
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
            sync_route_status,
            sync_shift_light_status,
            start_direct_source,
            stop_direct_source,
            set_telemetry_source,
            load_shift_light_profiles,
            save_shift_light_profile,
            register_shift_light_variant,
            reset_shift_light_profiles,
            reset_shift_light
        ])
        .on_window_event(|window, event| {
            if window.label() != "settings" {
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
                .tooltip("Forza Horizon 6 HUD")
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

            let marker = settings_marker_path(app.handle())?;
            if !marker.exists() {
                show_settings(app.handle())?;
                if let Some(parent) = marker.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(marker, b"1")?;
            }

            let _ = settings;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Forza Horizon 6 HUD");
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
        assert!((telemetry.lap.distance - 100.5).abs() < f32::EPSILON);
        assert!((telemetry.lap.best - 85.123).abs() < 0.001);
        assert!((telemetry.lap.last - 86.5).abs() < f32::EPSILON);
        assert!((telemetry.lap.current - 42.1).abs() < 0.001);
        assert!((telemetry.lap.race_time - 200.0).abs() < f32::EPSILON);
        assert_eq!(telemetry.lap.number, 3);
    }

    #[test]
    fn parses_shift_light_profile_key() {
        assert_eq!(
            parse_shift_light_key("fh6:1234:850:8000").unwrap(),
            (1234, 850, 8000)
        );
        assert!(parse_shift_light_key("fh5:1234:850:8000").is_err());
        assert!(parse_shift_light_key("fh6:0:850:8000").is_err());
        assert!(parse_shift_light_key("fh6:1234:850").is_err());
    }

    #[test]
    fn creates_shift_light_registry_and_is_idempotent() {
        let connection = Connection::open_in_memory().unwrap();

        initialize_shift_light_schema(&connection).unwrap();
        initialize_shift_light_schema(&connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
        for table in [
            "shift_light_cars",
            "shift_light_variants",
            "shift_light_profiles",
            "shift_light_profile_samples",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }
    }

    #[test]
    fn distinguishes_missing_variant_from_sqlite_lookup_errors() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&connection).unwrap();

        assert_eq!(
            find_shift_light_variant_id(&connection, 260, 600, 8500, ""),
            Ok(None)
        );

        connection
            .execute(
                "INSERT INTO shift_light_cars (game_id, car_ordinal) VALUES ('fh6', 260)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_variants
                   (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
                 VALUES ('fh6', 260, 600, 8500, '2:0.8000|3:0.8750')",
                [],
            )
            .unwrap();
        assert!(
            find_shift_light_variant_id(&connection, 260, 600, 8500, "")
                .unwrap()
                .is_none()
        );

        connection
            .execute_batch("DROP TABLE shift_light_variants")
            .unwrap();
        assert!(find_shift_light_variant_id(&connection, 260, 600, 8500, "").is_err());
    }

    #[test]
    fn migrates_calibrated_profiles_without_deleting_legacy_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (1);
                 CREATE TABLE shift_light_profiles (
                   car_ordinal INTEGER NOT NULL,
                   pi INTEGER NOT NULL,
                   rpm_max INTEGER NOT NULL,
                   gear INTEGER NOT NULL,
                   shift_rpm INTEGER NOT NULL,
                   sample_count INTEGER NOT NULL,
                   method TEXT NOT NULL,
                   ratio_drop REAL,
                   updated_at TEXT NOT NULL
                 );
                 INSERT INTO shift_light_profiles VALUES
                   (260, 600, 8500, 2, 7925, 5, 'observed', NULL, '2026-08-24 10:00:00');",
            )
            .unwrap();

        initialize_shift_light_schema(&connection).unwrap();
        initialize_shift_light_schema(&connection).unwrap();

        let migrated: (i32, i32, String) = connection
            .query_row(
                "SELECT p.shift_rpm, p.sample_count, p.status
                 FROM shift_light_profiles AS p
                 JOIN shift_light_variants AS v ON v.id = p.variant_id",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(migrated, (7925, 5, "calibrated".to_string()));
        let legacy_count: i32 = connection
            .query_row(
                "SELECT COUNT(*) FROM shift_light_profiles_legacy",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_count, 1);
    }

    #[test]
    fn stores_two_variants_for_one_car_without_mixing_identity() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_cars (game_id, car_ordinal) VALUES ('fh6', 260)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_variants
                   (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
                 VALUES
                   ('fh6', 260, 600, 8500, '2:0.8000|3:0.8750'),
                   ('fh6', 260, 600, 8500, '2:0.7500|3:0.8500')",
                [],
            )
            .unwrap();
        let count: i32 = connection
            .query_row(
                "SELECT COUNT(*) FROM shift_light_variants WHERE car_ordinal = 260",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn reset_removes_active_and_unsigned_profiles_but_keeps_other_gearboxes() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_cars (game_id, car_ordinal) VALUES ('fh6', 260)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_variants
                   (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
                 VALUES
                   ('fh6', 260, 600, 8500, ''),
                   ('fh6', 260, 600, 8500, '2:0.8000|3:0.8750'),
                   ('fh6', 260, 600, 8500, '2:0.7500|3:0.8500')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_profiles (variant_id, gear)
                 SELECT id, 2 FROM shift_light_variants",
                [],
            )
            .unwrap();

        delete_shift_light_profiles(&connection, 260, 600, 8500, "2:0.8000|3:0.8750").unwrap();

        let remaining: Vec<(String, i32)> = connection
            .prepare(
                "SELECT v.gearbox_signature, COUNT(p.gear)
                 FROM shift_light_variants AS v
                 LEFT JOIN shift_light_profiles AS p ON p.variant_id = v.id
                 WHERE v.car_ordinal = 260
                 GROUP BY v.id, v.gearbox_signature
                 ORDER BY v.gearbox_signature",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(
            remaining,
            vec![
                ("".to_string(), 0),
                ("2:0.7500|3:0.8500".to_string(), 1),
                ("2:0.8000|3:0.8750".to_string(), 0)
            ]
        );
    }
}
