---
name: madang-per-workspace-env
description: >-
  Set up, review, debug, or validate an Madang per-workspace environment recipe: the
  on-demand, disposable runtime (cloud sandbox, VM, SSH host, or local container)
  Madang creates fresh for each workspace. Use to stand up a new recipe end to end,
  fix an `environmentRecipes` entry in `madang.yaml`, scaffold provider lifecycle
  scripts, or resolve an `madang vm recipe doctor` failure. Use `madang-cli` for
  ordinary worktree and workspace creation with no recipe involved.
---

# Per-Workspace Environments

This discovery stub loads the version-matched guide from the Madang executable used for this session.

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
ORCA skills get madang-per-workspace-env
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Madang is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Madang. If
`skills get` is unknown, explain that updating Madang restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
