use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
}

pub type DbResult<T> = Result<T, DbError>;
