/**
 * Pure markdown parser for operator-facing documents (PRD / methodology /
 * analysis / construct brief). No React, no DOM — it turns a markdown string
 * into a small block AST so the renderer stays a thin mapping and the parsing
 * rules are unit-testable.
 *
 * Scope is the common subset the model emits: headings, horizontal rules,
 * unordered/ordered lists, blockquotes, fenced code, and inline code / bold /
 * italic. HTML comments are stripped. Anything unrecognized degrades to plain
 * paragraph text rather than breaking.
 */

export type Span =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string };

export type Block =
  | { type: "heading"; level: number; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | { type: "quote"; spans: Span[] }
  | { type: "hr" }
  | { type: "code"; text: string };

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])_[^_]+_(?![A-Za-z0-9])|\*[^*]+\*)/g;

/** Split a line into inline spans: `code`, **bold**, *italic* / _italic_. */
export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  const parts = text.split(INLINE).filter((p) => p !== undefined && p !== "");
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      out.push({ type: "code", value: part.slice(1, -1) });
    } else if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      out.push({ type: "bold", value: part.slice(2, -2) });
    } else if (
      part.length > 2 &&
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_")))
    ) {
      out.push({ type: "italic", value: part.slice(1, -1) });
    } else {
      out.push({ type: "text", value: part });
    }
  }
  return out;
}

/** Parse a markdown string into a block list. */
export function parseMarkdown(src: string): Block[] {
  // Strip HTML comments (incl. multiline) before line parsing.
  const cleaned = src.replace(/<!--[\s\S]*?-->/g, "");
  const lines = cleaned.split("\n");

  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push({ type: "paragraph", spans: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({
      type: "list",
      ordered: list.ordered,
      items: list.items.map((it) => parseInline(it)),
    });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push({ type: "quote", spans: parseInline(quote.join(" ")) });
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
    if (/^```/.test(line)) {
      if (fence) {
        blocks.push({ type: "code", text: fence.join("\n") });
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
      blocks.push({ type: "hr" });
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      blocks.push({
        type: "heading",
        level: h[1].length,
        spans: parseInline(h[2]),
      });
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
  if (fence) blocks.push({ type: "code", text: fence.join("\n") });
  return blocks;
}
