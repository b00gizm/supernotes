function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  );
}

/** Header copy for `permission_denied` (Woz IPC) and getUserMedia-shaped errors. */
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

export function deniedMicMessage(
  platform: { mac: boolean } = { mac: isMacPlatform() },
): string {
  return micPermissionMessage(
    new DOMException("denied", "NotAllowedError"),
    platform,
  );
}
