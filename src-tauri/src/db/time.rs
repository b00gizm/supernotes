use rusqlite::Connection;

use super::error::DbResult;

/// ISO-8601 UTC with millis, from SQLite — no hand-rolled civil-date math.
pub fn utc_now(conn: &Connection) -> DbResult<String> {
    Ok(conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        [],
        |row| row.get(0),
    )?)
}
