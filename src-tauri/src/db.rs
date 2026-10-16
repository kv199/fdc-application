//! Shared SQLite base for the FDC-local `fdc.sqlite`: schema creation, migrations, and the
//! Shift Light connection opener that every feature module reuses.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::Duration,
};

use rusqlite::{Connection, Transaction, params};
use tauri::{AppHandle, Manager, Runtime};

const HUD_SCHEMA_VERSION: i32 = 23;

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
               deleted_at TEXT,
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

fn migrate_event_soft_delete_schema(connection: &mut Connection) -> Result<(), String> {
    let has_deleted_at = table_has_column(connection, "events", "deleted_at")?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Event soft-delete schema migration: {error}"))?;
    if !has_deleted_at {
        transaction
            .execute("ALTER TABLE events ADD COLUMN deleted_at TEXT", [])
            .map_err(|error| format!("unable to add Event soft-delete data: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![HUD_SCHEMA_VERSION],
        )
        .map_err(|error| format!("unable to update Event soft-delete schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Event soft-delete schema migration: {error}"))
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

const DRIVER_ANALYSIS_SCHEMA_VERSION: i32 = 19;

const DRIVER_ANALYSIS_INITIAL_SCHEMA_VERSION: i32 = 17;

const DRIVER_ANALYSIS_RESULTS_SCHEMA_VERSION: i32 = 18;

fn create_driver_analysis_tables(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS driver_analysis_sessions (
               id INTEGER PRIMARY KEY,
               legacy_id TEXT UNIQUE,
               started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
               finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= started_at_ms),
               status TEXT NOT NULL CHECK (status IN ('recording', 'completed', 'insufficient', 'interrupted', 'error')),
               result TEXT CHECK (result IS NULL OR result IN ('issue', 'insufficient', 'ambiguous', 'no_recurring_problem', 'interrupted')),
               main_kind TEXT,
               label TEXT NOT NULL DEFAULT '',
               instruction TEXT NOT NULL DEFAULT '',
               sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
               maneuver_count INTEGER NOT NULL DEFAULT 0 CHECK (maneuver_count >= 0),
               opportunity_count INTEGER NOT NULL DEFAULT 0 CHECK (opportunity_count >= 0),
               evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
               detector_confidence REAL CHECK (detector_confidence IS NULL OR detector_confidence BETWEEN 0 AND 1),
               attribution_confidence REAL CHECK (attribution_confidence IS NULL OR attribution_confidence BETWEEN 0 AND 1),
               severity REAL CHECK (severity IS NULL OR severity BETWEEN 0 AND 1),
               storage_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
               algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
               vehicle_identity TEXT NOT NULL CHECK (length(trim(vehicle_identity)) > 0),
               vehicle_ordinal INTEGER,
               vehicle_pi INTEGER,
               vehicle_drivetrain INTEGER,
               vehicle_rpm_limit REAL,
               stats_json TEXT,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE INDEX IF NOT EXISTS idx_driver_analysis_sessions_newest
               ON driver_analysis_sessions(started_at_ms DESC, id DESC);
             CREATE TABLE IF NOT EXISTS driver_analysis_samples (
               id INTEGER PRIMARY KEY,
               session_id INTEGER NOT NULL,
               sequence INTEGER NOT NULL CHECK (sequence >= 0),
               timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
               speed_kmh REAL NOT NULL,
               throttle REAL NOT NULL,
               brake REAL NOT NULL,
               steer REAL NOT NULL,
               gear INTEGER NOT NULL,
               rpm REAL NOT NULL,
               rpm_max REAL NOT NULL,
               acceleration_x REAL NOT NULL,
               acceleration_y REAL NOT NULL,
               acceleration_z REAL NOT NULL,
               yaw_rate REAL NOT NULL,
               slip_ratio_fl REAL NOT NULL,
               slip_ratio_fr REAL NOT NULL,
               slip_ratio_rl REAL NOT NULL,
               slip_ratio_rr REAL NOT NULL,
               slip_angle_fl REAL NOT NULL,
               slip_angle_fr REAL NOT NULL,
               slip_angle_rl REAL NOT NULL,
               slip_angle_rr REAL NOT NULL,
               combined_slip_fl REAL NOT NULL,
               combined_slip_fr REAL NOT NULL,
               combined_slip_rl REAL NOT NULL,
               combined_slip_rr REAL NOT NULL,
               tire_temp_fl REAL NOT NULL,
               tire_temp_fr REAL NOT NULL,
               tire_temp_rl REAL NOT NULL,
               tire_temp_rr REAL NOT NULL,
               suspension_fl REAL NOT NULL,
               suspension_fr REAL NOT NULL,
               suspension_rl REAL NOT NULL,
               suspension_rr REAL NOT NULL,
               rumble_fl INTEGER NOT NULL CHECK (rumble_fl IN (0, 1)),
               rumble_fr INTEGER NOT NULL CHECK (rumble_fr IN (0, 1)),
               rumble_rl INTEGER NOT NULL CHECK (rumble_rl IN (0, 1)),
               rumble_rr INTEGER NOT NULL CHECK (rumble_rr IN (0, 1)),
               puddle_fl REAL NOT NULL,
               puddle_fr REAL NOT NULL,
               puddle_rl REAL NOT NULL,
               puddle_rr REAL NOT NULL,
               lap_time REAL NOT NULL,
               lap_number INTEGER NOT NULL,
               lap_distance REAL NOT NULL,
               UNIQUE (session_id, sequence),
               FOREIGN KEY (session_id) REFERENCES driver_analysis_sessions(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_driver_analysis_samples_session
               ON driver_analysis_samples(session_id, sequence);
             CREATE TABLE IF NOT EXISTS driver_analysis_opportunities (
               id INTEGER PRIMARY KEY,
               session_id INTEGER NOT NULL,
               maneuver_id TEXT NOT NULL,
               opportunity_type TEXT NOT NULL CHECK (length(trim(opportunity_type)) > 0),
               started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
               finished_at_ms INTEGER NOT NULL CHECK (finished_at_ms >= started_at_ms),
               speed_bin INTEGER,
               gear INTEGER,
               outcome TEXT NOT NULL CHECK (outcome IN ('clean', 'problem', 'ambiguous', 'incomplete')),
               valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
               invalid_reason TEXT,
               context_json TEXT NOT NULL DEFAULT '{}',
               FOREIGN KEY (session_id) REFERENCES driver_analysis_sessions(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_driver_analysis_opportunities_session
               ON driver_analysis_opportunities(session_id, id);
             CREATE TABLE IF NOT EXISTS driver_analysis_evidence (
               id INTEGER PRIMARY KEY,
               opportunity_id INTEGER NOT NULL,
               problem_type TEXT NOT NULL CHECK (length(trim(problem_type)) > 0),
               is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
               detector_confidence REAL NOT NULL CHECK (detector_confidence BETWEEN 0 AND 1),
               attribution_confidence REAL NOT NULL CHECK (attribution_confidence BETWEEN 0 AND 1),
               severity REAL NOT NULL CHECK (severity BETWEEN 0 AND 1),
               metrics_json TEXT NOT NULL DEFAULT '{}',
               FOREIGN KEY (opportunity_id) REFERENCES driver_analysis_opportunities(id) ON DELETE CASCADE
             );
             CREATE INDEX IF NOT EXISTS idx_driver_analysis_evidence_opportunity
               ON driver_analysis_evidence(opportunity_id, id);",
        )
        .map_err(|error| format!("unable to create Driver Analysis schema: {error}"))
}

fn migrate_driver_analysis_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Driver Analysis schema migration: {error}"))?;
    create_driver_analysis_tables(&transaction)?;
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![DRIVER_ANALYSIS_SCHEMA_VERSION],
        )
        .map_err(|error| format!("unable to update Driver Analysis schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis schema migration: {error}"))
}

fn migrate_driver_analysis_v18(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Driver Analysis v18 migration: {error}"))?;
    transaction
        .execute_batch(
            "ALTER TABLE driver_analysis_sessions
               ADD COLUMN result_v18 TEXT
               CHECK (result_v18 IS NULL OR result_v18 IN ('issue', 'insufficient', 'ambiguous', 'no_recurring_problem', 'interrupted'));
             UPDATE driver_analysis_sessions SET result_v18 = result;
             ALTER TABLE driver_analysis_sessions DROP COLUMN result;
             ALTER TABLE driver_analysis_sessions RENAME COLUMN result_v18 TO result;",
        )
        .map_err(|error| format!("unable to extend Driver Analysis results: {error}"))?;
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![DRIVER_ANALYSIS_SCHEMA_VERSION],
        )
        .map_err(|error| format!("unable to update Driver Analysis v18 schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis v18 migration: {error}"))
}

fn migrate_driver_analysis_stats(connection: &mut Connection) -> Result<(), String> {
    let has_stats = table_has_column(connection, "driver_analysis_sessions", "stats_json")?;
    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Driver Analysis statistics migration: {error}")
    })?;
    if !has_stats {
        transaction
            .execute(
                "ALTER TABLE driver_analysis_sessions ADD COLUMN stats_json TEXT",
                [],
            )
            .map_err(|error| format!("unable to add Driver Analysis statistics: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![DRIVER_ANALYSIS_SCHEMA_VERSION],
        )
        .map_err(|error| {
            format!("unable to update Driver Analysis statistics schema version: {error}")
        })?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis statistics migration: {error}"))
}

fn migrate_driver_analysis_recordings(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Driver Analysis recordings migration: {error}")
    })?;

    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS driver_analysis_recordings (
               id INTEGER PRIMARY KEY,
               started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS driver_analysis_drives (
               id INTEGER PRIMARY KEY,
               session_id INTEGER NOT NULL REFERENCES driver_analysis_sessions(id) ON DELETE CASCADE,
               drive_index INTEGER NOT NULL CHECK (drive_index >= 0),
               kind TEXT NOT NULL CHECK (kind IN ('circuit','sprint')),
               finished INTEGER NOT NULL CHECK (finished IN (0,1)),
               lap_count INTEGER CHECK (lap_count IS NULL OR lap_count >= 1),
               first_sequence INTEGER NOT NULL CHECK (first_sequence >= 0),
               last_sequence INTEGER NOT NULL CHECK (last_sequence >= first_sequence),
               started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
               finished_at_ms INTEGER NOT NULL CHECK (finished_at_ms >= started_at_ms),
               started_wall_ms INTEGER NOT NULL CHECK (started_wall_ms >= 0),
               distance_m REAL NOT NULL CHECK (distance_m >= 0),
               UNIQUE (session_id, drive_index)
             );
             CREATE INDEX IF NOT EXISTS idx_driver_analysis_drives_session
               ON driver_analysis_drives(session_id, drive_index);",
        )
        .map_err(|error| format!("unable to create Driver Analysis recording tables: {error}"))?;

    for (table, column, definition) in [
        ("driver_analysis_sessions", "recording_id", "INTEGER"),
        (
            "driver_analysis_sessions",
            "drives_recorded",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("driver_analysis_samples", "position_x", "REAL"),
        ("driver_analysis_samples", "position_y", "REAL"),
        ("driver_analysis_samples", "position_z", "REAL"),
    ] {
        // Partial databases from early development versions can lack a table; there is nothing to extend then.
        let table_exists: bool = transaction
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .map_err(|error| format!("unable to inspect Driver Analysis {table}: {error}"))?;
        if table_exists && !table_has_column(&transaction, table, column)? {
            transaction
                .execute(
                    &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|error| format!("unable to add Driver Analysis {column} data: {error}"))?;
        }
    }

    // Every earlier session becomes its own recording.
    let started_column =
        if table_has_column(&transaction, "driver_analysis_sessions", "started_at_ms")? {
            "started_at_ms"
        } else {
            "0"
        };
    let unlinked = {
        let mut statement = transaction
            .prepare(&format!(
                "SELECT id, {started_column} FROM driver_analysis_sessions
                 WHERE recording_id IS NULL ORDER BY id"
            ))
            .map_err(|error| {
                format!("unable to read unlinked Driver Analysis sessions: {error}")
            })?;
        statement
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|error| format!("unable to read unlinked Driver Analysis sessions: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("unable to read unlinked Driver Analysis sessions: {error}"))?
    };
    for (session_id, started_at_ms) in unlinked {
        transaction
            .execute(
                "INSERT INTO driver_analysis_recordings (started_at_ms) VALUES (?1)",
                params![started_at_ms.max(0)],
            )
            .map_err(|error| format!("unable to create Driver Analysis recording: {error}"))?;
        transaction
            .execute(
                "UPDATE driver_analysis_sessions SET recording_id = ?1 WHERE id = ?2",
                params![transaction.last_insert_rowid(), session_id],
            )
            .map_err(|error| format!("unable to link Driver Analysis session: {error}"))?;
    }

    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![HUD_SCHEMA_VERSION],
        )
        .map_err(|error| {
            format!("unable to update Driver Analysis recordings schema version: {error}")
        })?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis recordings migration: {error}"))
}

// Schema version 22 records which FDC version made each session; earlier sessions keep NULL.
fn migrate_driver_analysis_app_version(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("unable to start Driver Analysis version migration: {error}"))?;
    if !table_has_column(&transaction, "driver_analysis_sessions", "app_version")? {
        transaction
            .execute(
                "ALTER TABLE driver_analysis_sessions ADD COLUMN app_version TEXT",
                [],
            )
            .map_err(|error| format!("unable to add Driver Analysis app version: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![HUD_SCHEMA_VERSION],
        )
        .map_err(|error| format!("unable to update Driver Analysis version schema: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("unable to commit Driver Analysis version migration: {error}"))
}

const EVENT_TRACE_TELEMETRY_COLUMNS: [(&str, &str); 36] = [
    ("speed_kmh", "REAL"),
    ("gear", "INTEGER"),
    ("rpm", "REAL"),
    ("steer", "REAL"),
    ("acceleration_x", "REAL"),
    ("acceleration_y", "REAL"),
    ("acceleration_z", "REAL"),
    ("yaw_rate", "REAL"),
    ("slip_angle_fl", "REAL"),
    ("slip_angle_fr", "REAL"),
    ("slip_angle_rl", "REAL"),
    ("slip_angle_rr", "REAL"),
    ("slip_ratio_fl", "REAL"),
    ("slip_ratio_fr", "REAL"),
    ("slip_ratio_rl", "REAL"),
    ("slip_ratio_rr", "REAL"),
    ("combined_slip_fl", "REAL"),
    ("combined_slip_fr", "REAL"),
    ("combined_slip_rl", "REAL"),
    ("combined_slip_rr", "REAL"),
    ("tire_temp_c_fl", "REAL"),
    ("tire_temp_c_fr", "REAL"),
    ("tire_temp_c_rl", "REAL"),
    ("tire_temp_c_rr", "REAL"),
    ("suspension_fl", "REAL"),
    ("suspension_fr", "REAL"),
    ("suspension_rl", "REAL"),
    ("suspension_rr", "REAL"),
    ("puddle_fl", "REAL"),
    ("puddle_fr", "REAL"),
    ("puddle_rl", "REAL"),
    ("puddle_rr", "REAL"),
    ("rumble_fl", "INTEGER"),
    ("rumble_fr", "INTEGER"),
    ("rumble_rl", "INTEGER"),
    ("rumble_rr", "INTEGER"),
];

fn migrate_event_trace_telemetry_schema(connection: &mut Connection) -> Result<(), String> {
    let mut missing_columns = Vec::new();
    for (column, column_type) in EVENT_TRACE_TELEMETRY_COLUMNS {
        if !table_has_column(connection, "event_run_lap_trace_points", column)? {
            missing_columns.push((column, column_type));
        }
    }
    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Event trace telemetry schema migration: {error}")
    })?;
    for (column, column_type) in missing_columns {
        transaction
            .execute(
                &format!(
                    "ALTER TABLE event_run_lap_trace_points ADD COLUMN {column} {column_type}"
                ),
                [],
            )
            .map_err(|error| format!("unable to add Event trace {column} data: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![HUD_SCHEMA_VERSION],
        )
        .map_err(|error| {
            format!("unable to update Event trace telemetry schema version: {error}")
        })?;
    transaction.commit().map_err(|error| {
        format!("unable to commit Event trace telemetry schema migration: {error}")
    })
}

// Sprint results saved from the last live race time before Forza cleared telemetry.
// Existing runs keep 0 because their result time was never approximate.
fn migrate_event_result_approximate_schema(connection: &mut Connection) -> Result<(), String> {
    let has_column = table_has_column(connection, "event_runs", "result_time_approximate")?;
    let transaction = connection.transaction().map_err(|error| {
        format!("unable to start Event approximate result schema migration: {error}")
    })?;
    if !has_column {
        transaction
            .execute(
                "ALTER TABLE event_runs ADD COLUMN result_time_approximate INTEGER NOT NULL DEFAULT 0
                   CHECK (result_time_approximate IN (0, 1))",
                [],
            )
            .map_err(|error| format!("unable to add Event approximate result data: {error}"))?;
    }
    transaction
        .execute(
            "UPDATE hud_schema_version SET version = ?1",
            params![HUD_SCHEMA_VERSION],
        )
        .map_err(|error| {
            format!("unable to update Event approximate result schema version: {error}")
        })?;
    transaction.commit().map_err(|error| {
        format!("unable to commit Event approximate result schema migration: {error}")
    })
}

pub(crate) fn initialize_shift_light_schema(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS hud_schema_version (
               version INTEGER NOT NULL
             );
             INSERT INTO hud_schema_version (version)
             SELECT 18
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
    if version < 15 {
        migrate_shift_light_v15(connection)?;
    } else {
        create_shift_light_config_tables(connection)?;
    }
    if version < 16 {
        migrate_event_soft_delete_schema(connection)?;
    }
    if version < DRIVER_ANALYSIS_INITIAL_SCHEMA_VERSION {
        migrate_driver_analysis_schema(connection)?;
    } else if version < DRIVER_ANALYSIS_RESULTS_SCHEMA_VERSION {
        migrate_driver_analysis_v18(connection)?;
    } else {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("unable to start Driver Analysis schema check: {error}"))?;
        create_driver_analysis_tables(&transaction)?;
        transaction
            .commit()
            .map_err(|error| format!("unable to commit Driver Analysis schema check: {error}"))?;
    }
    if version < DRIVER_ANALYSIS_SCHEMA_VERSION {
        migrate_driver_analysis_stats(connection)?;
    }
    if version < 20 {
        migrate_event_trace_telemetry_schema(connection)?;
    }
    if version < 21 {
        migrate_driver_analysis_recordings(connection)?;
    }
    if version < 22 {
        migrate_driver_analysis_app_version(connection)?;
    }
    if version < 23 {
        migrate_event_result_approximate_schema(connection)?;
    }
    Ok(())
}

// Migrations run once per process for each database path. The lock is held while
// migrating so concurrent commands can never run the same migration at once.
static SHIFT_LIGHT_SCHEMA_READY: Mutex<Option<PathBuf>> = Mutex::new(None);

fn open_shift_light_connection(path: &Path) -> Result<Connection, String> {
    let mut ready = SHIFT_LIGHT_SCHEMA_READY
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    // A database file removed while the app runs must be migrated again.
    if !path.is_file() {
        *ready = None;
    }
    let mut connection = Connection::open(path)
        .map_err(|error| format!("unable to open HUD SQLite database: {error}"))?;
    // Commands run on worker threads and can write at the same time, so a writer
    // waits for the lock instead of failing immediately.
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("unable to configure HUD SQLite database: {error}"))?;
    // Foreign keys are a per-connection setting, so every connection enables them.
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("unable to configure HUD SQLite database: {error}"))?;
    if ready.as_deref() != Some(path) {
        initialize_shift_light_schema(&mut connection)?;
        *ready = Some(path.to_path_buf());
    }
    Ok(connection)
}

pub(crate) fn open_shift_light_db<R: Runtime>(app: &AppHandle<R>) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("unable to resolve HUD data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("unable to create HUD data directory: {error}"))?;
    open_shift_light_connection(&directory.join("fdc.sqlite"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;
    use crate::*;

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
            HUD_SCHEMA_VERSION
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

    #[test]
    fn v16_migration_preserves_events_and_current_shift_light_data() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Existing event", "A", "Asphalt", "Official", None),
        )
        .unwrap();
        connection
            .execute_batch(
                "INSERT INTO shift_light_configs
                   (id, game_id, car_ordinal, car_class, car_performance_index,
                    drivetrain_type, num_cylinders, reported_redline_rpm)
                 VALUES (42, 'fh6', 3766, 1, 800, 1, 10, 10300);
                 ALTER TABLE events DROP COLUMN deleted_at;
                 UPDATE hud_schema_version SET version = 15;",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        assert!(table_has_column(&connection, "events", "deleted_at").unwrap());
        assert_eq!(
            load_event_from_connection(&connection, event.id)
                .unwrap()
                .name,
            "Existing event"
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM shift_light_configs", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
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
        assert!(table_has_column(&connection, "events", "deleted_at").unwrap());
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

    #[test]
    fn v18_migration_preserves_driver_analysis_results_and_adds_no_recurring_result() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (17);
                 CREATE TABLE driver_analysis_sessions (
                   id INTEGER PRIMARY KEY,
                   result TEXT CHECK (result IS NULL OR result IN ('issue', 'insufficient', 'ambiguous', 'interrupted'))
                 );
                 INSERT INTO driver_analysis_sessions (id, result) VALUES (1, 'insufficient');",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT version FROM hud_schema_version", [], |row| row
                    .get::<_, i32>(0))
                .unwrap(),
            HUD_SCHEMA_VERSION
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT result FROM driver_analysis_sessions WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "insufficient"
        );
        connection
            .execute(
                "UPDATE driver_analysis_sessions SET result = 'no_recurring_problem' WHERE id = 1",
                [],
            )
            .unwrap();
    }

    #[test]
    fn v19_migration_adds_driver_analysis_stats_column() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (18);
                 CREATE TABLE driver_analysis_sessions (
                   id INTEGER PRIMARY KEY,
                   started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
                   finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= started_at_ms),
                   status TEXT NOT NULL CHECK (status IN ('recording', 'completed', 'insufficient', 'interrupted', 'error')),
                   result TEXT CHECK (result IS NULL OR result IN ('issue', 'insufficient', 'ambiguous', 'no_recurring_problem', 'interrupted')),
                   main_kind TEXT,
                   label TEXT NOT NULL DEFAULT '',
                   instruction TEXT NOT NULL DEFAULT '',
                   sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
                   maneuver_count INTEGER NOT NULL DEFAULT 0 CHECK (maneuver_count >= 0),
                   opportunity_count INTEGER NOT NULL DEFAULT 0 CHECK (opportunity_count >= 0),
                   evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
                   detector_confidence REAL CHECK (detector_confidence IS NULL OR detector_confidence BETWEEN 0 AND 1),
                   attribution_confidence REAL CHECK (attribution_confidence IS NULL OR attribution_confidence BETWEEN 0 AND 1),
                   severity REAL CHECK (severity IS NULL OR severity BETWEEN 0 AND 1),
                   storage_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
                   algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
                   vehicle_identity TEXT NOT NULL CHECK (length(trim(vehicle_identity)) > 0),
                   vehicle_ordinal INTEGER,
                   vehicle_pi INTEGER,
                   vehicle_drivetrain INTEGER,
                   vehicle_rpm_limit REAL
                 );
                 INSERT INTO driver_analysis_sessions
                   (id, started_at_ms, status, algorithm_version, vehicle_identity)
                 VALUES (1, 1000, 'recording', 'v1', '{}');",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);
        assert!(table_has_column(&connection, "driver_analysis_sessions", "stats_json").unwrap());
        let stats: Option<String> = connection
            .query_row(
                "SELECT stats_json FROM driver_analysis_sessions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stats, None);

        initialize_shift_light_schema(&mut connection).unwrap();
        let version_after: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version_after, HUD_SCHEMA_VERSION);
    }

    #[test]
    fn event_trace_migration_from_v19_preserves_data() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (19);",
            )
            .unwrap();
        let transaction = connection.transaction().unwrap();
        create_event_tables(&transaction).unwrap();
        create_event_run_tables(&transaction).unwrap();
        create_event_trace_tables(&transaction).unwrap();
        transaction.commit().unwrap();

        connection
            .execute(
                "INSERT INTO events (name, class, route, mode)
                 VALUES ('Test Event', 'A', 'Asphalt', 'Rivals')",
                [],
            )
            .unwrap();
        let event_id = connection.last_insert_rowid();
        connection
            .execute(
                "INSERT INTO event_runs
                   (event_id, car_ordinal, car_class, car_pi, drivetrain, started_at, run_type, result)
                 VALUES (?1, 260, 8, 700, 2, '2026-08-30T12:00:00Z', 'circuit', 'completed')",
                params![event_id],
            )
            .unwrap();
        let run_id = connection.last_insert_rowid();
        connection
            .execute(
                "INSERT INTO event_run_laps (run_id, lap_number, lap_time_ms)
                 VALUES (?1, 1, 90000)",
                params![run_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO event_run_lap_trace_points
                   (run_id, lap_number, sample_index, elapsed_ms, distance,
                    position_x, position_y, position_z, throttle, brake)
                 VALUES (?1, 1, 0, 250, 12.5, 1.0, 2.0, 3.0, 0.75, 0.0)",
                params![run_id],
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);

        assert!(table_has_column(&connection, "event_run_lap_trace_points", "speed_kmh").unwrap());
        assert!(table_has_column(&connection, "event_run_lap_trace_points", "gear").unwrap());
        assert!(table_has_column(&connection, "event_run_lap_trace_points", "rumble_fl").unwrap());

        let point_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM event_run_lap_trace_points",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(point_count, 1);

        let (distance, speed_kmh, gear): (f64, Option<f64>, Option<i32>) = connection
            .query_row(
                "SELECT distance, speed_kmh, gear FROM event_run_lap_trace_points WHERE sample_index = 0",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(distance, 12.5);
        assert_eq!(speed_kmh, None);
        assert_eq!(gear, None);
    }

    #[test]
    fn event_trace_fresh_database_starts_at_v20_with_columns() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();

        let version: i32 = connection
            .query_row("SELECT version FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, HUD_SCHEMA_VERSION);

        assert!(table_has_column(&connection, "event_run_lap_trace_points", "speed_kmh").unwrap());
        assert!(table_has_column(&connection, "event_run_lap_trace_points", "gear").unwrap());
        assert!(table_has_column(&connection, "event_run_lap_trace_points", "rpm").unwrap());
        assert!(table_has_column(&connection, "event_run_lap_trace_points", "rumble_fl").unwrap());
        assert!(table_has_column(&connection, "event_run_lap_trace_points", "rumble_rr").unwrap());
    }

    #[test]
    fn driver_analysis_v20_migration_creates_recordings_and_links_sessions() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE hud_schema_version (version INTEGER NOT NULL);
                 INSERT INTO hud_schema_version VALUES (20);
                 CREATE TABLE driver_analysis_sessions (
                   id INTEGER PRIMARY KEY,
                   started_at_ms INTEGER NOT NULL,
                   status TEXT NOT NULL,
                   algorithm_version TEXT NOT NULL,
                   vehicle_identity TEXT NOT NULL
                 );
                 INSERT INTO driver_analysis_sessions VALUES (1, 1000, 'completed', 'v2', '{}');
                 INSERT INTO driver_analysis_sessions VALUES (2, 1000, 'completed', 'v2', '{}');
                 CREATE TABLE driver_analysis_samples (
                   id INTEGER PRIMARY KEY,
                   session_id INTEGER,
                   sequence INTEGER,
                   timestamp_ms INTEGER,
                   speed_kmh REAL, throttle REAL, brake REAL, steer REAL,
                   gear INTEGER, rpm REAL, rpm_max REAL,
                   acceleration_x REAL, acceleration_y REAL, acceleration_z REAL, yaw_rate REAL,
                   slip_ratio_fl REAL, slip_ratio_fr REAL, slip_ratio_rl REAL, slip_ratio_rr REAL,
                   slip_angle_fl REAL, slip_angle_fr REAL, slip_angle_rl REAL, slip_angle_rr REAL,
                   combined_slip_fl REAL, combined_slip_fr REAL, combined_slip_rl REAL, combined_slip_rr REAL,
                   tire_temp_fl REAL, tire_temp_fr REAL, tire_temp_rl REAL, tire_temp_rr REAL,
                   suspension_fl REAL, suspension_fr REAL, suspension_rl REAL, suspension_rr REAL,
                   rumble_fl INTEGER, rumble_fr INTEGER, rumble_rl INTEGER, rumble_rr INTEGER,
                   puddle_fl REAL, puddle_fr REAL, puddle_rl REAL, puddle_rr REAL,
                   lap_time REAL, lap_number INTEGER, lap_distance REAL
                 );",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT version FROM hud_schema_version", [], |row| row
                    .get::<_, i32>(0))
                .unwrap(),
            HUD_SCHEMA_VERSION
        );

        let (recording_id, drives_recorded): (Option<i64>, i32) = connection
            .query_row(
                "SELECT recording_id, drives_recorded FROM driver_analysis_sessions WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(recording_id.is_some());
        assert_eq!(drives_recorded, 0);

        let recording_exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM driver_analysis_recordings WHERE id = ?1)",
                params![recording_id.unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(recording_exists);

        // Sessions that started at the same moment still get separate recordings.
        let distinct_recordings: i64 = connection
            .query_row(
                "SELECT COUNT(DISTINCT recording_id) FROM driver_analysis_sessions",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let recordings: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM driver_analysis_recordings",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((distinct_recordings, recordings), (2, 2));
    }

    #[test]
    fn driver_analysis_fresh_database_has_all_tables_and_columns_at_v21() {
        let mut connection = driver_analysis_connection();

        // Check recordings table exists
        let rec_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='driver_analysis_recordings'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rec_count, 1);

        // Check drives table exists
        let drives_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='driver_analysis_drives'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(drives_count, 1);

        // Check recording_id column on sessions
        let has_rec_id: bool = connection
            .query_row(
                "SELECT COUNT(*)>0 FROM pragma_table_info('driver_analysis_sessions') WHERE name='recording_id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_rec_id);

        // Check position columns on samples
        let has_pos_x: bool = connection
            .query_row(
                "SELECT COUNT(*)>0 FROM pragma_table_info('driver_analysis_samples') WHERE name='position_x'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_pos_x);
    }

    #[test]
    fn v22_migration_adds_the_recording_fdc_version_to_a_v21_database() {
        // A released schema version 21 database with one saved session and no app_version column.
        let mut connection = driver_analysis_connection();
        connection
            .execute(
                "INSERT INTO driver_analysis_sessions (started_at_ms, status, algorithm_version, vehicle_identity)
                 VALUES (1, 'completed', 'v1', '{}')",
                [],
            )
            .unwrap();
        connection
            .execute_batch(
                "ALTER TABLE driver_analysis_sessions DROP COLUMN app_version;
                 UPDATE hud_schema_version SET version = 21;",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();
        let session_id = create_driver_analysis_session_in_connection(
            &mut connection,
            &driver_analysis_session_input(1_000),
        )
        .unwrap();

        let versions: Vec<Option<String>> = connection
            .prepare("SELECT app_version FROM driver_analysis_sessions ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(session_id, 2);
        assert_eq!(
            versions,
            [None, Some(env!("CARGO_PKG_VERSION").to_string())]
        );
        assert_eq!(
            connection
                .query_row("SELECT version FROM hud_schema_version", [], |row| row
                    .get::<_, i32>(0))
                .unwrap(),
            HUD_SCHEMA_VERSION
        );
    }

    #[test]
    fn event_run_approximate_migration_from_v22_keeps_existing_runs() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let event = create_event_in_connection(
            &mut connection,
            test_event("Migrated run", "A", "Asphalt", "Rivals", None),
        )
        .unwrap();
        let existing = record_event_run_in_connection(
            &mut connection,
            test_event_run(event.id, "sprint", "confirmed", Some(74_000), Vec::new()),
        )
        .unwrap();
        // A released schema version 22 database has no approximate result column.
        connection
            .execute_batch(
                "ALTER TABLE event_runs DROP COLUMN result_time_approximate;
                 UPDATE hud_schema_version SET version = 22;",
            )
            .unwrap();

        initialize_shift_light_schema(&mut connection).unwrap();

        assert!(table_has_column(&connection, "event_runs", "result_time_approximate").unwrap());
        assert_eq!(
            connection
                .query_row("SELECT version FROM hud_schema_version", [], |row| row
                    .get::<_, i32>(0))
                .unwrap(),
            HUD_SCHEMA_VERSION
        );
        let migrated = load_event_run_from_connection(&connection, existing.id).unwrap();
        assert_eq!(migrated.result_time_ms, Some(74_000));
        assert!(!migrated.result_time_approximate);
    }

    #[test]
    fn shift_light_connections_enable_foreign_keys_and_migrate_again_after_file_removal() {
        let folder = std::env::temp_dir().join(format!("fdc-open-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("fdc.sqlite");
        for _ in 0..2 {
            let connection = open_shift_light_connection(&path).unwrap();
            let enabled: i64 = connection
                .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
                .unwrap();
            assert_eq!(enabled, 1);
        }
        fs::remove_file(&path).unwrap();
        let connection = open_shift_light_connection(&path).unwrap();
        let versions: i64 = connection
            .query_row("SELECT COUNT(*) FROM hud_schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(versions, 1);
        drop(connection);
        fs::remove_dir_all(folder).unwrap();
    }
}
