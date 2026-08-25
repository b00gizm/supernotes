import { type ReactNode } from "react";

/** Tiny markdown subset for assistant replies. No HTML passthrough. */
export function AssistantMarkdown({ text }: { text: string }) {
  if (!text) {
    return null;
  }
  return <div className="assistant-md">{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.map((block, index) => {
    const key = `b${String(index)}`;
    const trimmed = block.trimEnd();
    if (/^#{1,3} /.test(trimmed)) {
      const hashes = trimmed.match(/^#{1,3}/)?.[0].length ?? 1;
      const body = trimmed.slice(hashes + 1);
      const Tag = hashes === 1 ? "h3" : hashes === 2 ? "h4" : "h5";
      return (
        <Tag key={key} className="assistant-md-heading">
          {renderInline(body)}
        </Tag>
      );
    }
    const lines = trimmed.split("\n");
    if (lines.every((line) => /^[-*] /.test(line))) {
      return (
        <ul key={key} className="assistant-md-list">
          {lines.map((line, lineIndex) => (
            <li key={`${key}-${String(lineIndex)}`}>
              {renderInline(line.slice(2))}
            </li>
          ))}
        </ul>
      );
    }
    if (lines.every((line) => /^\d+\. /.test(line))) {
      return (
        <ol key={key} className="assistant-md-list">
          {lines.map((line, lineIndex) => (
            <li key={`${key}-${String(lineIndex)}`}>
              {renderInline(line.replace(/^\d+\. /, ""))}
            </li>
          ))}
        </ol>
      );
    }
    return (
      <p key={key} className="assistant-md-p">
        {renderInline(trimmed)}
      </p>
    );
  });
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match = pattern.exec(text);
  let index = 0;
  while (match) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `i${String(index)}`;
    index += 1;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
    match = pattern.exec(text);
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}
