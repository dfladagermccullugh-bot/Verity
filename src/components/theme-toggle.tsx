"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem("theme");
  return v === "light" || v === "dark" ? v : "system";
}

function effectiveScheme(mode: Mode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyMode(mode: Mode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
    window.localStorage.removeItem("theme");
  } else {
    root.setAttribute("data-theme", mode);
    window.localStorage.setItem("theme", mode);
  }
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(readStoredMode());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setMode("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const scheme = mounted ? effectiveScheme(mode) : "light";
  const next: Mode = scheme === "dark" ? "light" : "dark";

  function toggle() {
    applyMode(next);
    setMode(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="fixed right-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant ring-1 ring-outline-variant transition hover:bg-surface-container-high active:scale-95"
    >
      {scheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}
