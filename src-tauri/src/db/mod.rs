mod error;
mod migrate;
mod models;
mod repo;
mod time;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;

pub use error::{DbError, DbResult};
pub use migrate::{current_version, migrate};
pub use models::*;
pub use repo::Repository;

const DB_FILE_NAME: &str = "supernotes.sqlite3";

pub struct Db {
    path: PathBuf,
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DbStatus {
    pub path: String,
    pub schema_version: i64,
}

impl Db {
    pub fn open(app_data_dir: impl AsRef<Path>) -> DbResult<Self> {
        let dir = app_data_dir.as_ref();
        fs::create_dir_all(dir)?;
        let path = dir.join(DB_FILE_NAME);
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;",
        )?;
        migrate(&conn)?;
        Ok(Self {
            path,
            conn: Mutex::new(conn),
        })
    }

    pub fn open_in_memory() -> DbResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrate(&conn)?;
        Ok(Self {
            path: PathBuf::from(":memory:"),
            conn: Mutex::new(conn),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> DbResult<T>) -> DbResult<T> {
        let conn = self.conn.lock().expect("db mutex poisoned");
        f(&conn)
    }

    pub fn status(&self) -> DbResult<DbStatus> {
        self.with_conn(|conn| {
            Ok(DbStatus {
                path: self.path.display().to_string(),
                schema_version: current_version(conn)?,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn open_creates_db_file_and_migrates() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("supernotes-db-test-{nanos}"));
        let db = Db::open(&dir).unwrap();
        assert!(dir.join(DB_FILE_NAME).exists());

        let status = db.status().unwrap();
        assert_eq!(status.schema_version, 1);
        assert!(status.path.ends_with(DB_FILE_NAME));
        assert_eq!(db.path(), dir.join(DB_FILE_NAME).as_path());

        let memory = Db::open_in_memory().unwrap();
        assert_eq!(memory.status().unwrap().schema_version, 1);

        let _ = fs::remove_dir_all(dir);
    }
}
