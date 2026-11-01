# AGENTS.md — for coding agents

This file is read by coding agents working on this repository (Claude Code and Codex read it).
The research agent, Gravit, does not: dsh hands it `GRAVIT.md` and nothing else.

- Read `CLAUDE.md` first — the map, the commands, the gotchas. Depth: `DEVELOPMENT.md`
  (mechanism), `Gravit-Design.md` (intent), `face/README.md` (the face's contracts and drills).
- `GRAVIT.md` is a product file: every dsh agent in the tree reads it on its first request.
  Change it as you would change a prompt — deliberately, inside its byte budget, with
  `face/tests/gravit-md.test.ts` green.
- `strategies/` is Gravit's arena. `bots/`, `roles/` and `docs/research/` are the operator's:
  do not edit them unless asked.
- Keep the suite green: `npm test && npm run typecheck` in `face/` (the repo has no Python
  suite), plus `FACE_SMOKE=1 npm test` after any change under `face/src`, `face/plugins` or to
  the dsh pins; after a change under `account/`, its own `npm test && npm run typecheck` there
  (one known red, `test/unit/ui-superagent.test.ts`) and the face's `FACE_SMOKE=1` run.
- Commit messages go in a file and through `git commit -F`; never backticks or `$()` in `-m`.
