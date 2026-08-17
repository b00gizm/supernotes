import { describe, expect, it } from "vitest";
import { createMemoryCalendarApi } from "../calendar/api";
import { createMemoryTasksApi } from "../tasks/memoryApi";
import { createMemoryMeetingsApi } from "./meetings";
import { createMemoryNotesApi } from "./memoryApi";

describe("memory meetings (ENG-68)", () => {
  it("persists meeting type + date/start/end", async () => {
    const notes = createMemoryNotesApi();
    const meetings = createMemoryMeetingsApi(notes);
    const created = await meetings.createMeetingNote({
      title: "Pricing sync",
      body_markdown: "Decided to keep the free tier.",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });

    expect(created.note.note_type).toBe("meeting");
    expect(created.meeting).toEqual({
      note_id: created.note.id,
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
      transcript_note_id: null,
      calendar_event_id: null,
    });
    expect(await meetings.getMeeting(created.note.id)).toEqual(created.meeting);

    const listed = await notes.listNotes();
    expect(listed.some((note) => note.id === created.note.id)).toBe(true);

    const before = created.note.updated_at;
    const updated = await meetings.updateMeeting({
      note_id: created.note.id,
      meeting_date: "2026-08-11",
      start_time: "10:00",
      end_time: "10:30",
    });
    expect(updated.start_time).toBe("10:00");
    const noteAfter = (await notes.listNotes()).find(
      (note) => note.id === created.note.id,
    );
    expect(noteAfter?.updated_at).toBe(before);
  });

  it("create-from-calendar-event prefills date/times and links the note", async () => {
    const notes = createMemoryNotesApi();
    const calendar = createMemoryCalendarApi();
    const event = await calendar.createEvent({
      title: "Pricing sync",
      start: "2026-08-10T21:00:00.000Z",
      end: "2026-08-10T21:23:00.000Z",
    });
    const meetings = createMemoryMeetingsApi(notes, {
      getEvent: (id) => calendar.getEvent(id),
    });

    const created = await meetings.createMeetingNoteFromEvent(event.id);
    expect(created.note.note_type).toBe("meeting");
    expect(created.note.title).toBe("Pricing sync");
    expect(created.meeting.calendar_event_id).toBe(event.id);
    expect(created.meeting.meeting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(created.meeting.start_time).toMatch(/^\d{2}:\d{2}$/);
    expect(created.meeting.end_time).toMatch(/^\d{2}:\d{2}$/);

    const again = await meetings.createMeetingNoteFromEvent(event.id);
    expect(again.note.id).toBe(created.note.id);

    const lookedUp = await meetings.getMeetingForEvent(event.id);
    expect(lookedUp.note.id).toBe(created.note.id);
  });

  it("meeting notes still work as regular notes (linking, tasks, search)", async () => {
    const notes = createMemoryNotesApi();
    const tasks = createMemoryTasksApi();
    const meetings = createMemoryMeetingsApi(notes);
    const created = await meetings.createMeetingNote({
      title: "Pricing sync",
      body_markdown: "Decided to keep the free tier.",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });

    await notes.createNote({
      title: "Roadmap",
      body_markdown: "See [[Pricing sync]].",
    });
    const links = await notes.listLinksTo(created.note.id);
    expect(links).toHaveLength(1);

    const task = await tasks.createTask({
      note_id: created.note.id,
      title: "Send recap to team",
    });
    const forNote = await tasks.listTasksForNote(created.note.id);
    expect(forNote.map((item) => item.id)).toEqual([task.id]);

    const hits = await notes.searchNotes("pricing");
    expect(hits.some((note) => note.id === created.note.id)).toBe(true);
    expect(hits[0]?.note_type).toBe("meeting");
  });
});
