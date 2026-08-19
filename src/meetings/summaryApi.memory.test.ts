import { describe, expect, it } from "vitest";
import {
  createMemoryMeetingSummaryApi,
  demoMeetingSummary,
  subscribeSummaryDone,
  subscribeSummaryErrors,
  subscribeSummaryProgress,
} from "./summaryApi";

function flushGenerate(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("memory meeting summary (ENG-71)", () => {
  it("generate returns a job before done and replaces on regenerate", async () => {
    const api = createMemoryMeetingSummaryApi();
    const progress: string[] = [];
    const done: string[] = [];
    const unlistenProgress = await subscribeSummaryProgress((event) => {
      progress.push(event.stream_id);
    });
    const unlistenDone = await subscribeSummaryDone((event) => {
      done.push(event.summary.meeting_note_id);
    });

    expect(await api.getSummary("meet-1")).toBeNull();
    const job = await api.generateSummary("meet-1");
    expect(job.meeting_note_id).toBe("meet-1");
    expect(job.stream_id.startsWith("mem-")).toBe(true);
    expect(await api.getSummary("meet-1")).toBeNull();
    expect(progress).toEqual([job.stream_id]);

    await flushGenerate();
    const first = await api.getSummary("meet-1");
    expect(first?.purpose).toContain("pricing v2");
    expect(first?.participants.map((p) => p.certainty)).toEqual([
      "certain",
      "certain",
      "maybe",
    ]);
    expect(first?.action_items).toHaveLength(2);
    expect(done).toEqual(["meet-1"]);

    const secondJob = await api.generateSummary("meet-1");
    await flushGenerate();
    const second = await api.getSummary("meet-1");
    expect(secondJob.stream_id).not.toBe(job.stream_id);
    expect(second?.action_items.map((item) => item.task_id)).not.toEqual(
      first?.action_items.map((item) => item.task_id),
    );

    unlistenProgress();
    unlistenDone();
  });

  it("maps scripted failure to summary://error without storing a summary", async () => {
    const api = createMemoryMeetingSummaryApi({
      fail: {
        code: "unreachable",
        message: "Could not reach the LLM server.",
      },
    });
    const codes: string[] = [];
    const unlisten = await subscribeSummaryErrors((event) => {
      codes.push(event.code);
    });
    const job = await api.generateSummary("meet-1");
    expect(job.meeting_note_id).toBe("meet-1");
    await flushGenerate();
    expect(codes).toEqual(["unreachable"]);
    expect(await api.getSummary("meet-1")).toBeNull();
    expect(demoMeetingSummary().participants).toHaveLength(3);
    unlisten();
  });

  it("saveParticipants persists pills without changing task ids", async () => {
    const api = createMemoryMeetingSummaryApi();
    await api.generateSummary("meet-1");
    await flushGenerate();
    const generated = await api.getSummary("meet-1");
    const taskIds = generated?.action_items.map((item) => item.task_id);

    const saved = await api.saveParticipants("meet-1", [
      { name: "Sara Kim", certainty: "certain", note_id: "person-sara" },
      { name: "Steve", certainty: "certain", note_id: "person-steve" },
    ]);
    expect(saved.participants).toHaveLength(2);
    expect(saved.participants.at(1)?.name).toBe("Steve");
    expect(saved.action_items.map((item) => item.task_id)).toEqual(taskIds);
    expect((await api.getSummary("meet-1"))?.participants.at(1)?.name).toBe(
      "Steve",
    );
  });
});
