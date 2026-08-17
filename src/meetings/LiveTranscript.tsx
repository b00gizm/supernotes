import type { TranscriptSegment } from "./recording";

function IconClock() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
      />
      <path
        d="M8 5.25v3.1l2.1 1.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LiveTranscript({
  segments,
  live,
}: {
  segments: TranscriptSegment[];
  live: boolean;
}) {
  return (
    <section className="live-transcript" aria-label="Live transcript">
      <h2 className="live-transcript-heading">Live transcript</h2>
      <ol className="live-transcript-lines">
        {segments.map((segment, index) => {
          const newest = live && index === segments.length - 1;
          return (
            <li key={segment.id} className="live-transcript-line">
              <time className="live-transcript-time">{segment.time}</time>
              <p className="live-transcript-text">
                {segment.text}
                {newest ? (
                  <span className="live-transcript-cursor" aria-hidden="true" />
                ) : null}
              </p>
            </li>
          );
        })}
        {live && segments.length === 0 ? (
          <li className="live-transcript-line">
            <span className="live-transcript-time" />
            <p className="live-transcript-text">
              <span className="live-transcript-cursor" aria-hidden="true" />
            </p>
          </li>
        ) : null}
      </ol>
      <p className="live-transcript-status">
        <IconClock />
        Transcribing locally · summary on stop
      </p>
    </section>
  );
}
