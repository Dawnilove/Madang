---
name: orchestration
description: >-
  Coordinate supervised Madang workers: threaded messages, blocking ask/reply,
  task dispatch, worker_done/escalation waits, task DAGs, decision gates,
  coordinator loops, and decomposing work across agents. Use `madang-cli` for full
  ownership handoffs — "hand off", "handoff", "handover", "give this to another
  agent", "another worktree" — unless asked to supervise, monitor, or coordinate
  a DAG, and for terminal control, lightweight terminal prompts, shell commands,
  Madang worktree management, and reading or waiting on terminals. Also use it
  when the user, in any language, makes you the lead for several agents:
  "총괄", "감독", "역할 분담", "에이전트를 여러 개 열어 나눠서", "결과를 종합해서
  보고". The lead opens one worker per role with `worker-start`, waits for every
  `worker_done`, and reports one combined result.
---

# Madang Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Madang
orchestration reference is served by the `madang` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Madang orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the madang-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real Madang runtime
state; never substitute a non-Madang subagent tool.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `MADANG_CLI_COMMAND` environment variable is set, use its value. Madang exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `MADANG_DEV_REPO_ROOT`, use `madang-dev`.
- Otherwise, on Linux outside an Madang-managed terminal, use `madang-ide`. Never run bare
  `madang` there — outside Madang's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `madang`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Madang build.

## Load the version-matched guide before running Madang commands

```text
ORCA skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`ORCA skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`ORCA skills get orchestration --full` and read the named bundled reference before acting.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Madang is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Madang. If
`skills get` is unknown, explain that updating Madang restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
