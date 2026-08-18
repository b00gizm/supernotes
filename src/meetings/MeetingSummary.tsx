import { useEffect, useState } from "react";
import { tasksApi as defaultTasksApi, type TasksApi } from "../tasks/api";
import { dueChip, todayYmd } from "../tasks/due";
import { subscribeTasksChanged } from "../tasks/events";
import { priorityDotClass } from "../tasks/priority";
import { TaskStateIcon } from "../tasks/TaskStateIcon";
import type { Task, TaskState } from "../tasks/types";
import { formatTranscriptDuration, formatTranscriptWords } from "./format";
import type {
  MeetingSummary as MeetingSummaryData,
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

function participantLabel(participant: SummaryParticipant): string {
  if (participant.certainty === "certain") {
    return `@${participant.name}`;
  }
  return `(Maybe) ${participant.name}`;
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

function iconState(
  state: TaskState,
  due: string | null,
  today: string,
): TaskState {
  if (state !== "open" || !due || due <= today) {
    return state;
  }
  // ponytail: future due uses the waiting clock; real state stays open.
  return "waiting";
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
        // Render still uses summary JSON; live task state is optional.
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

export type MeetingSummaryProps = {
  summary: MeetingSummaryData;
  tasks?: TasksApi | undefined;
  today?: string | undefined;
  onOpenNote?: ((noteId: string) => void) | undefined;
};

export function MeetingSummary({
  summary,
  tasks: tasksClient = defaultTasksApi,
  today = todayYmd(),
  onOpenNote,
}: MeetingSummaryProps) {
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [error, setError] = useState<string | null>(null);

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

  const toggleTask = async (task: Task) => {
    const previous = task;
    const state: TaskState = task.state === "done" ? "open" : "done";
    setTasks((prev) => ({ ...prev, [task.id]: { ...task, state } }));
    setError(null);
    try {
      const saved = await tasksClient.updateTask({ id: task.id, state });
      setTasks((prev) => ({ ...prev, [saved.id]: saved }));
    } catch (err) {
      setTasks((prev) => ({ ...prev, [task.id]: previous }));
      setError(err instanceof Error ? err.message : "Could not update task");
    }
  };

  return (
    <div className="meeting-summary" aria-label="Meeting summary">
      <section className="meeting-summary-section" aria-label="Purpose">
        <h2 className="meeting-summary-label">Purpose</h2>
        <SummaryProse text={summary.purpose} />
      </section>
      <section className="meeting-summary-section" aria-label="Participants">
        <h2 className="meeting-summary-label">Participants</h2>
        <div className="meeting-summary-participants">
          {summary.participants.map((participant) => {
            const label = participantLabel(participant);
            const linked =
              participant.certainty === "certain" && participant.note_id;
            if (linked) {
              return (
                <button
                  key={`${participant.name}-${participant.note_id ?? "linked"}`}
                  type="button"
                  className="meeting-participant is-linked"
                  onClick={() => {
                    onOpenNote?.(participant.note_id as string);
                  }}
                >
                  {label}
                </button>
              );
            }
            return (
              <span
                key={`${participant.certainty}-${participant.name}`}
                className="meeting-participant is-maybe"
              >
                {label}
              </span>
            );
          })}
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
        <ul className="meeting-summary-actions">
          {summary.action_items.map((item) => {
            const task = tasks[item.task_id];
            const due = task?.due_date ?? item.due_date;
            const priority = task?.priority ?? item.priority;
            const state = task?.state ?? "open";
            const chip = dueChip(due, today, {
              terminal: state === "done" || state === "cancelled",
            });
            const dot = priorityDotClass(priority);
            return (
              <li key={item.task_id} className="meeting-summary-action">
                <button
                  type="button"
                  className="meeting-summary-action-toggle"
                  aria-label={
                    state === "done" ? "Mark task open" : "Mark task done"
                  }
                  disabled={!task}
                  onClick={() => {
                    if (task) {
                      void toggleTask(task);
                    }
                  }}
                >
                  <TaskStateIcon state={iconState(state, due, today)} />
                </button>
                <span className="meeting-summary-action-title">
                  {item.title}
                </span>
                {chip ? (
                  <span className={`meeting-summary-due is-${chip.tone}`}>
                    {chip.label}
                  </span>
                ) : null}
                {dot ? (
                  <span
                    className={`task-priority-dot ${dot}`}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
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
