import { invoke } from "@tauri-apps/api/core";
import type { Meeting, Note } from "./types";

export const RECORDING_STATE_EVENT = "recording://state";
export const RECORDING_SEGMENT_EVENT = "recording://segment";
export const RECORDING_ERROR_EVENT = "recording://error";
export const RECORDING_MODEL_EVENT = "recording://model";

export type RecordingStatus =
  "idle" | "downloading_model" | "recording" | "stopping";

export type RecordingState = {
  status: RecordingStatus;
  meeting_note_id: string | null;
  session_id: string | null;
  model_id: string | null;
  engine_id: string | null;
  started_at: string | null;
};

export type TranscriptSegment = {
  id: string;
  meeting_note_id: string;
  start_ms: number;
  end_ms: number;
  clock: string;
  text: string;
};

export type RecordingIpcError = {
  code: string;
  message: string;
};

export class RecordingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "RecordingError";
    this.code = code;
  }
}

export type StopRecordingResult = {
  meeting: Meeting;
  transcript_note: Note;
};

export type TranscriptionModel = {
  id: string;
  label: string;
  filename: string;
  downloaded: boolean;
  size_bytes: number;
};

export type MicrophonePermissionStatus =
  "granted" | "denied" | "not_determined" | "restricted";

export type MicrophonePermission = {
  status: MicrophonePermissionStatus;
};

export type ModelProgress = {
  model_id: string;
  downloaded_bytes: number;
  total_bytes: number | null;
};

export type RecordingApi = {
  startRecording: (
    meetingNoteId: string,
    modelId?: string,
  ) => Promise<RecordingState>;
  stopRecording: () => Promise<StopRecordingResult>;
  getRecordingState: () => Promise<RecordingState>;
  getMicrophonePermission: () => Promise<MicrophonePermission>;
  listTranscriptionModels: () => Promise<TranscriptionModel[]>;
  ensureTranscriptionModel: (modelId: string) => Promise<TranscriptionModel>;
};

const tauriRecordingApi: RecordingApi = {
  startRecording: (meetingNoteId, modelId) =>
    invoke<RecordingState>("start_recording", {
      meetingNoteId,
      modelId: modelId ?? null,
    }),
  stopRecording: () => invoke<StopRecordingResult>("stop_recording"),
  getRecordingState: () => invoke<RecordingState>("get_recording_state"),
  getMicrophonePermission: () =>
    invoke<MicrophonePermission>("get_microphone_permission"),
  listTranscriptionModels: () =>
    invoke<TranscriptionModel[]>("list_transcription_models"),
  ensureTranscriptionModel: (modelId) =>
    invoke<TranscriptionModel>("ensure_transcription_model", { modelId }),
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function localHm(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const idleState = (): RecordingState => ({
  status: "idle",
  meeting_note_id: null,
  session_id: null,
  model_id: null,
  engine_id: null,
  started_at: null,
});

export type MemoryRecordingOptions = {
  permission?: MicrophonePermissionStatus;
  engineId?: string;
  segmentsFor?: (
    meetingNoteId: string,
  ) => Array<Pick<TranscriptSegment, "clock" | "text" | "start_ms" | "end_ms">>;
};

/** In-memory RecordingApi for tests / browser preview (no mic, no ggml). */
export function createMemoryRecordingApi(
  notes: {
    createNote: (input: {
      title: string;
      body_markdown?: string;
    }) => Promise<Note>;
    listNotes: () => Promise<Note[]>;
  },
  meetings: {
    getMeeting: (noteId: string) => Promise<Meeting>;
    /** Test helper: memory meetings store is not exported; patch via this. */
    linkTranscript?: (noteId: string, transcriptNoteId: string) => void;
  },
  options: MemoryRecordingOptions = {},
): RecordingApi & {
  setTranscriptLink: (noteId: string, meeting: Meeting) => void;
} {
  let state = idleState();
  const meetingsById = new Map<string, Meeting>();
  const permission = options.permission ?? "granted";
  const engineId = options.engineId ?? "fake";

  const emit = (name: string, detail: object) => {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent(name, { detail }));
  };

  return {
    setTranscriptLink(noteId, meeting) {
      meetingsById.set(noteId, meeting);
    },
    async startRecording(meetingNoteId, modelId) {
      if (permission === "denied" || permission === "restricted") {
        const error = new RecordingError(
          "permission_denied",
          "Microphone access was denied.",
        );
        emit(RECORDING_ERROR_EVENT, {
          code: error.code,
          message: error.message,
        });
        throw error;
      }
      if (state.status === "recording") {
        throw new RecordingError("already_recording", "already recording");
      }
      const meeting =
        meetingsById.get(meetingNoteId) ??
        (await meetings.getMeeting(meetingNoteId));
      meetingsById.set(meetingNoteId, meeting);
      state = {
        status: "recording",
        meeting_note_id: meetingNoteId,
        session_id: `mem-${String(Date.now())}`,
        model_id: modelId ?? "tiny",
        engine_id: engineId,
        started_at: new Date().toISOString(),
      };
      emit(RECORDING_STATE_EVENT, state);
      const scripted = options.segmentsFor?.(meetingNoteId) ?? [];
      for (const item of scripted) {
        const segment: TranscriptSegment = {
          id: `seg-${String(item.start_ms)}`,
          meeting_note_id: meetingNoteId,
          ...item,
        };
        emit(RECORDING_SEGMENT_EVENT, segment);
      }
      return state;
    },
    async stopRecording() {
      if (state.status !== "recording" || !state.meeting_note_id) {
        throw new RecordingError("not_recording", "no active recording");
      }
      const meetingNoteId = state.meeting_note_id;
      const meeting =
        meetingsById.get(meetingNoteId) ??
        (await meetings.getMeeting(meetingNoteId));
      const listed = await notes.listNotes();
      const meetingNote = listed.find((note) => note.id === meetingNoteId);
      const scripted = options.segmentsFor?.(meetingNoteId) ?? [
        {
          clock: localHm(),
          text: "(audio 0–8s)",
          start_ms: 0,
          end_ms: 8000,
        },
      ];
      const body = scripted
        .map((item) => `${item.clock}  ${item.text}`)
        .join("\n");
      const transcript = await notes.createNote({
        title: `${meetingNote?.title ?? "Meeting"} — transcript`,
        body_markdown: body,
      });
      const linked: Meeting = {
        ...meeting,
        transcript_note_id: transcript.id,
      };
      meetingsById.set(meetingNoteId, linked);
      meetings.linkTranscript?.(meetingNoteId, transcript.id);
      state = idleState();
      emit(RECORDING_STATE_EVENT, state);
      return { meeting: linked, transcript_note: transcript };
    },
    getRecordingState() {
      return Promise.resolve(state);
    },
    getMicrophonePermission() {
      return Promise.resolve({ status: permission });
    },
    listTranscriptionModels() {
      return Promise.resolve([
        {
          id: "tiny.en",
          label: "Tiny (English)",
          filename: "ggml-tiny.en.bin",
          downloaded: true,
          size_bytes: 77_700_000,
        },
      ]);
    },
    ensureTranscriptionModel(modelId) {
      return Promise.resolve({
        id: modelId,
        label: modelId,
        filename: `ggml-${modelId}.bin`,
        downloaded: true,
        size_bytes: 0,
      });
    },
  };
}

export async function subscribeRecordingState(
  handler: (state: RecordingState) => void,
): Promise<() => void> {
  return subscribeEvent(RECORDING_STATE_EVENT, (payload) => {
    handler(payload as RecordingState);
  });
}

export async function subscribeRecordingSegments(
  handler: (segment: TranscriptSegment) => void,
): Promise<() => void> {
  return subscribeEvent(RECORDING_SEGMENT_EVENT, (payload) => {
    handler(payload as TranscriptSegment);
  });
}

export async function subscribeRecordingErrors(
  handler: (error: RecordingIpcError) => void,
): Promise<() => void> {
  return subscribeEvent(RECORDING_ERROR_EVENT, (payload) => {
    handler(payload as RecordingIpcError);
  });
}

export async function subscribeModelProgress(
  handler: (progress: ModelProgress) => void,
): Promise<() => void> {
  return subscribeEvent(RECORDING_MODEL_EVENT, (payload) => {
    handler(payload as ModelProgress);
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

/** Browser `npm run dev` has no Tauri IPC; recording stays idle until wired. */
export const recordingApi: RecordingApi = isTauriRuntime()
  ? tauriRecordingApi
  : {
      startRecording: () =>
        Promise.reject(
          new RecordingError("engine", "recording requires the Tauri app"),
        ),
      stopRecording: () =>
        Promise.reject(
          new RecordingError("not_recording", "no active recording"),
        ),
      getRecordingState: () => Promise.resolve(idleState()),
      getMicrophonePermission: () =>
        Promise.resolve({ status: "not_determined" as const }),
      listTranscriptionModels: () => Promise.resolve([]),
      ensureTranscriptionModel: (modelId) =>
        Promise.resolve({
          id: modelId,
          label: modelId,
          filename: `ggml-${modelId}.bin`,
          downloaded: false,
          size_bytes: 0,
        }),
    };
