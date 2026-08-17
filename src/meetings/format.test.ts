import { describe, expect, it } from "vitest";
import {
  defaultMeetingTimes,
  formatMeetingDate,
  formatMeetingMeta,
  formatMeetingRange,
  isMeetingDate,
  isMeetingTime,
  meetingTimesFromLocalIso,
} from "./format";

describe("meeting format (ENG-68)", () => {
  it("formats the mockup meta row", () => {
    expect(formatMeetingDate("2026-08-10")).toBe("Mon, Aug 10");
    expect(formatMeetingRange("14:00", "14:23")).toBe("14:00 – 14:23");
    expect(formatMeetingMeta("2026-08-10", "14:00", "14:23")).toBe(
      "Meeting · Mon, Aug 10 · 14:00 – 14:23",
    );
  });

  it("rejects invalid date and time strings", () => {
    expect(isMeetingDate("2026-08-10")).toBe(true);
    expect(isMeetingDate("2026-08-32")).toBe(false);
    expect(isMeetingTime("14:00")).toBe(true);
    expect(isMeetingTime("24:00")).toBe(false);
    expect(isMeetingTime("9:00")).toBe(false);
  });

  it("defaults to a 30-minute window on the local day", () => {
    const times = defaultMeetingTimes(new Date(2026, 7, 10, 14, 7));
    expect(times.meeting_date).toBe("2026-08-10");
    expect(times.start_time).toBe("14:00");
    expect(times.end_time).toBe("14:30");
  });

  it("reads local date and clock from event instants", () => {
    const start = new Date(2026, 7, 10, 14, 0).toISOString();
    const end = new Date(2026, 7, 10, 14, 23).toISOString();
    expect(meetingTimesFromLocalIso(start, end)).toEqual({
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });
  });
});
