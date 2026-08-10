-- Schema v1: notes, links, tasks, calendar_events, meetings.
-- Timestamps are ISO-8601 UTC text. Booleans are INTEGER 0/1.

CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL DEFAULT '',
    note_type TEXT NOT NULL CHECK (note_type IN ('regular', 'daily', 'meeting')),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX notes_updated_at_idx ON notes (updated_at DESC);
CREATE INDEX notes_note_type_idx ON notes (note_type);
CREATE INDEX notes_pinned_idx ON notes (pinned) WHERE pinned = 1;

CREATE TABLE links (
    source_note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    target_note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_note_id, target_note_id)
);

CREATE INDEX links_target_idx ON links (target_note_id);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'waiting', 'done', 'cancelled')),
    due_date TEXT,
    priority TEXT CHECK (
        priority IS NULL
        OR priority IN ('none', 'low', 'medium', 'high', 'urgent')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX tasks_note_id_idx ON tasks (note_id);
CREATE INDEX tasks_state_idx ON tasks (state);
CREATE INDEX tasks_due_date_idx ON tasks (due_date);

CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    "end" TEXT NOT NULL,
    task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX calendar_events_start_idx ON calendar_events (start);
CREATE INDEX calendar_events_task_id_idx ON calendar_events (task_id);

CREATE TABLE meetings (
    note_id TEXT PRIMARY KEY NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    meeting_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    transcript_note_id TEXT REFERENCES notes (id) ON DELETE SET NULL
);
