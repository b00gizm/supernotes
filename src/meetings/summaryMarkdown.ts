import { MENTION_TITLE } from "../notes/wikilinks";
import type {
  MeetingSummary,
  SummaryKeyPoint,
  SummaryParticipant,
} from "./summaryApi";

export const SUMMARY_HEADINGS = [
  "Purpose",
  "Participants",
  "Key points",
  "Outcome / next steps",
  "Action items",
] as const;

const HEADING_SET = new Set<string>(SUMMARY_HEADINGS);

export function mentionMarkdown(name: string): string {
  return MENTION_TITLE.test(name) ? `@${name}` : `[[${name}]]`;
}

function participantLine(participant: SummaryParticipant): string {
  if (participant.certainty === "certain") {
    return `- ${mentionMarkdown(participant.name)}`;
  }
  return `- (Maybe) ${participant.name}`;
}

function keyPointLines(points: SummaryKeyPoint[], depth = 0): string[] {
  const indent = "  ".repeat(depth);
  return points.flatMap((point) => {
    const stamp = point.timestamp ? ` ${point.timestamp}` : "";
    return [
      `${indent}- ${point.text}${stamp}`,
      ...keyPointLines(point.children, depth + 1),
    ];
  });
}

/** Render engine JSON as note markdown. LLM never writes this. */
export function renderSummaryMarkdown(summary: MeetingSummary): string {
  const participants = summary.participants.map(participantLine).join("\n");
  const points = keyPointLines(summary.key_points).join("\n");
  const actions = summary.action_items
    .map((item) =>
      item.title
        ? `[[task:${item.task_id}]] ${item.title}`
        : `[[task:${item.task_id}]]`,
    )
    .join("\n\n");
  return [
    "## Purpose",
    "",
    summary.purpose,
    "",
    "## Participants",
    "",
    participants,
    "",
    "## Key points",
    "",
    points,
    "",
    "## Outcome / next steps",
    "",
    summary.outcome,
    "",
    "## Action items",
    "",
    actions,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function findSummaryBlock(
  body: string,
): { start: number; end: number } | null {
  const headingRe = /^## (.+)$/gm;
  const headings: Array<{ title: string; index: number }> = [];
  for (const match of body.matchAll(headingRe)) {
    const title = match[1];
    if (!title) {
      continue;
    }
    headings.push({ title, index: match.index });
  }
  let startAt = -1;
  for (let i = headings.length - 1; i >= 0; i -= 1) {
    if (headings[i]?.title === "Purpose") {
      startAt = i;
      break;
    }
  }
  if (startAt < 0) {
    return null;
  }
  const seen = new Set<string>();
  let end = body.length;
  for (let i = startAt; i < headings.length; i += 1) {
    const heading = headings[i];
    if (!heading) {
      continue;
    }
    if (!HEADING_SET.has(heading.title)) {
      end = heading.index;
      break;
    }
    seen.add(heading.title);
  }
  if (!seen.has("Purpose") || !seen.has("Action items")) {
    return null;
  }
  const start = headings[startAt]?.index ?? 0;
  return { start, end };
}

/** Insert or replace the five-section summary block. Leaves other body intact. */
export function upsertSummaryMarkdown(body: string, block: string): string {
  const next = block.trim();
  const range = findSummaryBlock(body);
  if (!range) {
    const prefix = body.trimEnd();
    return prefix ? `${prefix}\n\n${next}` : next;
  }
  const before = body.slice(0, range.start).trimEnd();
  const after = body.slice(range.end).replace(/^\n+/, "").trimEnd();
  if (!before) {
    return after ? `${next}\n\n${after}` : next;
  }
  if (!after) {
    return `${before}\n\n${next}`;
  }
  return `${before}\n\n${next}\n\n${after}`;
}
