export const ORCA_CLI_POSIX_PATH_RESTORE = `if [ -n "\${MADANG_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$MADANG_CLI_BIN_DIR"|"$MADANG_CLI_BIN_DIR":*) ;;
    *) export PATH="$MADANG_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`
