-- Daily notes use canonical YYYY-MM-DD titles (ENG-59 / ENG-85 / ENG-126).
-- Rewrite legacy display titles from created_at's *local* calendar day.
-- Unique index is created in Rust after duplicate dailies are merged (ENG-126).
UPDATE notes
SET title = strftime('%Y-%m-%d', datetime(substr(created_at, 1, 19), 'localtime'))
WHERE note_type = 'daily'
  AND title NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
