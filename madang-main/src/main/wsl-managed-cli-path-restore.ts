/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${MADANG_WSL_CLI_DIR:-}" ]; then
  if [ -x "$MADANG_WSL_CLI_DIR/\${MADANG_CLI_COMMAND:-}" ]; then
    export PATH="$MADANG_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Madang CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$MADANG_WSL_CLI_DIR/\${MADANG_CLI_COMMAND:-}" >&2
  fi
fi`
