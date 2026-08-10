import { useNotes } from "./notes/useNotes";
import "./App.css";

function saveLabel(status: ReturnType<typeof useNotes>["status"]): string {
  switch (status) {
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "";
  }
}

function App() {
  const {
    notes,
    selectedId,
    titleDraft,
    bodyDraft,
    status,
    error,
    loading,
    selectNote,
    setTitleDraft,
    setBodyDraft,
    createNote,
    deleteSelected,
  } = useNotes();

  return (
    <main className="app-shell" aria-label="Supernotes">
      <aside className="notes-sidebar" aria-label="Notes">
        <div className="notes-sidebar-header">
          <h1 className="app-title">Supernotes</h1>
          <button
            type="button"
            onClick={() => {
              void createNote();
            }}
          >
            New note
          </button>
        </div>
        {loading ? <p className="notes-muted">Loading…</p> : null}
        <ul className="notes-list">
          {notes.map((note) => {
            const title = note.id === selectedId ? titleDraft : note.title;
            const body =
              note.id === selectedId ? bodyDraft : note.body_markdown;
            return (
              <li key={note.id}>
                <button
                  type="button"
                  className={
                    note.id === selectedId
                      ? "notes-list-item is-selected"
                      : "notes-list-item"
                  }
                  onClick={() => {
                    selectNote(note.id);
                  }}
                >
                  <span className="notes-list-title">
                    {title || "Untitled"}
                  </span>
                  <span className="notes-list-snippet">
                    {body.trim() || "Empty note"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="notes-editor" aria-label="Note editor">
        {selectedId ? (
          <>
            <div className="notes-editor-toolbar">
              <span className="notes-save-status" aria-live="polite">
                {saveLabel(status)}
              </span>
              <button
                type="button"
                onClick={() => {
                  void deleteSelected();
                }}
              >
                Delete
              </button>
            </div>
            <input
              className="notes-title-input"
              aria-label="Note title"
              value={titleDraft}
              onChange={(event) => {
                setTitleDraft(event.target.value);
              }}
            />
            <textarea
              className="notes-body-input"
              aria-label="Note body"
              value={bodyDraft}
              onChange={(event) => {
                setBodyDraft(event.target.value);
              }}
            />
          </>
        ) : (
          <p className="notes-muted">
            {loading ? "Loading notes…" : "Create a note to get started."}
          </p>
        )}
        {error ? (
          <p className="notes-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export default App;
