# Verity — UX/UI Audit against the Source of Truth

Running gap analysis of the shipped UI against [ux-source-of-truth.md](ux-source-of-truth.md).
Each finding cites the law it derives from, the file, the gap, and the proposed
change. Status: `open` / `done` / `wontfix (rationale)`. Keep this current as the
UI evolves — it is the artifact we review changes against.

_Last audited: 2026-06-16 · scope: full invitee flow + admin surface · method:
code + token review (no live a11y tooling run in-container)._

_Update 2026-06-16: all P0, P1, and P2 items implemented (verified by typecheck +
120 tests + production build; live a11y verification still pending). P2-4 is
closed as wontfix (reversible by design)._
120 tests + production build; live a11y verification still pending). P1/P2 remain
open._

## How to read severity

- **P0** — accessibility blocker or a consequential/irreversible action without a
  safeguard. Fix before further UI work.
- **P1** — clear law violation that degrades usability or a11y for real users.
- **P2** — polish / robustness; correct but worth doing.

---

## P0 — blockers

### P0-1 · Pinch-zoom is disabled (`maximumScale: 1`) — `done`
- **Law:** Postel's Law (survive zoom / text resize); WCAG 1.4.4 Resize Text.
- **Where:** `src/app/layout.tsx` — `viewport.maximumScale = 1`.
- **Gap:** Locking maximum scale to 1 prevents users from pinch-zooming on mobile,
  which is a hard accessibility failure for low-vision users.
- **Fix:** Remove `maximumScale` (and any `userScalable: false`); allow zoom to at
  least 5x. One-line change, zero design impact.

### P0-2 · "Mark complete" is irreversible with no confirmation — `done`
- **Law:** Tesler / Peak-End / §5 Error Prevention (irreversible action MUST have
  confirmation, undo, or recovery); Fitts (opposing actions adjacent).
- **Where:** `src/app/admin/prds/[id]/round-actions.tsx`.
- **Gap:** "Mark complete" consumes the single-use invite and permanently stops the
  durable link from resolving — it cannot be undone — yet it is a single click,
  sitting `gap-4` (16px) next to the opposite-consequence "Open another round".
- **Fix:** Add a confirmation step that names the consequence ("This consumes the
  invite and closes the respondent's link permanently"), keep cancel visually
  distinct, and increase separation between the two actions. Native `confirm()` is
  acceptable interim; a small inline confirm or dialog is better.

### P0-3 · Form inputs have no programmatic labels — `done`
- **Law:** Postel / Fitts / §3 Text input (programmatic label required; label MUST
  activate/focus input); WCAG 1.3.1 / 4.1.2.
- **Where:**
  - `src/app/i/[token]/seed-form.tsx` — `<textarea>` has only a placeholder.
  - `src/app/admin/login/login-form.tsx` — password `<input>` has only a placeholder.
  - `src/app/admin/prds/new-invite.tsx` — `<label>`s exist but are **not** associated
    (`labelClass` styles a bare `<label>` with no `htmlFor`/`id`), so clicking the
    label does not focus the field.
- **Gap:** Placeholders are not accessible names; unassociated labels fail the
  label-activates-input rule and shrink the effective target.
- **Fix:** Add real `<label htmlFor>` + matching `id` (or `aria-label`/`aria-labelledby`)
  for every input; never rely on placeholder as the only label.

### P0-4 · No visible focus indicator that meets WCAG — `done`
- **Law:** §5 Focus appearance (≥2px outline, ≥3:1 contrast); Jakob (keyboard
  semantics preserved).
- **Where:** systemic — inputs use `outline-none` and replace it with only a 1px
  `focus:border-primary`; buttons/links define hover states but no `focus-visible`
  styling. No global focus token exists (`globals.css`, all interactive components).
- **Gap:** Keyboard users get an inconsistent or near-invisible focus cue.
- **Fix:** Add a single global `:focus-visible` ring (e.g. 2px `ring-primary` with
  offset) in `globals.css` / a shared class; stop suppressing outline without an
  equivalent replacement.

### P0-5 · Links communicate by color alone — `done`
- **Law:** Von Restorff / §5 Use of color (link identity MUST NOT rely on color
  alone; underline or non-color cue required).
- **Where:** `src/app/admin/prds/page.tsx` ("View", ".md"), `[id]/page.tsx`
  ("← Registry", "Download PRD", "Methodology", "Analysis"), `new-invite.tsx` URL.
- **Gap:** Blue text with only a hover brightness change is the sole link signal.
- **Fix:** Underline standalone/inline links (at least on hover+focus, ideally
  default for inline links), or add another non-color affordance.

---

## P1 — clear violations

### P1-1 · Reduced-motion is not respected — `done`
- **Law:** §5 Motion (interaction motion MUST respect `prefers-reduced-motion`).
- **Where:** `interview.tsx` (slide transitions, animated progress bar, cycling
  loading word), `seed-form.tsx` (entrance), `tailwind.config.ts` `pulse-dot`
  (infinite), admin pulsing status dot.
- **Fix:** Gate Framer Motion transitions and the infinite pulse behind a
  `prefers-reduced-motion: reduce` check (Framer `useReducedMotion()` + a CSS
  media query that disables `animate-pulse*`).

### P1-2 · Status & error messages are not announced — `done`
- **Law:** Doherty / §5 Status messages (programmatically determinable without
  focus movement); §5 Error identification.
- **Where:** error `<p>`s in `interview.tsx`, `seed-form.tsx`, `login-form.tsx`,
  `new-invite.tsx`, `round-actions.tsx`; the "Copied" confirmation; the loading word.
- **Gap:** Errors and success states are visual-only; screen readers aren't told.
- **Fix:** Wrap errors in `role="alert"` and transient status (Copied / loading) in
  an `aria-live="polite"` region; link field errors with `aria-describedby` +
  `aria-invalid`.

### P1-3 · Admin registry is unbounded (no pagination) and loads every turn — `done`
- **Law:** §4 Pagination (admin screens/data tables MUST paginate/filter/sort);
  Miller (scanning cost); also a real perf concern.
- **Where:** `src/app/admin/prds/page.tsx` — selects all sessions and `db.select()
  .from(turns)` (every turn row) into memory to count per session.
- **Fix:** Paginate the table (20–50/page per spec) and compute turn counts with a
  grouped SQL aggregate instead of loading all rows. Add sort/filter as the list grows.

### P1-4 · Yes/No opposing actions are close together — `done`
- **Law:** Fitts (opposing actions MUST NOT be close enough to mis-tap).
- **Where:** `interview.tsx` — Yes (blue) and No are `gap-4` (16px) on mobile where
  they stack vertically, `gap-6` on desktop.
- **Gap:** Low-stakes here (both are valid answers, not destructive), but a mis-tap
  still corrupts the measurement. The "done"/conclude action is well separated and
  subordinate — good.
- **Fix:** Increase vertical separation on mobile (≥24px) and keep the confirm
  visually dominant; consider Y/N keyboard shortcuts as an enhancement.

### P1-5 · PRD/methodology shown as raw `<pre>` markdown — `done`
- **Law:** Aesthetic-Usability / Miller (walls of text need hierarchy).
- **Where:** `[id]/page.tsx` — PRD, methodology, analysis, construct brief all in
  `<pre>` including raw `<!-- -->` comments and `---` rules.
- **Gap:** Operator reads unrendered markdown; the document is the product's payoff
  (peak-value moment) and currently looks like source.
- **Fix:** Render the markdown (a small renderer) for reading; keep the raw `.md`
  download for machine consumption.

### P1-6 · Muted text stacks opacity on already-muted ink — `done`
- **Law:** §5 Contrast (normal text ≥4.5:1).
- **Where:** footer "Status" label `opacity-60` on `on-surface-variant`
  (`chrome.tsx`); "Turns = …" `opacity-50` and empty-state `opacity-60`
  (`prds/page.tsx`); session id `opacity-60` (`[id]/page.tsx`).
- **Fix:** Verify each against 4.5:1 (large text 3:1) and prefer a dedicated muted
  token over opacity-on-muted so contrast is predictable.

---

## P2 — polish / robustness

- **P2-1 · Disabled controls give no reason — `done`.** Seed `Begin` now carries a
  `title` hint when empty; the interview surface sets `aria-busy` while a turn is in
  flight (and the loading line states what's happening). (Tesler)
- **P2-2 · Long model waits (>10s) lack progress/ETA — `done`.** `LoadingLine`
  escalates to a "still working…" message after ~10s. (Doherty / §5)
- **P2-3 · Table semantics — `done`.** `scope="col"` on every `<th>` plus an
  sr-only `<caption>` naming the view and page. (Jakob / §3)
- **P2-4 · Archive lacks confirm but is reversible — `wontfix`** (Restore exists);
  documented so it isn't "fixed" into needless friction. (§5 — reversible path
  already satisfies the rule.)
- **P2-5 · Stale metadata copy — `done`.** `layout.tsx` title is now `Verity` with a
  calm, accurate description.
- **P2-6 · Dark-mode toggle — `done`.** `ThemeToggle` (admin header + invitee footer)
  sets an explicit `[data-theme]` override and persists it; a no-flash script in
  `layout.tsx` applies the choice before paint. OS preference still applies absent a
  choice. (Aesthetic-Usability / control)

---

## Deeper pass (round 2, 2026-06-16) — subtle/edge findings

### D-1 · Thrown/rejected server action left the UI silent — `done`
- **Law:** Peak-End (no ambiguity after an action); §5 (optimistic UI MUST
  include retry + visible failure recovery).
- **Where:** `interview.tsx` `send()` and `seed-form.tsx` `begin()` only handled
  the structured `{ ok: false }` path; a transport/server *throw* set no error and
  left the optimistic step applied.
- **Fix:** `try/catch` around the action — roll back the optimistic step and show
  "That didn't go through — please try again." (buttons re-enable for retry).

### D-2 · New question not reliably announced to assistive tech — `done`
- **Law:** §5 Status messages (programmatically determinable); Doherty.
- **Where:** the question `<h2>` is keyed per turn inside `AnimatePresence`, so it
  remounts rather than updates — an `aria-live` on it announces unreliably.
- **Fix:** a persistent visually-hidden `role="status"`/`aria-live="polite"` region
  that always holds the current question; the animated heading is now visual-only.

### D-3 · Focus lost when the "Mark complete" confirm opens — `done`
- **Law:** §3 Modal/confirm focus management; Fitts.
- **Where:** `round-actions.tsx` — clicking "Mark complete…" removed the trigger
  and dropped focus to `<body>`.
- **Fix:** move focus to the safe **Cancel** action when the confirm appears; wrap
  the prompt in a labeled `role="group"`.

### D-4 · Dark-mode borders were invisible — `done`
- **Law:** §5 Non-text contrast (UI component boundaries ≥3:1); Aesthetic-Usability
  (clarity in dark mode).
- **Where:** `globals.css` dark `--md-hairline` (#2f2f2f) was *identical* to the
  card fill `--md-surface-container-lowest` (#2f2f2f), so 1px card/input borders did
  not render at all in dark mode.
- **Fix:** raised the dark hairline to #444 so borders read against both card
  (#2f2f2f) and input (#252525) fills. (Note: strict ≥3:1 against the near-black
  canvas would require a heavy border; inputs are additionally identified by label +
  placeholder + focus ring, so this is a legibility fix, not a claim of full ≥3:1 —
  see L-2.)

## Known limitations / accepted (documented, not bugs)

- **L-1 · Admin link tap targets are dense.** Inline 12.5px links ("View", ".md",
  "Sign out", pagination) sit below the 44–48px mobile target guidance. Accepted:
  the admin registry is a desktop operator tool; the *respondent* controls (the ones
  that matter) are all large. Revisit if admin goes mobile-first.
- **L-2 · Dark-mode 1px borders are legible but not strictly ≥3:1** against the
  near-black canvas (that would demand a heavy ~#6f6f6f border, against the calm
  aesthetic). Mitigated by label + placeholder + a high-contrast focus ring, which
  keeps controls identifiable. Revisit if a formal dark-mode a11y audit requires it.
- **L-3 · Keyboard shortcuts (Y/N/D) are global single-letter.** Mirrors visible
  controls with a visible hint; there is no text input on the interview screen, and
  modifier combos are ignored. Accepted enhancement; AT browse-mode quick-nav
  generally consumes these before the page sees them.

---

## What already conforms (keep)

- **Hick's Law:** the respondent ever sees exactly three choices (yes / no / done),
  with done visually subordinate — the core thesis is on-spec.
- **Progressive disclosure:** admin detail uses `<details>` for construct brief,
  round history, methodology — primary content first, depth on demand. (Miller/Hick)
- **Doherty:** optimistic card transitions + cycling word mask model latency; failed
  answers roll back the optimistic count (rollback present). (Doherty)
- **Von Restorff (status):** session statuses pair color with a text label and dot —
  not color-alone. (good)
- **Peak-End (ending):** the `/done` screen gives a clean, unambiguous completion
  confirmation. (could add no next action by design — anonymous)
- **Jakob (admin):** standard table + native form controls + `<button>`/`<a>`
  semantics throughout.

---

## Live verification checklist (the one open caveat)

Everything above is verified by typecheck + tests + build — **not** by a real
browser, assistive tech, or zoom test (no headless browser in-container). Run this
once live (`npm run dev` with a `DATABASE_URL` + `ANTHROPIC_API_KEY`) to close it,
then record results inline next to each finding.

- [ ] **Keyboard-only** walk of the invitee flow: Tab reaches seed → Begin →
  Yes/No/Done in a sensible order; **Y / N / D shortcuts** fire; every control shows
  the **focus ring** (and the ring does NOT square off the pill buttons — regression
  guard for the P0-4 border-radius gotcha).
- [ ] **Screen reader** (VoiceOver/NVDA): each new question is **announced** (the
  persistent `role=status` region, D-2); form errors announce (`role=alert`);
  inputs read their labels; the "Mark complete" confirm moves focus to Cancel (D-3).
- [ ] **Dark mode:** toggle in admin header + invitee footer flips the theme; reload
  shows **no light/dark flash** (no-flash script); **card/input borders are visible**
  in dark (D-4 regression guard); text contrast holds.
- [ ] **Zoom / resize:** pinch-zoom works on mobile; browser zoom to **200%** reflows
  without clipping or overlap (P0-1).
- [ ] **Rendered operator docs:** PRD / methodology / analysis read as formatted
  prose (headings, lists, bold), not raw markdown; `<!-- -->` headers are stripped
  (P1-5). Confirm the raw `.md` download is still byte-for-byte the source.
- [ ] **Reduced motion:** with the OS "reduce motion" setting on, the interview
  transitions/pulse/progress are stilled (P1-1).
- [ ] **Failure recovery:** kill the network mid-answer → a retry message appears and
  the optimistic step rolls back (D-1).
- [ ] **Admin pagination:** with >25 sessions, prev/next + counts work and the page
  loads without scanning the whole `turns` table (P1-3).
