import type { ReactNode } from "react";

/** Bold the first case-insensitive substring match (mockup 1a / 1j). */
export function highlightMatch(title: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) {
    return title;
  }
  const index = title.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return title;
  }
  const end = index + needle.length;
  return (
    <>
      {title.slice(0, index)}
      <strong>{title.slice(index, end)}</strong>
      {title.slice(end)}
    </>
  );
}
