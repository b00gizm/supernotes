import { useEffect, useId, useRef, useState } from "react";
import {
  agentApi as defaultAgentApi,
  ASSISTANT_PANEL_TITLE,
  ASSISTANT_SHORTCUT_LABEL,
  subscribeAgentToolResults,
  subscribeAgentTools,
  subscribeLlmDone,
  subscribeLlmErrors,
  subscribeLlmTokens,
  type AgentApi,
} from "../agent/api";
import { llmErrorCopy } from "../settings/errors";
import { AssistantMarkdown } from "./markdown";
import { formatToolResult, formatToolRowLabel } from "./toolRow";

export const ASSISTANT_PLACEHOLDER = "Ask, or ⌘↵ to act on this note";
export const ACT_ON_NOTE_PROMPT = "Act on this note.";

export type AssistantSidebarProps = {
  open: boolean;
  onClose: () => void;
  noteId: string | null;
  api?: AgentApi;
};

type UserTurn = {
  id: string;
  role: "user";
  content: string;
};

type AssistantTurn = {
  id: string;
  role: "assistant";
  content: string;
};

type ToolTurn = {
  id: string;
  role: "tool";
  name: string;
  arguments: string;
  result?: unknown;
};

type ChatTurn = UserTurn | AssistantTurn | ToolTurn;

function isLiveStream(
  streamId: string | null,
  eventStreamId: string | undefined,
): boolean {
  if (streamId && eventStreamId && streamId !== eventStreamId) {
    return false;
  }
  return true;
}

function upsertToolTurn(
  current: ChatTurn[],
  next: Omit<ToolTurn, "role">,
): ChatTurn[] {
  const existing = current.findIndex(
    (turn) => turn.role === "tool" && turn.id === next.id,
  );
  if (existing === -1) {
    return [...current, { role: "tool", ...next }];
  }
  const prev = current[existing];
  if (prev?.role !== "tool") {
    return current;
  }
  const merged: ToolTurn = {
    ...prev,
    name: next.name || prev.name,
    arguments: next.arguments || prev.arguments,
    result: next.result === undefined ? prev.result : next.result,
  };
  return [
    ...current.slice(0, existing),
    merged,
    ...current.slice(existing + 1),
  ];
}

function ToolReadRow({ turn }: { turn: ToolTurn }) {
  const label = formatToolRowLabel(turn);
  const result = formatToolResult(turn.result);
  return (
    <details className="assistant-tool-row">
      <summary className="assistant-tool-summary">
        <span className="assistant-tool-chevron" aria-hidden="true">
          {">"}
        </span>
        {label}
      </summary>
      {result ? <pre className="assistant-tool-result">{result}</pre> : null}
    </details>
  );
}

function IconAssistantStar() {
  return (
    <svg className="assistant-star" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.15 9.65 6.05h4.15l-3.35 2.5 1.3 4.1L8 10.3l-3.75 2.35 1.3-4.1-3.35-2.5h4.15z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClose() {
  return (
    <svg
      className="assistant-close-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AssistantSidebar({
  open,
  onClose,
  noteId,
  api = defaultAgentApi,
}: AssistantSidebarProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const sendingRef = useRef(false);
  const acceptingRef = useRef(false);
  const streamIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const idRef = useRef(0);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextId = () => {
    idRef.current += 1;
    return `m${String(idRef.current)}`;
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      unsubs.push(
        await subscribeLlmTokens((event) => {
          if (cancelled || !acceptingRef.current) {
            return;
          }
          if (streamIdRef.current && event.stream_id !== streamIdRef.current) {
            return;
          }
          streamIdRef.current = event.stream_id;
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === "assistant") {
              return [
                ...current.slice(0, -1),
                { ...last, content: last.content + event.text },
              ];
            }
            return [
              ...current,
              { id: nextId(), role: "assistant", content: event.text },
            ];
          });
        }),
      );
      unsubs.push(
        await subscribeLlmDone((event) => {
          if (cancelled || !acceptingRef.current) {
            return;
          }
          if (streamIdRef.current && event.stream_id !== streamIdRef.current) {
            return;
          }
          streamIdRef.current = event.stream_id;
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === "assistant") {
              return [
                ...current.slice(0, -1),
                { ...last, content: event.text },
              ];
            }
            if (!event.text) {
              return current;
            }
            return [
              ...current,
              { id: nextId(), role: "assistant", content: event.text },
            ];
          });
        }),
      );
      unsubs.push(
        await subscribeLlmErrors((event) => {
          if (cancelled) {
            return;
          }
          if (
            event.stream_id &&
            streamIdRef.current &&
            event.stream_id !== streamIdRef.current
          ) {
            return;
          }
          if (!acceptingRef.current) {
            return;
          }
          setError(llmErrorCopy(event));
          setStreaming(false);
          acceptingRef.current = false;
          sendingRef.current = false;
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === "assistant" && last.content === "") {
              return current.slice(0, -1);
            }
            return current;
          });
        }),
      );
      unsubs.push(
        await subscribeAgentTools((event) => {
          if (cancelled || !acceptingRef.current) {
            return;
          }
          if (!isLiveStream(streamIdRef.current, event.stream_id)) {
            return;
          }
          streamIdRef.current = event.stream_id;
          setMessages((current) =>
            upsertToolTurn(current, {
              id: event.id,
              name: event.name,
              arguments: event.arguments,
            }),
          );
        }),
      );
      unsubs.push(
        await subscribeAgentToolResults((event) => {
          if (cancelled || !acceptingRef.current) {
            return;
          }
          if (!isLiveStream(streamIdRef.current, event.stream_id)) {
            return;
          }
          streamIdRef.current = event.stream_id;
          setMessages((current) =>
            upsertToolTurn(current, {
              id: event.id,
              name: event.name,
              arguments: "",
              result: event.result,
            }),
          );
        }),
      );
    })();
    return () => {
      cancelled = true;
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) {
      return;
    }
    thread.scrollTop = thread.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      const inPanel =
        target instanceof Element && target.closest(".assistant-sidebar");
      if (!inPanel) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  const clearConversation = () => {
    generationRef.current += 1;
    acceptingRef.current = false;
    sendingRef.current = false;
    streamIdRef.current = null;
    setStreaming(false);
    void api
      .clearConversation()
      .then(() => {
        setMessages([]);
        setError(null);
        inputRef.current?.focus();
      })
      .catch((err: unknown) => {
        setError(llmErrorCopy(err));
      });
  };

  const send = async (text: string) => {
    if (sendingRef.current) {
      return;
    }
    const userText = text.trim();
    if (!userText) {
      return;
    }
    sendingRef.current = true;
    const generation = generationRef.current;
    setDraft("");
    setError(null);
    setStreaming(true);
    // User turn only. Assistant row appears on the first token so a
    // failed stream never leaves a blank bubble.
    setMessages((current) => [
      ...current,
      { id: nextId(), role: "user", content: userText },
    ]);
    acceptingRef.current = true;
    streamIdRef.current = null;
    try {
      const result = await api.sendChat({
        message: userText,
        note_id: noteId,
      });
      if (generationRef.current !== generation) {
        return;
      }
      streamIdRef.current = result.stream_id;
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant") {
          return last.content
            ? current
            : [...current.slice(0, -1), { ...last, content: result.text }];
        }
        if (!result.text) {
          return current;
        }
        return [
          ...current,
          { id: nextId(), role: "assistant", content: result.text },
        ];
      });
    } catch (err) {
      if (generationRef.current !== generation) {
        return;
      }
      setError(llmErrorCopy(err));
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          return current.slice(0, -1);
        }
        return current;
      });
    } finally {
      if (generationRef.current === generation) {
        sendingRef.current = false;
        acceptingRef.current = false;
        setStreaming(false);
      }
    }
  };

  const submit = (actOnNote: boolean) => {
    const text = draft.trim();
    if (text) {
      void send(text).catch((err: unknown) => {
        setError(llmErrorCopy(err));
      });
      return;
    }
    if (actOnNote && noteId) {
      void send(ACT_ON_NOTE_PROMPT).catch((err: unknown) => {
        setError(llmErrorCopy(err));
      });
    }
  };

  return (
    <aside
      className={open ? "assistant-sidebar" : "assistant-sidebar is-closed"}
      hidden={!open}
      inert={!open}
      aria-hidden={!open}
      aria-label={ASSISTANT_PANEL_TITLE}
    >
      <header className="assistant-header">
        <h1 className="assistant-title">
          <IconAssistantStar />
          {ASSISTANT_PANEL_TITLE}
        </h1>
        <div className="assistant-header-actions">
          <button
            type="button"
            className="text-button assistant-clear"
            disabled={messages.length === 0 && !error}
            onClick={clearConversation}
          >
            Clear
          </button>
          <kbd className="search-chip">{ASSISTANT_SHORTCUT_LABEL}</kbd>
          <button
            type="button"
            className="assistant-close"
            aria-label={`Close ${ASSISTANT_PANEL_TITLE}`}
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>
      </header>

      <div
        ref={threadRef}
        className="assistant-thread"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((turn) => {
          if (turn.role === "user") {
            return (
              <div key={turn.id} className="assistant-turn is-user">
                <div className="assistant-user-bubble">{turn.content}</div>
              </div>
            );
          }
          if (turn.role === "tool") {
            return (
              <div key={turn.id} className="assistant-turn is-tool">
                <ToolReadRow turn={turn} />
              </div>
            );
          }
          return (
            <div key={turn.id} className="assistant-turn is-assistant">
              <AssistantMarkdown text={turn.content} />
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="assistant-composer">
        <input
          ref={inputRef}
          id={inputId}
          className="assistant-input"
          aria-label="Ask the Assistant"
          placeholder={ASSISTANT_PLACEHOLDER}
          value={draft}
          disabled={streaming}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) {
              return;
            }
            event.preventDefault();
            submit(event.metaKey || event.ctrlKey);
          }}
        />
      </div>
    </aside>
  );
}
