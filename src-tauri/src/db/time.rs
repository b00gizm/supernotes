use std::time::{SystemTime, UNIX_EPOCH};

/// ISO-8601 UTC timestamp with millisecond precision (`YYYY-MM-DDTHH:MM:SS.sssZ`).
pub fn utc_now() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch");
    format_utc_millis(duration.as_millis() as u64)
}

fn format_utc_millis(millis: u64) -> String {
    let secs = (millis / 1000) as i64;
    let ms = millis % 1000;

    // Civil date from Unix seconds (Howard Hinnant algorithm).
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400);
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z")
}

#[cfg(test)]
mod tests {
    use super::format_utc_millis;

    #[test]
    fn formats_unix_epoch() {
        assert_eq!(format_utc_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_utc_millis(1_001), "1970-01-01T00:00:01.001Z");
    }

    #[test]
    fn formats_known_instant() {
        // 2024-01-01T00:00:00.000Z
        assert_eq!(format_utc_millis(1_704_067_200_000), "2024-01-01T00:00:00.000Z");
    }
}
