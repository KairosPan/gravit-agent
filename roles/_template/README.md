# A role

One directory = one role = one `role_<id>` tool on Gravit's sessions (the face's
`face/plugins/role.mjs`), which runs a one-shot child on the role's own agent preset, `role-<id>` —
its persona and an exact tool allow-list as the preset's mask — and returns the child's report as
the tool result.

| File | Owner | What |
|---|---|---|
| `ROLE.md` | the operator | the child's persona; no `{{` (the prompt is a strict template); ≤ 2,000 bytes |
| `role.yml` | the operator | `name`, `description` (the summary Gravit reads, ≤ 300 chars), `allow` (exact tool names), optional `model` |

The face reads this directory at boot (`face/src/roles.ts`), renders Gravit's composition from it
and declares the role's preset after boot (a role none of whose tools exists refuses the boot); `bots/gravit/agent.cordis.yml` is the generated mirror (`npm run render:roles` in `face/`),
and a test fails when it drifts. Gravit proposes a role in conversation and never writes here.
A tool a role names must exist in the tree when the role is called, or that call fails naming
the tool. A role never carries `ask_user_question` (a child has no human to ask), delegation,
goals, `run_code`, the account and order tools under any server name, or the AKShare passthrough (`portfolio_akshare`). The
job tools (`job_output`, `job_list`, `job_kill`) belong only beside `bash`: a command past the
60 s default moves to a background job that is the child's own and is cancelled with it, so a
`bash` role carries them to read or stop it. Copy this directory, never link it: a symbolic
link under `roles/`, or a directory whose name is not an id, refuses the boot.
