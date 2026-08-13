export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  task_id: string | null;
  created_at: string;
};

export type CreateCalendarEventInput = {
  title: string;
  start: string;
  end: string;
  task_id?: string | null;
};

export type UpdateCalendarEventInput = {
  id: string;
  title: string;
  start: string;
  end: string;
  task_id?: string | null;
};
