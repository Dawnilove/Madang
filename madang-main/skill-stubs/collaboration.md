# Madang Collaboration

This file is a discovery stub, not the rules. The full, version-matched collaboration rules
are served by the `madang` binary itself — kept out of this file on purpose so they can
never drift from the binary that will actually run your commands.

Engage this skill only when the user's first input of the session starts with the word
"협업" (for example "협업: 로그인 화면을 만들어 줘"). Do not engage it for the word "협업"
appearing later in a conversation. The rules are served only when the user has turned on the
"협업 규칙" switch in Madang Settings > Experimental; otherwise the command below says the
rules are off, and you carry on as usual without them.

<!-- shared: resolver -->

## Load the rules before acting

```text
ORCA skills get collaboration
```

That prints the version-matched rules for the exact binary that will handle your next
commands. Read them fully before you reply to the user's first input. Open worker sessions
with the `orchestration` skill.

<!-- shared: no-guessing -->
