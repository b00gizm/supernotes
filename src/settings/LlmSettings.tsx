import { useEffect, useRef, useState } from "react";
import {
  llmApi as defaultLlmApi,
  llmErrorFromUnknown,
  llmErrorMessage,
  subscribeLlmTestErrors,
  subscribeLlmTestTokens,
  type LlmSettingsApi,
} from "./api";

export type LlmSettingsProps = {
  api?: LlmSettingsApi;
};

export function LlmSettings({ api = defaultLlmApi }: LlmSettingsProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyDirty, setKeyDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState("");
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const testingRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .getSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setBaseUrl(settings.base_url);
        setModel(settings.model);
        setHasKey(settings.has_api_key);
        setApiKeyDraft("");
        setKeyDirty(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(llmErrorFromUnknown(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      unsubs.push(
        await subscribeLlmTestTokens((event) => {
          if (cancelled) {
            return;
          }
          if (event.done) {
            return;
          }
          setStream((prev) => prev + event.token);
        }),
      );
      unsubs.push(
        await subscribeLlmTestErrors((event) => {
          if (cancelled) {
            return;
          }
          setError(llmErrorMessage(event.code));
        }),
      );
    })();
    return () => {
      cancelled = true;
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [api]);

  const persistMeta = async () => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    try {
      const saved = await api.saveSettings({
        base_url: baseUrl,
        model,
      });
      setHasKey(saved.has_api_key);
      setError(null);
    } catch (err) {
      setError(llmErrorFromUnknown(err));
      throw err;
    } finally {
      savingRef.current = false;
    }
  };

  const persistKey = async () => {
    if (!keyDirty) {
      return;
    }
    const next = apiKeyDraft.trim();
    try {
      if (next) {
        await api.setApiKey(next);
        setHasKey(true);
      } else {
        await api.clearApiKey();
        setHasKey(false);
      }
      setApiKeyDraft("");
      setKeyDirty(false);
      setError(null);
    } catch (err) {
      setError(llmErrorFromUnknown(err));
      throw err;
    }
  };

  const testConnection = async () => {
    if (testingRef.current) {
      return;
    }
    testingRef.current = true;
    setTesting(true);
    setError(null);
    setStream("");
    try {
      await persistMeta();
      await persistKey();
      await api.testConnection();
    } catch (err) {
      setError(llmErrorFromUnknown(err));
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  };

  return (
    <section className="overview-pane settings-pane" aria-label="Settings">
      <div className="overview-header">
        <h1 className="pane-title">Settings</h1>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <form
          className="settings-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void testConnection();
          }}
        >
          <div className="settings-field">
            <label htmlFor="llm-base-url">Base URL</label>
            <input
              id="llm-base-url"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
              }}
              onBlur={() => {
                void persistMeta().catch(() => {
                  // persistMeta already surfaces the error.
                });
              }}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="llm-api-key">API key</label>
            <input
              id="llm-api-key"
              type="password"
              autoComplete="off"
              value={apiKeyDraft}
              placeholder={hasKey ? "Key saved" : "API key"}
              onChange={(event) => {
                setApiKeyDraft(event.target.value);
                setKeyDirty(true);
              }}
              onBlur={() => {
                void persistKey().catch(() => {
                  // persistKey already surfaces the error.
                });
              }}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="llm-model">Model</label>
            <input
              id="llm-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
              }}
              onBlur={() => {
                void persistMeta().catch(() => {
                  // persistMeta already surfaces the error.
                });
              }}
            />
          </div>

          <div className="settings-actions">
            <button
              type="submit"
              className="new-note-button"
              disabled={testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          </div>

          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}

          {stream || testing ? (
            <pre
              className="settings-stream"
              aria-live="polite"
              aria-label="Test connection output"
            >
              {stream}
              {testing ? (
                <span className="live-transcript-cursor" aria-hidden="true" />
              ) : null}
            </pre>
          ) : null}
        </form>
      )}
    </section>
  );
}
