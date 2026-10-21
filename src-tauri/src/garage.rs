//! Garage: records observed cars and their tuning variants, loads the snapshot with each
//! variant's Shift Light summary, and renames saved cars.

use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::*;

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
pub(crate) struct GarageShiftLightSummary {
    pub(crate) status: String,
    pub(crate) tune_count: i64,
    pub(crate) calibrated_gear_count: i64,
    pub(crate) learning_gear_count: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GarageVariant {
    pub(crate) id: i64,
    pub(crate) class: i32,
    pub(crate) car_class: i32,
    pub(crate) pi: i32,
    pub(crate) drivetrain: i32,
    pub(crate) drivetrain_type: i32,
    pub(crate) cylinders: i32,
    pub(crate) num_cylinders: i32,
    pub(crate) first_seen_sequence: i64,
    pub(crate) last_seen_sequence: i64,
    pub(crate) is_current: bool,
    pub(crate) shift_light: GarageShiftLightSummary,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GarageCar {
    pub(crate) ordinal: i32,
    pub(crate) car_ordinal: i32,
    pub(crate) car_group: u32,
    pub(crate) drivetrain: i32,
    pub(crate) cylinders: i32,
    pub(crate) drivetrain_type: i32,
    pub(crate) num_cylinders: i32,
    pub(crate) name: Option<String>,
    pub(crate) first_seen_sequence: i64,
    pub(crate) last_seen_sequence: i64,
    pub(crate) current_variant_id: Option<i64>,
    pub(crate) latest_used: bool,
    pub(crate) variants: Vec<GarageVariant>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GarageSnapshot {
    pub(crate) cars: Vec<GarageCar>,
    pub(crate) current_car_ordinal: Option<i32>,
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
                       targets.model_rpm AS model_rpm,
                       COALESCE(targets.model_rpm, targets.optimal_rpm) AS shift_rpm,
                       targets.source_gear AS gear
                FROM shift_light_configs AS configs
                LEFT JOIN shift_light_gear_targets AS targets
                  ON targets.config_id = configs.id
                WHERE configs.game_id = 'fh6'
                  AND configs.car_ordinal = ?1
                  AND configs.car_performance_index = ?2
             ),
             -- A pair with a model point is ready whatever its status.
             gear_readiness AS (
                SELECT configuration_id, gear,
                       CASE
                         WHEN model_rpm IS NOT NULL THEN 1
                         WHEN status = 'optimal' AND shift_rpm IS NOT NULL THEN 1
                         ELSE 0
                       END AS ready
                FROM configuration_profiles
             )
             SELECT COUNT(DISTINCT configuration_id),
                    COALESCE(SUM(CASE WHEN ready = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE
                      WHEN gear IS NOT NULL AND ready = 0 THEN 1
                      ELSE 0
                    END), 0)
             FROM gear_readiness",
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

pub(crate) fn load_garage_snapshot_from_connection(
    connection: &Connection,
) -> Result<GarageSnapshot, String> {
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
        .transaction_with_behavior(TransactionBehavior::Immediate)
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

// Stays on the main thread: the Garage sequence and the reported latest car depend on call order.
#[tauri::command]
pub(crate) fn record_garage_vehicle(
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

#[tauri::command(async)]
pub(crate) fn load_garage_snapshot(app: AppHandle) -> Result<GarageSnapshot, String> {
    let connection = open_shift_light_db(&app)?;
    load_garage_snapshot_from_connection(&connection)
}

// Stays on the main thread: overlapping renames from Settings must apply in call order.
#[tauri::command]
pub(crate) fn rename_garage_car(
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn garage_counts_a_gear_pair_with_a_model_point_as_calibrated() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_shift_light_schema(&mut connection).unwrap();
        let vehicle = GarageVehicle {
            ordinal: 3766,
            class: 1,
            pi: 800,
            car_group: 42,
            drivetrain: 1,
            cylinders: 10,
        };
        record_garage_vehicle_in_connection(&mut connection, &vehicle).unwrap();
        connection
            .execute_batch(
                "INSERT INTO shift_light_configs
                   (id, game_id, car_ordinal, car_class, car_performance_index,
                    drivetrain_type, num_cylinders)
                 VALUES (7, 'fh6', 3766, 1, 800, 1, 10);
                 INSERT INTO shift_light_gear_targets
                   (config_id, source_gear, destination_gear, status, candidate_rpm,
                    optimal_rpm, confirmation_count, model_rpm)
                 VALUES (7, 1, 2, 'learning', NULL, NULL, 0, NULL),
                        (7, 2, 3, 'potential', 9100, NULL, 1, NULL);",
            )
            .unwrap();
        let summary = load_garage_shift_light_summary(&connection, 3766, 800).unwrap();
        assert_eq!(summary.status, "learning");
        assert_eq!(summary.calibrated_gear_count, 0);
        assert_eq!(summary.learning_gear_count, 2);

        connection
            .execute_batch(
                "UPDATE shift_light_gear_targets SET model_rpm = 7500 WHERE source_gear = 1;
                 INSERT INTO shift_light_gear_targets
                   (config_id, source_gear, destination_gear, status, candidate_rpm,
                    optimal_rpm, confirmation_count, model_rpm)
                 VALUES (7, 3, 4, 'optimal', 9000, 9050, 3, NULL);",
            )
            .unwrap();
        let snapshot = load_garage_snapshot_from_connection(&connection).unwrap();
        let summary = &snapshot.cars[0].variants[0].shift_light;
        assert_eq!(summary.status, "ready");
        assert_eq!(summary.tune_count, 1);
        assert_eq!(summary.calibrated_gear_count, 2);
        assert_eq!(summary.learning_gear_count, 1);
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
}
