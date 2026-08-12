use rusqlite::Connection;

use super::error::{DbError, DbResult};
use super::time::utc_now;

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "001_initial",
        sql: include_str!("../../migrations/001_initial.sql"),
    },
    Migration {
        version: 2,
        name: "002_daily_title_unique",
        sql: include_str!("../../migrations/002_daily_title_unique.sql"),
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migrate_applies_initial_schema() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(current_version(&conn).unwrap(), 0);

        let version = migrate(&conn).unwrap();
        assert_eq!(version, 2);
        assert_eq!(current_version(&conn).unwrap(), 2);

        for table in [
            "notes",
            "links",
            "tasks",
            "calendar_events",
            "meetings",
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
        assert_eq!(migrate(&conn).unwrap(), 2);
        assert_eq!(migrate(&conn).unwrap(), 2);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn migrate_rewrites_legacy_daily_titles_and_enforces_unique() {
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
        conn.execute(
            "INSERT INTO notes (id, title, body_markdown, note_type, pinned, created_at, updated_at)
             VALUES ('d1', 'Monday, Aug 10', '', 'daily', 0, '2026-08-10T12:00:00.000Z', '2026-08-10T12:00:00.000Z')",
            [],
        )
        .unwrap();

        assert_eq!(migrate(&conn).unwrap(), 2);

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
    }
}
