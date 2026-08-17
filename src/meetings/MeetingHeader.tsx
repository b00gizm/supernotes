import { useEffect, useRef, useState } from "react";
import { meetingsApi, type MeetingsApi } from "../notes/meetings";
import type { Meeting } from "../notes/types";
import { IconWaveform } from "../ui/IconWaveform";
import {
  formatMeetingDate,
  formatMeetingRange,
  isMeetingDate,
  isMeetingTime,
} from "./format";

export type MeetingHeaderProps = {
  noteId: string;
  api?: MeetingsApi;
};

type Draft = {
  meeting_date: string;
  start_time: string;
  end_time: string;
};

function toDraft(meeting: Meeting): Draft {
  return {
    meeting_date: meeting.meeting_date,
    start_time: meeting.start_time,
    end_time: meeting.end_time,
  };
}

export function MeetingHeader({
  noteId,
  api = meetingsApi,
}: MeetingHeaderProps) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEditing(false);
    setMeeting(null);
    setDraft(null);

    const load = async () => {
      try {
        const loaded = await api.getMeeting(noteId);
        if (cancelled || noteIdRef.current !== noteId) {
          return;
        }
        setMeeting(loaded);
        setDraft(toDraft(loaded));
        setError(null);
      } catch (err) {
        if (cancelled || noteIdRef.current !== noteId) {
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load meeting");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, noteId]);

  const persist = async (next: Draft) => {
    if (
      !isMeetingDate(next.meeting_date) ||
      !isMeetingTime(next.start_time) ||
      !isMeetingTime(next.end_time)
    ) {
      setError("Enter a valid date and times");
      return;
    }
    const previous = meeting;
    if (!previous) {
      setError("Could not save meeting");
      return;
    }
    const optimistic: Meeting = {
      ...previous,
      meeting_date: next.meeting_date,
      start_time: next.start_time,
      end_time: next.end_time,
    };
    setMeeting(optimistic);
    setDraft(next);
    setEditing(false);
    setError(null);
    try {
      const saved = await api.updateMeeting({
        note_id: noteId,
        meeting_date: next.meeting_date,
        start_time: next.start_time,
        end_time: next.end_time,
      });
      if (noteIdRef.current !== noteId) {
        return;
      }
      setMeeting(saved);
      setDraft(toDraft(saved));
    } catch (err) {
      if (noteIdRef.current !== noteId) {
        return;
      }
      setMeeting(previous);
      setDraft(toDraft(previous));
      setError(err instanceof Error ? err.message : "Could not save meeting");
    }
  };

  const shown = draft ?? meeting;
  if (!shown && !error) {
    return (
      <div className="meeting-meta" aria-label="Meeting details">
        <IconWaveform />
        <span>Meeting</span>
      </div>
    );
  }

  return (
    <div className="meeting-meta" aria-label="Meeting details">
      <IconWaveform />
      <span className="meeting-kind">Meeting</span>
      {shown ? (
        editing ? (
          <form
            className="meeting-meta-edit"
            onSubmit={(event) => {
              event.preventDefault();
              void persist(shown);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                return;
              }
              event.preventDefault();
              setEditing(false);
              setDraft(meeting ? toDraft(meeting) : shown);
              setError(null);
            }}
          >
            <span className="meeting-dot" aria-hidden="true">
              ·
            </span>
            <input
              type="date"
              aria-label="Meeting date"
              value={shown.meeting_date}
              autoFocus
              onChange={(event) => {
                setDraft({ ...shown, meeting_date: event.target.value });
              }}
            />
            <span className="meeting-dot" aria-hidden="true">
              ·
            </span>
            <input
              type="time"
              aria-label="Start time"
              value={shown.start_time}
              onChange={(event) => {
                setDraft({ ...shown, start_time: event.target.value });
              }}
            />
            <span aria-hidden="true">–</span>
            <input
              type="time"
              aria-label="End time"
              value={shown.end_time}
              onChange={(event) => {
                setDraft({ ...shown, end_time: event.target.value });
              }}
            />
            <button type="submit" className="text-button">
              Save
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="meeting-meta-text"
            aria-label="Edit meeting time"
            onClick={() => {
              setEditing(true);
              setError(null);
            }}
          >
            <span className="meeting-dot" aria-hidden="true">
              ·
            </span>
            <span>{formatMeetingDate(shown.meeting_date)}</span>
            <span className="meeting-dot" aria-hidden="true">
              ·
            </span>
            <span>{formatMeetingRange(shown.start_time, shown.end_time)}</span>
          </button>
        )
      ) : null}
      {error ? (
        <span className="meeting-meta-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
