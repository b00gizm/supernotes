import { describe, expect, it } from "vitest";
import { LlmError } from "../llm/api";
import {
  createMemoryMeetingSummaryApi,
  demoMeetingSummary,
} from "./summaryApi";

describe("memory meeting summary (ENG-71)", () => {
  it("returns the mockup-1h shape and replaces on regenerate", async () => {
    const api = createMemoryMeetingSummaryApi();
    expect(await api.getSummary("meet-1")).toBeNull();

    const first = await api.generateSummary("meet-1");
    expect(first.meeting_note_id).toBe("meet-1");
    expect(first.purpose).toContain("pricing v2");
    expect(first.participants.map((p) => p.certainty)).toEqual([
      "certain",
      "certain",
      "maybe",
    ]);
    expect(first.participants.at(2)?.note_id).toBeNull();
    expect(first.key_points.at(0)?.timestamp).toBe("14:02");
    expect(first.key_points.at(0)?.children.at(0)?.timestamp).toBe("14:05");
    expect(first.outcome).toContain("flags.pricingV2");
    expect(first.action_items).toHaveLength(2);
    expect(first.transcript.duration_seconds).toBe(45 * 60);
    expect(first.transcript.word_count).toBe(6120);
    expect(await api.getSummary("meet-1")).toEqual(first);

    const second = await api.generateSummary("meet-1");
    expect(second.purpose).toBe(first.purpose);
    expect(second.action_items.map((item) => item.task_id)).not.toEqual(
      first.action_items.map((item) => item.task_id),
    );
    expect(await api.getSummary("meet-1")).toEqual(second);
  });

  it("maps scripted failure to LlmError without storing a summary", async () => {
    const api = createMemoryMeetingSummaryApi({
      fail: {
        code: "unreachable",
        message: "Could not reach the LLM server.",
      },
    });
    await expect(api.generateSummary("meet-1")).rejects.toMatchObject({
      code: "unreachable",
    });
    await expect(api.generateSummary("meet-1")).rejects.toBeInstanceOf(
      LlmError,
    );
    expect(demoMeetingSummary().participants).toHaveLength(3);
  });
});
