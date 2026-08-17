import { formatTimeInput } from "../calendar/layout";

export type TranscriptSegment = {
  id: string;
  time: string;
  text: string;
};

/** Mockup 1g copy with speaker names stripped (v0 has no diarization). */
export const MOCK_TRANSCRIPT_LINES = [
  "Let's lock the Q3 pricing before the board deck goes out.",
  "I still think we should keep the free tier. It's how we get people in.",
  "Free tier stays. But we raise Pro to forty-nine and add a Team plan at ninety-nine.",
  "Works for me. I'll update the deck tonight.",
];

export function formatTranscriptClock(date: Date): string {
  return formatTimeInput(date.getHours() * 60 + date.getMinutes());
}

function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  );
}

/** Maps getUserMedia failures to the meeting-header error string. */
export function micPermissionMessage(
  err: unknown,
  platform: { mac: boolean } = { mac: isMacPlatform() },
): string {
  const name = err instanceof DOMException ? err.name : "";
  const raw = err instanceof Error ? err.message : String(err);
  const denied =
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /not allowed|permission|denied/i.test(raw);
  const missing =
    name === "NotFoundError" ||
    /no microphone|requested device not found/i.test(raw);

  if (missing) {
    return "No microphone found.";
  }
  if (denied) {
    return platform.mac
      ? "Microphone access is required to record. On macOS, allow Supernotes in System Settings → Privacy & Security → Microphone."
      : "Microphone access is required to record. Allow microphone access and try again.";
  }
  if (!raw || raw === "undefined") {
    return "Could not access the microphone.";
  }
  return raw;
}

/**
 * Prompts for mic access, then drops the stream.
 * ponytail: permission UX only — Woz owns capture → whisper.cpp. Do not keep
 * this stream or invent recording IPC.
 */
export async function requestMicAccess(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error("Microphone is not available in this environment.");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
  } catch (err) {
    throw new Error(micPermissionMessage(err));
  }
}
