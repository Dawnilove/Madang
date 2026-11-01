---
name: collaboration
description: >-
  Multi-agent collaboration rules for Madang. Use only when the user's FIRST
  input of the session starts with the word "협업" (for example "협업: 로그인 화면을 만들어 줘").
  Do not use for the word "협업" appearing later in a conversation. The session
  becomes the lead (총괄) session: it assigns roles, shows a plan, sends work
  orders to worker sessions, and reports one combined result. The rules are
  served only when the "협업 규칙" switch in Madang Settings > Experimental is ON.
---

# Madang Collaboration

This file is a discovery stub, not the rules. The full, version-matched collaboration rules
are served by the `madang` binary itself — kept out of this file on purpose so they can
never drift from the binary that will actually run your commands.

Engage this skill only when the user's first input of the session starts with the word
"협업" (for example "협업: 로그인 화면을 만들어 줘"). Do not engage it for the word "협업"
appearing later in a conversation. The rules are served only when the user has turned on the
"협업 규칙" switch in Madang Settings > Experimental; otherwise the command below says the
rules are off, and you carry on as usual without them.

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

## Load the rules before acting

```text
ORCA skills get collaboration
```

That prints the version-matched rules for the exact binary that will handle your next
commands. Read them fully before you reply to the user's first input. Open worker sessions
with the `orchestration` skill.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Madang is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Madang. If
`skills get` is unknown, explain that updating Madang restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
