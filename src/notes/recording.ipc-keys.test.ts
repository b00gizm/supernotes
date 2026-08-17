import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri recording IPC arg keys (ENG-69)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("start / ensure / get pass camelCase keys", async () => {
    const { recordingApi } = await import("./recording");
    await recordingApi.startRecording("note-1", "tiny.en");
    await recordingApi.ensureTranscriptionModel("base.en");
    await recordingApi.getRecordingState();
    await recordingApi.getMicrophonePermission();
    await recordingApi.listTranscriptionModels();
    await recordingApi.stopRecording();

    expect(invoke).toHaveBeenCalledWith("start_recording", {
      meetingNoteId: "note-1",
      modelId: "tiny.en",
    });
    expect(invoke).toHaveBeenCalledWith("ensure_transcription_model", {
      modelId: "base.en",
    });
    expect(invoke).toHaveBeenCalledWith("get_recording_state");
    expect(invoke).toHaveBeenCalledWith("get_microphone_permission");
    expect(invoke).toHaveBeenCalledWith("list_transcription_models");
    expect(invoke).toHaveBeenCalledWith("stop_recording");
  });
});
