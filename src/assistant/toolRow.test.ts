import { describe, expect, it } from "vitest";
import { formatToolResult, formatToolRow, formatToolRowLabel } from "./toolRow";

describe("tool-read row copy (ENG-73)", () => {
  it("uses mockup 1i copy for search_notes and list_calendar_events", () => {
    expect(
      formatToolRowLabel({
        name: "search_notes",
        arguments: '{"query":"pricing"}',
        result: [{}, {}, {}, {}],
      }),
    ).toBe("Searched notes · 'pricing' · 4 results");
    expect(
      formatToolRow({
        name: "list_calendar_events",
        arguments: '{"date":"2026-08-13"}',
        result: [{ title: "Standup" }],
      }),
    ).toEqual({
      action: "Read calendar",
      argument: "Thu, Aug 13",
      summary: null,
    });
  });

  it("keeps the same action · argument · count shape for the other reads", () => {
    expect(
      formatToolRowLabel({
        name: "get_note",
        arguments: '{"id_or_title":"Mike Q3 sync"}',
        result: { title: "Mike Q3 sync" },
      }),
    ).toBe("Read note · 'Mike Q3 sync'");
    expect(
      formatToolRowLabel({
        name: "list_tasks",
        arguments: '{"state":"open"}',
        result: [{ id: "t1" }],
      }),
    ).toBe("Listed tasks · open · 1 result");
    expect(
      formatToolRowLabel({
        name: "get_daily_note",
        arguments: '{"date":"2026-08-13"}',
        result: { title: "2026-08-13" },
      }),
    ).toBe("Read daily note · Thu, Aug 13");
  });

  it("stringifies the paired result for expand", () => {
    expect(formatToolResult([{ title: "pricing north" }])).toContain(
      "pricing north",
    );
    expect(formatToolResult({ error: "unknown tool: nope" })).toContain(
      "unknown tool: nope",
    );
    expect(formatToolResult(null)).toBe("null");
    expect(formatToolResult(undefined)).toBe("null");
  });
});
