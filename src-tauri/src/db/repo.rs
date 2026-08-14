use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use super::error::{DbError, DbResult};
use super::models::{
    CalendarEvent, Link, Meeting, Note, NoteType, Task, TaskListFilter, TaskPriority, TaskState,
};
use super::time::utc_now;
use super::wikilinks::{extract_wikilink_titles, rewrite_wikilink_title, titles_eq_folded};

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
        let tx = self.conn.unchecked_transaction()?;
        let repo = Repository::new(&tx);
        let now = utc_now(repo.conn)?;
        let note = Note {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            body_markdown: body_markdown.to_string(),
            note_type,
            pinned,
            created_at: now.clone(),
            updated_at: now,
        };

        repo.conn.execute(
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
        repo.sync_links_from_body(&note.id, body_markdown)?;
        // Unresolved `[[…]]` / `#` / `@` at earlier saves gain rows once the target exists.
        repo.backfill_incoming_links(&note)?;
        tx.commit()?;
        Ok(note)
    }

    /// Canonical daily title is `YYYY-MM-DD`. Returns the existing note or creates it.
    pub fn get_or_create_daily(&self, date: &str) -> DbResult<Note> {
        let date = date.trim();
        if !is_daily_title(date) {
            return Err(DbError::Invalid(format!(
                "daily date must be YYYY-MM-DD, got {date:?}"
            )));
        }
        if let Some(existing) = self.find_daily_by_title(date)? {
            return Ok(existing);
        }
        match self.create_note(date, "", NoteType::Daily, false) {
            Ok(note) => Ok(note),
            Err(DbError::Sqlite(rusqlite::Error::SqliteFailure(info, _)))
                if info.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                self.find_daily_by_title(date)?.ok_or(DbError::NotFound)
            }
            Err(err) => Err(err),
        }
    }

    fn find_daily_by_title(&self, title: &str) -> DbResult<Option<Note>> {
        self.conn
            .query_row(
                "SELECT id, title, body_markdown, note_type, pinned, created_at, updated_at
                 FROM notes
                 WHERE note_type = 'daily' AND title = ?1",
                [title],
                map_note,
            )
            .optional()
            .map_err(DbError::from)
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

    pub fn update_note(&self, id: &str, title: &str, body_markdown: &str) -> DbResult<Note> {
        let tx = self.conn.unchecked_transaction()?;
        let repo = Repository::new(&tx);
        let previous = repo.get_note(id)?;
        let updated_at = utc_now(repo.conn)?;
        let changed = repo.conn.execute(
            "UPDATE notes
             SET title = ?1, body_markdown = ?2, updated_at = ?3
             WHERE id = ?4",
            params![title, body_markdown, updated_at, id],
        )?;
        if changed == 0 {
            return Err(DbError::NotFound);
        }
        repo.sync_links_from_body(id, body_markdown)?;
        if previous.title != title {
            // Linking notes store the display title in markdown; keep them in sync.
            // Deliberately does not bump their updated_at (recency stays theirs).
            repo.rewrite_incoming_wikilink_titles(id, &previous.title, title)?;
        }
        let note = repo.get_note(id)?;
        tx.commit()?;
        Ok(note)
    }

    /// Case-insensitive title match; prefers exact case, then newest `updated_at`.
    pub fn find_note_by_title(&self, title: &str) -> DbResult<Option<Note>> {
        let needle = title.trim();
        if needle.is_empty() {
            return Ok(None);
        }
        // ponytail: load-all then Unicode-fold in Rust — SQLite LOWER() is ASCII-only
        // (Ü ≠ ü). Fine for personal corpora; stored fold column if this shows up in profiles.
        let notes = self.list_notes()?;
        let mut fallback = None;
        for note in notes {
            if !titles_eq_folded(&note.title, needle) {
                continue;
            }
            if note.title == needle {
                return Ok(Some(note));
            }
            if fallback.is_none() {
                fallback = Some(note);
            }
        }
        Ok(fallback)
    }

    /// Metadata toggle: deliberately leaves `updated_at` untouched.
    pub fn set_pinned(&self, id: &str, pinned: bool) -> DbResult<Note> {
        let changed = self.conn.execute(
            "UPDATE notes SET pinned = ?1 WHERE id = ?2",
            params![pinned as i64, id],
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

    pub fn list_links_to(&self, target_note_id: &str) -> DbResult<Vec<Link>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_note_id, target_note_id, created_at
             FROM links WHERE target_note_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([target_note_id], map_link)?;
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

    /// Replace the outbound link set for a note (derived from `[[…]]` in the body).
    pub fn replace_links_for_source(
        &self,
        source_note_id: &str,
        target_note_ids: &[String],
    ) -> DbResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        Repository::new(&tx).replace_links_for_source_in_tx(source_note_id, target_note_ids)?;
        tx.commit()?;
        Ok(())
    }

    /// Caller must already hold a transaction (e.g. create/update note).
    fn replace_links_for_source_in_tx(
        &self,
        source_note_id: &str,
        target_note_ids: &[String],
    ) -> DbResult<()> {
        self.conn.execute(
            "DELETE FROM links WHERE source_note_id = ?1",
            [source_note_id],
        )?;
        let mut seen = std::collections::HashSet::new();
        for target in target_note_ids {
            if target == source_note_id || !seen.insert(target.as_str()) {
                continue;
            }
            let _ = self.create_link(source_note_id, target)?;
        }
        Ok(())
    }

    fn sync_links_from_body(&self, source_note_id: &str, body_markdown: &str) -> DbResult<()> {
        let mut targets = Vec::new();
        for title in extract_wikilink_titles(body_markdown) {
            if let Some(note) = self.find_note_by_title(&title)? {
                targets.push(note.id);
            }
        }
        self.replace_links_for_source_in_tx(source_note_id, &targets)
    }

    /// When a note is created, attach link rows from existing bodies that already
    /// mention its title (create-on-click / late target).
    /// ponytail: O(n notes) scan on create — fine for personal corpora; index later if needed.
    fn backfill_incoming_links(&self, new_note: &Note) -> DbResult<()> {
        let sources = self.list_notes()?;
        for source in sources {
            if source.id == new_note.id {
                continue;
            }
            let mut mentions = false;
            for title in extract_wikilink_titles(&source.body_markdown) {
                if let Some(target) = self.find_note_by_title(&title)? {
                    if target.id == new_note.id {
                        mentions = true;
                        break;
                    }
                }
            }
            if !mentions {
                continue;
            }
            if matches!(self.get_link(&source.id, &new_note.id), Ok(_)) {
                continue;
            }
            let _ = self.create_link(&source.id, &new_note.id)?;
        }
        Ok(())
    }

    fn rewrite_incoming_wikilink_titles(
        &self,
        target_note_id: &str,
        old_title: &str,
        new_title: &str,
    ) -> DbResult<()> {
        let incoming = self.list_links_to(target_note_id)?;
        for link in incoming {
            let source = self.get_note(&link.source_note_id)?;
            let rewritten = rewrite_wikilink_title(&source.body_markdown, old_title, new_title);
            if rewritten == source.body_markdown {
                continue;
            }
            self.conn.execute(
                "UPDATE notes SET body_markdown = ?1 WHERE id = ?2",
                params![rewritten, source.id],
            )?;
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

    /// Title search for ⌘K (ENG-122). Empty query returns all tasks, newest first.
    pub fn search_tasks_by_title(&self, query: &str) -> DbResult<Vec<Task>> {
        let pattern = like_contains_pattern(&query.to_lowercase());
        let mut stmt = self.conn.prepare(
            "SELECT id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
             FROM tasks
             WHERE LOWER(title) LIKE ?1 ESCAPE '\\'
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([pattern], map_task)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    /// Inbox / Upcoming / Complete queries for the Tasks sidebar (ENG-63).
    /// `today` is local calendar `YYYY-MM-DD` (overdue + 14-day complete window).
    pub fn list_tasks(&self, filter: TaskListFilter, today: &str) -> DbResult<Vec<Task>> {
        let priority_order = "CASE priority
                WHEN 'urgent' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
                WHEN 'none' THEN 4
                ELSE 5
             END";
        let (sql, params): (String, Vec<String>) = match filter {
            TaskListFilter::Inbox => (
                "SELECT id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
                 FROM tasks
                 WHERE state IN ('open', 'waiting') AND due_date IS NULL
                 ORDER BY created_at DESC"
                    .to_string(),
                vec![],
            ),
            TaskListFilter::Upcoming => (
                format!(
                    "SELECT id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
                     FROM tasks
                     WHERE state IN ('open', 'waiting') AND due_date IS NOT NULL
                     ORDER BY due_date ASC, {priority_order} ASC, created_at ASC"
                ),
                vec![],
            ),
            // ponytail: completed_at is UTC ISO; window uses the UTC calendar
            // prefix against local `today`. Upgrade: convert to local date first.
            TaskListFilter::Complete => (
                "SELECT id, note_id, title, state, due_date, priority, created_at, updated_at, completed_at
                 FROM tasks
                 WHERE state IN ('done', 'cancelled')
                   AND completed_at IS NOT NULL
                   AND substr(completed_at, 1, 10) >= date(?1, '-14 days')
                 ORDER BY completed_at DESC"
                    .to_string(),
                vec![today.to_string()],
            ),
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = if params.is_empty() {
            stmt.query_map([], map_task)?
        } else {
            stmt.query_map(params![params[0]], map_task)?
        };
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn update_task(
        &self,
        id: &str,
        title: Option<&str>,
        state: Option<TaskState>,
        due_date: Option<Option<&str>>,
        priority: Option<Option<TaskPriority>>,
    ) -> DbResult<Task> {
        let existing = self.get_task(id)?;
        let updated_at = utc_now(self.conn)?;
        let title = title.unwrap_or(&existing.title);
        let next_state = state.unwrap_or(existing.state);
        let due_date = match due_date {
            Some(value) => value,
            None => existing.due_date.as_deref(),
        };
        let priority = match priority {
            Some(value) => value,
            None => existing.priority,
        };
        // Only recompute completed_at when state is part of the patch.
        let completed_at = match state {
            None => existing.completed_at.clone(),
            Some(TaskState::Done | TaskState::Cancelled) => {
                existing.completed_at.or_else(|| Some(updated_at.clone()))
            }
            Some(TaskState::Open | TaskState::Waiting) => None,
        };

        let changed = self.conn.execute(
            "UPDATE tasks
             SET title = ?1, state = ?2, due_date = ?3, priority = ?4,
                 updated_at = ?5, completed_at = ?6
             WHERE id = ?7",
            params![
                title,
                next_state.as_str(),
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
        validate_event_range(start, end)?;
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

    /// Overlapping window: `start < to AND end > from`. Omit either bound to skip it.
    pub fn list_calendar_events(
        &self,
        from: Option<&str>,
        to: Option<&str>,
    ) -> DbResult<Vec<CalendarEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, start, \"end\", task_id, created_at
             FROM calendar_events
             WHERE (?1 IS NULL OR start < ?1)
               AND (?2 IS NULL OR \"end\" > ?2)
             ORDER BY start ASC",
        )?;
        let rows = stmt.query_map(params![to, from], map_calendar_event)?;
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
        validate_event_range(start, end)?;
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

fn is_daily_title(title: &str) -> bool {
    let bytes = title.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let Ok(year) = title[0..4].parse::<i32>() else {
        return false;
    };
    let Ok(month) = title[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = title[8..10].parse::<u32>() else {
        return false;
    };
    if !(1..=12).contains(&month) {
        return false;
    }
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max_day).contains(&day)
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

fn validate_event_range(start: &str, end: &str) -> DbResult<()> {
    if start.is_empty() || end.is_empty() {
        return Err(DbError::Invalid(
            "event start and end are required".to_string(),
        ));
    }
    if end <= start {
        return Err(DbError::Invalid(
            "event end must be after start".to_string(),
        ));
    }
    Ok(())
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

            let updated = repo.update_note(&created.id, "Hello 2", "body 2").unwrap();
            assert_eq!(updated.title, "Hello 2");
            assert!(updated.pinned, "content update must not touch pinned");

            let unpinned = repo.set_pinned(&created.id, false).unwrap();
            assert!(!unpinned.pinned);
            assert_eq!(
                unpinned.updated_at, updated.updated_at,
                "pin toggle must not touch updated_at"
            );

            let listed = repo.list_notes().unwrap();
            assert_eq!(listed.len(), 1);

            repo.delete_note(&created.id).unwrap();
            assert!(matches!(repo.get_note(&created.id), Err(DbError::NotFound)));
        });
    }

    #[test]
    fn get_or_create_daily_is_idempotent_and_unique() {
        with_repo(|repo| {
            let daily = repo.get_or_create_daily("2026-08-10").unwrap();
            assert_eq!(daily.note_type, NoteType::Daily);
            assert_eq!(daily.title, "2026-08-10");
            let again = repo.get_or_create_daily("2026-08-10").unwrap();
            assert_eq!(again.id, daily.id);
            assert!(repo.get_or_create_daily("Aug 10").is_err());
            assert!(
                repo.create_note("2026-08-10", "", NoteType::Daily, false)
                    .is_err(),
                "unique daily title enforced"
            );
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
    fn update_note_syncs_wikilinks_and_rename_rewrites_sources() {
        with_repo(|repo| {
            let target = repo
                .create_note("Foo", "", NoteType::Regular, false)
                .unwrap();
            let other = repo
                .create_note("Bar", "", NoteType::Regular, false)
                .unwrap();
            let source = repo
                .create_note(
                    "Source",
                    "See [[Foo]] and [[Missing]].",
                    NoteType::Regular,
                    false,
                )
                .unwrap();

            let links = repo.list_links_from(&source.id).unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].target_note_id, target.id);

            // Drop Foo, keep Bar — Missing still unresolved.
            let source = repo
                .update_note(&source.id, "Source", "See [[Bar]] only.")
                .unwrap();
            let links = repo.list_links_from(&source.id).unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].target_note_id, other.id);

            repo.update_note(&other.id, "Baz", "").unwrap();
            let source_after = repo.get_note(&source.id).unwrap();
            assert_eq!(source_after.body_markdown, "See [[Baz]] only.");
            // Linking note's updated_at must not bump on target rename.
            assert_eq!(source_after.updated_at, source.updated_at);
        });
    }

    #[test]
    fn unicode_fold_resolves_and_rewrites_wikilinks() {
        with_repo(|repo| {
            let target = repo
                .create_note("Über plan", "", NoteType::Regular, false)
                .unwrap();
            let found = repo.find_note_by_title("über plan").unwrap();
            assert_eq!(found.as_ref().map(|n| n.id.as_str()), Some(target.id.as_str()));

            let source = repo
                .create_note(
                    "Source",
                    "See [[über plan]].",
                    NoteType::Regular,
                    false,
                )
                .unwrap();
            let links = repo.list_links_from(&source.id).unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].target_note_id, target.id);

            repo.update_note(&target.id, "Done plan", "").unwrap();
            let source_after = repo.get_note(&source.id).unwrap();
            assert_eq!(source_after.body_markdown, "See [[Done plan]].");
            assert_eq!(source_after.updated_at, source.updated_at);
        });
    }

    #[test]
    fn deleting_wikilink_from_body_removes_link_row() {
        with_repo(|repo| {
            let target = repo
                .create_note("Foo", "", NoteType::Regular, false)
                .unwrap();
            let source = repo
                .create_note("Source", "[[Foo]]", NoteType::Regular, false)
                .unwrap();
            assert_eq!(repo.list_links_from(&source.id).unwrap().len(), 1);
            assert_eq!(
                repo.list_links_from(&source.id).unwrap()[0].target_note_id,
                target.id
            );

            repo.update_note(&source.id, "Source", "no links").unwrap();
            assert!(repo.list_links_from(&source.id).unwrap().is_empty());
        });
    }

    #[test]
    fn create_note_backfills_links_from_existing_mentions() {
        with_repo(|repo| {
            let source = repo
                .create_note(
                    "Source",
                    "Ask @Sam about #project and [[Missing]].",
                    NoteType::Regular,
                    false,
                )
                .unwrap();
            assert!(repo.list_links_from(&source.id).unwrap().is_empty());

            let sam = repo
                .create_note("Sam", "", NoteType::Regular, false)
                .unwrap();
            let project = repo
                .create_note("project", "", NoteType::Regular, false)
                .unwrap();

            let to_sam = repo.list_links_to(&sam.id).unwrap();
            assert_eq!(to_sam.len(), 1);
            assert_eq!(to_sam[0].source_note_id, source.id);

            let to_project = repo.list_links_to(&project.id).unwrap();
            assert_eq!(to_project.len(), 1);
            assert_eq!(to_project[0].source_note_id, source.id);

            assert!(repo.list_links_from(&source.id).unwrap().len() >= 2);
        });
    }

    #[test]
    fn replace_links_rolls_back_delete_when_insert_fails() {
        with_repo(|repo| {
            let a = repo
                .create_note("A", "", NoteType::Regular, false)
                .unwrap();
            let b = repo
                .create_note("B", "", NoteType::Regular, false)
                .unwrap();
            repo.create_link(&a.id, &b.id).unwrap();
            assert_eq!(repo.list_links_from(&a.id).unwrap().len(), 1);

            // FK violation on INSERT after DELETE — whole replace must roll back.
            let err = repo.replace_links_for_source(&a.id, &["missing-target".into()]);
            assert!(err.is_err());
            let links = repo.list_links_from(&a.id).unwrap();
            assert_eq!(links.len(), 1, "DELETE must not commit if INSERT fails");
            assert_eq!(links[0].target_note_id, b.id);
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
                    None,
                    Some(TaskState::Done),
                    None,
                    None,
                )
                .unwrap();
            assert_eq!(done.state, TaskState::Done);
            assert!(done.completed_at.is_some());
            assert_eq!(done.due_date.as_deref(), Some("2026-08-11"));
            assert_eq!(done.priority, Some(TaskPriority::High));

            assert_eq!(repo.list_tasks_for_note(&note.id).unwrap().len(), 1);
            repo.delete_task(&created.id).unwrap();
            assert!(matches!(repo.get_task(&created.id), Err(DbError::NotFound)));
        });
    }

    #[test]
    fn list_tasks_parity_fixture_matches_ts() {
        #[derive(serde::Deserialize)]
        struct Fixture {
            today: String,
            tasks: Vec<Task>,
            cases: Vec<Case>,
        }
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            filter: TaskListFilter,
            ids: Vec<String>,
        }
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../src/tasks/fixtures/list-tasks-parity.json"
        ))
        .expect("parity fixture");

        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let repo = Repository::new(&conn);
        let note = repo
            .create_note("Tasks", "", NoteType::Regular, false)
            .unwrap();
        for task in &fixture.tasks {
            conn.execute(
                "INSERT INTO tasks (
                    id, note_id, title, state, due_date, priority,
                    created_at, updated_at, completed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    task.id,
                    note.id,
                    task.title,
                    task.state.as_str(),
                    task.due_date,
                    task.priority.map(TaskPriority::as_str),
                    task.created_at,
                    task.updated_at,
                    task.completed_at,
                ],
            )
            .unwrap();
        }

        for case in fixture.cases {
            let listed = repo.list_tasks(case.filter, &fixture.today).unwrap();
            let ids: Vec<String> = listed.iter().map(|task| task.id.clone()).collect();
            assert_eq!(ids, case.ids, "{}", case.name);
        }
    }

    #[test]
    fn search_tasks_by_title_is_case_insensitive_and_escapes_like() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let repo = Repository::new(&conn);
        let note = repo
            .create_note("Tasks", "", NoteType::Regular, false)
            .unwrap();
        repo.create_task(&note.id, "Buy milk", TaskState::Open, None, None)
            .unwrap();
        repo.create_task(&note.id, "MILK run", TaskState::Waiting, None, None)
            .unwrap();
        repo.create_task(&note.id, "100% done_draft", TaskState::Open, None, None)
            .unwrap();
        repo.create_task(&note.id, "Unrelated", TaskState::Open, None, None)
            .unwrap();

        let hits = repo.search_tasks_by_title("MILK").unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|t| t.title.to_lowercase().contains("milk")));

        let literal = repo.search_tasks_by_title("100%").unwrap();
        assert_eq!(literal.len(), 1);
        assert_eq!(literal[0].title, "100% done_draft");

        let underscore = repo.search_tasks_by_title("done_draft").unwrap();
        assert_eq!(underscore.len(), 1);

        let empty = repo.search_tasks_by_title("").unwrap();
        assert_eq!(empty.len(), 4);
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
            assert_eq!(repo.list_calendar_events(None, None).unwrap().len(), 1);
            assert_eq!(
                repo.list_calendar_events(
                    Some("2026-08-10T10:00:00.000Z"),
                    Some("2026-08-10T11:00:00.000Z"),
                )
                .unwrap()
                .len(),
                1
            );
            assert!(
                repo.list_calendar_events(
                    Some("2026-08-10T12:00:00.000Z"),
                    Some("2026-08-10T13:00:00.000Z"),
                )
                .unwrap()
                .is_empty()
            );

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
