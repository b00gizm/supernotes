mod error;
mod migrate;
mod models;
mod repo;
mod time;
mod wikilinks;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

pub use error::{DbError, DbResult};
pub use migrate::{current_version, migrate};
pub use models::*;
pub use repo::Repository;
pub use time::local_ms_of_day;
pub use wikilinks::{extract_wikilink_titles, rewrite_wikilink_title};

const DB_FILE_NAME: &str = "supernotes.sqlite3";

pub struct Db {
    path: PathBuf,
    // ponytail: process-wide mutex; upgrade to a pool if concurrent writers hurt.
    conn: Mutex<Connection>,
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
        assert_eq!(db.path(), dir.join(DB_FILE_NAME).as_path());
        assert_eq!(db.with_conn(current_version).unwrap(), 4);

        let memory = Db::open_in_memory().unwrap();
        assert_eq!(memory.with_conn(current_version).unwrap(), 4);

        let _ = fs::remove_dir_all(dir);
    }
}
