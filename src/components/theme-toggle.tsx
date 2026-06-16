"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * User-facing light/dark switch. The token sets live in globals.css; this only
 * sets an explicit `[data-theme]` override on <html> and persists the choice
 * (a no-flash script in layout.tsx applies it before paint on the next load).
 * Absent a choice, OS preference still applies. Renders nothing until mounted
 * so server and first client paint match.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    const explicit = el.getAttribute("data-theme") as Theme | null;
    const current =
      explicit ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* storage unavailable — in-session toggle still works */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
      }
      className={`pointer-events-auto text-label-sm text-on-surface-variant underline-offset-2 transition-colors hover:text-on-surface hover:underline focus-visible:underline ${className}`}
    >
      {theme === null ? "" : theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
