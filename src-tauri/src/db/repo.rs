use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use super::error::{DbError, DbResult};
use super::models::{
    CalendarEvent, Link, Meeting, Note, NoteType, Task, TaskPriority, TaskState,
};
use super::time::utc_now;

pub struct Repository<'a> {
    conn: &'a Connection,
}

impl<'a> Repository<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    // --- notes ---

    pub fn create_note(
        &self,
        title: &str,
        body_markdown: &str,
        note_type: NoteType,
        pinned: bool,
    ) -> DbResult<Note> {
        let now = utc_now(self.conn)?;
        let note = Note {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            body_markdown: body_markdown.to_string(),
            note_type,
            pinned,
            created_at: now.clone(),
            updated_at: now,
        };

        self.conn.execute(
            "INSERT INTO notes (id, title, body_markdown, note_type, pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                note.id,
                note.title,
                note.body_markdown,
                note.note_type.as_str(),
                note.pinned as i64,
                note.created_at,
                note.updated_at,
            ],
        )?;
        Ok(note)
    }

    pub fn get_note(&self, id: &str) -> DbResult<Note> {
        self.conn
            .query_row(
                "SELECT id, title, body_markdown, note_type, pinned, created_at, updated_at
                 FROM notes WHERE id = ?1",
                [id],
                map_note,
            )
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn list_notes(&self) -> DbResult<Vec<Note>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, body_markdown, note_type, pinned, created_at, updated_at
             FROM notes
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], map_note)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn update_note(
        &self,
        id: &str,
        title: &str,
        body_markdown: &str,
        pinned: bool,
    ) -> DbResult<Note> {
        let updated_at = utc_now(self.conn)?;
        let changed = self.conn.execute(
            "UPDATE notes
             SET title = ?1, body_markdown = ?2, pinned = ?3, updated_at = ?4
             WHERE id = ?5",
            params![title, body_markdown, pinned as i64, updated_at, id],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        self.get_note(id)
    }

    pub fn delete_note(&self, id: &str) -> DbResult<()> {
        let changed = self
            .conn
            .execute("DELETE FROM notes WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Case-insensitive title substring match (`LIKE`), newest first.
    pub fn search_notes_by_title(&self, query: &str) -> DbResult<Vec<Note>> {
        let pattern = like_contains_pattern(&query.to_lowercase());
        let mut stmt = self.conn.prepare(
            "SELECT id, title, body_markdown, note_type, pinned, created_at, updated_at
             FROM notes
             WHERE LOWER(title) LIKE ?1 ESCAPE '\\'
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([pattern], map_note)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    // --- links ---

    pub fn create_link(&self, source_note_id: &str, target_note_id: &str) -> DbResult<Link> {
        let link = Link {
            source_note_id: source_note_id.to_string(),
            target_note_id: target_note_id.to_string(),
            created_at: utc_now(self.conn)?,
        };
        self.conn.execute(
            "INSERT INTO links (source_note_id, target_note_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![link.source_note_id, link.target_note_id, link.created_at],
        )?;
        Ok(link)
    }

    pub fn get_link(&self, source_note_id: &str, target_note_id: &str) -> DbResult<Link> {
        self.conn
            .query_row(
                "SELECT source_note_id, target_note_id, created_at
                 FROM links
                 WHERE source_note_id = ?1 AND target_note_id = ?2",
                params![source_note_id, target_note_id],
                map_link,
            )
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn list_links_from(&self, source_note_id: &str) -> DbResult<Vec<Link>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_note_id, target_note_id, created_at
             FROM links WHERE source_note_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([source_note_id], map_link)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn delete_link(&self, source_note_id: &str, target_note_id: &str) -> DbResult<()> {
        let changed = self.conn.execute(
            "DELETE FROM links WHERE source_note_id = ?1 AND target_note_id = ?2",
            params![source_note_id, target_note_id],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    // --- tasks ---

    pub fn create_task(
        &self,
        note_id: &str,
        title: &str,
        state: TaskState,
        due_date: Option<&str>,
        priority: Option<TaskPriority>,
    ) -> DbResult<Task> {
        let now = utc_now(self.conn)?;
        let completed_at = matches!(state, TaskState::Done | TaskState::Cancelled).then(|| now.clone());
        let task = Task {
            id: Uuid::new_v4().to_string(),
            note_id: note_id.to_string(),
            title: title.to_string(),
            state,
            due_date: due_date.map(str::to_string),
            priority,
            created_at: now.clone(),
            updated_at: now,
            completed_at,
        };

        self.conn.execute(
            "INSERT INTO tasks (
                id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                task.id,
                task.note_id,
                task.title,
                task.state.as_str(),
                task.due_date,
                task.priority.map(TaskPriority::as_str),
                task.created_at,
                task.updated_at,
                task.completed_at,
            ],
        )?;
        Ok(task)
    }

    pub fn get_task(&self, id: &str) -> DbResult<Task> {
        self.conn
            .query_row(
                "SELECT id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
                 FROM tasks WHERE id = ?1",
                [id],
                map_task,
            )
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn list_tasks_for_note(&self, note_id: &str) -> DbResult<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
             FROM tasks WHERE note_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([note_id], map_task)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn update_task(
        &self,
        id: &str,
        title: &str,
        state: TaskState,
        due_date: Option<&str>,
        priority: Option<TaskPriority>,
    ) -> DbResult<Task> {
        let existing = self.get_task(id)?;
        let updated_at = utc_now(self.conn)?;
        let completed_at = match state {
            TaskState::Done | TaskState::Cancelled => {
                existing.completed_at.or_else(|| Some(updated_at.clone()))
            }
            TaskState::Open | TaskState::Waiting => None,
        };

        let changed = self.conn.execute(
            "UPDATE tasks
             SET title = ?1, state = ?2, due_date = ?3, priority = ?4,
                 updated_at = ?5, completed_at = ?6
             WHERE id = ?7",
            params![
                title,
                state.as_str(),
                due_date,
                priority.map(TaskPriority::as_str),
                updated_at,
                completed_at,
                id,
            ],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        self.get_task(id)
    }

    pub fn delete_task(&self, id: &str) -> DbResult<()> {
        let changed = self
            .conn
            .execute("DELETE FROM tasks WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    // --- calendar_events ---

    pub fn create_calendar_event(
        &self,
        title: &str,
        start: &str,
        end: &str,
        task_id: Option<&str>,
    ) -> DbResult<CalendarEvent> {
        let event = CalendarEvent {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            start: start.to_string(),
            end: end.to_string(),
            task_id: task_id.map(str::to_string),
            created_at: utc_now(self.conn)?,
        };
        self.conn.execute(
            "INSERT INTO calendar_events (id, title, start, \"end\", task_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                event.id,
                event.title,
                event.start,
                event.end,
                event.task_id,
                event.created_at,
            ],
        )?;
        Ok(event)
    }

    pub fn get_calendar_event(&self, id: &str) -> DbResult<CalendarEvent> {
        self.conn
            .query_row(
                "SELECT id, title, start, \"end\", task_id, created_at
                 FROM calendar_events WHERE id = ?1",
                [id],
                map_calendar_event,
            )
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn list_calendar_events(&self) -> DbResult<Vec<CalendarEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, start, \"end\", task_id, created_at
             FROM calendar_events
             ORDER BY start ASC",
        )?;
        let rows = stmt.query_map([], map_calendar_event)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn update_calendar_event(
        &self,
        id: &str,
        title: &str,
        start: &str,
        end: &str,
        task_id: Option<&str>,
    ) -> DbResult<CalendarEvent> {
        let changed = self.conn.execute(
            "UPDATE calendar_events
             SET title = ?1, start = ?2, \"end\" = ?3, task_id = ?4
             WHERE id = ?5",
            params![title, start, end, task_id, id],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        self.get_calendar_event(id)
    }

    pub fn delete_calendar_event(&self, id: &str) -> DbResult<()> {
        let changed = self
            .conn
            .execute("DELETE FROM calendar_events WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    // --- meetings ---

    pub fn create_meeting(
        &self,
        note_id: &str,
        meeting_date: &str,
        start_time: &str,
        end_time: &str,
        transcript_note_id: Option<&str>,
    ) -> DbResult<Meeting> {
        let meeting = Meeting {
            note_id: note_id.to_string(),
            meeting_date: meeting_date.to_string(),
            start_time: start_time.to_string(),
            end_time: end_time.to_string(),
            transcript_note_id: transcript_note_id.map(str::to_string),
        };
        self.conn.execute(
            "INSERT INTO meetings (
                note_id, meeting_date, start_time, end_time, transcript_note_id
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                meeting.note_id,
                meeting.meeting_date,
                meeting.start_time,
                meeting.end_time,
                meeting.transcript_note_id,
            ],
        )?;
        Ok(meeting)
    }

    pub fn get_meeting(&self, note_id: &str) -> DbResult<Meeting> {
        self.conn
            .query_row(
                "SELECT note_id, meeting_date, start_time, end_time, transcript_note_id
                 FROM meetings WHERE note_id = ?1",
                [note_id],
                map_meeting,
            )
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn list_meetings(&self) -> DbResult<Vec<Meeting>> {
        let mut stmt = self.conn.prepare(
            "SELECT note_id, meeting_date, start_time, end_time, transcript_note_id
             FROM meetings
             ORDER BY meeting_date ASC, start_time ASC",
        )?;
        let rows = stmt.query_map([], map_meeting)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn update_meeting(
        &self,
        note_id: &str,
        meeting_date: &str,
        start_time: &str,
        end_time: &str,
        transcript_note_id: Option<&str>,
    ) -> DbResult<Meeting> {
        let changed = self.conn.execute(
            "UPDATE meetings
             SET meeting_date = ?1, start_time = ?2, end_time = ?3, transcript_note_id = ?4
             WHERE note_id = ?5",
            params![
                meeting_date,
                start_time,
                end_time,
                transcript_note_id,
                note_id
            ],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        self.get_meeting(note_id)
    }

    pub fn delete_meeting(&self, note_id: &str) -> DbResult<()> {
        let changed = self
            .conn
            .execute("DELETE FROM meetings WHERE note_id = ?1", [note_id])?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }
}

fn like_contains_pattern(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len().saturating_mul(2) + 2);
    escaped.push('%');
    for ch in query.chars() {
        match ch {
            '\\' | '%' | '_' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            _ => escaped.push(ch),
        }
    }
    escaped.push('%');
    escaped
}

fn map_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    let note_type: String = row.get(3)?;
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        body_markdown: row.get(2)?,
        note_type: NoteType::parse(&note_type).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                format!("invalid note_type: {note_type}").into(),
            )
        })?,
        pinned: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<Link> {
    Ok(Link {
        source_note_id: row.get(0)?,
        target_note_id: row.get(1)?,
        created_at: row.get(2)?,
    })
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let state: String = row.get(3)?;
    let priority: Option<String> = row.get(5)?;
    Ok(Task {
        id: row.get(0)?,
        note_id: row.get(1)?,
        title: row.get(2)?,
        state: TaskState::parse(&state).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                format!("invalid task state: {state}").into(),
            )
        })?,
        due_date: row.get(4)?,
        priority: priority
            .map(|value| {
                TaskPriority::parse(&value).ok_or_else(|| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Text,
                        format!("invalid task priority: {value}").into(),
                    )
                })
            })
            .transpose()?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        completed_at: row.get(8)?,
    })
}

fn map_calendar_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        start: row.get(2)?,
        end: row.get(3)?,
        task_id: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn map_meeting(row: &rusqlite::Row<'_>) -> rusqlite::Result<Meeting> {
    Ok(Meeting {
        note_id: row.get(0)?,
        meeting_date: row.get(1)?,
        start_time: row.get(2)?,
        end_time: row.get(3)?,
        transcript_note_id: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate::migrate;
    use rusqlite::Connection;

    fn with_repo<T>(f: impl FnOnce(&Repository<'_>) -> T) -> T {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        f(&Repository::new(&conn))
    }

    #[test]
    fn notes_crud_round_trip() {
        with_repo(|repo| {
            let created = repo
                .create_note("Hello", "body", NoteType::Regular, true)
                .unwrap();
            assert!(created.pinned);
            assert_eq!(created.note_type, NoteType::Regular);

            let fetched = repo.get_note(&created.id).unwrap();
            assert_eq!(fetched.title, "Hello");

            let updated = repo
                .update_note(&created.id, "Hello 2", "body 2", false)
                .unwrap();
            assert_eq!(updated.title, "Hello 2");
            assert!(!updated.pinned);

            let listed = repo.list_notes().unwrap();
            assert_eq!(listed.len(), 1);

            repo.delete_note(&created.id).unwrap();
            assert!(matches!(repo.get_note(&created.id), Err(DbError::NotFound)));
        });
    }

    #[test]
    fn search_notes_by_title_is_case_insensitive_and_escapes_like() {
        with_repo(|repo| {
            repo.create_note("Pricing v2", "", NoteType::Regular, false)
                .unwrap();
            repo.create_note("pricing sync", "", NoteType::Meeting, false)
                .unwrap();
            repo.create_note("100% done_draft", "", NoteType::Regular, false)
                .unwrap();
            repo.create_note("Unrelated", "", NoteType::Regular, false)
                .unwrap();

            let hits = repo.search_notes_by_title("PRICING").unwrap();
            assert_eq!(hits.len(), 2);
            assert!(hits.iter().all(|n| n.title.to_lowercase().contains("pricing")));

            let literal = repo.search_notes_by_title("100%").unwrap();
            assert_eq!(literal.len(), 1);
            assert_eq!(literal[0].title, "100% done_draft");

            let underscore = repo.search_notes_by_title("done_draft").unwrap();
            assert_eq!(underscore.len(), 1);

            let empty = repo.search_notes_by_title("").unwrap();
            assert_eq!(empty.len(), 4);
        });
    }

    #[test]
    fn search_notes_by_title_stays_fast_for_1k() {
        with_repo(|repo| {
            const COUNT: usize = 1000;
            const BUDGET_MS: u128 = 50;
            for i in 0..COUNT {
                repo.create_note(&format!("Note {i:04}"), "", NoteType::Regular, false)
                    .unwrap();
            }
            // Warm statement/cache path once, then measure the hot search.
            let _ = repo.search_notes_by_title("Note 05").unwrap();
            let start = std::time::Instant::now();
            let hits = repo.search_notes_by_title("Note 05").unwrap();
            let elapsed = start.elapsed();
            eprintln!(
                "[search-kpi] {COUNT} notes, query=\"Note 05\", hits={}, {:.2}ms (budget {BUDGET_MS}ms)",
                hits.len(),
                elapsed.as_secs_f64() * 1000.0
            );
            assert!(
                elapsed.as_millis() < BUDGET_MS,
                "search took {elapsed:?}, budget {BUDGET_MS}ms"
            );
            assert!(!hits.is_empty());
            assert!(hits.len() < COUNT, "query should not return the full corpus");
        });
    }

    #[test]
    fn links_crud_and_cascade() {
        with_repo(|repo| {
            let a = repo
                .create_note("A", "", NoteType::Regular, false)
                .unwrap();
            let b = repo
                .create_note("B", "", NoteType::Regular, false)
                .unwrap();
            let link = repo.create_link(&a.id, &b.id).unwrap();
            assert_eq!(
                repo.get_link(&a.id, &b.id).unwrap().target_note_id,
                b.id
            );
            assert_eq!(repo.list_links_from(&a.id).unwrap().len(), 1);

            repo.delete_link(&link.source_note_id, &link.target_note_id)
                .unwrap();
            assert!(matches!(
                repo.get_link(&a.id, &b.id),
                Err(DbError::NotFound)
            ));

            let link = repo.create_link(&a.id, &b.id).unwrap();
            repo.delete_note(&a.id).unwrap();
            assert!(matches!(
                repo.get_link(&link.source_note_id, &link.target_note_id),
                Err(DbError::NotFound)
            ));
        });
    }

    #[test]
    fn tasks_crud_round_trip() {
        with_repo(|repo| {
            let note = repo
                .create_note("Tasks", "", NoteType::Daily, false)
                .unwrap();
            let created = repo
                .create_task(
                    &note.id,
                    "Buy milk",
                    TaskState::Open,
                    Some("2026-08-11"),
                    Some(TaskPriority::High),
                )
                .unwrap();
            assert!(created.completed_at.is_none());

            let done = repo
                .update_task(
                    &created.id,
                    "Buy milk",
                    TaskState::Done,
                    Some("2026-08-11"),
                    Some(TaskPriority::High),
                )
                .unwrap();
            assert_eq!(done.state, TaskState::Done);
            assert!(done.completed_at.is_some());

            assert_eq!(repo.list_tasks_for_note(&note.id).unwrap().len(), 1);
            repo.delete_task(&created.id).unwrap();
            assert!(matches!(repo.get_task(&created.id), Err(DbError::NotFound)));
        });
    }

    #[test]
    fn calendar_events_crud_round_trip() {
        with_repo(|repo| {
            let note = repo
                .create_note("Tasks", "", NoteType::Regular, false)
                .unwrap();
            let task = repo
                .create_task(&note.id, "Focus", TaskState::Open, None, None)
                .unwrap();
            let created = repo
                .create_calendar_event(
                    "Deep work",
                    "2026-08-10T09:00:00.000Z",
                    "2026-08-10T09:15:00.000Z",
                    Some(&task.id),
                )
                .unwrap();

            let updated = repo
                .update_calendar_event(
                    &created.id,
                    "Deep work",
                    "2026-08-10T10:00:00.000Z",
                    "2026-08-10T10:30:00.000Z",
                    None,
                )
                .unwrap();
            assert_eq!(updated.start, "2026-08-10T10:00:00.000Z");
            assert!(updated.task_id.is_none());
            assert_eq!(repo.list_calendar_events().unwrap().len(), 1);

            repo.delete_calendar_event(&created.id).unwrap();
            assert!(matches!(
                repo.get_calendar_event(&created.id),
                Err(DbError::NotFound)
            ));
        });
    }

    #[test]
    fn meetings_crud_round_trip() {
        with_repo(|repo| {
            let note = repo
                .create_note("1-1", "", NoteType::Meeting, false)
                .unwrap();
            let created = repo
                .create_meeting(&note.id, "2026-08-10", "09:00", "09:30", None)
                .unwrap();
            assert_eq!(created.meeting_date, "2026-08-10");

            let updated = repo
                .update_meeting(&note.id, "2026-08-11", "10:00", "10:30", None)
                .unwrap();
            assert_eq!(updated.start_time, "10:00");
            assert_eq!(repo.list_meetings().unwrap().len(), 1);

            repo.delete_meeting(&note.id).unwrap();
            assert!(matches!(
                repo.get_meeting(&note.id),
                Err(DbError::NotFound)
            ));
        });
    }

    }
