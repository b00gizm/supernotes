import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Note } from "../notes/types";
import { tasksApi as defaultTasksApi, type TasksApi } from "../tasks/api";
import { todayYmd } from "../tasks/due";
import { subscribeTasksChanged } from "../tasks/events";
import { TaskMetaPopover, type TaskMetaPatch } from "../tasks/TaskMetaPopover";
import { TaskRow } from "../tasks/TaskRow";
import type { Task, TaskState } from "../tasks/types";
import { formatTranscriptDuration, formatTranscriptWords } from "./format";
import type {
  MeetingSummary as MeetingSummaryData,
  MeetingSummaryApi,
  SummaryKeyPoint,
  SummaryParticipant,
} from "./summaryApi";

function SummaryProse({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <p className="meeting-summary-prose">
      {parts.map((part, index) => {
        if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={index} className="meeting-summary-code">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </p>
  );
}

function KeyPoints({ points }: { points: SummaryKeyPoint[] }) {
  if (points.length === 0) {
    return null;
  }
  return (
    <ul className="meeting-summary-points">
      {points.map((point, index) => (
        <li key={`${point.text}-${String(index)}`}>
          <span className="meeting-summary-point-row">
            <span>{point.text}</span>
            {point.timestamp ? (
              <span className="meeting-summary-time">{point.timestamp}</span>
            ) : null}
          </span>
          {point.children.length > 0 ? (
            <KeyPoints points={point.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function participantPrefix(participant: SummaryParticipant): string {
  return participant.certainty === "certain" ? "@" : "(Maybe) ";
}

function ParticipantChip({
  participant,
  onCommit,
}: {
  participant: SummaryParticipant;
  onCommit: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant.name);
  const linked = participant.certainty === "certain" && participant.note_id;
  const className = `meeting-participant${linked ? " is-linked" : " is-maybe"}`;

  useEffect(() => {
    setDraft(participant.name);
  }, [participant.name]);

  const commit = () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || name === participant.name) {
      setDraft(participant.name);
      return;
    }
    onCommit(name);
  };

  if (editing) {
    return (
      <span className={className}>
        <span aria-hidden="true">{participantPrefix(participant)}</span>
        <input
          className="meeting-participant-input"
          aria-label={`Edit participant ${participant.name}`}
          value={draft}
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(participant.name);
              setEditing(false);
            }
          }}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={`Edit participant ${participant.name}`}
      onClick={() => {
        setEditing(true);
      }}
    >
      {`${participantPrefix(participant)}${participant.name}`}
    </button>
  );
}

async function loadTasksById(
  client: TasksApi,
  ids: string[],
): Promise<Record<string, Task>> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await client.getTask(id)] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  const next: Record<string, Task> = {};
  for (const [id, task] of entries) {
    if (task) {
      next[id] = task;
    }
  }
  return next;
}

function taskFromItem(
  item: MeetingSummaryData["action_items"][number],
  loaded: Task | undefined,
  noteId: string,
): Task {
  return (
    loaded ?? {
      id: item.task_id,
      note_id: noteId,
      title: item.title,
      state: "open",
      due_date: item.due_date,
      priority: item.priority,
      created_at: "",
      updated_at: "",
      completed_at: null,
    }
  );
}

export type MeetingSummaryProps = {
  summary: MeetingSummaryData;
  summaryApi?: MeetingSummaryApi | undefined;
  tasks?: TasksApi | undefined;
  note?: Note | undefined;
  today?: string | undefined;
  onOpenNote?: ((noteId: string) => void) | undefined;
  onSummaryChange?: ((summary: MeetingSummaryData) => void) | undefined;
};

export function MeetingSummary({
  summary,
  summaryApi,
  tasks: tasksClient = defaultTasksApi,
  note,
  today = todayYmd(),
  onOpenNote,
  onSummaryChange,
}: MeetingSummaryProps) {
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<{
    taskId: string;
    x: number;
    y: number;
  } | null>(null);

  const sourceNote = useMemo<Note>(
    () =>
      note ?? {
        id: summary.meeting_note_id,
        title: "Meeting",
        body_markdown: "",
        note_type: "meeting",
        pinned: false,
        created_at: "",
        updated_at: "",
      },
    [note, summary.meeting_note_id],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = summary.action_items.map((item) => item.task_id);
    void loadTasksById(tasksClient, ids).then((next) => {
      if (!cancelled) {
        setTasks(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [summary, tasksClient]);

  useEffect(
    () =>
      subscribeTasksChanged(() => {
        const ids = summary.action_items.map((item) => item.task_id);
        void loadTasksById(tasksClient, ids).then(setTasks);
      }),
    [summary, tasksClient],
  );

  const applyUpdate = async (task: Task, patch: TaskMetaPatch) => {
    const previous = task;
    const nextState = patch.state ?? task.state;
    setTasks((prev) => ({
      ...prev,
      [task.id]: {
        ...task,
        state: nextState,
        due_date: patch.due_date === undefined ? task.due_date : patch.due_date,
        priority: patch.priority === undefined ? task.priority : patch.priority,
      },
    }));
    setError(null);
    try {
      const saved = await tasksClient.updateTask({
        id: task.id,
        title: task.title,
        state: nextState,
        due_date: patch.due_date === undefined ? task.due_date : patch.due_date,
        priority: patch.priority === undefined ? task.priority : patch.priority,
      });
      setTasks((prev) => ({ ...prev, [saved.id]: saved }));
    } catch (err) {
      setTasks((prev) => ({ ...prev, [task.id]: previous }));
      setError(err instanceof Error ? err.message : "Could not update task");
    }
  };

  const toggleDone = (task: Task) => {
    const state: TaskState = task.state === "done" ? "open" : "done";
    void applyUpdate(task, { state });
  };

  const saveParticipant = async (index: number, name: string) => {
    const current = summary.participants[index];
    if (!current || !summaryApi) {
      return;
    }
    const participants = summary.participants.map((item, itemIndex) =>
      itemIndex === index ? { ...item, name } : item,
    );
    onSummaryChange?.({ ...summary, participants });
    try {
      const saved = await summaryApi.saveParticipants(
        summary.meeting_note_id,
        participants,
      );
      onSummaryChange?.(saved);
      setError(null);
    } catch (err) {
      onSummaryChange?.(summary);
      setError(
        err instanceof Error ? err.message : "Could not save participant",
      );
    }
  };

  const listed = summary.action_items.map((item) =>
    taskFromItem(item, tasks[item.task_id], summary.meeting_note_id),
  );
  const popoverTask = popover
    ? (listed.find((task) => task.id === popover.taskId) ?? null)
    : null;

  return (
    <div className="meeting-summary" aria-label="Meeting summary">
      <section className="meeting-summary-section" aria-label="Purpose">
        <h2 className="meeting-summary-label">Purpose</h2>
        <SummaryProse text={summary.purpose} />
      </section>
      <section className="meeting-summary-section" aria-label="Participants">
        <h2 className="meeting-summary-label">Participants</h2>
        <div className="meeting-summary-participants">
          {summary.participants.map((participant, index) => (
            <ParticipantChip
              key={`${participant.certainty}-${participant.name}-${String(index)}`}
              participant={participant}
              onCommit={(name) => {
                void saveParticipant(index, name);
              }}
            />
          ))}
        </div>
      </section>
      <section className="meeting-summary-section" aria-label="Key points">
        <h2 className="meeting-summary-label">Key points</h2>
        <KeyPoints points={summary.key_points} />
      </section>
      <section className="meeting-summary-section" aria-label="Outcome">
        <h2 className="meeting-summary-label">Outcome</h2>
        <SummaryProse text={summary.outcome} />
      </section>
      <section className="meeting-summary-section" aria-label="Action items">
        <h2 className="meeting-summary-label">Action items</h2>
        {error ? (
          <p className="meeting-summary-error" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="tasks-list meeting-summary-actions">
          {listed.map((task) => (
            <li key={task.id}>
              <TaskRow
                task={task}
                note={sourceNote}
                today={today}
                showDue={Boolean(task.due_date)}
                onToggle={() => {
                  toggleDone(task);
                }}
                onOpen={() => {
                  onOpenNote?.(sourceNote.id);
                }}
                onMeta={(event: ReactMouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setPopover({
                    taskId: task.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              />
            </li>
          ))}
        </ul>
        {popover && popoverTask ? (
          <TaskMetaPopover
            task={popoverTask}
            anchor={{ x: popover.x, y: popover.y }}
            onClose={() => {
              setPopover(null);
            }}
            onUpdate={(patch) => {
              void applyUpdate(popoverTask, patch);
            }}
          />
        ) : null}
      </section>
      <p className="meeting-summary-footer">
        <button
          type="button"
          className="meeting-summary-transcript"
          onClick={() => {
            onOpenNote?.(summary.transcript.note_id);
          }}
        >
          Full transcript
        </button>
        <span className="meeting-dot" aria-hidden="true">
          ·
        </span>
        <span>
          {formatTranscriptDuration(summary.transcript.duration_seconds)}
        </span>
        <span className="meeting-dot" aria-hidden="true">
          ·
        </span>
        <span>{formatTranscriptWords(summary.transcript.word_count)}</span>
      </p>
    </div>
  );
}
