-- Old 002 used substr(created_at, 1, 10) (UTC date). Retitle those rows to
-- the local calendar day, then merge duplicates before recreating the index.
DROP INDEX IF EXISTS notes_daily_title_uidx;

UPDATE notes
SET title = strftime('%Y-%m-%d', datetime(substr(created_at, 1, 19), 'localtime'))
WHERE note_type = 'daily'
  AND title = substr(created_at, 1, 10);
