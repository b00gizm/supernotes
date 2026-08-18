import { invoke } from "@tauri-apps/api/core";
import { LlmError, type LlmIpcError } from "../llm/api";
import type { TaskPriority } from "../tasks/types";

export { LlmError } from "../llm/api";

export const SUMMARY_PROGRESS_EVENT = "summary://progress";
export const SUMMARY_DONE_EVENT = "summary://done";
export const SUMMARY_ERROR_EVENT = "summary://error";

export type ParticipantCertainty = "certain" | "maybe" | "unknown";

export type SummaryParticipant = {
  name: string;
  certainty: ParticipantCertainty;
  note_id: string | null;
};

export type SummaryKeyPoint = {
  text: string;
  timestamp: string | null;
  children: SummaryKeyPoint[];
};

export type SummaryActionItem = {
  title: string;
  due_date: string | null;
  priority: TaskPriority | null;
  task_id: string;
};

export type SummaryTranscriptMeta = {
  note_id: string;
  duration_seconds: number;
  word_count: number;
};

/** Structured meeting summary (mockup 1h). Never written into the note body. */
export type MeetingSummary = {
  meeting_note_id: string;
  purpose: string;
  participants: SummaryParticipant[];
  key_points: SummaryKeyPoint[];
  outcome: string;
  action_items: SummaryActionItem[];
  transcript: SummaryTranscriptMeta;
};

export type GenerateSummaryJob = {
  stream_id: string;
  meeting_note_id: string;
};

export type SummaryProgressEvent = {
  stream_id: string;
  meeting_note_id: string;
};

export type SummaryDoneEvent = {
  stream_id: string;
  meeting_note_id: string;
  summary: MeetingSummary;
};

export type SummaryErrorEvent = {
  stream_id: string;
  meeting_note_id: string;
  code: string;
  message: string;
};

export type MeetingSummaryApi = {
  getSummary: (meetingNoteId: string) => Promise<MeetingSummary | null>;
  /** Starts generate on a worker thread. Listen to summary://* for the result. */
  generateSummary: (meetingNoteId: string) => Promise<GenerateSummaryJob>;
  saveParticipants: (
    meetingNoteId: string,
    participants: SummaryParticipant[],
  ) => Promise<MeetingSummary>;
};

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) {
    return err;
  }
  if (err && typeof err === "object") {
    const rec = err as { code?: unknown; message?: unknown };
    if (typeof rec.code === "string" && typeof rec.message === "string") {
      return new LlmError(rec.code, rec.message);
    }
  }
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/^([a-z_]+):\s*(.*)$/);
  if (match?.[1] && match[2] !== undefined) {
    return new LlmError(match[1], match[2]);
  }
  return new LlmError("request_failed", raw || "The LLM request failed.");
}

async function invokeSummary<T>(
  cmd: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toLlmError(err);
  }
}

const tauriSummaryApi: MeetingSummaryApi = {
  getSummary: (meetingNoteId) =>
    invokeSummary<MeetingSummary | null>("get_meeting_summary", {
      meetingNoteId,
    }),
  generateSummary: (meetingNoteId) =>
    invokeSummary<GenerateSummaryJob>("generate_meeting_summary", {
      meetingNoteId,
    }),
  saveParticipants: (meetingNoteId, participants) =>
    invokeSummary<MeetingSummary>("save_meeting_summary_participants", {
      meetingNoteId,
      participants,
    }),
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Canned mockup-1h payload for browser preview / tests. No live LLM. */
export function demoMeetingSummary(
  meetingNoteId = "demo-sync",
  transcriptNoteId = "demo-transcript",
): MeetingSummary {
  return {
    meeting_note_id: meetingNoteId,
    purpose:
      "Settle the pricing v2 tier structure so the table can ship with the beta cohort this week.",
    participants: [
      { name: "Sara Kim", certainty: "certain", note_id: "person-sara" },
      { name: "Marcus Webb", certainty: "certain", note_id: "person-marcus" },
      { name: "Steve", certainty: "maybe", note_id: null },
    ],
    key_points: [
      {
        text: "Free tier stays; importer moves behind the paid line",
        timestamp: "14:02",
        children: [
          {
            text: "revisit only if activation dips, September at the earliest",
            timestamp: "14:05",
            children: [],
          },
        ],
      },
      {
        text: "Annual pricing blocked on refund language",
        timestamp: "14:11",
        children: [],
      },
      {
        text: "Sara owns the final tier table, lands in Monday's daily note",
        timestamp: "14:18",
        children: [],
      },
    ],
    outcome:
      "Tier structure approved. Ship behind `flags.pricingV2` once legal clears the annual terms — details in Pricing v2 draft.",
    action_items: [
      {
        title: "Send updated tier table",
        due_date: "2026-08-10",
        priority: "high",
        task_id: "mem-task-1",
      },
      {
        title: "Legal review of annual terms",
        due_date: "2026-08-14",
        priority: null,
        task_id: "mem-task-2",
      },
    ],
    transcript: {
      note_id: transcriptNoteId,
      duration_seconds: 45 * 60,
      word_count: 6120,
    },
  };
}

export type MemorySummaryOptions = {
  fail?: LlmIpcError;
};

/** In-memory MeetingSummaryApi for tests / `npm run dev` (no live LLM). */
export function createMemoryMeetingSummaryApi(
  options: MemorySummaryOptions = {},
): MeetingSummaryApi {
  const store = new Map<string, MeetingSummary>();
  let taskSeq = 0;
  let streamSeq = 0;

  const emit = (name: string, detail: object) => {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent(name, { detail }));
  };

  return {
    getSummary(meetingNoteId) {
      return Promise.resolve(store.get(meetingNoteId) ?? null);
    },
    generateSummary(meetingNoteId) {
      streamSeq += 1;
      const job: GenerateSummaryJob = {
        stream_id: `mem-${String(streamSeq)}`,
        meeting_note_id: meetingNoteId,
      };
      emit(SUMMARY_PROGRESS_EVENT, job);
      setTimeout(() => {
        if (options.fail) {
          emit(SUMMARY_ERROR_EVENT, {
            ...job,
            code: options.fail.code,
            message: options.fail.message,
          });
          return;
        }
        const base = demoMeetingSummary(meetingNoteId);
        const summary: MeetingSummary = {
          ...base,
          action_items: base.action_items.map((item) => {
            taskSeq += 1;
            return { ...item, task_id: `mem-task-${String(taskSeq)}` };
          }),
        };
        store.set(meetingNoteId, summary);
        emit(SUMMARY_DONE_EVENT, { ...job, summary });
      }, 0);
      return Promise.resolve(job);
    },
    saveParticipants(meetingNoteId, participants) {
      const current = store.get(meetingNoteId);
      if (!current) {
        return Promise.reject(
          new LlmError("invalid", "No summary to edit. Generate one first."),
        );
      }
      const summary: MeetingSummary = {
        ...current,
        participants: participants.map((item) => ({ ...item })),
      };
      store.set(meetingNoteId, summary);
      return Promise.resolve(summary);
    },
  };
}

export async function subscribeSummaryProgress(
  handler: (event: SummaryProgressEvent) => void,
): Promise<() => void> {
  return subscribeEvent(SUMMARY_PROGRESS_EVENT, (payload) => {
    handler(payload as SummaryProgressEvent);
  });
}

export async function subscribeSummaryDone(
  handler: (event: SummaryDoneEvent) => void,
): Promise<() => void> {
  return subscribeEvent(SUMMARY_DONE_EVENT, (payload) => {
    handler(payload as SummaryDoneEvent);
  });
}

export async function subscribeSummaryErrors(
  handler: (event: SummaryErrorEvent) => void,
): Promise<() => void> {
  return subscribeEvent(SUMMARY_ERROR_EVENT, (payload) => {
    handler(payload as SummaryErrorEvent);
  });
}

async function subscribeEvent(
  name: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  if (isTauriRuntime()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(name, (event) => {
      handler(event.payload);
    });
  }
  if (typeof window === "undefined") {
    return () => {};
  }
  const wrapped = (event: Event) => {
    handler((event as CustomEvent<unknown>).detail);
  };
  window.addEventListener(name, wrapped);
  return () => {
    window.removeEventListener(name, wrapped);
  };
}

/** Baymax must use this wrapper. Do not invoke meeting-summary IPC from UI. */
export const summaryApi: MeetingSummaryApi = isTauriRuntime()
  ? tauriSummaryApi
  : createMemoryMeetingSummaryApi();
