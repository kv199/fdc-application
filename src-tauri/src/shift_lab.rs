//! Shift Lab recorder: stores every accepted raw Forza Data Out packet whose IsRaceOn flag is set
//! in the separate FDC-local `fdc-lab.sqlite`, grouped into per-car sessions under a size budget.
//! Packets reach a dedicated writer thread through a bounded channel, so recording never blocks or
//! slows the UDP receiver, the HUD, or `fdc.sqlite`.

use std::{
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, params};

const PACKET_LENGTH: usize = 324;
const CHANNEL_CAPACITY: usize = 4096;
const BATCH_PACKET_LIMIT: usize = 256;
const BATCH_INTERVAL: Duration = Duration::from_millis(500);
const SESSION_GAP_MS: i64 = 2_000;
const BUDGET_CHECK_INTERVAL: Duration = Duration::from_secs(10);
const LAB_BUDGET_BYTES: i64 = 200 * 1024 * 1024;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
// Mirrors SHIFT_LIGHT_LEARNING_VERSION in src/shift-light/optimal-shift.ts.
const SHIFT_LIGHT_MODEL_VERSION: i64 = 4;

const LAB_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS lab_schema_version (version INTEGER NOT NULL);
INSERT INTO lab_schema_version (version)
  SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM lab_schema_version);
CREATE TABLE IF NOT EXISTS lab_sessions (
  id INTEGER PRIMARY KEY,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  shift_light_model_version INTEGER NOT NULL,
  car_ordinal INTEGER NOT NULL,
  car_class INTEGER NOT NULL,
  car_pi INTEGER NOT NULL,
  car_drivetrain INTEGER NOT NULL,
  car_cylinders INTEGER NOT NULL,
  packet_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lab_packets (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES lab_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  packet BLOB NOT NULL CHECK (length(packet) = 324),
  UNIQUE (session_id, sequence)
);
"#;

/// Handle the UDP receiver uses to hand accepted packets to the lab writer thread.
pub(crate) struct LabRecorder {
    sender: SyncSender<LabPacket>,
}

struct LabPacket {
    bytes: [u8; PACKET_LENGTH],
    received_at_ms: i64,
}

impl LabRecorder {
    /// Starts the writer thread for `path`. It never fails: when the database cannot be opened,
    /// the thread keeps draining and discarding packets.
    pub(crate) fn start(path: PathBuf) -> Self {
        let (sender, receiver) = mpsc::sync_channel(CHANNEL_CAPACITY);
        let spawned = thread::Builder::new()
            .name("fdc-shift-lab".to_string())
            .spawn(move || run_writer(&path, receiver));
        if let Err(error) = spawned {
            // The receiver went with the failed closure, so later sends report Disconnected.
            eprintln!("unable to start Shift Lab recorder thread: {error}");
        }
        Self { sender }
    }

    /// Queues one raw packet when it is a full race-on packet. Never blocks: a full or closed
    /// queue drops the packet silently.
    pub(crate) fn record(&self, bytes: &[u8]) {
        if !accepts(bytes) {
            return;
        }
        let mut packet = [0_u8; PACKET_LENGTH];
        packet.copy_from_slice(bytes);
        let _ = self.sender.try_send(LabPacket {
            bytes: packet,
            received_at_ms: unix_millis(),
        });
    }
}

fn accepts(bytes: &[u8]) -> bool {
    bytes.len() == PACKET_LENGTH && read_i32(bytes, 0) == 1
}

fn read_i32(bytes: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct CarIdentity {
    ordinal: i32,
    class: i32,
    pi: i32,
    drivetrain: i32,
    cylinders: i32,
}

impl CarIdentity {
    fn from_packet(bytes: &[u8]) -> Self {
        Self {
            ordinal: read_i32(bytes, 212),
            class: read_i32(bytes, 216),
            pi: read_i32(bytes, 220),
            drivetrain: read_i32(bytes, 224),
            cylinders: read_i32(bytes, 228),
        }
    }
}

#[derive(Clone, Copy)]
struct CurrentSession {
    id: i64,
    identity: CarIdentity,
    next_sequence: i64,
    last_received_at_ms: i64,
    packet_count: i64,
}

fn run_writer(path: &Path, receiver: Receiver<LabPacket>) {
    let mut writer = match Connection::open(path)
        .map_err(|error| format!("unable to open Shift Lab SQLite database: {error}"))
        .and_then(|connection| LabWriter::open(connection, LAB_BUDGET_BYTES))
    {
        Ok(writer) => Some(writer),
        Err(error) => {
            eprintln!("Shift Lab recording is disabled for this run: {error}");
            None
        }
    };

    let mut pending: Vec<LabPacket> = Vec::with_capacity(BATCH_PACKET_LIMIT);
    let mut last_commit = Instant::now();
    loop {
        match receiver.recv_timeout(BATCH_INTERVAL) {
            Ok(packet) => pending.push(packet),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        if !pending.is_empty()
            && (pending.len() >= BATCH_PACKET_LIMIT || last_commit.elapsed() >= BATCH_INTERVAL)
        {
            commit_pending(&mut writer, &mut pending);
            last_commit = Instant::now();
        }
    }
    commit_pending(&mut writer, &mut pending);
}

fn commit_pending(writer: &mut Option<LabWriter>, pending: &mut Vec<LabPacket>) {
    if let Some(writer) = writer.as_mut() {
        if let Err(error) = writer.write_batch(pending.as_slice()) {
            eprintln!("unable to record Shift Lab packets: {error}");
        } else if let Err(error) = writer.enforce_budget_if_due() {
            eprintln!("unable to enforce the Shift Lab size budget: {error}");
        }
    }
    pending.clear();
}

struct LabWriter {
    connection: Connection,
    budget_bytes: i64,
    current: Option<CurrentSession>,
    last_budget_check: Option<Instant>,
}

impl LabWriter {
    fn open(connection: Connection, budget_bytes: i64) -> Result<Self, String> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("unable to configure Shift Lab SQLite database: {error}"))?;
        // Foreign keys are a per-connection setting, so every connection enables them.
        connection
            .execute_batch(
                "PRAGMA journal_mode = DELETE;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA foreign_keys = ON;",
            )
            .map_err(|error| format!("unable to configure Shift Lab SQLite database: {error}"))?;
        connection
            .execute_batch(LAB_SCHEMA_SQL)
            .map_err(|error| format!("unable to create Shift Lab schema: {error}"))?;
        Ok(Self {
            connection,
            budget_bytes,
            current: None,
            last_budget_check: None,
        })
    }

    /// Stores a batch in one transaction. The in-memory session state only advances when the
    /// transaction commits, so a failed batch leaves the next batch consistent with the database.
    fn write_batch(&mut self, packets: &[LabPacket]) -> Result<(), String> {
        if packets.is_empty() {
            return Ok(());
        }

        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("unable to start Shift Lab transaction: {error}"))?;
        let mut current = self.current;
        for packet in packets {
            let identity = CarIdentity::from_packet(&packet.bytes);
            let session = match current {
                Some(session)
                    if session.identity == identity
                        && packet
                            .received_at_ms
                            .saturating_sub(session.last_received_at_ms)
                            <= SESSION_GAP_MS =>
                {
                    session
                }
                previous => {
                    if let Some(session) = previous {
                        finish_session(&transaction, &session)?;
                    }
                    let id = insert_session(&transaction, packet.received_at_ms, identity)?;
                    CurrentSession {
                        id,
                        identity,
                        next_sequence: 0,
                        last_received_at_ms: packet.received_at_ms,
                        packet_count: 0,
                    }
                }
            };

            transaction
                .execute(
                    "INSERT INTO lab_packets (session_id, sequence, received_at_ms, packet)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        session.id,
                        session.next_sequence,
                        packet.received_at_ms,
                        &packet.bytes[..]
                    ],
                )
                .map_err(|error| format!("unable to store Shift Lab packet: {error}"))?;
            current = Some(CurrentSession {
                next_sequence: session.next_sequence + 1,
                last_received_at_ms: packet.received_at_ms,
                packet_count: session.packet_count + 1,
                ..session
            });
        }

        if let Some(session) = current {
            finish_session(&transaction, &session)?;
        }
        transaction
            .commit()
            .map_err(|error| format!("unable to commit Shift Lab batch: {error}"))?;
        self.current = current;
        Ok(())
    }

    fn enforce_budget_if_due(&mut self) -> Result<(), String> {
        if self
            .last_budget_check
            .is_some_and(|checked_at| checked_at.elapsed() < BUDGET_CHECK_INTERVAL)
        {
            return Ok(());
        }
        self.enforce_budget()
    }

    /// Deletes the oldest inactive session while the database is over budget. When only the
    /// current session is left, its oldest 10% of packets are trimmed instead.
    fn enforce_budget(&mut self) -> Result<(), String> {
        self.last_budget_check = Some(Instant::now());
        while self.used_bytes()? > self.budget_bytes {
            if self.delete_oldest_inactive_session()? {
                continue;
            }
            if self.trim_current_session()? == 0 {
                break;
            }
        }
        Ok(())
    }

    fn delete_oldest_inactive_session(&mut self) -> Result<bool, String> {
        let current_id = self.current.map(|session| session.id);
        let oldest: Option<i64> = self
            .connection
            .query_row(
                "SELECT id FROM lab_sessions WHERE id IS NOT ?1 ORDER BY id LIMIT 1",
                params![current_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("unable to find Shift Lab session to trim: {error}"))?;
        let Some(id) = oldest else {
            return Ok(false);
        };
        self.connection
            .execute("DELETE FROM lab_sessions WHERE id = ?1", params![id])
            .map_err(|error| format!("unable to delete Shift Lab session: {error}"))?;
        Ok(true)
    }

    /// Returns the number of packets deleted from the current session.
    fn trim_current_session(&mut self) -> Result<i64, String> {
        let Some(session) = self.current else {
            return Ok(0);
        };
        if session.packet_count == 0 {
            return Ok(0);
        }

        let trim = (session.packet_count / 10).max(1);
        let deleted = self
            .connection
            .execute(
                "DELETE FROM lab_packets WHERE id IN (
                   SELECT id FROM lab_packets WHERE session_id = ?1 ORDER BY sequence LIMIT ?2
                 )",
                params![session.id, trim],
            )
            .map_err(|error| format!("unable to trim Shift Lab packets: {error}"))?
            as i64;
        self.connection
            .execute(
                "UPDATE lab_sessions SET packet_count = packet_count - ?2 WHERE id = ?1",
                params![session.id, deleted],
            )
            .map_err(|error| format!("unable to update Shift Lab session: {error}"))?;
        if let Some(current) = self.current.as_mut() {
            current.packet_count -= deleted;
        }
        Ok(deleted)
    }

    /// Bytes held by live pages. Freed pages stay in the file but count as free, so deletions
    /// lower this value and SQLite reuses them without a VACUUM.
    fn used_bytes(&self) -> Result<i64, String> {
        let page_count: i64 = self
            .connection
            .pragma_query_value(None, "page_count", |row| row.get(0))
            .map_err(|error| format!("unable to read Shift Lab page count: {error}"))?;
        let freelist_count: i64 = self
            .connection
            .pragma_query_value(None, "freelist_count", |row| row.get(0))
            .map_err(|error| format!("unable to read Shift Lab free pages: {error}"))?;
        let page_size: i64 = self
            .connection
            .pragma_query_value(None, "page_size", |row| row.get(0))
            .map_err(|error| format!("unable to read Shift Lab page size: {error}"))?;
        Ok((page_count - freelist_count) * page_size)
    }
}

fn insert_session(
    connection: &Connection,
    started_at_ms: i64,
    identity: CarIdentity,
) -> Result<i64, String> {
    connection
        .execute(
            "INSERT INTO lab_sessions (
               started_at_ms, finished_at_ms, app_version, shift_light_model_version,
               car_ordinal, car_class, car_pi, car_drivetrain, car_cylinders, packet_count
             ) VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
            params![
                started_at_ms,
                APP_VERSION,
                SHIFT_LIGHT_MODEL_VERSION,
                identity.ordinal,
                identity.class,
                identity.pi,
                identity.drivetrain,
                identity.cylinders
            ],
        )
        .map_err(|error| format!("unable to create Shift Lab session: {error}"))?;
    Ok(connection.last_insert_rowid())
}

fn finish_session(connection: &Connection, session: &CurrentSession) -> Result<(), String> {
    connection
        .execute(
            "UPDATE lab_sessions SET finished_at_ms = ?2, packet_count = ?3 WHERE id = ?1",
            params![
                session.id,
                session.last_received_at_ms,
                session.packet_count
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("unable to update Shift Lab session: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn packet(ordinal: i32, received_at_ms: i64) -> LabPacket {
        let mut bytes = [0_u8; PACKET_LENGTH];
        bytes[0..4].copy_from_slice(&1_i32.to_le_bytes());
        bytes[212..216].copy_from_slice(&ordinal.to_le_bytes());
        LabPacket {
            bytes,
            received_at_ms,
        }
    }

    fn test_directory(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("fdc-shift-lab-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn count(connection: &Connection, sql: &str) -> i64 {
        connection.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    fn session_ids(connection: &Connection) -> Vec<i64> {
        let mut statement = connection
            .prepare("SELECT id FROM lab_sessions ORDER BY id")
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn schema_creation_is_idempotent() {
        let directory = test_directory("schema");
        let path = directory.join("fdc-lab.sqlite");
        LabWriter::open(Connection::open(&path).unwrap(), LAB_BUDGET_BYTES).unwrap();

        let writer = LabWriter::open(Connection::open(&path).unwrap(), LAB_BUDGET_BYTES).unwrap();
        assert_eq!(
            count(
                &writer.connection,
                "SELECT COUNT(*) FROM lab_schema_version"
            ),
            1
        );
        assert_eq!(
            count(&writer.connection, "SELECT version FROM lab_schema_version"),
            1
        );
        drop(writer);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn record_accepts_only_full_race_on_packets() {
        let mut race_on = [0_u8; PACKET_LENGTH];
        race_on[0] = 1;
        assert!(accepts(&race_on));
        assert!(!accepts(&race_on[..323]));

        let mut longer = race_on.to_vec();
        longer.push(0);
        assert!(!accepts(&longer));

        let mut race_off = race_on;
        race_off[0] = 0;
        assert!(!accepts(&race_off));

        // A recorder whose writer is gone must drop packets without panicking.
        let (sender, receiver) = mpsc::sync_channel(1);
        drop(receiver);
        LabRecorder { sender }.record(&race_on);
    }

    #[test]
    fn splits_sessions_on_car_change_and_gaps_over_two_seconds() {
        let mut writer =
            LabWriter::open(Connection::open_in_memory().unwrap(), LAB_BUDGET_BYTES).unwrap();
        writer
            .write_batch(&[packet(7, 1_000), packet(7, 1_500)])
            .unwrap();
        // 1_500 to 3_500 is exactly 2_000 ms and must stay in the same session; 3_500 to 5_501
        // is a gap above 2_000 ms and starts a new one; 5_600 changes the car.
        writer
            .write_batch(&[packet(7, 3_500), packet(7, 5_501), packet(8, 5_600)])
            .unwrap();

        let mut statement = writer
            .connection
            .prepare(
                "SELECT id, started_at_ms, finished_at_ms, packet_count, car_ordinal
                 FROM lab_sessions ORDER BY id",
            )
            .unwrap();
        let sessions: Vec<(i64, i64, i64, i64, i64)> = statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        drop(statement);
        assert_eq!(
            sessions,
            vec![
                (1, 1_000, 3_500, 3, 7),
                (2, 5_501, 5_501, 1, 7),
                (3, 5_600, 5_600, 1, 8)
            ]
        );

        let mut statement = writer
            .connection
            .prepare("SELECT session_id, sequence FROM lab_packets ORDER BY id")
            .unwrap();
        let sequences: Vec<(i64, i64)> = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        drop(statement);
        assert_eq!(sequences, vec![(1, 0), (1, 1), (1, 2), (2, 0), (3, 0)]);
    }

    #[test]
    fn budget_deletes_oldest_inactive_session_before_current() {
        let mut writer =
            LabWriter::open(Connection::open_in_memory().unwrap(), LAB_BUDGET_BYTES).unwrap();
        for ordinal in 1..=3_i32 {
            let batch: Vec<LabPacket> = (0..60_i64)
                .map(|index| packet(ordinal, 1_000 + index * 10))
                .collect();
            writer.write_batch(&batch).unwrap();
        }

        // Deleting the oldest session alone frees several pages, which is more than the
        // one-byte-smaller budget requires, so the two newer sessions must survive.
        let total = writer.used_bytes().unwrap();
        writer.budget_bytes = total - 1;
        writer.enforce_budget().unwrap();

        assert_eq!(session_ids(&writer.connection), vec![2, 3]);
        assert_eq!(writer.current.map(|session| session.id), Some(3));
        assert!(writer.used_bytes().unwrap() <= writer.budget_bytes);
    }

    #[test]
    fn budget_trims_oldest_packets_of_the_current_session() {
        let mut writer =
            LabWriter::open(Connection::open_in_memory().unwrap(), LAB_BUDGET_BYTES).unwrap();
        let batch: Vec<LabPacket> = (0..60_i64)
            .map(|index| packet(1, 1_000 + index * 10))
            .collect();
        writer.write_batch(&batch).unwrap();

        let total = writer.used_bytes().unwrap();
        writer.budget_bytes = total - 4096;
        writer.enforce_budget().unwrap();

        let remaining = count(&writer.connection, "SELECT COUNT(*) FROM lab_packets");
        let oldest = count(&writer.connection, "SELECT MIN(sequence) FROM lab_packets");
        assert!(remaining > 0 && remaining < 60);
        assert_eq!(oldest, 60 - remaining);
        assert_eq!(
            writer.current.map(|session| session.packet_count),
            Some(remaining)
        );
        assert_eq!(
            count(&writer.connection, "SELECT COUNT(*) FROM lab_sessions"),
            1
        );
        assert!(writer.used_bytes().unwrap() <= writer.budget_bytes);
    }

    #[test]
    fn writer_flushes_pending_packets_on_shutdown() {
        let directory = test_directory("shutdown");
        let path = directory.join("fdc-lab.sqlite");
        let (sender, receiver) = mpsc::sync_channel(CHANNEL_CAPACITY);
        for index in 0..10_i64 {
            sender.try_send(packet(7, 1_000 + index * 10)).unwrap();
        }
        drop(sender);

        run_writer(&path, receiver);

        {
            let connection = Connection::open(&path).unwrap();
            assert_eq!(count(&connection, "SELECT COUNT(*) FROM lab_packets"), 10);
            assert_eq!(
                count(&connection, "SELECT packet_count FROM lab_sessions"),
                10
            );
        }
        let _ = fs::remove_dir_all(&directory);
    }
}
