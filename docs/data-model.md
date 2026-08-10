# Supernotes data model

SQLite is the source of truth. The database file is `supernotes.sqlite3` in the platform app-data directory (opened on app startup; migrations run automatically).

## Conventions

- Primary keys are UUID strings (`TEXT`).
- Timestamps are ISO-8601 UTC text with millisecond precision (`YYYY-MM-DDTHH:MM:SS.sssZ`).
- Booleans are stored as `INTEGER` (`0` / `1`).
- Foreign keys are enabled (`PRAGMA foreign_keys = ON`).
- Schema versions are tracked in `schema_migrations` and applied from `src-tauri/migrations/`.

## Tables (schema v1)

### `notes`

Core note document. `body_markdown` is the canonical content; the editor round-trips to this column later (M2).

| Column          | Type    | Notes                                              |
| --------------- | ------- | -------------------------------------------------- |
| `id`            | TEXT PK | UUID                                               |
| `title`         | TEXT    |                                                    |
| `body_markdown` | TEXT    | default `''`                                       |
| `note_type`     | TEXT    | `regular` \| `daily` \| `meeting`                  |
| `pinned`        | INTEGER | `0`/`1`, default `0` (Notes overview Pinned group) |
| `created_at`    | TEXT    |                                                    |
| `updated_at`    | TEXT    |                                                    |

### `links`

Backlink index. Rows are derived from wikilinks in note bodies (M2); not stored inside markdown.

| Column           | Type                               | Notes             |
| ---------------- | ---------------------------------- | ----------------- |
| `source_note_id` | TEXT FK → notes                    | ON DELETE CASCADE |
| `target_note_id` | TEXT FK → notes                    | ON DELETE CASCADE |
| `created_at`     | TEXT                               |                   |
| PK               | `(source_note_id, target_note_id)` |                   |

### `tasks`

First-class task entities referenced from notes (M4). Editor pills store the task id, not checkbox text state.

| Column         | Type            | Notes                                             |
| -------------- | --------------- | ------------------------------------------------- |
| `id`           | TEXT PK         | UUID                                              |
| `note_id`      | TEXT FK → notes | ON DELETE CASCADE                                 |
| `title`        | TEXT            |                                                   |
| `state`        | TEXT            | `open` \| `waiting` \| `done` \| `cancelled`      |
| `due_date`     | TEXT NULL       | calendar date `YYYY-MM-DD` when set               |
| `priority`     | TEXT NULL       | `none` \| `low` \| `medium` \| `high` \| `urgent` |
| `created_at`   | TEXT            |                                                   |
| `updated_at`   | TEXT            |                                                   |
| `completed_at` | TEXT NULL       | set when entering `done` / `cancelled`            |

### `calendar_events`

Local-only events (M5). Optional `task_id` links a time block to a task.

| Column       | Type                 | Notes                                           |
| ------------ | -------------------- | ----------------------------------------------- |
| `id`         | TEXT PK              | UUID                                            |
| `title`      | TEXT                 |                                                 |
| `start`      | TEXT                 | ISO-8601 instant                                |
| `end`        | TEXT                 | ISO-8601 instant (SQL column quoted as `"end"`) |
| `task_id`    | TEXT NULL FK → tasks | ON DELETE SET NULL                              |
| `created_at` | TEXT                 |                                                 |

### `meetings`

Meeting metadata for `note_type = meeting` notes (M6). One row per meeting note.

| Column               | Type                 | Notes              |
| -------------------- | -------------------- | ------------------ |
| `note_id`            | TEXT PK FK → notes   | ON DELETE CASCADE  |
| `meeting_date`       | TEXT                 | `YYYY-MM-DD`       |
| `start_time`         | TEXT                 | local `HH:MM`      |
| `end_time`           | TEXT                 | local `HH:MM`      |
| `transcript_note_id` | TEXT NULL FK → notes | ON DELETE SET NULL |

## Access layer

- Rust: `src-tauri/src/db/` — open/migrate, models, `Repository` CRUD.
- Tauri commands: `db_status`, `create_note`, `get_note`, `list_notes`, `update_note`, `delete_note` (`src-tauri/src/notes.rs`).
- Frontend: `src/notes/` wraps those commands (`notesApi` + `useNotes` with ~500ms debounced autosave).
