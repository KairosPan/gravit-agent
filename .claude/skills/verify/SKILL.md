---
name: verify
description: Use when a change in the gravit-agent repository is about to be committed, pushed or called done, or when asked to verify, test or check a change here, before saying it works.
---

# Verify a change in this repository

Verification here means running the change, and the diff decides what it owes. `checklist.md`
beside this file holds the checks: each has the paths that trigger it, what to do, and why it
exists. `match.mjs` reads it against your diff.

## 1. List what the diff owes

```bash
node .claude/skills/verify/match.mjs -- <path> ...  # these paths alone, from the repo root
node .claude/skills/verify/match.mjs                # working tree, index and untracked files against HEAD
node .claude/skills/verify/match.mjs --base main    # a branch: also everything committed since main
```

In the primary checkout, name your paths after `--`: other sessions' uncommitted edits and
untracked files sit there too, and the bare form reads them all. Stage your paths by name when
you commit. In a worktree of your own, the bare or `--base` form is the whole change. Run it again
whenever the change grows: a new file brings its own items.

## 2. Run what an agent can run, cheapest first

Generated files first (`npm run render:roles`, golden re-pins), then focused tests on the touched
modules, typechecks, the full suites, and `FACE_SMOKE=1` last. Run a long suite in the
background, on a Mac under `caffeinate -i` (a Mac on battery sleeps mid-run).

- A check that fails: fix and run it again, three rounds at most, then stop and report the
  failure, what you tried and its output.
- A failure called pre-existing is shown failing on HEAD too: in a `git archive HEAD` copy (with
  only your diff applied, where the checkout holds others' edits) or a worktree. A memory of it
  failing before is not that. `git stash` is never the way: the stash is shared with every
  worktree and session.
- A test that fails and then passes when run again alone goes under Flaky by name, not under
  Verified. Nothing is skipped, slept or retried to turn it green.
- A change that loosens a limit judging it goes under Decisions, with the options, and stays out
  of the commit until the operator decides. Loosening means raising a byte cap, a budget or a
  threshold, re-pinning a golden state it did not mean to redraw, or editing a test so it no
  longer checks what it checked. If the change cannot stand without it, both wait. A test moved to
  the behaviour the change sets out to make, and still asserting it exactly, is part of the change.

## 3. Name what only the operator can do

The drills in `face/README.md` ("The ... drill") are keyed or live, so they are the operator's.
Each one the diff triggers goes under Owed, by name. So does a screen you could not see.

## 4. Report in this shape

```
Verified:  <command> (<directory>) -> <result: pass count, or what you saw>
Failed:    <check> - <its output>; tried: <what>      (or: none)
Not run:   <check> - <why>
Owed:      <drill or operator step> - <why it is the operator's>
Decisions: <what the operator decides, and the options>
Flaky:     <test> - failed, then passed alone        (or: none)
Live:      <service> at its next restart, or 3090 at its next reload; whether it can stop that boot
Stamp:     verified: <checks>; owed: <items>
```

Every item `match.mjs` printed appears under Verified, Failed, Not run or Owed. The Stamp line is the
one a commit message can carry.

## Facts that save a search

- The installed face, account and market services run this checkout's sources
  (`face/scripts/service.ts`, `account/src/portfolio/account-service.ts`,
  `market/src/market-service.ts`). An edit, committed or not, reaches a service at its next
  restart, and an edit that breaks a boot (a cap exceeded, a profile file refused) breaks the
  service there.
- The face serves the primary checkout's `face/client/` from disk on every request
  (`face/src/static.ts`): a client edit there shows on 127.0.0.1:3090 after a hard reload. A
  worktree's client edit is not served there.
- A second face (AGENTS.md) runs with `FACE_DESK=0`, so it draws no desk: desk screens are seen
  on 3090.
- `npm run typecheck` in `face/` covers the TypeScript in `src`, `tests` and `scripts`, not
  `face/client/js`.
- Focused face tests: `npx --no -- tsx --test <files>` in `face/`. Without the `--`, npx takes
  `--test` for itself and tsx runs only the first file, as a plain script.
- Focused account or market tests: `npx --no -- vitest run <files>` in that package.
- The account and market suites run their files one at a time on the same fixed ports
  (4701–4705, 4800; both `vitest.config.ts`): one of those suites at a time, never both together
  and never two agents at once. `lsof -nP -iTCP:4701-4705 -iTCP:4800 -sTCP:LISTEN` prints
  nothing while the ports are free.
- The keyless sources (Nasdaq, Cboe, SEC, Tencent, Binance, Hyperliquid) see the machine's one
  address, which the running market shares: fetch once, save, work from the file.
