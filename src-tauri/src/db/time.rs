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
    let (date, hm) = conn.query_row(
        "SELECT strftime('%Y-%m-%d', ?1, 'utc', 'localtime'),
                strftime('%H:%M', ?1, 'utc', 'localtime')",
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

    #[test]
    fn local_date_and_hm_uses_process_timezone() {
        with_tz("America/Los_Angeles", || {
            let conn = Connection::open_in_memory().unwrap();
            // 21:00 UTC in August is 14:00 PDT (UTC-7).
            let (date, hm) = local_date_and_hm(&conn, "2026-08-10T21:00:00.000Z").unwrap();
            assert_eq!(date, "2026-08-10");
            assert_eq!(hm, "14:00");
        });
        with_tz("Europe/Berlin", || {
            let conn = Connection::open_in_memory().unwrap();
            // 12:00 UTC in August is 14:00 CEST (UTC+2).
            let (date, hm) = local_date_and_hm(&conn, "2026-08-10T12:00:00.000Z").unwrap();
            assert_eq!(date, "2026-08-10");
            assert_eq!(hm, "14:00");
        });
    }
}
