import { describe, expect, it } from "vitest";
import { createMemoryNotesApi } from "./memoryApi";
import {
  makeSearchKpiSeed,
  runSearchKpi,
  SEARCH_KPI_MAX_MS,
  SEARCH_KPI_NOTE_COUNT,
  SEARCH_KPI_QUERY,
} from "./searchKpi";

describe("title search KPI (ENG-52)", () => {
  it(`searches ${String(SEARCH_KPI_NOTE_COUNT)} notes in under ${String(SEARCH_KPI_MAX_MS)}ms`, async () => {
    const api = createMemoryNotesApi(makeSearchKpiSeed());
    const result = await runSearchKpi(api);

    expect(result.noteCount).toBe(SEARCH_KPI_NOTE_COUNT);
    expect(result.query).toBe(SEARCH_KPI_QUERY);
    expect(result.hitCount).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeLessThan(SEARCH_KPI_MAX_MS);
    expect(result.passed).toBe(true);

    // Visible baseline in CI / local logs.
    console.log(
      `[search-kpi] ${String(result.noteCount)} notes, query="${result.query}", hits=${String(result.hitCount)}, ${result.elapsedMs.toFixed(2)}ms (budget ${String(SEARCH_KPI_MAX_MS)}ms)`,
    );
  });
});
