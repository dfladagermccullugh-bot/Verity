/**
 * Renders the markdown block AST from `@/lib/markdown` to JSX. Server-safe, no
 * hooks. Parsing rules (and their tests) live in the lib; this file is only the
 * visual mapping. The raw `.md` download remains the source of truth for
 * machine consumption.
 */
import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Span } from "@/lib/markdown";

function renderSpans(spans: Span[], keyPrefix: string): ReactNode[] {
  return spans.map((s, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (s.type) {
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.9em] text-on-surface"
          >
            {s.value}
          </code>
        );
      case "bold":
        return (
          <strong key={key} className="font-semibold text-on-surface">
            {s.value}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic">
            {s.value}
          </em>
        );
      default:
        return <Fragment key={key}>{s.value}</Fragment>;
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-8 text-headline-md font-bold text-on-surface first:mt-0",
  2: "mt-7 text-body-lg font-bold text-on-surface first:mt-0",
  3: "mt-6 text-body-md font-bold text-on-surface first:mt-0",
  4: "mt-5 text-body-md font-semibold text-on-surface first:mt-0",
  5: "mt-4 text-body-md font-semibold text-on-surface-variant first:mt-0",
  6: "mt-4 text-label-sm font-semibold text-on-surface-variant first:mt-0",
};

export default function Markdown({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseMarkdown(content);

  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const key = `b-${i}`;
        switch (b.type) {
          case "heading": {
            const Tag = `h${b.level}` as keyof JSX.IntrinsicElements;
            return (
              <Tag key={key} className={HEADING_CLASS[b.level]}>
                {renderSpans(b.spans, key)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p
                key={key}
                className="mt-4 leading-relaxed text-on-surface first:mt-0"
              >
                {renderSpans(b.spans, key)}
              </p>
            );
          case "list":
            return b.ordered ? (
              <ol
                key={key}
                className="mt-4 list-decimal space-y-1 pl-6 text-on-surface first:mt-0"
              >
                {b.items.map((item, j) => (
                  <li key={j} className="leading-relaxed">
                    {renderSpans(item, `${key}-${j}`)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul
                key={key}
                className="mt-4 list-disc space-y-1 pl-6 text-on-surface first:mt-0"
              >
                {b.items.map((item, j) => (
                  <li key={j} className="leading-relaxed">
                    {renderSpans(item, `${key}-${j}`)}
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="mt-4 border-l-2 border-hairline pl-4 text-on-surface-variant first:mt-0"
              >
                {renderSpans(b.spans, key)}
              </blockquote>
            );
          case "hr":
            return <hr key={key} className="mt-6 border-hairline first:mt-0" />;
          case "code":
            return (
              <pre
                key={key}
                className="mt-4 overflow-x-auto rounded-md bg-surface-container p-4 font-mono text-label-sm text-on-surface first:mt-0"
              >
                {b.text}
              </pre>
            );
        }
      })}
    </div>
  );
}
