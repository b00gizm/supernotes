-- LLM client settings (ENG-70). API key lives in the OS keychain, never here.
CREATE TABLE llm_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
