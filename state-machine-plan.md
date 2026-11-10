# Verity — state machines: remaining items

The inventory, findings and all five implementation phases are done (PR #48,
2026-11-10) — full record in [history.md](history.md#2026-11-10--state-machines-inventory-fixes-migration-0006-pr-48).
Only work that needs credentials or a deliberate decision is left.

## Remaining manual steps (need credentials)

1. **Check the 0006 migration in the production build log.** Search the Vercel
   build output of the first deploy after PR #48 for `0006:` warnings. A warning
   means an index was skipped (duplicates remained or the table was busy); the
   app's locked claims still enforce the invariant. To retry, add a `0007` that
   repeats the guarded block for that index after cleaning the duplicates.
2. **Re-baseline the canary.** `ANTHROPIC_API_KEY=… ANTHROPIC_MODEL=<prod model>
   npm run canary:rebaseline`, review the per-seed table, commit with the
   baseline conditions in the message. The policy changed (corrective retries,
   tolerant stop, boundary jargon, validated PRD fallback, mirror tagging), so
   any earlier numbers are void.
3. **Live QA against a real database and model** (handoff to-do #1), including
   the stalled → Resume / Close path and a follow-up round.

## Deferred (not started, by decision)

- CHECK constraints on status / reason / answer columns (`0007`, `NOT VALID`
  first, then `VALIDATE` once production data is confirmed clean).
- Rate-limiter changes (in-memory, per instance — acceptable for invite-only).
