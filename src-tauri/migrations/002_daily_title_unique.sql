-- Daily notes use canonical YYYY-MM-DD titles (ENG-59 / ENG-85).
-- Rewrite legacy display titles ("Monday, Aug 10") from created_at's UTC date.
UPDATE notes
SET title = substr(created_at, 1, 10)
WHERE note_type = 'daily'
  AND title NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

CREATE UNIQUE INDEX notes_daily_title_uidx ON notes (title)
WHERE note_type = 'daily';
