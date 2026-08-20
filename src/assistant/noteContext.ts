import type { LlmChatMessage } from "../llm/api";

export type OpenNoteContext = {
  title: string;
  body: string;
};

export const ACT_ON_NOTE_PROMPT = "Act on this note.";

export function noteContextMessage(
  note: OpenNoteContext | null,
): LlmChatMessage | null {
  if (!note) {
    return null;
  }
  const title = note.title.trim() || "Untitled";
  const body = note.body.trim();
  return {
    role: "system",
    content: body
      ? `Current note: ${title}\n\n${body}`
      : `Current note: ${title}`,
  };
}

export function buildChatMessages(input: {
  note: OpenNoteContext | null;
  history: readonly LlmChatMessage[];
  user: string;
}): LlmChatMessage[] {
  const messages: LlmChatMessage[] = [];
  const context = noteContextMessage(input.note);
  if (context) {
    messages.push(context);
  }
  for (const message of input.history) {
    messages.push({ role: message.role, content: message.content });
  }
  messages.push({ role: "user", content: input.user });
  return messages;
}
