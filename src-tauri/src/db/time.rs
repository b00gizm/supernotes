use rusqlite::Connection;

use super::error::{DbError, DbResult};

/// ISO-8601 UTC with millis, from SQLite — no hand-rolled civil-date math.
pub fn utc_now(conn: &Connection) -> DbResult<String> {
    Ok(
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })?,
    )
}

/// Local calendar date (`YYYY-MM-DD`) and clock (`HH:MM`) for a UTC ISO instant.
pub fn local_date_and_hm(conn: &Connection, iso: &str) -> DbResult<(String, String)> {
    let normalized = normalize_iso_utc(iso)?;
    // `localtime` treats the naive stamp as UTC (we stripped `Z`) and converts.
    // Do not also apply `utc` — that pair is a no-op and drops the zone shift.
    let (date, hm) = conn.query_row(
        "SELECT strftime('%Y-%m-%d', ?1, 'localtime'),
                strftime('%H:%M', ?1, 'localtime')",
        [&normalized],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    if date.is_empty() || hm.is_empty() {
        return Err(DbError::Invalid(format!(
            "could not convert timestamp to local date/time: {iso:?}"
        )));
    }
    Ok((date, hm))
}

/// SQLite datetime() wants `YYYY-MM-DD HH:MM:SS`; treat a trailing `Z` as UTC.
fn normalize_iso_utc(iso: &str) -> DbResult<String> {
    let trimmed = iso.trim();
    if trimmed.is_empty() {
        return Err(DbError::Invalid("timestamp is required".to_string()));
    }
    Ok(trimmed.replace('T', " ").trim_end_matches('Z').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn local_date_and_hm_accepts_iso_z_and_rejects_empty() {
        let conn = Connection::open_in_memory().unwrap();
        let (date, start) = local_date_and_hm(&conn, "2026-08-10T21:00:00.000Z").unwrap();
        let (end_date, end) = local_date_and_hm(&conn, "2026-08-10T21:23:00.000Z").unwrap();
        assert_eq!(date, end_date);
        assert!(is_ymd(&date), "{date}");
        assert!(is_hhmm(&start), "{start}");
        assert!(is_hhmm(&end), "{end}");
        assert_ne!(start, end);
        assert!(local_date_and_hm(&conn, "").is_err());
        assert!(local_date_and_hm(&conn, "   ").is_err());
    }

    fn is_ymd(value: &str) -> bool {
        let bytes = value.as_bytes();
        bytes.len() == 10 && bytes[4] == b'-' && bytes[7] == b'-'
    }

    fn is_hhmm(value: &str) -> bool {
        let bytes = value.as_bytes();
        bytes.len() == 5 && bytes[2] == b':'
    }
}
