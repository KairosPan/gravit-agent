# AGENTS.md — for coding agents

This file is read by coding agents working on this repository: Codex reads it, and Claude Code
through the `@AGENTS.md` import at the top of `CLAUDE.md`. The research agent, gravit, does not:
dsh hands it `GRAVIT.md` and nothing else.

- `CLAUDE.md` holds the map, the commands and the gotchas (Codex: read it first).
- `Gravit-Design.md`, `DEVELOPMENT.md`, `ROADMAP.md`, `Gravit-Docs-and-Prompt-Loops.html` and
  `docs/superpowers/` are the operator's private documents: gitignored, present only in the
  primary checkout (`git worktree list`'s first line), never in a worktree or a clone. Read and
  edit them there; never `git add -f` them. Commits before 2026-11-09 still hold them. In
  `docs/superpowers/`, the documents dated 2026-06 or 2026-07 and `runbooks/p-b-p-c-activation.md`
  describe the previous product.
- `GRAVIT.md` is a product file: every dsh agent in the tree reads it on its first request.
  Change it as you would change a prompt — deliberately, inside its byte budget, with
  `face/tests/gravit-md.test.ts` green.
- `strategies/` is gravit's arena. `bots/`, `roles/` and `docs/research/` are the operator's:
  do not edit them unless asked.
- Keep the suite green: `npm test && npm run typecheck` in `face/` (the repo has no Python
  suite), plus `FACE_SMOKE=1 npm test` after any change under `face/src`, `face/plugins` or to
  the dsh pins; after a change under `account/`, its own `npm test && npm run typecheck` there
  and the face's `FACE_SMOKE=1` run; after a change under `market/`, its own suite, `account/`'s
  (whose tests import `market/src`) and the face's with `FACE_SMOKE=1` (whose stand-in Account
  runs it). Before a commit, `node .claude/skills/verify/match.mjs` lists the checks and drills a
  diff owes (Claude Code's `verify` skill).
- A face test never opens a real memory: a test that boots or composes a face imports
  `./helpers/no-memory.ts` right after `./helpers/no-market.ts`; in a test process a memory home
  outside the temporary directory is refused, and `face/tests/memory-row.test.ts` checks the import.
- A face you start runs beside the operator's service, never on its home or port: a scratch
  `DSH_HOME` (after `npm run setup` with it), another `FACE_PORT`, `FACE_DESK=0`,
  `FACE_MEMORY_HOME=<scratch>/memory`, `FACE_MEMORY_RECONCILE=0` and
  `FACE_ACCOUNT_URL=http://127.0.0.1:9`, a dead Account URL, so it never pairs with the real one.
- Commit messages go in a file and through `git commit -F`; never backticks or `$()` in `-m`.
