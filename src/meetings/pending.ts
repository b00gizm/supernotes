import type { MeetingPrefill } from "./types";

let pending: MeetingPrefill | null = null;

/** Stash times before createNote selects, so the header can create the row. */
export function queueMeetingPrefill(times: MeetingPrefill): void {
  pending = times;
}

export function takeMeetingPrefill(): MeetingPrefill | null {
  const value = pending;
  pending = null;
  return value;
}
