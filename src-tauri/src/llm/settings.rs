//! Persist base URL + model in SQLite. Never the API key.

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{utc_now, DbResult};

use super::{LlmIpcError, DEFAULT_BASE_URL, DEFAULT_MODEL};

pub fn load_settings(conn: &Connection) -> DbResult<(String, String)> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT base_url, model FROM llm_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(row.unwrap_or_else(|| (DEFAULT_BASE_URL.to_string(), DEFAULT_MODEL.to_string())))
}

pub fn save_settings(conn: &Connection, base_url: &str, model: &str) -> DbResult<()> {
    let now = utc_now(conn)?;
    conn.execute(
        "INSERT INTO llm_settings (id, base_url, model, updated_at)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
            base_url = excluded.base_url,
            model = excluded.model,
            updated_at = excluded.updated_at",
        params![base_url, model, now],
    )?;
    Ok(())
}

pub fn validate_settings(base_url: &str, model: &str) -> Result<(String, String), LlmIpcError> {
    let base_url = base_url.trim();
    let model = model.trim();
    if base_url.is_empty() {
        return Err(LlmIpcError::invalid("Base URL is required."));
    }
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(LlmIpcError::invalid(
            "Base URL must start with http:// or https://.",
        ));
    }
    if model.is_empty() {
        return Err(LlmIpcError::invalid("Model name is required."));
    }
    Ok((base_url.to_string(), model.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn load_returns_defaults_when_empty() {
        let db = Db::open_in_memory().unwrap();
        let (base_url, model) = db.with_conn(load_settings).unwrap();
        assert_eq!(base_url, DEFAULT_BASE_URL);
        assert_eq!(model, DEFAULT_MODEL);
    }

    #[test]
    fn save_round_trips_base_url_and_model() {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|conn| save_settings(conn, "http://127.0.0.1:11434/v1", "llama3.2"))
            .unwrap();
        let (base_url, model) = db.with_conn(load_settings).unwrap();
        assert_eq!(base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(model, "llama3.2");
    }

    #[test]
    fn validate_rejects_non_http() {
        let err = validate_settings("ftp://x", "gpt").unwrap_err();
        assert_eq!(err.code, "invalid");
    }
}
