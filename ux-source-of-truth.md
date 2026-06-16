# UX/UI Source of Truth & Implementation Guidelines

> **Status: canonical.** This document governs interaction design, accessibility,
> and UX behavior for Verity. It is the companion to [design.md](design.md): where
> `design.md` defines the *visual* language (the Warm Paper Calm token set —
> color, type, radius, elevation), this document defines how the interface must
> *behave* — cognitive load, target sizes, accessibility, feedback, and ethics.
> When the two ever conflict, accessibility rules here win. New or changed UI is
> reviewed against this file; the running gap analysis lives in [ux-audit.md](ux-audit.md).

## 1. Core Directives

- Design MUST match established user mental models before introducing custom interaction patterns; novelty MUST be justified by user value and validated with users.
- Interfaces MUST reduce cognitive, physical, and memory load by chunking content, limiting immediate choices, enlarging targets, and shifting necessary complexity into the system.
- Every interaction MUST preserve user control, accessibility, resilience, and ethical intent; the product MUST NOT exploit attention, confusion, defaults, or friction removal for outcomes against user interests.

## 2. The Laws of UX (Technical Extraction)

### Jakob's Law

* **Cognitive Principle:** Users transfer expectations from familiar products into new interfaces and move faster when new systems match those expectations.
* **Technical Implementation Rule:** Use platform-standard components, layout conventions, navigation placement, search behavior, form controls, and checkout/account patterns before creating custom UI.
* **Web Constraint:** Desktop web MUST use recognizable header navigation, visible search where search is a core task, conventional form controls, keyboard-accessible menus, browser-native semantics, and responsive layouts that preserve familiar patterns at each breakpoint.
* **Mobile Constraint:** Mobile MUST use native-feeling navigation patterns, clear app bars, bottom navigation only for primary destinations, standard gestures only where discoverable, and touch-first controls without hover dependency.
* **Violations to Avoid:** MUST NOT redesign common workflows in ways that break learned expectations. MUST NOT replace standard controls with custom controls unless semantics, keyboard behavior, screen reader behavior, and touch behavior are fully preserved.

### Fitts's Law

* **Cognitive Principle:** Target acquisition time increases as the target gets smaller or farther from the user's pointer, finger, gaze, or current focus.
* **Technical Implementation Rule:** Interactive targets MUST be large, close to the related task context, and spaced to prevent accidental activation.
* **Web Constraint:** Pointer targets MUST meet WCAG 2.2 AA minimum `24x24 CSS px` or the spacing exception, and primary or frequent controls SHOULD meet `44x44 CSS px` enhanced sizing; icon-only buttons MUST include padding that creates the full hit area. Source: [WCAG target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [WCAG target size enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).
* **Mobile Constraint:** Touch targets MUST be at least `48x48 dp/CSS px` with `>=8dp/px` spacing; Apple-style native targets MUST NOT go below `44x44 pt`; destructive and high-frequency actions SHOULD exceed the minimum. Source: [Android touch target size](https://support.google.com/accessibility/android/answer/7101858?hl=en).
* **Violations to Avoid:** MUST NOT place opposing actions, such as confirm/delete or accept/deny, close enough to cause accidental activation. MUST NOT make labels visually separate from inputs without making the label activate or focus the input.

### Miller's Law

* **Cognitive Principle:** Working memory is limited, and users process information better when related items are grouped into meaningful chunks.
* **Technical Implementation Rule:** Content MUST be chunked into visibly distinct groups using hierarchy, spacing, headings, dividers, and progressive disclosure.
* **Web Constraint:** Dense desktop pages MUST use section headings, scannable groups, readable line lengths, and grouped toolbar/menu actions; visible navigation MUST be grouped by meaning rather than capped by an arbitrary "7 items" rule.
* **Mobile Constraint:** Mobile screens MUST show one primary content group or task step per viewport where possible; long content MUST use headings, accordions, tabs, or steps to reduce scanning cost.
* **Violations to Avoid:** MUST NOT present walls of text without hierarchy. MUST NOT justify navigation limits with "7 +/- 2"; visible menus do not require memorization.

### Hick's Law

* **Cognitive Principle:** Decision time increases as the number and complexity of available choices increases.
* **Technical Implementation Rule:** Show only the choices needed for the user's current step; defer secondary, advanced, or rare actions through progressive disclosure.
* **Web Constraint:** Immediate decision points SHOULD expose no more than `3` primary choices; explanations that support a choice SHOULD stay at or below `80 characters`; complex desktop menus MUST be grouped with headings and labels.
* **Mobile Constraint:** Mobile task flows MUST prioritize one primary action per screen, use step-based flows for complex tasks, and avoid menus that require scanning more than one screen without grouping or search.
* **Violations to Avoid:** MUST NOT show all possible actions by default. MUST NOT simplify to icon-only abstraction when labels or context are required for recognition.

### Postel's Law

* **Cognitive Principle:** Human input is variable and error-prone, so systems feel usable when they accept flexible input and return reliable output.
* **Technical Implementation Rule:** Accept varied user input formats, normalize them internally, validate with clear boundaries, and provide reliable accessible output across devices, input methods, languages, and connection quality.
* **Web Constraint:** Web UI MUST use responsive design, progressive enhancement, semantic HTML, resilient validation, keyboard access, and layouts that survive zoom, text resizing, translation expansion, and slow networks.
* **Mobile Constraint:** Mobile UI MUST accept touch, keyboard, paste, autofill, voice input where supported, biometric/platform authentication where appropriate, and dynamic text size without clipping or overlap.
* **Violations to Avoid:** MUST NOT reject valid human names, addresses, phone numbers, or localized formats because of rigid Western-centric validation. MUST NOT request data already known or unnecessary for the task.

### Peak-End Rule

* **Cognitive Principle:** Users judge an experience disproportionately by its most intense moment and its ending.
* **Technical Implementation Rule:** Identify peak-risk moments, peak-value moments, and final states in every critical journey; design each with clear feedback, prevention, recovery, and completion quality.
* **Web Constraint:** Web flows MUST provide polished endings for checkout, onboarding, upload, save, delete, invite, and error recovery; completion states MUST confirm what happened and provide the next useful action.
* **Mobile Constraint:** Mobile flows MUST protect interruption-prone moments with save/resume, clear progress, recoverable actions, and concise confirmation states that fit small screens.
* **Violations to Avoid:** MUST NOT end a flow with ambiguity after a submit/save/payment action. MUST NOT let validation, waiting, or 404/error states become the strongest remembered moment without recovery guidance.

### Aesthetic-Usability Effect

* **Cognitive Principle:** Users perceive visually polished interfaces as more usable and more trustworthy, even when usability defects remain.
* **Technical Implementation Rule:** Visual design MUST support function through clear hierarchy, spacing, typography, alignment, contrast, and consistency; usability validation MUST rely on observed behavior, not subjective visual preference.
* **Web Constraint:** Desktop web MUST maintain consistent design tokens, spacing scale, readable density, and layout rhythm across responsive breakpoints; aesthetic polish MUST NOT replace keyboard, screen reader, or performance quality.
* **Mobile Constraint:** Mobile UI MUST preserve clarity under compact density, dynamic type, dark mode, orientation changes, and touch use; decorative motion and visual flourish MUST remain secondary to task completion.
* **Violations to Avoid:** MUST NOT treat visual attractiveness as proof of usability. MUST NOT allow decoration, animation, or brand expression to reduce readability, discoverability, or accessibility.

### Von Restorff Effect

* **Cognitive Principle:** Among similar items, the visually distinct item receives attention and is more likely to be remembered.
* **Technical Implementation Rule:** Use contrast intentionally to emphasize one primary action, warning, selection, notification, or featured item within a local context.
* **Web Constraint:** Web emphasis MUST use more than color when communicating meaning; contrast MUST pair color with at least one additional cue such as scale, shape, spacing, position, iconography, border, label, or reduced-motion-safe motion.
* **Mobile Constraint:** Mobile emphasis MUST remain legible at small sizes, work in dark mode and high contrast settings, respect reduced motion, and avoid visual competition between multiple highlighted elements.
* **Violations to Avoid:** MUST NOT highlight many competing elements in the same region. MUST NOT rely on color alone to communicate action, selection, status, severity, or error.

### Tesler's Law

* **Cognitive Principle:** Every system has irreducible complexity that must be handled by either the system or the user.
* **Technical Implementation Rule:** The product team MUST absorb avoidable complexity through defaults, autofill, suggestions, progressive disclosure, sensible automation, and reusable design-system components.
* **Web Constraint:** Web flows MUST prefill known data, preserve user input, support undo/retry, offer defaults with transparent meaning, and expose advanced controls only after primary controls are understood.
* **Mobile Constraint:** Mobile flows MUST reduce typing through platform autofill, pickers, saved preferences, payment/auth integrations, and contextual suggestions while preserving review and correction.
* **Violations to Avoid:** MUST NOT ship internal complexity to users because implementation is easier. MUST NOT hide necessary complexity so aggressively that users lose context, control, or the ability to correct outcomes.

### Doherty Threshold

* **Cognitive Principle:** Users stay productive when the interface responds fast enough that neither the user nor the system waits on the other.
* **Technical Implementation Rule:** System feedback MUST appear within `400ms`; longer work MUST use perceived-performance patterns such as optimistic UI, skeleton screens, reserved layout space, progress bars, or status text.
* **Web Constraint:** Web interactions MUST show pressed/loading/success/error states promptly, reserve media dimensions to prevent layout shift, use skeletons for loading content, and include progress plus task description and ETA when waits exceed `10s`.
* **Mobile Constraint:** Mobile interactions MUST provide immediate touch feedback, avoid blocking the main thread, preserve responsiveness during background work, and use platform-native progress indicators or inline skeletons.
* **Violations to Avoid:** MUST NOT leave users uncertain whether an action registered. MUST NOT use instant completion for trust-sensitive tasks when a brief confirmation, review, or explanation is needed to prevent mistakes.

## 3. Global Component Heuristics

| Component Type | Minimum Size/Constraint | State Management (Hover/Focus/Active) | Accessibility Requirement |
| --- | --- | --- | --- |
| Primary button | Web: `>=44x44 CSS px` preferred, `>=24x24 CSS px` absolute WCAG AA floor. Mobile: `>=48x48 dp/px`. | Web MUST include hover, focus, active, disabled, loading, success, and error states. Mobile MUST include pressed, disabled, loading, success, and error states. | Text contrast `>=4.5:1`; non-text boundary/state contrast `>=3:1`; visible focus indicator required. |
| Icon button | Visual icon SHOULD be `20-24px`; hit area MUST meet full target size. | Web MUST provide hover/focus tooltip or accessible name. Mobile MUST NOT depend on hover; label or accessible name required. | MUST include `aria-label` or visible text; icon meaning MUST be conventional or labeled. |
| Text link | Inline links follow text line-height exception; standalone links MUST meet target sizing. | Web MUST use underline or non-color cue on default/hover/focus. Mobile MUST provide adequate line height and tap spacing. | Link identity MUST NOT rely on color alone; link text contrast `>=4.5:1`. |
| Text input / textarea | Height SHOULD be `>=44px` web and `>=48px` mobile; label MUST activate/focus input. | MUST include default, focus, filled, disabled, read-only, error, success, and loading/autocomplete states. | Programmatic label required; error text required; border or background cue contrast `>=3:1`. |
| Select / combobox | Closed control MUST meet target sizing; option rows SHOULD be `>=44px` web and `>=48px` mobile. | Web MUST support keyboard open, search/typeahead where lists are long, focus, hover, active, selected. Mobile SHOULD use native picker where appropriate. | Role, name, expanded state, active option, and selected value MUST be exposed to assistive tech. |
| Checkbox / radio / switch | Control plus label MUST create a target `>=44x44px` web and `>=48x48` mobile. | MUST include focus, checked/unchecked, indeterminate where applicable, disabled, and error states. | State MUST be programmatically exposed; color-only checked/error indication is forbidden. |
| Tabs / primary navigation | Desktop top-level nav SHOULD fit one row and SHOULD NOT exceed `7` top-level groups. Mobile bottom nav MUST contain `3-5` primary destinations. | Web tabs MUST support keyboard arrow navigation and focus. Mobile tabs MUST show selected/pressed states without hover. | Current page/tab MUST be programmatically indicated; icon-only nav requires labels or accessible names. |
| Menu / overflow action | Immediate decision menus SHOULD expose `<=7` visible items before grouping; decision-critical choices SHOULD expose `<=3`. | Web MUST support hover only as enhancement, click/tap open, keyboard navigation, escape close, and focus return. Mobile MUST use tap-first sheets, menus, or dialogs. | Menu role/structure MUST be semantic; destructive items MUST be visually and textually distinct. |
| Modal / dialog | Dialog width MUST fit viewport; controls MUST meet target sizes; destructive confirmation MUST require explicit action. | MUST trap focus, support escape/cancel, restore focus on close, and distinguish primary/secondary/destructive actions. | `role="dialog"` or native dialog semantics required; accessible name and description required. |
| Toast / status message | MUST be concise; persistent actions MUST NOT live only in auto-dismissing toasts. | Web and mobile MUST show success/error/waiting states without stealing focus unless user action is required. | Status changes MUST be programmatically announced without unnecessary focus movement. |
| Progress / loading | Feedback MUST appear within `400ms`; waits over `10s` MUST include progress, task label, and ETA or remaining-step messaging. | Skeletons MUST reserve layout space; optimistic UI MUST include rollback/error recovery. | Loading/progress state MUST be exposed via ARIA or native platform accessibility APIs. |
| Card / list item | If clickable, full card target SHOULD meet full target sizing and contain one primary action. | Web card hover MUST be supplemental; focus and active states required. Mobile MUST provide pressed state. | Clickable cards MUST have accessible names and must not hide nested controls from keyboard users. |
| Pagination / load more | Page controls MUST meet target size; page size SHOULD be `20-50` items on desktop and `10-25` on mobile. | Web MUST support keyboard and focus restoration. Mobile MUST preserve scroll position and loading state. | Current page and result counts MUST be announced or visible in text. |
| Destructive action | MUST require confirmation, undo, or recovery when data loss, payment, legal, privacy, or irreversible consequences exist. | Destructive state MUST be visually distinct and textually explicit; confirm and cancel MUST be separated. | Error-prevention path MUST allow review, correction, cancellation, or reversal. |

## 4. Cognitive Load & Navigation Limits

- **Choice Limits**
  - Immediate decision points SHOULD present `<=3` primary choices.
  - Secondary actions MUST be visually subordinate to the primary action.
  - Interfaces MUST remove choices that do not support the user's current goal.
  - Explanatory helper text SHOULD be `<=80 characters` when used to clarify a choice.

- **Navigation Limits**
  - Primary desktop navigation SHOULD expose `<=7` top-level groups.
  - Mobile bottom navigation MUST expose `3-5` primary destinations.
  - Navigation with more than `7` destinations MUST use grouping, hierarchy, search, or progressive disclosure.
  - Icon navigation MUST include visible labels for critical or non-universal icons.
  - Miller's Law MUST NOT be used as the rationale for a fixed menu count; the rationale MUST be decision complexity, discoverability, and scanability.

- **Progressive Disclosure**
  - Default screens MUST show primary content and primary actions only.
  - Advanced, rare, dangerous, or configuration-heavy actions MUST be placed behind menus, accordions, drawers, steppers, or secondary screens.
  - Hidden content MUST remain discoverable through clear labels, affordances, and keyboard/touch access.

- **Pagination vs. Infinite Scroll**
  - Goal-directed lists, search results, data tables, admin screens, settings, transactions, and reference content MUST use pagination, filtering, sorting, or "Load more" instead of unbounded infinite scroll.
  - Infinite scroll MUST be limited to open-ended discovery feeds where passive browsing is the user goal.
  - Infinite scroll MUST preserve scroll position, expose loading/status messages, support deep linking or restoration, and provide an accessible path to footer or terminal content.
  - Autoplay and infinite-feed loops MUST NOT be used to maximize time-on-site against user intent.

- **Form Chunking**
  - Forms MUST request only data required for the current task.
  - Forms with more than `10` fields MUST be chunked into logical sections or steps.
  - Each form step SHOULD contain `<=5` fields unless the fields are tightly related and scannable.
  - Required fields, format requirements, and constraints MUST be visible before submission.
  - Validation MUST accept flexible human input where meaning is clear, normalize internally, and reject only when required for correctness, security, or legal constraints.

## 5. Accessibility (A11y) & Error Handling

- **Contrast and Visual Cues**
  - Normal text MUST meet contrast `>=4.5:1`; large text MUST meet `>=3:1`. Source: [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
  - UI component boundaries, icons, state indicators, focus indicators, and meaningful graphics MUST meet non-text contrast `>=3:1`. Source: [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
  - Color MUST NOT be the only cue for links, errors, required fields, selections, status, severity, or success. Source: [WCAG use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
  - Focus indicators SHOULD use at least a `2px` visible outline or equivalent area and MUST maintain `>=3:1` contrast against adjacent colors. Source: [WCAG focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).

- **Motion and Flashing**
  - Motion triggered by interaction MUST respect reduced-motion preferences and MUST be disableable unless essential. Source: [WCAG animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
  - Auto-moving, blinking, scrolling, or auto-updating content that starts automatically and lasts more than `5s` MUST provide pause, stop, hide, or update-frequency controls. Source: [WCAG pause, stop, hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
  - Content MUST NOT flash more than `3` times in any `1s` period unless it is below WCAG flash thresholds. Source: [WCAG three flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).

- **Error Prevention**
  - Forms MUST prevent errors before submission through labels, instructions, constraints, examples, input masks where safe, and real-time validation for high-friction fields such as passwords.
  - Legal, financial, privacy, destructive, or data-loss actions MUST provide at least one safeguard: reversible action, validation with correction opportunity, or review/confirmation before final submission. Source: [WCAG error prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html).
  - Destructive confirmations MUST clearly name the object, consequence, and action; cancel/keep-safe action MUST be available and visually distinct.

- **Error Identification and Recovery**
  - Automatically detected errors MUST identify the field in error and describe the error in text. Source: [WCAG error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html).
  - When a correction is known, the UI MUST provide a correction suggestion unless doing so compromises security or purpose. Source: [WCAG error suggestion](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html).
  - Error messages MUST be polite, specific, and actionable; they MUST NOT blame the user or state that a person's name, identity, address, or valid localized format is "wrong."
  - Errors MUST be linked programmatically to fields using platform semantics such as `aria-describedby`, `aria-invalid`, native validation APIs, or equivalent native-mobile accessibility APIs.

- **Feedback Loops**
  - Every user action MUST produce perceivable feedback within `400ms`.
  - Status messages for success, failure, waiting, progress, and results MUST be visible and programmatically determinable without unnecessary focus movement. Source: [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
  - Optimistic UI MUST include rollback, retry, and visible failure recovery.
  - Waits over `10s` MUST provide progress, a task description, and an ETA or remaining-step indicator.

- **Ethical Constraints**
  - Defaults MUST align with user benefit, privacy, and informed consent.
  - Infinite loops, autoplay, variable rewards, forced action, hidden opt-outs, confusing defaults, and manipulative friction removal MUST NOT be used to increase engagement, consent, data sharing, or purchases against user intent.
  - Friction MUST be added for safety-critical, privacy-critical, destructive, financial, legal, or irreversible actions.
