/** Three-bar waveform glyph (ENG-68): left shortest, middle tallest, right medium. */
export function IconWaveform({
  className = "waveform-icon",
}: {
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="1.25"
        y="7"
        width="2.1"
        height="4"
        rx="1.05"
        fill="currentColor"
      />
      <rect
        x="4.95"
        y="1.5"
        width="2.1"
        height="9.5"
        rx="1.05"
        fill="currentColor"
      />
      <rect
        x="8.65"
        y="4.25"
        width="2.1"
        height="6.75"
        rx="1.05"
        fill="currentColor"
      />
    </svg>
  );
}
