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

Core note document. `body_markdown` is the canonical content; the TipTap editor
round-trips to this column (see `docs/markdown.md`).

| Column          | Type    | Notes                                                      |
| --------------- | ------- | ---------------------------------------------------------- |
| `id`            | TEXT PK | UUID                                                       |
| `title`         | TEXT    | For `daily`, canonical `YYYY-MM-DD` (unique among dailies) |
| `body_markdown` | TEXT    | default `''`                                               |
| `note_type`     | TEXT    | `regular` \| `daily` \| `meeting`                          |
| `pinned`        | INTEGER | `0`/`1`, default `0` (Notes overview Pinned group)         |
| `created_at`    | TEXT    |                                                            |
| `updated_at`    | TEXT    |                                                            |

Unique index `notes_daily_title_uidx` enforces one daily note per calendar day
(title). Display formatting (`Sunday, Aug 10 2026`) is frontend-only.

### `links`

Backlink index. Rows are derived from `[[wikilinks]]`, `#tags`, and `@mentions`
in note bodies (M2); not stored inside markdown.

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

Daily notes render a live **Due** section (not stored in `body_markdown`) for
open/waiting tasks with `due_date` on or before that day's title. Overdue
tasks roll forward until resolved. The query is always current: resolving a
task drops it from past daily notes too (not a historical snapshot). See
`docs/markdown.md`.

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
Display (`Mon, Aug 10`, `14:00 – 14:23`) is frontend-only; storage is local date + clock.

| Column               | Type                           | Notes                                              |
| -------------------- | ------------------------------ | -------------------------------------------------- |
| `note_id`            | TEXT PK FK → notes             | ON DELETE CASCADE                                  |
| `meeting_date`       | TEXT                           | local `YYYY-MM-DD`                                 |
| `start_time`         | TEXT                           | local `HH:MM`                                      |
| `end_time`           | TEXT                           | local `HH:MM`                                      |
| `transcript_note_id` | TEXT NULL FK → notes           | ON DELETE SET NULL; set on recording stop (ENG-69) |
| `calendar_event_id`  | TEXT NULL FK → calendar_events | ON DELETE SET NULL; unique when set (schema v4)    |

### `llm_settings`

Single-row LLM client config (schema v5 / ENG-70). The API key is **not** stored
here — it lives in the OS keychain (`cloud.snowfire.supernotes` / `llm_api_key`).

| Column       | Type    | Notes                                     |
| ------------ | ------- | ----------------------------------------- |
| `id`         | INTEGER | always `1`                                |
| `base_url`   | TEXT    | OpenAI-compatible root, e.g. `…/v1`       |
| `model`      | TEXT    | model name (`gpt-4o-mini`, `llama3.2`, …) |
| `updated_at` | TEXT    |                                           |

Defaults when no row exists: `https://api.openai.com/v1` + `gpt-4o-mini`.
`SUPERNOTES_FAKE_LLM=1` uses an in-memory client and secret store (no live API).

## Access layer

- Rust: `src-tauri/src/db/` — open/migrate, models, `Repository` CRUD.
- Tauri commands: `create_note`, `get_or_create_daily_note`, `get_note`,
  `list_notes`, `search_notes`, `update_note`, `set_note_pinned`, `delete_note`,
  `list_links_from`, `list_links_to` (`src-tauri/src/notes.rs`); `create_task`,
  `get_task`, `list_tasks`, `list_tasks_for_note`, `update_task`, `delete_task`
  (`src-tauri/src/tasks.rs`); `create_calendar_event`, `get_calendar_event`,
  `list_calendar_events`, `update_calendar_event`, `delete_calendar_event`
  (`src-tauri/src/calendar.rs`); `create_meeting_note`, `update_meeting`,
  `get_meeting`, `create_meeting_note_from_event`, `get_meeting_for_event`
  (`src-tauri/src/meetings.rs`); `start_recording`, `stop_recording`,
  `get_recording_state`, `get_microphone_permission`,
  `list_transcription_models`, `ensure_transcription_model`
  (`src-tauri/src/transcription/`); `get_llm_settings`, `save_llm_settings`,
  `set_llm_api_key`, `clear_llm_api_key`, `test_llm_connection`,
  `stream_llm_chat` (`src-tauri/src/llm/`). `list_calendar_events` takes optional `from` /
  `to` ISO instants and returns events overlapping that window. Saving a note
  syncs its outbound `links` rows from `[[…]]` / `#tag` / `@mention` in
  `body_markdown` (skips `[[task:…]]`). `create_meeting_note_from_event` is
  idempotent: it prefills local date/start/end from the event instants and
  stores `calendar_event_id`. Meeting metadata updates do not bump the note's
  `updated_at`. Stopping a recording writes a regular note (`{title} — transcript`)
  and sets `meetings.transcript_note_id`. That note is read-only:
  `update_note` / `delete_note` are rejected. No schema migration (column already
  existed). Live transcript lines are pushed on `recording://segment` (see
  `src/notes/recording.ts`).
- Frontend: `src/notes/` wraps note/link commands (`notesApi` + `useNotes` with
  ~500ms debounced autosave) and meeting metadata (`meetingsApi`). `src/tasks/`
  wraps task commands (`tasksApi`) and the Inbox / Upcoming / Complete overview
  (`TasksView`). Daily notes render a Due query section from `list_tasks(upcoming)`
  filtered to `due_date <=` that day. Editor task pills create/update/delete
  rows immediately; note markdown still autosaves the `[[task:id]]` reference.
  `src/calendar/` wraps event commands (`calendarApi`) and the week grid /
  agenda views (`CalendarView`). `src/llm/api.ts` wraps LLM settings / keychain /
  streaming (`llmApi`); live tokens arrive on `llm://token`.
