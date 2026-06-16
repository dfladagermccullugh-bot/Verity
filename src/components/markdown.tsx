/**
 * Minimal, dependency-free markdown renderer for operator-facing documents
 * (PRD / methodology / analysis / construct brief). Server-safe, no hooks.
 *
 * Scope is deliberately small — the common subset the model emits: headings,
 * horizontal rules, unordered/ordered lists, blockquotes, fenced/inline code,
 * bold/italic, and paragraphs. HTML comments are stripped. Anything it does not
 * recognize falls through as plain text, so unusual syntax degrades to readable
 * prose rather than breaking. The raw `.md` download remains the source of truth
 * for machine consumption.
 */
import { Fragment, type ReactNode } from "react";

/** Inline spans: `code`, **bold**, *italic* / _italic_. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on the inline markers while keeping the delimiters.
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])_[^_]+_(?![A-Za-z0-9])|\*[^*]+\*)/g;
  const parts = text.split(pattern).filter((p) => p !== undefined && p !== "");
  parts.forEach((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.9em] text-on-surface"
        >
          {part.slice(1, -1)}
        </code>
      );
    } else if (part.startsWith("**") && part.endsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-on-surface">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (
      (part.startsWith("*") && part.endsWith("*") && part.length > 2) ||
      (part.startsWith("_") && part.endsWith("_") && part.length > 2)
    ) {
      out.push(
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    } else {
      out.push(<Fragment key={key}>{part}</Fragment>);
    }
  });
  return out;
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
  // Strip HTML comments (incl. multiline) before line parsing.
  const cleaned = content.replace(/<!--[\s\S]*?-->/g, "");
  const lines = cleaned.split("\n");

  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(
      <p key={`p-${k++}`} className="mt-4 leading-relaxed text-on-surface first:mt-0">
        {renderInline(para.join(" "), `p-${k}`)}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => (
      <li key={i} className="leading-relaxed">
        {renderInline(it, `li-${k}-${i}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`ol-${k++}`} className="mt-4 list-decimal space-y-1 pl-6 text-on-surface first:mt-0">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${k++}`} className="mt-4 list-disc space-y-1 pl-6 text-on-surface first:mt-0">
          {items}
        </ul>
      )
    );
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote
        key={`q-${k++}`}
        className="mt-4 border-l-2 border-hairline pl-4 text-on-surface-variant first:mt-0"
      >
        {renderInline(quote.join(" "), `q-${k}`)}
      </blockquote>
    );
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // Fenced code block.
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      if (fence) {
        blocks.push(
          <pre
            key={`pre-${k++}`}
            className="mt-4 overflow-x-auto rounded-md bg-surface-container p-4 font-mono text-label-sm text-on-surface first:mt-0"
          >
            {fence.join("\n")}
          </pre>
        );
        fence = null;
      } else {
        flushAll();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(raw);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      blocks.push(<hr key={`hr-${k++}`} className="mt-6 border-hairline first:mt-0" />);
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={`h-${k++}`} className={HEADING_CLASS[level]}>
          {renderInline(h[2], `h-${k}`)}
        </Tag>
      );
      continue;
    }

    // Ordered list item.
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      flushQuote();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }

    // Unordered list item.
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      flushQuote();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }

    // Blockquote.
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      flushList();
      quote.push(bq[1]);
      continue;
    }

    // Paragraph text.
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  if (fence) {
    blocks.push(
      <pre
        key={`pre-${k++}`}
        className="mt-4 overflow-x-auto rounded-md bg-surface-container p-4 font-mono text-label-sm text-on-surface first:mt-0"
      >
        {fence.join("\n")}
      </pre>
    );
  }

  return <div className={className}>{blocks}</div>;
}
