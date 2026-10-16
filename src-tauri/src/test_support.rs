//! Test fixtures shared by Rust test modules that live in more than one feature file.

use rusqlite::Connection;

use crate::*;

pub(crate) fn test_event(
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

pub(crate) fn test_event_run(
    event_id: i64,
    run_type: &str,
    result: &str,
    result_time_ms: Option<i64>,
    laps: Vec<EventRunLapInput>,
) -> NewEventRun {
    NewEventRun {
        event_id,
        car_ordinal: 260,
        car_class: 8,
        car_pi: 700,
        drivetrain: 2,
        started_at: "2026-08-30T12:00:00Z".to_string(),
        run_type: run_type.to_string(),
        result: result.to_string(),
        result_time_ms,
        result_time_approximate: None,
        laps,
    }
}

pub(crate) fn driver_analysis_session_input(started_at_ms: i64) -> DriverAnalysisSessionInput {
    DriverAnalysisSessionInput {
        algorithm_version: "driver-analysis-rules-v2".to_string(),
        vehicle_identity: serde_json::json!({ "ordinal": 3766, "pi": 800 }),
        started_at_ms,
        vehicle_ordinal: Some(3766),
        vehicle_pi: Some(800),
        vehicle_drivetrain: Some(1),
        vehicle_rpm_limit: Some(10_300.0),
        recording_id: None,
    }
}

pub(crate) fn driver_analysis_connection() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_shift_light_schema(&mut connection).unwrap();
    connection
}

pub(crate) fn hud_bounds(left: f64, top: f64, width: f64, height: f64) -> HudWindowBounds {
    HudWindowBounds {
        left,
        top,
        width,
        height,
    }
}
