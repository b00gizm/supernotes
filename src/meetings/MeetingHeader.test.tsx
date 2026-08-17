import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MeetingHeader } from "./MeetingHeader";
import { createMemoryMeetingsApi } from "./memoryApi";
import { queueMeetingPrefill } from "./pending";

describe("MeetingHeader (ENG-68)", () => {
  it("shows the waveform meta row and persists edits", async () => {
    const user = userEvent.setup();
    const api = createMemoryMeetingsApi([
      {
        note_id: "m1",
        meeting_date: "2026-08-10",
        start_time: "14:00",
        end_time: "14:23",
        transcript_note_id: null,
      },
    ]);

    render(<MeetingHeader noteId="m1" api={api} />);

    expect(await screen.findByText("Meeting")).toBeInTheDocument();
    expect(screen.getByText("Mon, Aug 10")).toBeInTheDocument();
    expect(screen.getByText("14:00 – 14:23")).toBeInTheDocument();
    expect(document.querySelector(".meeting-meta .waveform-icon")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit meeting time" }));
    await user.clear(screen.getByLabelText("Meeting date"));
    await user.type(screen.getByLabelText("Meeting date"), "2026-08-11");
    await user.clear(screen.getByLabelText("Start time"));
    await user.type(screen.getByLabelText("Start time"), "10:00");
    await user.clear(screen.getByLabelText("End time"));
    await user.type(screen.getByLabelText("End time"), "10:30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Tue, Aug 11")).toBeInTheDocument();
    expect(screen.getByText("10:00 – 10:30")).toBeInTheDocument();
    await expect(api.getMeeting("m1")).resolves.toMatchObject({
      meeting_date: "2026-08-11",
      start_time: "10:00",
      end_time: "10:30",
    });
  });

  it("uses queued prefill when creating a missing row", async () => {
    queueMeetingPrefill({
      title: "Pricing sync",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });
    const api = createMemoryMeetingsApi();
    render(<MeetingHeader noteId="from-cal" api={api} />);
    expect(await screen.findByText("Mon, Aug 10")).toBeInTheDocument();
    expect(screen.getByText("14:00 – 14:23")).toBeInTheDocument();
    await expect(api.getMeeting("from-cal")).resolves.toMatchObject({
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });
  });

  it("creates a row when none exists and Escape cancels an edit", async () => {
    const user = userEvent.setup();
    const api = createMemoryMeetingsApi();
    render(<MeetingHeader noteId="fresh" api={api} />);

    expect(
      await screen.findByLabelText("Edit meeting time"),
    ).toBeInTheDocument();
    const created = await api.getMeeting("fresh");
    expect(created.note_id).toBe("fresh");

    await user.click(screen.getByRole("button", { name: "Edit meeting time" }));
    await user.clear(screen.getByLabelText("Meeting date"));
    await user.type(screen.getByLabelText("Meeting date"), "2026-01-01");
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Meeting date")).not.toBeInTheDocument();
    await expect(api.getMeeting("fresh")).resolves.toEqual(created);
  });

  it("surfaces a failed save instead of keeping the optimistic row", async () => {
    const user = userEvent.setup();
    const api = createMemoryMeetingsApi([
      {
        note_id: "m1",
        meeting_date: "2026-08-10",
        start_time: "14:00",
        end_time: "14:23",
        transcript_note_id: null,
      },
    ]);
    api.updateMeeting = () => Promise.reject(new Error("disk full"));

    render(<MeetingHeader noteId="m1" api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Edit meeting time" }),
    );
    await user.clear(screen.getByLabelText("Meeting date"));
    await user.type(screen.getByLabelText("Meeting date"), "2026-08-12");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByText("Mon, Aug 10")).toBeInTheDocument();
  });
});
