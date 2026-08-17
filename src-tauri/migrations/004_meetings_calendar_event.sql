-- Schema v4: link a meeting note to the calendar event it was created from.
ALTER TABLE meetings ADD COLUMN calendar_event_id TEXT REFERENCES calendar_events (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX meetings_calendar_event_uidx
    ON meetings (calendar_event_id)
    WHERE calendar_event_id IS NOT NULL;
