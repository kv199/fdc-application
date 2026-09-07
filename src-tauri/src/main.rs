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

/// Versioned, opaque learner state owned by the canonical Shift Light learner.
///
/// The native layer stores the JSON atomically and also materializes the two
/// bounded collections when the learner provides them. Keeping the canonical
/// state opaque here means changing the learner does not require a second
/// implementation in Rust, while the normalized tables remain useful for
/// inspection and Garage summaries.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShiftLightLearningStateRequest {
    key: String,
    config_id: i64,
    state: serde_json::Value,
}

const SHIFT_LIGHT_LEARNING_MODEL_VERSION: i32 = 2;
const MAX_SHIFT_LIGHT_LEARNING_STATE_BYTES: usize = 512 * 1024;
const MAX_SHIFT_LIGHT_POWER_BINS: usize = 512;
const MAX_SHIFT_LIGHT_SHIFT_EVIDENCE: usize = 128;

#[derive(Clone, Copy)]
struct ShiftLightConfigIdentity {
    car_ordinal: i32,
    car_class: i32,
    car_performance_index: i32,
    drivetrain_type: i32,
    num_cylinders: i32,
    rpm_max: i32,
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

fn parse_shift_light_config_key(key: &str) -> Result<ShiftLightConfigIdentity, String> {
    let parts = key.split(':').collect::<Vec<_>>();
    if parts.first().copied() != Some("fh6") {
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
        // The new learner key deliberately excludes rpmMax. It is a display
        // hint from the current telemetry, not configuration identity.
        rpm_max: if parts.len() == 6 {
            1
        } else if parts.len() == 7 {
            parse(parts.get(6).copied())?
        } else {
            return Err("invalid Shift Light configuration key".to_string());
        },
    };
    if identity.car_ordinal <= 0
        || identity.car_class < 0
        || identity.car_performance_index <= 0
        || identity.drivetrain_type < 0
        || identity.num_cylinders <= 0
        || identity.rpm_max < 0
    {
        return Err("invalid Shift Light configuration key".to_string());
    }
    Ok(identity)
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

fn active_profile_method_rank(method: &str) -> i32 {
    if method == "optimal" { 1 } else { 0 }
}

fn active_profile_is_calibrated(profile: &StoredShiftLightProfile) -> bool {
    profile.status == "calibrated" && profile.shift_rpm.is_some()
}

fn active_profile_has_stronger_partial_prefix(
    existing: &StoredShiftLightProfile,
    incoming: &StoredShiftLightProfile,
) -> bool {
    existing.status == "learning"
        && incoming.status == "learning"
        && existing.samples.len() > incoming.samples.len()
        && existing.samples.starts_with(&incoming.samples)
        && existing.sample_count >= incoming.sample_count
}

fn merge_active_config_profiles(
    existing: &StoredShiftLightProfile,
    incoming: &StoredShiftLightProfile,
) -> StoredShiftLightProfile {
    let existing_calibrated = active_profile_is_calibrated(existing);
    let incoming_calibrated = active_profile_is_calibrated(incoming);
    let existing_method_rank = active_profile_method_rank(&existing.method);
    let incoming_method_rank = active_profile_method_rank(&incoming.method);

    let selected = if incoming_calibrated
        && (!existing_calibrated
            || incoming_method_rank > existing_method_rank
            || (incoming_method_rank == existing_method_rank && incoming.method == existing.method))
    {
        incoming
    } else if existing_calibrated || active_profile_has_stronger_partial_prefix(existing, incoming)
    {
        existing
    } else {
        incoming
    };

    let mut merged = selected.clone();
    merged.sample_count = selected.sample_count.max(selected.samples.len() as i32);
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

fn read_config_profiles(
    connection: &Connection,
    config_id: i64,
) -> Result<Vec<StoredShiftLightProfile>, String> {
    let mut statement = connection
        .prepare(
            "SELECT gear, status, shift_rpm, sample_count, method, ratio_drop
             FROM shift_light_config_profiles WHERE config_id = ?1 ORDER BY gear",
        )
        .map_err(|error| {
            format!("unable to prepare Shift Light configuration profile query: {error}")
        })?;
    let rows = statement
        .query_map(params![config_id], |row| {
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
        .map_err(|error| format!("unable to read Shift Light configuration profiles: {error}"))?;
    let mut profiles = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("unable to decode Shift Light configuration profiles: {error}"))?;
    let mut sample_statement = connection
        .prepare(
            "SELECT gear, rpm FROM shift_light_config_profile_samples
             WHERE config_id = ?1 ORDER BY gear, sample_index",
        )
        .map_err(|error| {
            format!("unable to prepare Shift Light configuration evidence query: {error}")
        })?;
    let samples = sample_statement
        .query_map(params![config_id], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, i32>(1)?))
        })
        .map_err(|error| format!("unable to read Shift Light configuration evidence: {error}"))?;
    for sample in samples {
        let (gear, rpm) = sample.map_err(|error| {
            format!("unable to decode Shift Light configuration evidence: {error}")
        })?;
        if let Some(profile) = profiles.iter_mut().find(|profile| profile.gear == gear) {
            profile.samples.push(rpm);
        }
    }
    Ok(profiles)
}

fn write_config_profile(
    connection: &Connection,
    config_id: i64,
    profile: &StoredShiftLightProfile,
) -> Result<(), String> {
    let profile = profile.clone();
    connection
        .execute(
            "INSERT INTO shift_light_config_profiles
               (config_id, gear, status, shift_rpm, sample_count, method, ratio_drop, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
             ON CONFLICT (config_id, gear) DO UPDATE SET
               status = excluded.status, shift_rpm = excluded.shift_rpm,
               sample_count = excluded.sample_count, method = excluded.method,
               ratio_drop = excluded.ratio_drop, updated_at = CURRENT_TIMESTAMP",
            params![
                config_id,
                profile.gear,
                profile.status,
                profile.shift_rpm,
                profile.sample_count,
                profile.method,
                profile.ratio_drop
            ],
        )
        .map_err(|error| format!("unable to save Shift Light configuration profile: {error}"))?;
    connection
        .execute(
            "DELETE FROM shift_light_config_profile_samples WHERE config_id = ?1 AND gear = ?2",
            params![config_id, profile.gear],
        )
        .map_err(|error| {
            format!("unable to replace Shift Light configuration evidence: {error}")
        })?;
    for (sample_index, rpm) in profile.samples.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO shift_light_config_profile_samples (config_id, gear, sample_index, rpm)
                 VALUES (?1, ?2, ?3, ?4)",
                params![config_id, profile.gear, sample_index as i32, rpm],
            )
            .map_err(|error| format!("unable to save Shift Light configuration evidence: {error}"))?;
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
               rpm_max INTEGER NOT NULL,
               gear_count INTEGER NOT NULL CHECK (gear_count BETWEEN 1 AND 10),
               gearbox_signature TEXT NOT NULL DEFAULT '',
               first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               UNIQUE (game_id, car_ordinal, car_class, car_performance_index,
                       drivetrain_type, num_cylinders, rpm_max, gear_count)
             );
             CREATE TABLE IF NOT EXISTS shift_light_config_profiles (
               config_id INTEGER NOT NULL,
               gear INTEGER NOT NULL,
               status TEXT NOT NULL DEFAULT 'learning',
               shift_rpm INTEGER,
               sample_count INTEGER NOT NULL DEFAULT 0,
               method TEXT NOT NULL DEFAULT 'observed',
               ratio_drop REAL,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (config_id, gear),
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_config_profile_samples (
               config_id INTEGER NOT NULL,
               gear INTEGER NOT NULL,
               sample_index INTEGER NOT NULL,
               rpm INTEGER NOT NULL,
               PRIMARY KEY (config_id, gear, sample_index),
               FOREIGN KEY (config_id, gear)
                 REFERENCES shift_light_config_profiles(config_id, gear) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_shift_light_configs_latest
               ON shift_light_configs
               (game_id, car_ordinal, car_class, car_performance_index,
                drivetrain_type, num_cylinders, rpm_max, last_seen_at DESC);",
        )
        .map_err(|error| format!("unable to create Shift Light configuration schema: {error}"))
}

fn create_shift_light_learning_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS shift_light_gear_learning (
               config_id INTEGER NOT NULL,
               source_gear INTEGER NOT NULL CHECK (source_gear BETWEEN 1 AND 10),
               status TEXT NOT NULL DEFAULT 'learning',
               target_rpm REAL,
               candidate_rpm REAL,
               confirming_count INTEGER NOT NULL DEFAULT 0 CHECK (confirming_count >= 0),
               last_reason TEXT,
               model_version INTEGER NOT NULL,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (config_id, source_gear),
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_learning_state (
               config_id INTEGER PRIMARY KEY,
               model_version INTEGER NOT NULL,
               state_json TEXT NOT NULL,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_power_bins (
               config_id INTEGER NOT NULL,
               source_gear INTEGER NOT NULL CHECK (source_gear BETWEEN 1 AND 10),
               rpm_bucket INTEGER NOT NULL,
               sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
               power_sum REAL NOT NULL DEFAULT 0,
               median_power REAL NOT NULL,
               torque_sum REAL NOT NULL DEFAULT 0,
               torque_sample_count INTEGER NOT NULL DEFAULT 0,
               speed_sum REAL NOT NULL DEFAULT 0,
               speed_sample_count INTEGER NOT NULL DEFAULT 0,
               median_torque REAL,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (config_id, source_gear, rpm_bucket),
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS shift_light_shift_evidence (
               id INTEGER PRIMARY KEY,
               config_id INTEGER NOT NULL,
               source_gear INTEGER NOT NULL CHECK (source_gear BETWEEN 1 AND 10),
               destination_gear INTEGER NOT NULL CHECK (destination_gear BETWEEN 1 AND 10),
               before_timestamp_ms INTEGER,
               after_timestamp_ms INTEGER,
               before_rpm REAL NOT NULL,
               before_power REAL,
               before_speed REAL,
               after_rpm REAL NOT NULL,
               after_power REAL,
               after_speed REAL,
               outcome TEXT NOT NULL CHECK (outcome IN ('better', 'too_early', 'invalid')),
               reason TEXT,
               model_version INTEGER NOT NULL,
               recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (config_id) REFERENCES shift_light_configs(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_shift_light_evidence_config_time
               ON shift_light_shift_evidence(config_id, recorded_at DESC, id DESC);",
        )
        .map_err(|error| format!("unable to create Shift Light learning schema: {error}"))
}

/// Move the active database to the new learner generation. Shift Light has no
/// supported data migration from the former observed/ratio model: retaining
/// those rows would make them indistinguishable from evidence produced by the
/// new algorithm. Only Shift Light rows are removed; Garage, Events and their
/// schema are deliberately left intact.
fn reset_shift_light_learning_generation(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light generation reset: {error}"))?;
    transaction
        .execute_batch(
            "DELETE FROM shift_light_learning_state;
             DELETE FROM shift_light_gear_learning;
             DELETE FROM shift_light_shift_evidence;
             DELETE FROM shift_light_power_bins;
             DELETE FROM shift_light_config_profile_samples;
             DELETE FROM shift_light_config_profiles;
             DELETE FROM shift_light_profile_samples;
             DELETE FROM shift_light_profiles;
             DELETE FROM shift_light_variants;
             DELETE FROM shift_light_cars;
             DELETE FROM shift_light_configs;",
        )
        .map_err(|error| format!("unable to clear legacy Shift Light data: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light generation reset: {error}"))
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
    create_shift_light_config_tables(connection)?;

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
    create_shift_light_config_tables(connection)?;
    if version < 11 {
        connection
            .execute("UPDATE hud_schema_version SET version = 11", [])
            .map_err(|error| {
                format!("unable to update Shift Light configuration schema version: {error}")
            })?;
    }
    create_shift_light_learning_tables(connection)?;
    if version < 12 {
        reset_shift_light_learning_generation(connection)?;
        connection
            .execute("UPDATE hud_schema_version SET version = 12", [])
            .map_err(|error| {
                format!("unable to update Shift Light learning schema version: {error}")
            })?;
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
                       learning.status AS status,
                       learning.target_rpm AS shift_rpm,
                       learning.source_gear AS gear
                FROM shift_light_configs AS configs
                LEFT JOIN shift_light_gear_learning AS learning
                  ON learning.config_id = configs.id
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

fn read_shift_light_config_identity(
    connection: &Connection,
    config_id: i64,
) -> Result<(ShiftLightConfigIdentity, i32, String), String> {
    connection
        .query_row(
            "SELECT car_ordinal, car_class, car_performance_index, drivetrain_type,
                    num_cylinders, rpm_max, gear_count, gearbox_signature
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
                        rpm_max: row.get(5)?,
                    },
                    row.get(6)?,
                    row.get(7)?,
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
) -> Result<(ShiftLightConfigIdentity, i32, String), String> {
    let (identity, gear_count, signature) =
        read_shift_light_config_identity(connection, config_id)?;
    let expected = parse_shift_light_config_key(key)?;
    if identity.car_ordinal != expected.car_ordinal
        || identity.car_class != expected.car_class
        || identity.car_performance_index != expected.car_performance_index
        || identity.drivetrain_type != expected.drivetrain_type
        || identity.num_cylinders != expected.num_cylinders
        || expected.rpm_max > 0 && identity.rpm_max != expected.rpm_max
    {
        return Err(format!(
            "Shift Light configuration {config_id} does not match its key"
        ));
    }
    Ok((identity, gear_count, signature))
}

#[tauri::command]
fn resolve_shift_light_config(
    app: AppHandle,
    key: String,
    observed_gear: i32,
) -> Result<ShiftLightVariantResolution, String> {
    let mut connection = open_shift_light_db(&app)?;
    resolve_shift_light_config_in_connection(&mut connection, &key, observed_gear)
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
    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Shift Light configuration resolution: {error}")
    })?;
    let existing: Option<(i64, String)> = transaction
        .query_row(
            "SELECT id, gearbox_signature FROM shift_light_configs
             WHERE game_id = 'fh6' AND car_ordinal = ?1 AND car_class = ?2
               AND car_performance_index = ?3 AND drivetrain_type = ?4
               AND num_cylinders = ?5 AND (?6 = 0 OR rpm_max = ?6)
             ORDER BY last_seen_at DESC, id DESC LIMIT 1",
            params![
                identity.car_ordinal,
                identity.car_class,
                identity.car_performance_index,
                identity.drivetrain_type,
                identity.num_cylinders,
                identity.rpm_max
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("unable to resolve current Shift Light configuration: {error}"))?;
    let (config_id, signature) = if let Some(existing) = existing {
        existing
    } else {
        // Retain the legacy schema and IDs. This creation-time observation is
        // not a transmission maximum and must never gate profile persistence.
        transaction
            .execute(
                "INSERT INTO shift_light_configs
                 (game_id, car_ordinal, car_class, car_performance_index, drivetrain_type,
                  num_cylinders, rpm_max, gear_count)
                 VALUES ('fh6', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    identity.car_ordinal,
                    identity.car_class,
                    identity.car_performance_index,
                    identity.drivetrain_type,
                    identity.num_cylinders,
                    identity.rpm_max,
                    observed_gear
                ],
            )
            .map_err(|error| {
                format!("unable to create current Shift Light configuration: {error}")
            })?;
        (transaction.last_insert_rowid(), String::new())
    };
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
        ratio_features: (!signature.is_empty()).then_some(signature),
    })
}

#[tauri::command]
fn get_latest_shift_light_config(app: AppHandle, key: String) -> Result<Option<i32>, String> {
    let identity = parse_shift_light_config_key(&key)?;
    let connection = open_shift_light_db(&app)?;
    connection
        .query_row(
            "SELECT gear_count FROM shift_light_configs
             WHERE game_id = 'fh6' AND car_ordinal = ?1 AND car_class = ?2
               AND car_performance_index = ?3 AND drivetrain_type = ?4
               AND num_cylinders = ?5 AND (?6 = 0 OR rpm_max = ?6)
             ORDER BY last_seen_at DESC, id DESC LIMIT 1",
            params![
                identity.car_ordinal,
                identity.car_class,
                identity.car_performance_index,
                identity.drivetrain_type,
                identity.num_cylinders,
                identity.rpm_max
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("unable to load latest Shift Light configuration: {error}"))
}

#[tauri::command]
fn register_shift_light_config(
    app: AppHandle,
    key: String,
    gear_count: i32,
    gearbox_signature: Option<String>,
) -> Result<ShiftLightVariantResolution, String> {
    if !(1..=10).contains(&gear_count) {
        return Err("invalid learned Shift Light gear count".to_string());
    }
    let identity = parse_shift_light_config_key(&key)?;
    let signature = gearbox_signature.unwrap_or_default();
    if signature.len() > 256 {
        return Err("invalid Shift Light gearbox signature".to_string());
    }
    parse_ratio_features(&signature)?;
    let mut connection = open_shift_light_db(&app)?;
    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Shift Light configuration transaction: {error}")
    })?;
    transaction
        .execute(
            "INSERT INTO shift_light_configs
           (game_id, car_ordinal, car_class, car_performance_index, drivetrain_type,
            num_cylinders, rpm_max, gear_count, gearbox_signature)
         VALUES ('fh6', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (game_id, car_ordinal, car_class, car_performance_index,
                      drivetrain_type, num_cylinders, rpm_max, gear_count)
         DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP",
            params![
                identity.car_ordinal,
                identity.car_class,
                identity.car_performance_index,
                identity.drivetrain_type,
                identity.num_cylinders,
                identity.rpm_max,
                gear_count,
                signature
            ],
        )
        .map_err(|error| format!("unable to register Shift Light configuration: {error}"))?;
    let (config_id, stored_signature): (i64, String) = transaction
        .query_row(
            "SELECT id, gearbox_signature FROM shift_light_configs
         WHERE game_id = 'fh6' AND car_ordinal = ?1 AND car_class = ?2
           AND car_performance_index = ?3 AND drivetrain_type = ?4
           AND num_cylinders = ?5 AND rpm_max = ?6 AND gear_count = ?7",
            params![
                identity.car_ordinal,
                identity.car_class,
                identity.car_performance_index,
                identity.drivetrain_type,
                identity.num_cylinders,
                identity.rpm_max,
                gear_count
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("unable to resolve Shift Light configuration: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light configuration: {error}"))?;
    Ok(ShiftLightVariantResolution {
        variant_id: config_id,
        status: "ready".to_string(),
        ratio_features: (!stored_signature.is_empty()).then_some(stored_signature),
    })
}

#[tauri::command]
fn load_shift_light_config_profiles(
    app: AppHandle,
    key: String,
    config_id: i64,
) -> Result<Vec<ShiftLightProfile>, String> {
    let connection = open_shift_light_db(&app)?;
    let (_, _, signature) = assert_shift_light_config_matches_key(&connection, config_id, &key)?;
    Ok(read_config_profiles(&connection, config_id)?
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
            gearbox_signature: (!signature.is_empty()).then_some(signature.clone()),
        })
        .collect())
}

#[tauri::command]
fn save_shift_light_config_profile(
    app: AppHandle,
    config_id: i64,
    profile: ShiftLightProfile,
) -> Result<(), String> {
    if !(1..=10).contains(&profile.gear)
        || profile.shift_rpm.is_some_and(|rpm| rpm < 0)
        || profile.sample_count < 0
        || profile.samples.len() > MAX_SHIFT_LIGHT_SAMPLES
        || profile.samples.iter().any(|sample| *sample < 0)
        || !["learning", "confirming", "optimal", "calibrated"].contains(&profile.status.as_str())
        || !["none", "observed", "optimal"].contains(&profile.method.as_str())
    {
        return Err("invalid Shift Light configuration profile".to_string());
    }
    let mut connection = open_shift_light_db(&app)?;
    assert_shift_light_config_matches_key(&connection, config_id, &profile.key)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light configuration save: {error}"))?;
    let incoming = StoredShiftLightProfile {
        gear: profile.gear,
        status: profile.status,
        shift_rpm: profile.shift_rpm,
        sample_count: profile.sample_count,
        method: profile.method,
        ratio_drop: profile.ratio_drop,
        samples: profile.samples,
    };
    let existing = read_config_profiles(&transaction, config_id)?
        .into_iter()
        .find(|stored| stored.gear == incoming.gear);
    let merged = existing
        .as_ref()
        .map(|stored| merge_active_config_profiles(stored, &incoming))
        .unwrap_or(incoming);
    write_config_profile(&transaction, config_id, &merged)?;
    transaction
        .execute(
            "UPDATE shift_light_configs SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![config_id],
        )
        .map_err(|error| format!("unable to update Shift Light configuration: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light configuration profile: {error}"))
}

fn state_model_version(state: &serde_json::Value) -> Result<i32, String> {
    let model_version = state
        .get("modelVersion")
        .or_else(|| state.get("version"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(SHIFT_LIGHT_LEARNING_MODEL_VERSION as i64);
    if model_version != SHIFT_LIGHT_LEARNING_MODEL_VERSION as i64 {
        return Err("incompatible Shift Light learning model version".to_string());
    }
    Ok(model_version as i32)
}

fn json_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    value
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite())
}

fn json_i32(value: Option<&serde_json::Value>) -> Option<i32> {
    value
        .and_then(|value| value.as_i64())
        .and_then(|value| i32::try_from(value).ok())
}

fn json_i64(value: Option<&serde_json::Value>) -> Option<i64> {
    value.and_then(serde_json::Value::as_i64)
}

fn state_array<'a>(
    state: &'a serde_json::Value,
    names: &[&str],
) -> Option<&'a Vec<serde_json::Value>> {
    names.iter().find_map(|name| state.get(*name)?.as_array())
}

fn materialize_learning_state(
    transaction: &Transaction<'_>,
    config_id: i64,
    state: &serde_json::Value,
    model_version: i32,
) -> Result<(), String> {
    let gear_states = state_array(state, &["gears", "gearStates", "perGear"]);
    transaction
        .execute(
            "DELETE FROM shift_light_gear_learning WHERE config_id = ?1",
            params![config_id],
        )
        .and_then(|_| {
            transaction.execute(
                "DELETE FROM shift_light_power_bins WHERE config_id = ?1",
                params![config_id],
            )
        })
        .and_then(|_| {
            transaction.execute(
                "DELETE FROM shift_light_shift_evidence WHERE config_id = ?1",
                params![config_id],
            )
        })
        .map_err(|error| format!("unable to replace Shift Light learning facts: {error}"))?;
    let Some(gear_states) = gear_states else {
        return Ok(());
    };
    let mut power_count = 0usize;
    let mut evidence_count = 0usize;
    for gear_state in gear_states {
        let Some(gear) = json_i32(
            gear_state
                .get("gear")
                .or_else(|| gear_state.get("sourceGear")),
        ) else {
            continue;
        };
        if !(1..=10).contains(&gear) {
            continue;
        }
        let status = gear_state
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("learning");
        let status = match status {
            "learning" | "confirming" | "optimal" => status,
            _ => "learning",
        };
        transaction
            .execute(
                "INSERT INTO shift_light_gear_learning
                   (config_id, source_gear, status, target_rpm, candidate_rpm,
                    confirming_count, last_reason, model_version, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
                 ON CONFLICT (config_id, source_gear) DO UPDATE SET
                   status = excluded.status,
                   target_rpm = excluded.target_rpm,
                   candidate_rpm = excluded.candidate_rpm,
                   confirming_count = excluded.confirming_count,
                   last_reason = excluded.last_reason,
                   model_version = excluded.model_version,
                   updated_at = CURRENT_TIMESTAMP",
                params![
                    config_id,
                    gear,
                    status,
                    json_f64(gear_state.get("targetRpm")),
                    json_f64(gear_state.get("candidateRpm")),
                    json_i32(gear_state.get("confirmingCount"))
                        .unwrap_or(0)
                        .max(0),
                    gear_state
                        .get("lastReason")
                        .and_then(serde_json::Value::as_str),
                    model_version
                ],
            )
            .map_err(|error| format!("unable to save Shift Light gear state: {error}"))?;
        if let Some(power_bins) = state_array(gear_state, &["powerBins", "power_bins"]) {
            for bin in power_bins
                .iter()
                .take(MAX_SHIFT_LIGHT_POWER_BINS - power_count)
            {
                let Some(rpm_bucket) = json_i32(
                    bin.get("rpmBucket")
                        .or_else(|| bin.get("rpm"))
                        .or_else(|| bin.get("rpmMin")),
                ) else {
                    continue;
                };
                let sample_count = json_i32(bin.get("sampleCount")).unwrap_or(1).max(0);
                let power_sum = json_f64(bin.get("powerSum"))
                    .or_else(|| {
                        json_f64(bin.get("medianPower")).map(|value| value * sample_count as f64)
                    })
                    .or_else(|| json_f64(bin.get("power")))
                    .unwrap_or(0.0);
                if !power_sum.is_finite() {
                    continue;
                }
                let power = power_sum / sample_count.max(1) as f64;
                let torque_sum = json_f64(bin.get("torqueSum"))
                    .or_else(|| {
                        json_f64(bin.get("medianTorque")).map(|value| value * sample_count as f64)
                    })
                    .or_else(|| json_f64(bin.get("torque")))
                    .unwrap_or(0.0);
                let torque_sample_count = json_i32(bin.get("torqueSampleCount"))
                    .unwrap_or(if torque_sum != 0.0 { sample_count } else { 0 })
                    .max(0);
                let speed_sum = json_f64(bin.get("speedSum")).unwrap_or(0.0);
                let speed_sample_count = json_i32(bin.get("speedSampleCount"))
                    .unwrap_or(if speed_sum != 0.0 { sample_count } else { 0 })
                    .max(0);
                let torque =
                    (torque_sample_count > 0).then_some(torque_sum / torque_sample_count as f64);
                transaction
                    .execute(
                        "INSERT INTO shift_light_power_bins
                           (config_id, source_gear, rpm_bucket, sample_count,
                            power_sum, median_power, torque_sum, torque_sample_count,
                            speed_sum, speed_sample_count, median_torque, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, CURRENT_TIMESTAMP)
                         ON CONFLICT (config_id, source_gear, rpm_bucket) DO UPDATE SET
                           sample_count = excluded.sample_count,
                           power_sum = excluded.power_sum,
                           median_power = excluded.median_power,
                           torque_sum = excluded.torque_sum,
                           torque_sample_count = excluded.torque_sample_count,
                           speed_sum = excluded.speed_sum,
                           speed_sample_count = excluded.speed_sample_count,
                           median_torque = excluded.median_torque,
                           updated_at = CURRENT_TIMESTAMP",
                        params![
                            config_id,
                            gear,
                            rpm_bucket,
                            sample_count,
                            power_sum,
                            power,
                            torque_sum,
                            torque_sample_count,
                            speed_sum,
                            speed_sample_count,
                            torque
                        ],
                    )
                    .map_err(|error| format!("unable to save Shift Light power bin: {error}"))?;
                power_count += 1;
                if power_count >= MAX_SHIFT_LIGHT_POWER_BINS {
                    break;
                }
            }
        }
        let evidence = state_array(gear_state, &["shiftEvidence", "evidence"]);
        if let Some(evidence) = evidence {
            for item in evidence
                .iter()
                .take(MAX_SHIFT_LIGHT_SHIFT_EVIDENCE - evidence_count)
            {
                let Some(destination_gear) =
                    json_i32(item.get("destinationGear").or_else(|| item.get("toGear")))
                else {
                    continue;
                };
                if !(1..=10).contains(&destination_gear) {
                    continue;
                }
                let outcome = item
                    .get("outcome")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("invalid");
                if !["better", "too_early", "invalid"].contains(&outcome) {
                    continue;
                }
                let before_rpm = json_f64(item.get("beforeRpm")).unwrap_or(0.0);
                let after_rpm = json_f64(item.get("afterRpm")).unwrap_or(0.0);
                if before_rpm <= 0.0 || after_rpm <= 0.0 {
                    continue;
                }
                transaction
                    .execute(
                        "INSERT INTO shift_light_shift_evidence
                           (config_id, source_gear, destination_gear, before_rpm,
                            before_timestamp_ms, after_timestamp_ms, before_power,
                            before_speed, after_rpm, after_power, after_speed,
                            outcome, reason, model_version)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                        params![
                            config_id,
                            gear,
                            destination_gear,
                            before_rpm,
                            json_i64(item.get("beforeTimestampMs")),
                            json_i64(item.get("afterTimestampMs")),
                            json_f64(item.get("beforePower")),
                            json_f64(
                                item.get("beforeSpeedKmh")
                                    .or_else(|| item.get("beforeSpeed"))
                            ),
                            after_rpm,
                            json_f64(item.get("afterPower")),
                            json_f64(item.get("afterSpeedKmh").or_else(|| item.get("afterSpeed"))),
                            outcome,
                            item.get("reason").and_then(serde_json::Value::as_str),
                            model_version
                        ],
                    )
                    .map_err(|error| {
                        format!("unable to save Shift Light shift evidence: {error}")
                    })?;
                evidence_count += 1;
                if evidence_count >= MAX_SHIFT_LIGHT_SHIFT_EVIDENCE {
                    break;
                }
            }
        }
        if power_count >= MAX_SHIFT_LIGHT_POWER_BINS
            && evidence_count >= MAX_SHIFT_LIGHT_SHIFT_EVIDENCE
        {
            break;
        }
    }
    Ok(())
}

#[tauri::command]
fn load_shift_light_learning_state(
    app: AppHandle,
    key: String,
    config_id: i64,
) -> Result<Option<serde_json::Value>, String> {
    let connection = open_shift_light_db(&app)?;
    assert_shift_light_config_matches_key(&connection, config_id, &key)?;
    connection
        .query_row(
            "SELECT state_json FROM shift_light_learning_state WHERE config_id = ?1",
            params![config_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("unable to load Shift Light learning state: {error}"))?
        .map(|state| {
            serde_json::from_str(&state)
                .map_err(|error| format!("unable to decode Shift Light learning state: {error}"))
        })
        .transpose()
}

#[tauri::command]
fn save_shift_light_learning_state(
    app: AppHandle,
    request: ShiftLightLearningStateRequest,
) -> Result<(), String> {
    if request.config_id < 1 || !request.state.is_object() {
        return Err("invalid Shift Light learning state".to_string());
    }
    if request.state.get("key").and_then(serde_json::Value::as_str) != Some(request.key.as_str()) {
        return Err("Shift Light learning state does not match its key".to_string());
    }
    let state_json = serde_json::to_string(&request.state)
        .map_err(|error| format!("unable to encode Shift Light learning state: {error}"))?;
    if state_json.len() > MAX_SHIFT_LIGHT_LEARNING_STATE_BYTES {
        return Err("Shift Light learning state exceeds the storage limit".to_string());
    }
    let model_version = state_model_version(&request.state)?;
    let mut connection = open_shift_light_db(&app)?;
    assert_shift_light_config_matches_key(&connection, request.config_id, &request.key)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light learning save: {error}"))?;
    transaction
        .execute(
            "INSERT INTO shift_light_learning_state
               (config_id, model_version, state_json, updated_at)
             VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
             ON CONFLICT (config_id) DO UPDATE SET
               model_version = excluded.model_version,
               state_json = excluded.state_json,
               updated_at = CURRENT_TIMESTAMP",
            params![request.config_id, model_version, state_json],
        )
        .map_err(|error| format!("unable to save Shift Light learning state: {error}"))?;
    materialize_learning_state(
        &transaction,
        request.config_id,
        &request.state,
        model_version,
    )?;
    transaction
        .execute(
            "UPDATE shift_light_configs SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![request.config_id],
        )
        .map_err(|error| {
            format!("unable to update Shift Light configuration timestamp: {error}")
        })?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Shift Light learning state: {error}"))
}

#[tauri::command]
fn clear_shift_light_config(
    app: AppHandle,
    config_id: i64,
    gearbox_signature: Option<String>,
) -> Result<(), String> {
    let signature = gearbox_signature.unwrap_or_default();
    parse_ratio_features(&signature)?;
    let mut connection = open_shift_light_db(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Shift Light configuration clear: {error}"))?;
    transaction
        .execute(
            "DELETE FROM shift_light_config_profiles WHERE config_id = ?1",
            params![config_id],
        )
        .map_err(|error| format!("unable to clear Shift Light configuration profiles: {error}"))?;
    for table in [
        "shift_light_learning_state",
        "shift_light_gear_learning",
        "shift_light_power_bins",
        "shift_light_shift_evidence",
    ] {
        transaction
            .execute(
                &format!("DELETE FROM {table} WHERE config_id = ?1"),
                params![config_id],
            )
            .map_err(|error| format!("unable to clear Shift Light learning data: {error}"))?;
    }
    transaction.execute("UPDATE shift_light_configs SET gearbox_signature = ?1, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?2", params![signature, config_id])
        .map_err(|error| format!("unable to update Shift Light configuration signature: {error}"))?;
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
            load_shift_light_profiles,
            save_shift_light_profile,
            register_shift_light_variant,
            reset_shift_light_profiles,
            get_latest_shift_light_config,
            resolve_shift_light_config,
            register_shift_light_config,
            load_shift_light_config_profiles,
            save_shift_light_config_profile,
            load_shift_light_learning_state,
            save_shift_light_learning_state,
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
        assert_eq!(version, 12);
        for table in [
            "shift_light_cars",
            "shift_light_variants",
            "shift_light_profiles",
            "shift_light_profile_samples",
            "shift_light_configs",
            "shift_light_config_profiles",
            "shift_light_config_profile_samples",
            "garage_cars",
            "garage_variants",
            "garage_sequence",
            "events",
            "event_runs",
            "event_run_laps",
            "event_run_lap_trace_points",
        ] {
            assert!(table_exists(&connection, table).unwrap(), "missing {table}");
        }
    }

    #[test]
    fn v12_deletes_legacy_shift_light_data_without_touching_garage_or_events() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let vehicle = GarageVehicle {
            ordinal: 3766,
            class: 1,
            pi: 800,
            car_group: 43,
            drivetrain: 1,
            cylinders: 10,
        };
        record_garage_vehicle_in_connection(&mut connection, &vehicle).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Keep me", "S1", "Asphalt", "Official", None),
        )
        .unwrap();
        let config =
            resolve_shift_light_config_in_connection(&mut connection, "fh6:3766:1:800:1:10", 1)
                .unwrap();
        write_config_profile(
            &connection,
            config.variant_id,
            &StoredShiftLightProfile {
                gear: 1,
                status: "calibrated".to_string(),
                shift_rpm: Some(9500),
                sample_count: 5,
                method: "observed".to_string(),
                ratio_drop: None,
                samples: vec![9500; 5],
            },
        )
        .unwrap();
        connection
            .execute("UPDATE hud_schema_version SET version = 11", [])
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM shift_light_configs", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM shift_light_config_profiles",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            load_garage_snapshot_from_connection(&connection)
                .unwrap()
                .cars
                .len(),
            1
        );
        assert_eq!(
            load_event_from_connection(&connection, event.id)
                .unwrap()
                .name,
            "Keep me"
        );
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
        create_shift_light_tables(&connection).unwrap();
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
        connection
            .execute(
                "INSERT INTO shift_light_cars (game_id, car_ordinal)
                 VALUES ('fh6', 260)",
                [],
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 12);
        assert!(table_exists(&connection, "events").unwrap());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM garage_cars", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM shift_light_cars", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
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
        assert_eq!(version, 12);
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
    #[ignore = "v12 intentionally deletes legacy Shift Light learner data"]
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
    fn shift_light_resolution_preserves_342_profiles_above_legacy_gear_count() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        connection
            .execute_batch(
                "INSERT INTO shift_light_configs
             (id, game_id, car_ordinal, car_class, car_performance_index,
              drivetrain_type, num_cylinders, rpm_max, gear_count, last_seen_at)
             VALUES (3, 'fh6', 342, 3, 678, 1, 12, 9500, 2, '2000-08-31 18:49:42'),
                    (4, 'fh6', 342, 3, 678, 1, 12, 9500, 1, '2000-09-05 14:36:57');",
            )
            .unwrap();
        let profile = StoredShiftLightProfile {
            gear: 6,
            status: "calibrated".to_string(),
            shift_rpm: Some(8602),
            sample_count: 5,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8677; 5],
        };
        write_config_profile(&connection, 4, &profile).unwrap();
        for gear in [3, 6, 1, 10] {
            let resolution = resolve_shift_light_config_in_connection(
                &mut connection,
                "fh6:342:3:678:1:12:9500",
                gear,
            )
            .unwrap();
            assert_eq!(resolution.variant_id, 4);
        }
        let profiles = read_config_profiles(&connection, 4).unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].shift_rpm, Some(8602));
        assert_eq!(profiles[0].samples, profile.samples);
        let count: i64 = connection
            .query_row("SELECT count(*) FROM shift_light_configs", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
        assert!(
            connection
                .prepare("PRAGMA foreign_key_check")
                .unwrap()
                .query([])
                .unwrap()
                .next()
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn shift_light_resolution_saves_before_limiter_and_preserves_schema_and_identity() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let key = "fh6:342:3:678:1:12:9500";
        let first = resolve_shift_light_config_in_connection(&mut connection, key, 1).unwrap();
        write_config_profile(
            &connection,
            first.variant_id,
            &StoredShiftLightProfile {
                gear: 3,
                status: "learning".to_string(),
                shift_rpm: None,
                sample_count: 1,
                method: "observed".to_string(),
                ratio_drop: None,
                samples: vec![8500],
            },
        )
        .unwrap();
        // Schema initialization on a later open must not reinterpret or delete
        // profiles whose gear exceeds the old creation-time count field.
        initialize_shift_light_schema(&mut connection).unwrap();
        let next = resolve_shift_light_config_in_connection(&mut connection, key, 6).unwrap();
        assert_eq!(first.variant_id, next.variant_id);
        assert_eq!(
            read_config_profiles(&connection, next.variant_id).unwrap()[0].samples,
            vec![8500]
        );
        for other_key in [
            "fh6:342:3:678:2:12:9500",
            "fh6:342:3:679:1:12:9500",
            "fh6:342:4:678:1:12:9500",
            "fh6:342:3:678:1:8:9500",
            "fh6:342:3:678:1:12:9000",
            "fh6:343:3:678:1:12:9500",
        ] {
            let other =
                resolve_shift_light_config_in_connection(&mut connection, other_key, 1).unwrap();
            assert_ne!(first.variant_id, other.variant_id);
        }
        for gear in [0, 11, -1] {
            assert!(resolve_shift_light_config_in_connection(&mut connection, key, gear).is_err());
        }
    }

    #[test]
    #[ignore = "v12 intentionally deletes legacy Shift Light learner data"]
    fn garage_variant_summarizes_shift_light_configurations() {
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
                "INSERT INTO shift_light_configs
                   (game_id, car_ordinal, car_class, car_performance_index, drivetrain_type,
                    num_cylinders, rpm_max, gear_count, gearbox_signature)
                 VALUES ('fh6', 260, 8, 600, 1, 4, 8500, 10, '2:0.8000')",
                [],
            )
            .unwrap();
        let config_id = connection.last_insert_rowid();
        write_config_profile(
            &connection,
            config_id,
            &StoredShiftLightProfile {
                gear: 2,
                status: "calibrated".to_string(),
                shift_rpm: Some(7800),
                sample_count: 5,
                method: "observed".to_string(),
                ratio_drop: Some(0.8),
                samples: vec![7800; 5],
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
        assert_eq!(version, 12);
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
        assert_eq!(version, 12);
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
        assert_eq!(version, 12);
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
    #[ignore = "v12 intentionally deletes legacy Shift Light learner data"]
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
    fn active_config_merge_keeps_duplicate_cumulative_observations() {
        let existing = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 1,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8000],
        };
        let incoming = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 2,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8000, 8000],
        };

        let merged = merge_active_config_profiles(&existing, &incoming);

        assert_eq!(merged.shift_rpm, None);
        assert_eq!(merged.sample_count, 2);
        assert_eq!(merged.samples, vec![8000, 8000]);
    }

    #[test]
    fn active_config_merge_accepts_newer_valid_same_method_target() {
        let existing = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(8200),
            sample_count: 5,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8275, 8275, 8275, 8275, 8275],
        };
        let incoming = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7600),
            sample_count: 1,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7675],
        };

        let merged = merge_active_config_profiles(&existing, &incoming);

        assert_eq!(merged.shift_rpm, Some(7600));
        assert_eq!(merged.samples, vec![7675]);
        assert_eq!(merged.sample_count, 1);
    }

    #[test]
    fn active_config_merge_preserves_optimal_target_over_observed_downgrade() {
        let existing = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7800),
            sample_count: 40,
            method: "optimal".to_string(),
            ratio_drop: Some(0.8),
            samples: Vec::new(),
        };
        let incoming = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7400),
            sample_count: 1,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![7475],
        };

        let merged = merge_active_config_profiles(&existing, &incoming);

        assert_eq!(merged.method, "optimal");
        assert_eq!(merged.shift_rpm, Some(7800));
        assert!(merged.samples.is_empty());
    }

    #[test]
    fn active_config_merge_accepts_newer_optimal_target_without_old_evidence_count() {
        let existing = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7800),
            sample_count: 40,
            method: "optimal".to_string(),
            ratio_drop: Some(0.8),
            samples: Vec::new(),
        };
        let incoming = StoredShiftLightProfile {
            gear: 2,
            status: "calibrated".to_string(),
            shift_rpm: Some(7400),
            sample_count: 1,
            method: "optimal".to_string(),
            ratio_drop: Some(0.7),
            samples: vec![7475],
        };

        let merged = merge_active_config_profiles(&existing, &incoming);

        assert_eq!(merged.shift_rpm, Some(7400));
        assert_eq!(merged.sample_count, 1);
        assert_eq!(merged.samples, vec![7475]);
    }

    #[test]
    fn active_config_merge_keeps_stronger_partial_prefix_when_retry_is_older() {
        let existing = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 2,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8000, 8000],
        };
        let incoming = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 1,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8000],
        };

        let merged = merge_active_config_profiles(&existing, &incoming);

        assert_eq!(merged.sample_count, 2);
        assert_eq!(merged.samples, vec![8000, 8000]);
    }

    #[test]
    fn active_config_round_trip_preserves_partial_profile_and_duplicate_samples() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let config_id =
            resolve_shift_light_config_in_connection(&mut connection, "fh6:260:4:800:1:8:8000", 2)
                .unwrap()
                .variant_id;
        let profile = StoredShiftLightProfile {
            gear: 2,
            status: "learning".to_string(),
            shift_rpm: None,
            sample_count: 2,
            method: "observed".to_string(),
            ratio_drop: None,
            samples: vec![8000, 8000],
        };

        write_config_profile(&connection, config_id, &profile).unwrap();
        let loaded = read_config_profiles(&connection, config_id).unwrap();

        assert_eq!(loaded[0].status, "learning");
        assert_eq!(loaded[0].shift_rpm, None);
        assert_eq!(loaded[0].sample_count, 2);
        assert_eq!(loaded[0].samples, vec![8000, 8000]);
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
    #[ignore = "v12 intentionally deletes legacy Shift Light learner data"]
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
