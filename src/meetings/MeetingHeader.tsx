import { useEffect, useRef, useState } from "react";
import { meetingsApi, type MeetingsApi } from "../notes/meetings";
import {
  recordingApi as defaultRecordingApi,
  RecordingError,
  subscribeRecordingErrors,
  subscribeRecordingSegments,
  subscribeRecordingState,
  type RecordingApi,
  type RecordingState,
  type TranscriptSegment,
} from "../notes/recording";
import type { Meeting } from "../notes/types";
import { IconWaveform } from "../ui/IconWaveform";
import {
  formatMeetingDate,
  formatMeetingRange,
  isMeetingDate,
  isMeetingTime,
} from "./format";
import { LiveTranscript } from "./LiveTranscript";
import { deniedMicMessage } from "./recording";

export type MeetingHeaderProps = {
  noteId: string;
  api?: MeetingsApi;
  recording?: RecordingApi;
  onOpenNote?: (noteId: string) => void;
  onStopped?: () => void;
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

function isLiveForNote(state: RecordingState, noteId: string): boolean {
  return state.meeting_note_id === noteId && state.status !== "idle";
}

function errorMessage(err: unknown): string {
  if (err instanceof RecordingError && err.code === "permission_denied") {
    return deniedMicMessage();
  }
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    err.code === "permission_denied"
  ) {
    return deniedMicMessage();
  }
  return err instanceof Error ? err.message : "Could not start recording";
}

export function MeetingHeader({
  noteId,
  api = meetingsApi,
  recording = defaultRecordingApi,
  onOpenNote,
  onStopped,
}: MeetingHeaderProps) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const noteIdRef = useRef(noteId);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  noteIdRef.current = noteId;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEditing(false);
    setMeeting(null);
    setDraft(null);
    setLive(false);
    setStarting(false);
    startingRef.current = false;
    setStopping(false);
    stoppingRef.current = false;
    setSegments([]);

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

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const attach = async () => {
      unsubs.push(
        await subscribeRecordingState((state) => {
          if (cancelled) {
            return;
          }
          const nextLive = isLiveForNote(state, noteIdRef.current);
          setLive(nextLive);
          if (!nextLive) {
            setSegments([]);
          }
        }),
      );
      unsubs.push(
        await subscribeRecordingSegments((segment) => {
          if (cancelled || segment.meeting_note_id !== noteIdRef.current) {
            return;
          }
          setSegments((prev) =>
            prev.some((item) => item.id === segment.id)
              ? prev
              : [...prev, segment],
          );
        }),
      );
      unsubs.push(
        await subscribeRecordingErrors((payload) => {
          if (cancelled) {
            return;
          }
          setError(
            payload.code === "permission_denied"
              ? deniedMicMessage()
              : payload.message,
          );
        }),
      );
      try {
        const current = await recording.getRecordingState();
        if (cancelled) {
          return;
        }
        setLive(isLiveForNote(current, noteId));
      } catch {
        // Idle chrome if state probe fails; Record still surfaces start errors.
      }
    };

    void attach();
    return () => {
      cancelled = true;
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [recording, noteId]);

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

  const startRecording = async () => {
    if (live || startingRef.current) {
      return;
    }
    startingRef.current = true;
    setStarting(true);
    setError(null);
    setSegments([]);
    try {
      const permission = await recording.getMicrophonePermission();
      if (
        permission.status === "denied" ||
        permission.status === "restricted"
      ) {
        throw new RecordingError(
          "permission_denied",
          "Microphone access was denied.",
        );
      }
      await recording.startRecording(noteId);
    } catch (err) {
      if (noteIdRef.current !== noteId) {
        return;
      }
      setError(errorMessage(err));
    } finally {
      startingRef.current = false;
      if (noteIdRef.current === noteId) {
        setStarting(false);
      }
    }
  };

  const stopRecording = async () => {
    if (stoppingRef.current) {
      return;
    }
    stoppingRef.current = true;
    setStopping(true);
    setError(null);
    try {
      const stopped = await recording.stopRecording();
      if (noteIdRef.current !== noteId) {
        return;
      }
      setMeeting(stopped.meeting);
      setDraft(toDraft(stopped.meeting));
      setLive(false);
      setSegments([]);
      onStopped?.();
    } catch (err) {
      if (noteIdRef.current !== noteId) {
        return;
      }
      setError(err instanceof Error ? err.message : "Could not stop recording");
    } finally {
      stoppingRef.current = false;
      if (noteIdRef.current === noteId) {
        setStopping(false);
      }
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

  const transcriptId = meeting?.transcript_note_id ?? null;

  return (
    <>
      <div className="meeting-meta" aria-label="Meeting details">
        <div className="meeting-meta-main">
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
                <span>
                  {formatMeetingRange(shown.start_time, shown.end_time)}
                </span>
              </button>
            )
          ) : null}
          {transcriptId ? (
            <>
              <span className="meeting-dot" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className="meeting-transcript-link"
                onClick={() => {
                  onOpenNote?.(transcriptId);
                }}
              >
                Transcript
              </button>
            </>
          ) : null}
          {live ? (
            <span className="recording-badge">
              <span className="recording-dot" aria-hidden="true" />
              Recording
            </span>
          ) : null}
          {error ? (
            <span className="meeting-meta-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
        {shown ? (
          live ? (
            <button
              type="button"
              className="meeting-stop"
              disabled={stopping}
              onClick={() => {
                void stopRecording();
              }}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="meeting-record"
              disabled={starting}
              onClick={() => {
                void startRecording();
              }}
            >
              Record
            </button>
          )
        ) : null}
      </div>
      {live ? <LiveTranscript segments={segments} live /> : null}
    </>
  );
}
