use rusqlite::{params, Connection, Transaction};

use super::error::{DbError, DbResult};
use super::time::utc_now;

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
    after: Option<fn(&Transaction<'_>) -> DbResult<()>>,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "001_initial",
        sql: include_str!("../../migrations/001_initial.sql"),
        after: None,
    },
    Migration {
        version: 2,
        name: "002_daily_title_unique",
        sql: include_str!("../../migrations/002_daily_title_unique.sql"),
        after: Some(merge_duplicate_dailies_and_index),
    },
    Migration {
        version: 3,
        name: "003_daily_title_local",
        sql: include_str!("../../migrations/003_daily_title_local.sql"),
        after: Some(merge_duplicate_dailies_and_index),
    },
    Migration {
        version: 4,
        name: "004_meetings_calendar_event",
        sql: include_str!("../../migrations/004_meetings_calendar_event.sql"),
        after: None,
    },
    Migration {
        version: 5,
        name: "005_llm_settings",
        sql: include_str!("../../migrations/005_llm_settings.sql"),
        after: None,
    },
    Migration {
        version: 6,
        name: "006_meeting_summary",
        sql: include_str!("../../migrations/006_meeting_summary.sql"),
        after: None,
    },
];

pub fn migrate(conn: &Connection) -> DbResult<i64> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )?;

    let mut current = current_version(conn)?;
    for migration in MIGRATIONS {
        if migration.version <= current {
            continue;
        }
        if migration.version != current + 1 {
            return Err(DbError::Migration(format!(
                "gap in migrations: have {current}, next is {}",
                migration.version
            )));
        }

        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(migration.sql)?;
        if let Some(after) = migration.after {
            after(&tx)?;
        }
        tx.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![migration.version, migration.name, utc_now(&tx)?],
        )?;
        tx.commit()?;
        current = migration.version;
    }

    Ok(current)
}

pub fn current_version(conn: &Connection) -> DbResult<i64> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'schema_migrations'
        )",
        [],
        |row| row.get(0),
    )?;

    if !exists {
        return Ok(0);
    }

    let version: Option<i64> =
        conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
    Ok(version.unwrap_or(0))
}

fn merge_duplicate_dailies_and_index(tx: &Transaction<'_>) -> DbResult<()> {
    merge_duplicate_dailies(tx)?;
    tx.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS notes_daily_title_uidx ON notes (title)
         WHERE note_type = 'daily';",
    )?;
    Ok(())
}

/// Keep the earliest daily per title; concatenate bodies; rehome tasks/links.
/// ponytail: O(duplicates) scans, fine for personal corpora.
fn merge_duplicate_dailies(tx: &Transaction<'_>) -> DbResult<()> {
    let mut title_stmt = tx.prepare(
        "SELECT title FROM notes
         WHERE note_type = 'daily'
         GROUP BY title
         HAVING COUNT(*) > 1",
    )?;
    let titles: Vec<String> = title_stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(title_stmt);

    for title in titles {
        let mut row_stmt = tx.prepare(
            "SELECT id, body_markdown, pinned, updated_at
             FROM notes
             WHERE note_type = 'daily' AND title = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows: Vec<DailyDup> = row_stmt
            .query_map([&title], |row| {
                Ok(DailyDup {
                    id: row.get(0)?,
                    body: row.get(1)?,
                    pinned: row.get::<_, i64>(2)? != 0,
                    updated_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(row_stmt);
        if rows.len() < 2 {
            continue;
        }

        let keeper_id = rows[0].id.clone();
        let mut bodies: Vec<String> = Vec::new();
        let mut pinned = false;
        let mut updated_at = rows[0].updated_at.clone();
        for row in &rows {
            if !row.body.trim().is_empty() {
                bodies.push(row.body.clone());
            }
            pinned |= row.pinned;
            if row.updated_at > updated_at {
                updated_at.clone_from(&row.updated_at);
            }
        }

        tx.execute(
            "UPDATE notes
             SET body_markdown = ?1, pinned = ?2, updated_at = ?3
             WHERE id = ?4",
            params![bodies.join("\n\n"), pinned as i64, updated_at, keeper_id],
        )?;

        for row in rows.iter().skip(1) {
            rehome_and_delete_daily(tx, &keeper_id, &row.id)?;
        }
    }
    Ok(())
}

struct DailyDup {
    id: String,
    body: String,
    pinned: bool,
    updated_at: String,
}

fn rehome_and_delete_daily(tx: &Transaction<'_>, keeper_id: &str, dup_id: &str) -> DbResult<()> {
    tx.execute(
        "UPDATE tasks SET note_id = ?1 WHERE note_id = ?2",
        params![keeper_id, dup_id],
    )?;
    tx.execute(
        "UPDATE OR IGNORE links SET source_note_id = ?1 WHERE source_note_id = ?2",
        params![keeper_id, dup_id],
    )?;
    tx.execute(
        "DELETE FROM links WHERE source_note_id = ?1",
        params![dup_id],
    )?;
    tx.execute(
        "UPDATE OR IGNORE links SET target_note_id = ?1 WHERE target_note_id = ?2",
        params![keeper_id, dup_id],
    )?;
    tx.execute(
        "DELETE FROM links WHERE target_note_id = ?1",
        params![dup_id],
    )?;
    let keeper_has_meeting: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM meetings WHERE note_id = ?1)",
        params![keeper_id],
        |row| row.get(0),
    )?;
    if !keeper_has_meeting {
        tx.execute(
            "UPDATE OR IGNORE meetings SET note_id = ?1 WHERE note_id = ?2",
            params![keeper_id, dup_id],
        )?;
    }
    tx.execute("DELETE FROM notes WHERE id = ?1", params![dup_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    static TZ_LOCK: Mutex<()> = Mutex::new(());

    fn tzset() {
        unsafe {
            extern "C" {
                fn tzset();
            }
            tzset();
        }
    }

    fn with_tz<T>(tz: &str, f: impl FnOnce() -> T) -> T {
        let _guard = TZ_LOCK.lock().expect("tz lock poisoned");
        let prev = std::env::var("TZ").ok();
        // SAFETY: tests serialize TZ mutations through TZ_LOCK.
        unsafe {
            std::env::set_var("TZ", tz);
        }
        tzset();
        let result = f();
        unsafe {
            match prev {
                Some(value) => std::env::set_var("TZ", value),
                None => std::env::remove_var("TZ"),
            }
        }
        tzset();
        result
    }

    fn conn_at_v1() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn.execute_batch(include_str!("../../migrations/001_initial.sql"))
            .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, applied_at)
             VALUES (1, '001_initial', '2026-08-10T00:00:00.000Z')",
            [],
        )
        .unwrap();
        conn
    }

    fn insert_daily(conn: &Connection, id: &str, title: &str, body: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO notes (id, title, body_markdown, note_type, pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'daily', 0, ?4, ?4)",
            params![id, title, body, created_at],
        )
        .unwrap();
    }

    #[test]
    fn migrate_applies_initial_schema() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(current_version(&conn).unwrap(), 0);

        let version = migrate(&conn).unwrap();
        assert_eq!(version, 6);
        assert_eq!(current_version(&conn).unwrap(), 6);

        for table in [
            "notes",
            "links",
            "tasks",
            "calendar_events",
            "meetings",
            "llm_settings",
            "schema_migrations",
        ] {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
                    )",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "expected table {table}");
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(migrate(&conn).unwrap(), 6);
        assert_eq!(migrate(&conn).unwrap(), 6);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 6);
    }

    #[test]
    fn migrate_rewrites_legacy_daily_titles_and_enforces_unique() {
        with_tz("UTC", || {
            let conn = conn_at_v1();
            insert_daily(
                &conn,
                "d1",
                "Monday, Aug 10",
                "",
                "2026-08-10T12:00:00.000Z",
            );

            assert_eq!(migrate(&conn).unwrap(), 6);

            let title: String = conn
                .query_row("SELECT title FROM notes WHERE id = 'd1'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(title, "2026-08-10");

            let dup = conn.execute(
                "INSERT INTO notes (id, title, body_markdown, note_type, pinned, created_at, updated_at)
                 VALUES ('d2', '2026-08-10', '', 'daily', 0, '2026-08-10T13:00:00.000Z', '2026-08-10T13:00:00.000Z')",
                [],
            );
            assert!(dup.is_err(), "second daily for the same day must fail");
        });
    }

    #[test]
    fn migrate_merges_same_local_day_dailies_before_unique_index() {
        let conn = conn_at_v1();
        insert_daily(
            &conn,
            "d1",
            "Monday, Aug 10",
            "Morning",
            "2026-08-10T12:00:00.000Z",
        );
        insert_daily(
            &conn,
            "d2",
            "Also Monday",
            "Evening",
            "2026-08-10T12:00:00.000Z",
        );
        conn.execute(
            "INSERT INTO tasks (id, note_id, title, state, created_at, updated_at)
             VALUES ('t1', 'd2', 'Buy milk', 'open', '2026-08-10T12:00:00.000Z', '2026-08-10T12:00:00.000Z')",
            [],
        )
        .unwrap();

        assert_eq!(migrate(&conn).unwrap(), 6);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE note_type = 'daily'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let (id, body): (String, String) = conn
            .query_row(
                "SELECT id, body_markdown FROM notes WHERE note_type = 'daily'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(id, "d1");
        assert_eq!(body, "Morning\n\nEvening");

        let task_note: String = conn
            .query_row("SELECT note_id FROM tasks WHERE id = 't1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(task_note, "d1");
    }

    #[test]
    fn migrate_uses_local_day_so_utc_collisions_split() {
        with_tz("Europe/Berlin", || {
            let conn = conn_at_v1();
            // Aug 8 12:00 local (UTC+2) and Aug 9 00:30 local share a UTC date.
            insert_daily(
                &conn,
                "d1",
                "Saturday, Aug 8",
                "saturday",
                "2026-08-08T10:00:00.000Z",
            );
            insert_daily(
                &conn,
                "d2",
                "Sunday, Aug 9",
                "sunday",
                "2026-08-08T22:30:00.000Z",
            );

            assert_eq!(migrate(&conn).unwrap(), 6);

            let mut titles: Vec<(String, String)> = conn
                .prepare("SELECT id, title FROM notes ORDER BY id")
                .unwrap()
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            titles.sort();
            assert_eq!(
                titles,
                vec![
                    ("d1".into(), "2026-08-08".into()),
                    ("d2".into(), "2026-08-09".into()),
                ]
            );
        });
    }

    #[test]
    fn migrate_003_fixes_utc_titles_from_old_002() {
        with_tz("Europe/Berlin", || {
            let conn = conn_at_v1();
            insert_daily(
                &conn,
                "d1",
                "Sunday, Aug 9",
                "evening",
                "2026-08-08T22:30:00.000Z",
            );
            // Simulate a successful *old* 002 (UTC substr + unique index).
            conn.execute_batch(
                "UPDATE notes
                 SET title = substr(created_at, 1, 10)
                 WHERE note_type = 'daily'
                   AND title NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
                 CREATE UNIQUE INDEX notes_daily_title_uidx ON notes (title)
                 WHERE note_type = 'daily';",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at)
                 VALUES (2, '002_daily_title_unique', '2026-08-10T00:00:00.000Z')",
                [],
            )
            .unwrap();

            let utc_title: String = conn
                .query_row("SELECT title FROM notes WHERE id = 'd1'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(utc_title, "2026-08-08");

            assert_eq!(migrate(&conn).unwrap(), 6);

            let local_title: String = conn
                .query_row("SELECT title FROM notes WHERE id = 'd1'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(local_title, "2026-08-09");
        });
    }

    #[test]
    fn migrate_004_adds_calendar_event_link_to_existing_meetings() {
        let conn = conn_at_v1();
        conn.execute(
            "INSERT INTO notes (id, title, body_markdown, note_type, pinned, created_at, updated_at)
             VALUES ('n1', 'Pricing sync', '', 'meeting', 0, '2026-08-10T12:00:00.000Z', '2026-08-10T12:00:00.000Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO meetings (note_id, meeting_date, start_time, end_time)
             VALUES ('n1', '2026-08-10', '14:00', '14:23')",
            [],
        )
        .unwrap();

        assert_eq!(migrate(&conn).unwrap(), 6);

        let event_id: Option<String> = conn
            .query_row(
                "SELECT calendar_event_id FROM meetings WHERE note_id = 'n1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(event_id.is_none());

        let index_exists: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'index' AND name = 'meetings_calendar_event_uidx'
                )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(index_exists);
    }

    #[test]
    fn migrate_006_adds_summary_json_without_rewriting_transcript() {
        let conn = conn_at_v1();
        conn.execute(
            "INSERT INTO notes (id, title, body_markdown, note_type, pinned, created_at, updated_at)
             VALUES
               ('n1', 'Pricing sync', 'keep this meeting body', 'meeting', 0, '2026-08-10T12:00:00.000Z', '2026-08-10T12:00:00.000Z'),
               ('t1', 'Transcript', '14:02  keep this transcript', 'regular', 0, '2026-08-10T12:00:00.000Z', '2026-08-10T12:00:00.000Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO meetings (note_id, meeting_date, start_time, end_time, transcript_note_id)
             VALUES ('n1', '2026-08-10', '14:00', '14:45', 't1')",
            [],
        )
        .unwrap();

        assert_eq!(migrate(&conn).unwrap(), 6);

        let summary: Option<String> = conn
            .query_row(
                "SELECT summary_json FROM meetings WHERE note_id = 'n1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(summary.is_none());

        let meeting_body: String = conn
            .query_row(
                "SELECT body_markdown FROM notes WHERE id = 'n1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let transcript_body: String = conn
            .query_row(
                "SELECT body_markdown FROM notes WHERE id = 't1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(meeting_body, "keep this meeting body");
        assert_eq!(transcript_body, "14:02  keep this transcript");
    }
}
