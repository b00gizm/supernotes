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

/// Local ms since midnight (`localtime`). Used for utterance clocks, not scheduled meeting start.
pub fn local_ms_of_day(conn: &Connection) -> DbResult<u64> {
    let (hour, minute, frac): (String, String, String) = conn.query_row(
        "SELECT strftime('%H', 'now', 'localtime'),
                strftime('%M', 'now', 'localtime'),
                strftime('%f', 'now', 'localtime')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let hour: u64 = hour
        .parse()
        .map_err(|_| DbError::Invalid(format!("could not parse local hour {hour:?}")))?;
    let minute: u64 = minute
        .parse()
        .map_err(|_| DbError::Invalid(format!("could not parse local minute {minute:?}")))?;
    let frac: f64 = frac
        .parse()
        .map_err(|_| DbError::Invalid(format!("could not parse local seconds {frac:?}")))?;
    // `%f` is SS.sss
    let ms = (frac * 1000.0).round() as u64;
    Ok(hour
        .saturating_mul(3_600_000)
        .saturating_add(minute.saturating_mul(60_000))
        .saturating_add(ms))
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

        let now = utc_now(&conn).unwrap();
        let (_date, hm) = local_date_and_hm(&conn, &now).unwrap();
        let ms = local_ms_of_day(&conn).unwrap();
        let from_ms = format!("{:02}:{:02}", (ms / 60_000) / 60 % 24, (ms / 60_000) % 60);
        assert_eq!(from_ms, hm);
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
