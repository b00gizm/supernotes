-- Schema v6: structured AI meeting summary JSON (not written into the note body).
ALTER TABLE meetings ADD COLUMN summary_json TEXT;
