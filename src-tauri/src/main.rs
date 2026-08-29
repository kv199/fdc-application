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

use rusqlite::{Connection, Error as SqliteError, Transaction, params};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, State, WebviewWindow,
    WindowEvent, menu::MenuBuilder, tray::TrayIconBuilder,
};

const SETTINGS_WINDOW_SIZE_FILE: &str = "settings-window-size.json";
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightVariantResolution {
    variant_id: i64,
    status: String,
    ratio_features: Option<String>,
}

#[derive(Clone)]
struct StoredShiftLightProfile {
    gear: i32,
    status: String,
    shift_rpm: Option<i32>,
    sample_count: i32,
    method: String,
    ratio_drop: Option<f64>,
    samples: Vec<i32>,
}

#[derive(Clone, Copy)]
struct RatioFeature {
    gear: i32,
    ratio: f64,
}

const RATIO_FEATURE_TOLERANCE: f64 = 0.005;
const MAX_SHIFT_LIGHT_SAMPLES: usize = 5;
const OBSERVED_SHIFT_RPM_OFFSET: f64 = 75.0;

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

fn parse_ratio_features(features: &str) -> Result<Vec<RatioFeature>, String> {
    if features.is_empty() {
        return Ok(Vec::new());
    }
    let mut parsed = Vec::new();
    for token in features.split('|') {
        let mut parts = token.split(':');
        let gear = parts
            .next()
            .ok_or_else(|| "invalid HUD gearbox ratio features".to_string())?
            .parse::<i32>()
            .map_err(|_| "invalid HUD gearbox ratio features".to_string())?;
        let ratio = parts
            .next()
            .ok_or_else(|| "invalid HUD gearbox ratio features".to_string())?
            .parse::<f64>()
            .map_err(|_| "invalid HUD gearbox ratio features".to_string())?;
        if parts.next().is_some() || !(1..=10).contains(&gear) || !ratio.is_finite() {
            return Err("invalid HUD gearbox ratio features".to_string());
        }
        if parsed
            .iter()
            .any(|feature: &RatioFeature| feature.gear == gear)
        {
            return Err("duplicate HUD gearbox ratio feature".to_string());
        }
        parsed.push(RatioFeature { gear, ratio });
    }
    parsed.sort_by_key(|feature| feature.gear);
    Ok(parsed)
}

fn format_ratio_features(features: &[RatioFeature]) -> String {
    features
        .iter()
        .map(|feature| format!("{}:{:.4}", feature.gear, feature.ratio))
        .collect::<Vec<_>>()
        .join("|")
}

fn ratio_features_are_compatible(left: &str, right: &str) -> Result<bool, String> {
    let left = parse_ratio_features(left)?;
    let right = parse_ratio_features(right)?;
    if left.is_empty() || right.is_empty() {
        return Ok(false);
    }
    let mut common = 0;
    for left_feature in &left {
        if let Some(right_feature) = right
            .iter()
            .find(|feature| feature.gear == left_feature.gear)
        {
            common += 1;
            if (left_feature.ratio - right_feature.ratio).abs() > RATIO_FEATURE_TOLERANCE {
                return Ok(false);
            }
        }
    }
    Ok(common > 0)
}

fn merge_ratio_features(existing: &str, detected: &str) -> Result<String, String> {
    let mut merged = parse_ratio_features(existing)?;
    let detected = parse_ratio_features(detected)?;
    if merged.is_empty() {
        return Ok(format_ratio_features(&detected));
    }
    if detected.is_empty() {
        return Ok(format_ratio_features(&merged));
    }
    let detected_features = format_ratio_features(&detected);
    if !ratio_features_are_compatible(existing, &detected_features)? {
        return Err("incompatible HUD gearbox ratio features".to_string());
    }
    for detected_feature in detected {
        if let Some(existing_feature) = merged
            .iter_mut()
            .find(|feature| feature.gear == detected_feature.gear)
        {
            if (existing_feature.ratio - detected_feature.ratio).abs() > RATIO_FEATURE_TOLERANCE {
                return Err("incompatible HUD gearbox ratio features".to_string());
            }
        } else {
            merged.push(detected_feature);
        }
    }
    merged.sort_by_key(|feature| feature.gear);
    Ok(format_ratio_features(&merged))
}

fn profile_preference_key(profile: &StoredShiftLightProfile) -> String {
    format!(
        "{}|{:010}|{:010}|{}|{:020.6}",
        if profile.status == "calibrated" { 1 } else { 0 },
        profile.sample_count.max(0),
        profile.shift_rpm.unwrap_or(i32::MAX),
        profile.method,
        profile.ratio_drop.unwrap_or(f64::MAX),
    )
}

fn merge_profile_samples(left: &[i32], right: &[i32]) -> Vec<i32> {
    let mut samples = left.iter().chain(right).copied().collect::<Vec<_>>();
    samples.sort_unstable();
    samples.dedup();
    samples.truncate(MAX_SHIFT_LIGHT_SAMPLES);
    samples
}

fn complete_observed_profile(profile: &mut StoredShiftLightProfile) {
    if profile.method != "observed"
        || profile.shift_rpm.is_some()
        || profile.samples.len() < MAX_SHIFT_LIGHT_SAMPLES
    {
        return;
    }

    let average = profile
        .samples
        .iter()
        .map(|sample| *sample as f64)
        .sum::<f64>()
        / profile.samples.len() as f64;
    profile.shift_rpm = Some((average - OBSERVED_SHIFT_RPM_OFFSET).round().max(0.0) as i32);
    profile.sample_count = profile.sample_count.max(profile.samples.len() as i32);
    profile.status = "calibrated".to_string();
}

fn merge_stored_profiles(
    left: &StoredShiftLightProfile,
    right: &StoredShiftLightProfile,
) -> StoredShiftLightProfile {
    let selected = if profile_preference_key(right) > profile_preference_key(left) {
        right
    } else {
        left
    };
    let samples = merge_profile_samples(&left.samples, &right.samples);
    let mut merged = selected.clone();
    merged.sample_count = left
        .sample_count
        .max(right.sample_count)
        .max(samples.len() as i32);
    merged.samples = samples;
    complete_observed_profile(&mut merged);
    if merged.status == "learning" && merged.sample_count >= 5 && merged.shift_rpm.is_some() {
        merged.status = "calibrated".to_string();
    }
    merged
}

fn read_stored_profiles(
    connection: &Connection,
    variant_id: i64,
) -> Result<Vec<StoredShiftLightProfile>, String> {
    let mut statement = connection
        .prepare(
            "SELECT gear, status, shift_rpm, sample_count, method, ratio_drop
             FROM shift_light_profiles WHERE variant_id = ?1 ORDER BY gear",
        )
        .map_err(|error| format!("unable to prepare Shift Light profile query: {error}"))?;
    let rows = statement
        .query_map(params![variant_id], |row| {
            Ok(StoredShiftLightProfile {
                gear: row.get(0)?,
                status: row.get(1)?,
                shift_rpm: row.get(2)?,
                sample_count: row.get(3)?,
                method: row.get(4)?,
                ratio_drop: row.get(5)?,
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
    for profile in &mut profiles {
        complete_observed_profile(profile);
    }
    Ok(profiles)
}

fn write_stored_profile(
    connection: &Connection,
    variant_id: i64,
    profile: &StoredShiftLightProfile,
) -> Result<(), String> {
    let mut profile = profile.clone();
    complete_observed_profile(&mut profile);
    connection
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
                profile.status,
                profile.shift_rpm,
                profile.sample_count,
                profile.method,
                profile.ratio_drop,
            ],
        )
        .map_err(|error| format!("unable to save Shift Light profile: {error}"))?;
    connection
        .execute(
            "DELETE FROM shift_light_profile_samples WHERE variant_id = ?1 AND gear = ?2",
            params![variant_id, profile.gear],
        )
        .map_err(|error| format!("unable to replace Shift Light evidence: {error}"))?;
    for (sample_index, rpm) in profile.samples.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO shift_light_profile_samples
                   (variant_id, gear, sample_index, rpm)
                 VALUES (?1, ?2, ?3, ?4)",
                params![variant_id, profile.gear, sample_index as i32, rpm],
            )
            .map_err(|error| format!("unable to save Shift Light evidence: {error}"))?;
    }
    Ok(())
}

fn merge_variant_records(
    transaction: &Transaction<'_>,
    target_id: i64,
    source_id: i64,
) -> Result<(), String> {
    if target_id == source_id {
        return Ok(());
    }
    let source_profiles = read_stored_profiles(transaction, source_id)?;
    let target_profiles = read_stored_profiles(transaction, target_id)?;
    for source_profile in source_profiles {
        let merged = target_profiles
            .iter()
            .find(|profile| profile.gear == source_profile.gear)
            .map(|target| merge_stored_profiles(target, &source_profile))
            .unwrap_or(source_profile);
        write_stored_profile(transaction, target_id, &merged)?;
    }
    transaction
        .execute(
            "DELETE FROM shift_light_variants WHERE id = ?1",
            params![source_id],
        )
        .map_err(|error| format!("unable to merge HUD variants: {error}"))?;
    Ok(())
}

fn ensure_provisional_variant(
    transaction: &Transaction<'_>,
    car_ordinal: i32,
    pi: i32,
    rpm_max: i32,
) -> Result<i64, String> {
    transaction
        .execute(
            "INSERT INTO shift_light_cars (game_id, car_ordinal)
             VALUES ('fh6', ?1)
             ON CONFLICT (game_id, car_ordinal) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
            params![car_ordinal],
        )
        .map_err(|error| format!("unable to register HUD car: {error}"))?;
    match transaction.query_row(
        "SELECT id FROM shift_light_variants
         WHERE game_id = 'fh6' AND car_ordinal = ?1 AND pi = ?2 AND rpm_max = ?3
           AND is_provisional = 1
         ORDER BY id LIMIT 1",
        params![car_ordinal, pi, rpm_max],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(variant_id) => Ok(variant_id),
        Err(SqliteError::QueryReturnedNoRows) => {
            transaction
                .execute(
                    "INSERT INTO shift_light_variants
                       (game_id, car_ordinal, pi, rpm_max, gearbox_signature, is_provisional)
                     VALUES ('fh6', ?1, ?2, ?3, '', 1)",
                    params![car_ordinal, pi, rpm_max],
                )
                .map_err(|error| format!("unable to create provisional HUD variant: {error}"))?;
            transaction
                .query_row(
                    "SELECT id FROM shift_light_variants
                     WHERE game_id = 'fh6' AND car_ordinal = ?1 AND pi = ?2 AND rpm_max = ?3
                       AND is_provisional = 1
                     ORDER BY id LIMIT 1",
                    params![car_ordinal, pi, rpm_max],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| format!("unable to resolve provisional HUD variant: {error}"))
        }
        Err(error) => Err(format!(
            "unable to resolve provisional HUD variant: {error}"
        )),
    }
}

fn list_matching_variants(
    transaction: &Transaction<'_>,
    car_ordinal: i32,
    pi: i32,
    rpm_max: i32,
    detected_features: &str,
) -> Result<Vec<(i64, String)>, String> {
    let mut statement = transaction
        .prepare(
            "SELECT id, gearbox_signature FROM shift_light_variants
             WHERE game_id = 'fh6' AND car_ordinal = ?1 AND pi = ?2 AND rpm_max = ?3
               AND is_provisional = 0 ORDER BY id",
        )
        .map_err(|error| format!("unable to prepare HUD variant query: {error}"))?;
    let rows = statement
        .query_map(params![car_ordinal, pi, rpm_max], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("unable to read HUD variants: {error}"))?;
    let mut matches = Vec::new();
    for row in rows {
        let (variant_id, features) =
            row.map_err(|error| format!("unable to decode HUD variant: {error}"))?;
        if ratio_features_are_compatible(&features, detected_features)? {
            matches.push((variant_id, features));
        }
    }
    Ok(matches)
}

fn read_variant_identity(
    connection: &Connection,
    variant_id: i64,
) -> Result<(i32, i32, i32, bool, String), String> {
    connection
        .query_row(
            "SELECT car_ordinal, pi, rpm_max, is_provisional, gearbox_signature
             FROM shift_light_variants WHERE id = ?1",
            params![variant_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, i32>(3)? != 0,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| match error {
            SqliteError::QueryReturnedNoRows => {
                format!("HUD variant {variant_id} does not exist")
            }
            other => format!("unable to resolve HUD variant {variant_id}: {other}"),
        })
}

fn assert_variant_matches_key(
    connection: &Connection,
    variant_id: i64,
    key: &str,
) -> Result<(i32, i32, i32, bool, String), String> {
    let (car_ordinal, pi, rpm_max, is_provisional, features) =
        read_variant_identity(connection, variant_id)?;
    let expected = parse_shift_light_key(key)?;
    if (car_ordinal, pi, rpm_max) != expected {
        return Err(format!(
            "HUD variant {variant_id} does not match Shift Light key"
        ));
    }
    Ok((car_ordinal, pi, rpm_max, is_provisional, features))
}

fn delete_shift_light_profiles(connection: &mut Connection, variant_id: i64) -> Result<(), String> {
    let (car_ordinal, pi, rpm_max, _, _) = read_variant_identity(connection, variant_id)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light reset: {error}"))?;
    transaction
        .execute(
            "DELETE FROM shift_light_variants
             WHERE id = ?1
                OR (game_id = 'fh6' AND car_ordinal = ?2 AND pi = ?3 AND rpm_max = ?4
                    AND is_provisional = 1)",
            params![variant_id, car_ordinal, pi, rpm_max],
        )
        .map_err(|error| format!("unable to reset Shift Light profiles: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light reset: {error}"))?;
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
               is_provisional INTEGER NOT NULL DEFAULT 0,
               first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

#[derive(Clone)]
struct LegacyVariantRow {
    id: i64,
    car_ordinal: i32,
    pi: i32,
    rpm_max: i32,
    is_provisional: bool,
    features: String,
}

fn migrate_stable_variant_schema(connection: &mut Connection) -> Result<(), String> {
    if !table_has_column(connection, "shift_light_variants", "is_provisional")? {
        connection
            .execute(
                "ALTER TABLE shift_light_variants
                 ADD COLUMN is_provisional INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|error| format!("unable to add HUD variant stability column: {error}"))?;
    }
    connection
        .execute(
            "UPDATE shift_light_variants
             SET is_provisional = CASE WHEN gearbox_signature = '' THEN 1 ELSE 0 END",
            [],
        )
        .map_err(|error| format!("unable to classify HUD variants: {error}"))?;

    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id, car_ordinal, pi, rpm_max, is_provisional, gearbox_signature
                 FROM shift_light_variants ORDER BY car_ordinal, pi, rpm_max, id",
            )
            .map_err(|error| format!("unable to prepare HUD variant migration: {error}"))?;
        statement
            .query_map([], |row| {
                Ok(LegacyVariantRow {
                    id: row.get(0)?,
                    car_ordinal: row.get(1)?,
                    pi: row.get(2)?,
                    rpm_max: row.get(3)?,
                    is_provisional: row.get::<_, i32>(4)? != 0,
                    features: row.get(5)?,
                })
            })
            .map_err(|error| format!("unable to read HUD variants for migration: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("unable to decode HUD variants for migration: {error}"))?
    };

    for row in &rows {
        parse_ratio_features(&row.features)?;
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start HUD variant migration: {error}"))?;
    let mut groups = std::collections::BTreeMap::<(i32, i32, i32), Vec<LegacyVariantRow>>::new();
    for row in rows {
        groups
            .entry((row.car_ordinal, row.pi, row.rpm_max))
            .or_default()
            .push(row);
    }

    for variants in groups.values() {
        let provisional = variants
            .iter()
            .filter(|variant| variant.is_provisional)
            .collect::<Vec<_>>();
        if let Some(target) = provisional.first() {
            for source in provisional.iter().skip(1) {
                merge_variant_records(&transaction, target.id, source.id)?;
            }
        }

        let mut consolidated = Vec::<(i64, String)>::new();
        for variant in variants.iter().filter(|variant| !variant.is_provisional) {
            let mut merged = false;
            for (target_id, target_features) in &mut consolidated {
                if !ratio_features_are_compatible(target_features, &variant.features)? {
                    continue;
                }
                let combined = merge_ratio_features(target_features, &variant.features)?;
                merge_variant_records(&transaction, *target_id, variant.id)?;
                transaction
                    .execute(
                        "UPDATE shift_light_variants
                         SET gearbox_signature = ?, last_seen_at = CURRENT_TIMESTAMP
                         WHERE id = ?",
                        params![combined, *target_id],
                    )
                    .map_err(|error| format!("unable to consolidate HUD variants: {error}"))?;
                *target_features = combined;
                merged = true;
                break;
            }
            if !merged {
                consolidated.push((variant.id, variant.features.clone()));
            }
        }
    }

    transaction
        .execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_light_provisional_variant
             ON shift_light_variants (game_id, car_ordinal, pi, rpm_max)
             WHERE is_provisional = 1",
            [],
        )
        .map_err(|error| format!("unable to index provisional HUD variants: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit HUD variant migration: {error}"))?;
    Ok(())
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
    }
    create_shift_light_tables(connection)?;
    if version < 3 {
        migrate_stable_variant_schema(connection)?;
        connection
            .execute("UPDATE hud_schema_version SET version = 3", [])
            .map_err(|error| format!("unable to update HUD SQLite schema version: {error}"))?;
    } else {
        connection
            .execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_light_provisional_variant
                 ON shift_light_variants (game_id, car_ordinal, pi, rpm_max)
                 WHERE is_provisional = 1",
                [],
            )
            .map_err(|error| format!("unable to index provisional HUD variants: {error}"))?;
    }
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
            "SELECT COUNT(DISTINCT variants.id),
                    COALESCE(SUM(CASE
                      WHEN profiles.status = 'calibrated' AND profiles.shift_rpm IS NOT NULL THEN 1
                      ELSE 0
                    END), 0),
                    COALESCE(SUM(CASE
                      WHEN profiles.gear IS NOT NULL
                       AND (profiles.status <> 'calibrated' OR profiles.shift_rpm IS NULL) THEN 1
                      ELSE 0
                    END), 0)
             FROM shift_light_variants AS variants
             LEFT JOIN shift_light_profiles AS profiles ON profiles.variant_id = variants.id
             WHERE variants.game_id = 'fh6'
               AND variants.car_ordinal = ?1
               AND variants.pi = ?2",
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

#[tauri::command]
fn load_shift_light_profiles(
    app: AppHandle,
    key: String,
    variant_id: i64,
) -> Result<Vec<ShiftLightProfile>, String> {
    let connection = open_shift_light_db(&app)?;
    let (_, _, _, _, features) = assert_variant_matches_key(&connection, variant_id, &key)?;
    let profiles = read_stored_profiles(&connection, variant_id)?;
    Ok(profiles
        .into_iter()
        .map(|profile| ShiftLightProfile {
            key: key.clone(),
            gear: profile.gear,
            shift_rpm: profile.shift_rpm,
            sample_count: profile.sample_count,
            status: profile.status,
            samples: profile.samples,
            method: profile.method,
            ratio_drop: profile.ratio_drop,
            gearbox_signature: (!features.is_empty()).then_some(features.clone()),
        })
        .collect())
}

#[tauri::command]
fn save_shift_light_profile(
    app: AppHandle,
    variant_id: i64,
    profile: ShiftLightProfile,
) -> Result<(), String> {
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
    {
        return Err("invalid Shift Light profile".to_string());
    }

    let mut connection = open_shift_light_db(&app)?;
    let (_, _, _, _, _) = assert_variant_matches_key(&connection, variant_id, &profile.key)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light transaction: {error}"))?;
    let incoming = StoredShiftLightProfile {
        gear: profile.gear,
        status: persisted_status.to_string(),
        shift_rpm: profile.shift_rpm,
        sample_count: profile.sample_count,
        method: profile.method,
        ratio_drop: profile.ratio_drop,
        samples: profile.samples,
    };
    let existing = read_stored_profiles(&transaction, variant_id)?
        .into_iter()
        .find(|stored| stored.gear == incoming.gear);
    let merged = existing
        .as_ref()
        .map(|stored| merge_stored_profiles(stored, &incoming))
        .unwrap_or(incoming);
    write_stored_profile(&transaction, variant_id, &merged)?;
    transaction
        .execute(
            "UPDATE shift_light_variants SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![variant_id],
        )
        .map_err(|error| format!("unable to update HUD variant: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light profile: {error}"))?;
    Ok(())
}

fn resolve_shift_light_variant(
    connection: &mut Connection,
    car_ordinal: i32,
    pi: i32,
    rpm_max: i32,
    detected_features: &str,
) -> Result<ShiftLightVariantResolution, String> {
    if detected_features.len() > 256 {
        return Err("invalid Shift Light gearbox signature".to_string());
    }
    let parsed_features = parse_ratio_features(detected_features)?;
    let detected_features = format_ratio_features(&parsed_features);
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start HUD variant resolution: {error}"))?;
    let provisional_id = ensure_provisional_variant(&transaction, car_ordinal, pi, rpm_max)?;
    if detected_features.is_empty() {
        transaction
            .commit()
            .map_err(|error| format!("unable to commit provisional HUD variant: {error}"))?;
        return Ok(ShiftLightVariantResolution {
            variant_id: provisional_id,
            status: "provisional".to_string(),
            ratio_features: None,
        });
    }

    let matches =
        list_matching_variants(&transaction, car_ordinal, pi, rpm_max, &detected_features)?;
    if matches.len() > 1 {
        transaction
            .commit()
            .map_err(|error| format!("unable to commit ambiguous HUD variant: {error}"))?;
        return Ok(ShiftLightVariantResolution {
            variant_id: provisional_id,
            status: "ambiguous".to_string(),
            ratio_features: None,
        });
    }

    let target_id = matches.first().map(|(variant_id, _)| *variant_id);
    let target_id = if let Some(target_id) = target_id {
        let (_, _, _, _, target_features) = read_variant_identity(&transaction, target_id)?;
        if target_id != provisional_id {
            merge_variant_records(&transaction, target_id, provisional_id)?;
        }
        let merged_features = merge_ratio_features(&target_features, &detected_features)?;
        transaction
            .execute(
                "UPDATE shift_light_variants
                 SET gearbox_signature = ?1, is_provisional = 0, last_seen_at = CURRENT_TIMESTAMP
                 WHERE id = ?2",
                params![merged_features, target_id],
            )
            .map_err(|error| format!("unable to update HUD gearbox features: {error}"))?;
        target_id
    } else {
        transaction
            .execute(
                "UPDATE shift_light_variants
                 SET gearbox_signature = ?1, is_provisional = 0, last_seen_at = CURRENT_TIMESTAMP
                 WHERE id = ?2",
                params![detected_features, provisional_id],
            )
            .map_err(|error| format!("unable to promote HUD variant: {error}"))?;
        provisional_id
    };
    let features: String = transaction
        .query_row(
            "SELECT gearbox_signature FROM shift_light_variants WHERE id = ?1",
            params![target_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("unable to read HUD gearbox features: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit HUD variant resolution: {error}"))?;
    Ok(ShiftLightVariantResolution {
        variant_id: target_id,
        status: "resolved".to_string(),
        ratio_features: Some(features),
    })
}

#[tauri::command]
fn register_shift_light_variant(
    app: AppHandle,
    key: String,
    gearbox_signature: Option<String>,
) -> Result<ShiftLightVariantResolution, String> {
    let (car_ordinal, pi, rpm_max) = parse_shift_light_key(&key)?;
    let detected_features = gearbox_signature.unwrap_or_default();
    let mut connection = open_shift_light_db(&app)?;
    resolve_shift_light_variant(
        &mut connection,
        car_ordinal,
        pi,
        rpm_max,
        &detected_features,
    )
}

#[tauri::command]
fn reset_shift_light_profiles(app: AppHandle, variant_id: i64) -> Result<(), String> {
    let mut connection = open_shift_light_db(&app)?;
    delete_shift_light_profiles(&mut connection, variant_id)
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
struct SettingsWindowSize {
    width: u32,
    height: u32,
}

fn settings_window_size_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(SETTINGS_WINDOW_SIZE_FILE))
}

fn is_valid_settings_window_size(size: SettingsWindowSize) -> bool {
    (SETTINGS_MIN_WIDTH..=SETTINGS_MAX_WIDTH).contains(&size.width)
        && (SETTINGS_MIN_HEIGHT..=SETTINGS_MAX_HEIGHT).contains(&size.height)
}

fn restore_settings_window_size<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let path = settings_window_size_path(app)?;
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(());
    };
    let Ok(size) = serde_json::from_str::<SettingsWindowSize>(&contents) else {
        return Ok(());
    };
    if !is_valid_settings_window_size(size) {
        return Ok(());
    }

    window.set_size(LogicalSize::new(size.width, size.height))?;
    Ok(())
}

fn persist_settings_window_size<R: Runtime>(
    app: &AppHandle<R>,
    size: SettingsWindowSize,
) -> tauri::Result<()> {
    if !is_valid_settings_window_size(size) {
        return Ok(());
    }

    let path = settings_window_size_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec(&size).map_err(std::io::Error::other)?;
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
    shift_light_brightness: u8,
    hud_opacity: u8,
) -> Result<(), String> {
    let safe_speed_unit = match speed_unit.as_str() {
        "kmh" | "mph" => speed_unit,
        _ => return Err("unknown speed unit".to_string()),
    };
    if shift_light_brightness > 100 {
        return Err("Shift Light brightness must be between 0 and 100".to_string());
    }
    if !(1..=100).contains(&hud_opacity) {
        return Err("HUD opacity must be between 1 and 100".to_string());
    }

    let script = format!(
        "window.HudOverlay?.setDisplayPreferences?.({{ speedUnit: '{}', shiftLightBrightness: {}, hudOpacity: {} }})",
        safe_speed_unit, shift_light_brightness, hud_opacity
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
            set_configuration_always_on_top,
            sync_route_status,
            sync_shift_light_status,
            start_direct_source,
            stop_direct_source,
            retry_direct_source,
            load_shift_light_profiles,
            save_shift_light_profile,
            register_shift_light_variant,
            reset_shift_light_profiles,
            reset_shift_light,
            record_garage_vehicle,
            load_garage_snapshot,
            load_garage,
            rename_garage_car
        ])
        .on_window_event(|window, event| {
            if window.label() != "settings" {
                return;
            }

            if let WindowEvent::Resized(size) = event {
                let app = window.app_handle();
                let scale_factor = window
                    .scale_factor()
                    .ok()
                    .filter(|value| value.is_finite() && *value > 0.0)
                    .unwrap_or(1.0);
                let size = SettingsWindowSize {
                    width: ((size.width as f64 / scale_factor).round()) as u32,
                    height: ((size.height as f64 / scale_factor).round()) as u32,
                };
                if let Err(error) = persist_settings_window_size(&app, size) {
                    eprintln!("unable to persist Configuration window size: {error}");
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

            restore_settings_window_size(app.handle(), &settings)?;

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
    fn accepts_default_configuration_window_size_and_rejects_unsafe_values() {
        let default = SettingsWindowSize {
            width: SETTINGS_DEFAULT_WIDTH,
            height: SETTINGS_DEFAULT_HEIGHT,
        };
        assert!(is_valid_settings_window_size(default));
        assert!(!is_valid_settings_window_size(SettingsWindowSize {
            width: SETTINGS_MIN_WIDTH - 1,
            height: SETTINGS_DEFAULT_HEIGHT,
        }));
        assert!(!is_valid_settings_window_size(SettingsWindowSize {
            width: SETTINGS_DEFAULT_WIDTH,
            height: SETTINGS_MAX_HEIGHT + 1,
        }));
    }

    #[test]
    fn serializes_configuration_window_size_for_persistence() {
        let size = SettingsWindowSize {
            width: 1024,
            height: 768,
        };
        let encoded = serde_json::to_string(&size).unwrap();
        assert_eq!(
            serde_json::from_str::<SettingsWindowSize>(&encoded)
                .unwrap()
                .width,
            1024
        );
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
        let mut connection = Connection::open_in_memory().unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 6);
        for table in [
            "shift_light_cars",
            "shift_light_variants",
            "shift_light_profiles",
            "shift_light_profile_samples",
            "garage_cars",
            "garage_variants",
            "garage_sequence",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
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
    fn garage_variant_summarizes_its_shift_light_tunes() {
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
        let no_profile = load_garage_snapshot_from_connection(&connection).unwrap();
        assert_eq!(no_profile.cars[0].variants[0].shift_light.status, "none");
        let resolution = resolve_shift_light_variant(&mut connection, 260, 600, 8500, "").unwrap();
        let learning = load_garage_snapshot_from_connection(&connection).unwrap();
        let learning_summary = &learning.cars[0].variants[0].shift_light;
        assert_eq!(learning_summary.status, "learning");
        assert_eq!(learning_summary.tune_count, 1);
        assert_eq!(learning_summary.calibrated_gear_count, 0);
        assert_eq!(learning_summary.learning_gear_count, 0);
        write_stored_profile(
            &connection,
            resolution.variant_id,
            &StoredShiftLightProfile {
                gear: 2,
                status: "calibrated".to_string(),
                shift_rpm: Some(7800),
                sample_count: 5,
                method: "observed".to_string(),
                ratio_drop: None,
                samples: vec![7875, 7900, 7925, 7950, 7975],
            },
        )
        .unwrap();

        let snapshot = load_garage_snapshot_from_connection(&connection).unwrap();
        let summary = &snapshot.cars[0].variants[0].shift_light;
        assert_eq!(summary.status, "ready");
        assert_eq!(summary.tune_count, 1);
        assert_eq!(summary.calibrated_gear_count, 1);
        assert_eq!(summary.learning_gear_count, 0);
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
        assert_eq!(version, 6);
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
        assert_eq!(version, 6);
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
        assert_eq!(version, 6);
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

    #[test]
    fn distinguishes_missing_variant_from_sqlite_lookup_errors() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        assert!(read_variant_identity(&connection, 999).is_err());
        connection
            .execute_batch("DROP TABLE shift_light_variants")
            .unwrap();
        assert!(read_variant_identity(&connection, 999).is_err());
    }

    #[test]
    fn migrates_calibrated_profiles_without_deleting_legacy_rows() {
        let mut connection = Connection::open_in_memory().unwrap();
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

        initialize_shift_light_schema(&mut connection).unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

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
        let provisional: i32 = connection
            .query_row(
                "SELECT is_provisional FROM shift_light_variants LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(provisional, 1);
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
    fn registers_a_provisional_variant_before_any_gear_is_known() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        let first = resolve_shift_light_variant(&mut connection, 260, 600, 8500, "").unwrap();
        let second = resolve_shift_light_variant(&mut connection, 260, 600, 8500, "").unwrap();
        assert_eq!(first.variant_id, second.variant_id);
        assert_eq!(first.status, "provisional");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM shift_light_cars WHERE car_ordinal = 260",
                    [],
                    |row| row.get::<_, i32>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM shift_light_profiles", [], |row| row
                    .get::<_, i32>(
                    0
                ),)
                .unwrap(),
            0
        );
    }

    #[test]
    fn restores_partial_evidence_from_the_provisional_variant() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let resolution = resolve_shift_light_variant(&mut connection, 260, 600, 8500, "").unwrap();
        write_stored_profile(
            &connection,
            resolution.variant_id,
            &StoredShiftLightProfile {
                gear: 2,
                status: "learning".to_string(),
                shift_rpm: None,
                sample_count: 2,
                method: "observed".to_string(),
                ratio_drop: None,
                samples: vec![7900, 7920],
            },
        )
        .unwrap();

        let restored = read_stored_profiles(&connection, resolution.variant_id).unwrap();
        assert_eq!(restored[0].sample_count, 2);
        assert_eq!(restored[0].samples, vec![7900, 7920]);
    }

    #[test]
    fn ratio_noise_and_higher_gears_keep_the_same_variant_id() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let first =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.8000|3:0.8750")
                .unwrap();
        let noisy =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.8010|3:0.8750")
                .unwrap();
        let expanded = resolve_shift_light_variant(
            &mut connection,
            260,
            600,
            8500,
            "2:0.8010|3:0.8750|4:0.8330",
        )
        .unwrap();
        assert_eq!(first.variant_id, noisy.variant_id);
        assert_eq!(first.variant_id, expanded.variant_id);
        assert_eq!(
            expanded.ratio_features.as_deref(),
            Some("2:0.8000|3:0.8750|4:0.8330")
        );
    }

    #[test]
    fn provisional_learning_does_not_replace_calibrated_evidence() {
        let calibrated = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7800),
            sample_count: 5,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7900, 7910, 7920, 7930, 7940],
        };
        let provisional = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 1,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8000],
        };
        let left = merge_stored_profiles(&calibrated, &provisional);
        let right = merge_stored_profiles(&provisional, &calibrated);
        assert_eq!(left.status, "calibrated");
        assert_eq!(left.sample_count, 5);
        assert_eq!(left.shift_rpm, Some(7800));
        assert_eq!(left.samples, right.samples);
        assert_eq!(left.shift_rpm, right.shift_rpm);
    }

    #[test]
    fn merging_five_partial_observed_samples_completes_calibration() {
        let first = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 3,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7900, 7920, 7940],
        };
        let second = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 2,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7960, 7980],
        };

        let merged = merge_stored_profiles(&first, &second);

        assert_eq!(merged.status, "calibrated");
        assert_eq!(merged.shift_rpm, Some(7865));
        assert_eq!(merged.sample_count, 5);
        assert_eq!(merged.samples, vec![7900, 7920, 7940, 7960, 7980]);
    }

    #[test]
    fn equal_quality_merge_uses_a_deterministic_profile_choice() {
        let first = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7800),
            sample_count: 5,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7900, 7910, 7920, 7930, 7940],
        };
        let second = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7900),
            sample_count: 5,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7950, 7960, 7970, 7980, 7990],
        };
        let left = merge_stored_profiles(&first, &second);
        let right = merge_stored_profiles(&second, &first);
        assert_eq!(left.shift_rpm, Some(7900));
        assert_eq!(left.shift_rpm, right.shift_rpm);
        assert_eq!(left.samples, right.samples);
    }

    #[test]
    fn materially_different_gearbox_gets_a_different_variant_id() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let first =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.8000|3:0.8750")
                .unwrap();
        let second =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.7000|3:0.8500")
                .unwrap();
        assert_ne!(first.variant_id, second.variant_id);
    }

    #[test]
    fn ambiguous_matching_variants_keep_learning_provisional() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_cars (game_id, car_ordinal) VALUES ('fh6', 260)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO shift_light_variants
                   (game_id, car_ordinal, pi, rpm_max, gearbox_signature, is_provisional)
                 VALUES
                   ('fh6', 260, 600, 8500, '2:0.8000|3:0.8720', 0),
                   ('fh6', 260, 600, 8500, '2:0.8000|3:0.8780', 0)",
                [],
            )
            .unwrap();
        let result =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.8000|3:0.8750")
                .unwrap();
        assert_eq!(result.status, "ambiguous");
        assert!(
            connection
                .query_row(
                    "SELECT is_provisional FROM shift_light_variants WHERE id = ?1",
                    params![result.variant_id],
                    |row| row.get::<_, i32>(0),
                )
                .unwrap()
                > 0
        );
    }

    #[test]
    fn reset_removes_active_and_provisional_but_keeps_other_variants() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let active =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.8000|3:0.8750")
                .unwrap();
        let other =
            resolve_shift_light_variant(&mut connection, 260, 600, 8500, "2:0.7000|3:0.8500")
                .unwrap();
        let provisional = resolve_shift_light_variant(&mut connection, 260, 600, 8500, "").unwrap();
        delete_shift_light_profiles(&mut connection, active.variant_id).unwrap();

        assert!(read_variant_identity(&connection, active.variant_id).is_err());
        assert!(read_variant_identity(&connection, provisional.variant_id).is_err());
        assert!(read_variant_identity(&connection, other.variant_id).is_ok());
    }

    #[test]
    fn migrates_evolving_variants_idempotently_and_keeps_strongest_profile() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (2);
                 CREATE TABLE shift_light_cars (
                   game_id TEXT NOT NULL, car_ordinal INTEGER NOT NULL,
                   first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
                   PRIMARY KEY (game_id, car_ordinal)
                 );
                 CREATE TABLE shift_light_variants (
                   id INTEGER PRIMARY KEY, game_id TEXT NOT NULL, car_ordinal INTEGER NOT NULL,
                   pi INTEGER NOT NULL, rpm_max INTEGER NOT NULL,
                   gearbox_signature TEXT NOT NULL DEFAULT '',
                   first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
                   UNIQUE (game_id, car_ordinal, pi, rpm_max, gearbox_signature)
                 );
                 CREATE TABLE shift_light_profiles (
                   variant_id INTEGER NOT NULL, gear INTEGER NOT NULL,
                   status TEXT NOT NULL, shift_rpm INTEGER, sample_count INTEGER NOT NULL,
                   method TEXT NOT NULL, ratio_drop REAL,
                   updated_at TEXT NOT NULL, PRIMARY KEY (variant_id, gear)
                 );
                 CREATE TABLE shift_light_profile_samples (
                   variant_id INTEGER NOT NULL, gear INTEGER NOT NULL,
                   sample_index INTEGER NOT NULL, rpm INTEGER NOT NULL,
                   PRIMARY KEY (variant_id, gear, sample_index)
                 );
                 INSERT INTO shift_light_cars VALUES ('fh6', 260, 'a', 'a');
                 INSERT INTO shift_light_variants
                   (id, game_id, car_ordinal, pi, rpm_max, gearbox_signature, first_seen_at, last_seen_at)
                 VALUES
                   (10, 'fh6', 260, 600, 8500, '2:0.8000|3:0.8750', 'a', 'a'),
                   (20, 'fh6', 260, 600, 8500, '2:0.8010|3:0.8750|4:0.8330', 'a', 'a'),
                   (30, 'fh6', 260, 600, 8500, '2:0.7000|3:0.8500', 'a', 'a');
                 INSERT INTO shift_light_profiles
                   VALUES (10, 2, 'learning', NULL, 1, 'observed', NULL, 'a'),
                          (20, 2, 'calibrated', 7800, 5, 'observed', NULL, 'a');
                 INSERT INTO shift_light_profile_samples
                   VALUES (10, 2, 0, 7900), (20, 2, 0, 7900), (20, 2, 1, 7910),
                          (20, 2, 2, 7920), (20, 2, 3, 7930), (20, 2, 4, 7940);",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let merged: (String, String, i32) = connection
            .query_row(
                "SELECT v.gearbox_signature, p.status, p.sample_count
                 FROM shift_light_variants AS v
                 JOIN shift_light_profiles AS p ON p.variant_id = v.id
                 WHERE v.id = 10 AND p.gear = 2",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            merged,
            (
                "2:0.8000|3:0.8750|4:0.8330".to_string(),
                "calibrated".to_string(),
                5
            )
        );
        assert!(read_variant_identity(&connection, 20).is_err());
        assert!(read_variant_identity(&connection, 30).is_ok());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM shift_light_variants", [], |row| {
                    row.get::<_, i32>(0)
                })
                .unwrap(),
            2
        );
    }
}
