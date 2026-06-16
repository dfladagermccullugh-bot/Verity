import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline, type Block } from "@/lib/markdown";

// Narrow helper for asserting on a block by index.
function block(md: string, i: number): Block {
  return parseMarkdown(md)[i];
}

describe("parseInline", () => {
  it("returns a single text span for plain text", () => {
    expect(parseInline("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });

  it("parses bold, italic, and inline code", () => {
    expect(parseInline("**b** and *i* and `c`")).toEqual([
      { type: "bold", value: "b" },
      { type: "text", value: " and " },
      { type: "italic", value: "i" },
      { type: "text", value: " and " },
      { type: "code", value: "c" },
    ]);
  });

  it("parses underscore italics but not mid-word underscores", () => {
    expect(parseInline("_em_")).toEqual([{ type: "italic", value: "em" }]);
    expect(parseInline("file_name_here")).toEqual([
      { type: "text", value: "file_name_here" },
    ]);
  });

  it("does not treat ** as italic", () => {
    expect(parseInline("**strong**")).toEqual([
      { type: "bold", value: "strong" },
    ]);
  });
});

describe("parseMarkdown blocks", () => {
  it("parses headings at the right level", () => {
    expect(block("# Title", 0)).toEqual({
      type: "heading",
      level: 1,
      spans: [{ type: "text", value: "Title" }],
    });
    expect(block("### Deep", 0)).toMatchObject({ type: "heading", level: 3 });
  });

  it("strips HTML comments before parsing", () => {
    const blocks = parseMarkdown("<!-- meta -->\n# Real");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
  });

  it("treats --- as a horizontal rule, not a heading", () => {
    expect(block("---", 0)).toEqual({ type: "hr" });
  });

  it("groups consecutive bullets into one unordered list", () => {
    const b = block("- one\n- two\n- three", 0);
    expect(b.type).toBe("list");
    if (b.type === "list") {
      expect(b.ordered).toBe(false);
      expect(b.items).toHaveLength(3);
      expect(b.items[0]).toEqual([{ type: "text", value: "one" }]);
    }
  });

  it("separates ordered and unordered lists into distinct blocks", () => {
    const blocks = parseMarkdown("1. a\n2. b\n- c");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[1]).toMatchObject({ type: "list", ordered: false });
  });

  it("joins soft-wrapped lines into a single paragraph", () => {
    const b = block("line one\nline two", 0);
    expect(b).toEqual({
      type: "paragraph",
      spans: [{ type: "text", value: "line one line two" }],
    });
  });

  it("splits paragraphs on a blank line", () => {
    const blocks = parseMarkdown("para one\n\npara two");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((x) => x.type === "paragraph")).toBe(true);
  });

  it("captures fenced code verbatim", () => {
    const b = block("```\nconst x = 1;\n```", 0);
    expect(b).toEqual({ type: "code", text: "const x = 1;" });
  });

  it("does not parse markup inside a fenced code block", () => {
    const blocks = parseMarkdown("```\n# not a heading\n- not a list\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "code" });
  });

  it("parses a blockquote", () => {
    expect(block("> quoted", 0)).toEqual({
      type: "quote",
      spans: [{ type: "text", value: "quoted" }],
    });
  });

  it("handles a realistic PRD fragment end to end", () => {
    const md = [
      "<!-- Verity PRD -->",
      "# Product Requirements Document",
      "## Food Supply Service",
      "",
      "---",
      "",
      "### One-Line Pitch",
      "A phone-based **delivery** service for small establishments.",
      "",
      "### Open Questions",
      "- Cuisine focus?",
      "- Payment at door?",
    ].join("\n");
    const blocks = parseMarkdown(md);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      "heading",
      "heading",
      "hr",
      "heading",
      "paragraph",
      "heading",
      "list",
    ]);
    const para = blocks[4];
    if (para.type === "paragraph") {
      expect(para.spans).toContainEqual({ type: "bold", value: "delivery" });
    }
    const list = blocks[6];
    if (list.type === "list") {
      expect(list.items).toHaveLength(2);
    }
  });

  it("returns an empty list for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});
