import { invoke } from "@tauri-apps/api/core";
import { createMemoryMeetingsApi } from "./memoryApi";
import type { Meeting, MeetingInput } from "./types";

export type MeetingsApi = {
  getMeeting: (noteId: string) => Promise<Meeting>;
  createMeeting: (input: MeetingInput) => Promise<Meeting>;
  updateMeeting: (input: MeetingInput) => Promise<Meeting>;
};

const tauriMeetingsApi: MeetingsApi = {
  // Tauri 2 deserializes multi-word command args as camelCase by default.
  getMeeting: (noteId) => invoke<Meeting>("get_meeting", { noteId }),
  createMeeting: (input) => invoke<Meeting>("create_meeting", { input }),
  updateMeeting: (input) => invoke<Meeting>("update_meeting", { input }),
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Browser preview seed matching the ENG-68 Pricing sync mockup. */
const DEMO_SEED: Meeting[] = [
  {
    note_id: "demo-sync",
    meeting_date: "2026-08-10",
    start_time: "14:00",
    end_time: "14:23",
    transcript_note_id: null,
  },
];

export const meetingsApi: MeetingsApi = isTauriRuntime()
  ? tauriMeetingsApi
  : createMemoryMeetingsApi(DEMO_SEED);
