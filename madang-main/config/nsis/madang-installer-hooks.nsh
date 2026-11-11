; electron-builder accepts one nsis.include; keep every customInstall/customUnInstall hook here.

!include "${__FILEDIR__}\madang-process-check.nsh"

; Inside a macro, __FILEDIR__ resolves where the macro is used (the builder template), so capture this folder now.
!define MADANG_NSIS_DIR "${__FILEDIR__}"

; #10138/#23225: electron-builder’s APP_ASSOCIATE overwrites the extension’s default without backup,
; and APP_UNASSOCIATE never restores it. Register only additive ProgID/OpenWithProgids/SupportedTypes
; entries; never write the extension’s default handler. Sync extensions with isOsOpenedDocumentName().
!define MARKDOWN_PROGID "Madang.Markdown"
!define TABULAR_PROGID "Madang.Tabular"

!macro ORCA_REGISTER_DOCUMENT_OPEN_WITH EXT PROGID
  WriteRegNone SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
!macroend

!macro ORCA_UNREGISTER_DOCUMENT_OPEN_WITH EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}"
!macroend

!macro ORCA_REGISTER_DOCUMENT_PROGID PROGID NAME
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open" "" "Open with ${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$appExe" "%1"'
!macroend

; Put resources\bin on the user PATH so `madang` works in new terminals. Failure is not fatal:
; Settings can still register it. The script keeps the PATH value type and never duplicates the
; entry; it stays in $INSTDIR so the uninstaller can reuse it.
!macro MADANG_PATH_ACTION ACTION
  Push $0
  nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\madang-path.ps1" -Action ${ACTION} -Dir "$INSTDIR\resources\bin"'
  Pop $0
  ; Tell running programs the environment changed.
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r0)'
  Pop $0
!macroend

!macro customInstall
  File "/oname=$INSTDIR\resources\bin\madang-path.ps1" "${MADANG_NSIS_DIR}\madang-path.ps1"
  !insertmacro MADANG_PATH_ACTION add
  !insertmacro ORCA_REGISTER_DOCUMENT_PROGID "${MARKDOWN_PROGID}" "Markdown Document"
  !insertmacro ORCA_REGISTER_DOCUMENT_PROGID "${TABULAR_PROGID}" "Tabular Document"
  !insertmacro ORCA_REGISTER_DOCUMENT_OPEN_WITH ".md" "${MARKDOWN_PROGID}"
  !insertmacro ORCA_REGISTER_DOCUMENT_OPEN_WITH ".markdown" "${MARKDOWN_PROGID}"
  !insertmacro ORCA_REGISTER_DOCUMENT_OPEN_WITH ".mdx" "${MARKDOWN_PROGID}"
  !insertmacro ORCA_REGISTER_DOCUMENT_OPEN_WITH ".csv" "${TABULAR_PROGID}"
  !insertmacro ORCA_REGISTER_DOCUMENT_OPEN_WITH ".tsv" "${TABULAR_PROGID}"
  ; Why: Explorer caches the association list until told otherwise.
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

; Relocated hosts escape $INSTDIR’s process/file sweep, surviving updates but requiring real-uninstall cleanup.
; Keep ${isUpdated}: uninstallOldVersion runs this hook on every update and must preserve terminals.
; Sync LOCALAPPDATA root with LOCAL_HOST_ROOT_NAME in src/main/daemon/daemon-host-relocation.ts;
; see docs/reference/windows-daemon-host-relocation.md.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro MADANG_PATH_ACTION remove
    Push $0
    Push $1
    Push $2
    ; The verbatim app exe and an older renamed host both need cleanup, scoped to the current user
    ; like upstream KILL_PROCESS. NSIS expands USERNAME directly, avoiding two cmd.exe spawns.
    ReadEnvStr $1 USERNAME
    ${if} $1 == ""
      ; taskkill rejects an empty user filter and kills nothing. Fall back unfiltered if the normally set USERNAME is absent.
      StrCpy $2 ""
    ${else}
      StrCpy $2 '/FI "USERNAME eq $1"'
    ${endIf}
    nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" $2'
    Pop $0
    nsExec::Exec 'taskkill /F /IM "orca-terminal-daemon.exe" $2'
    Pop $0
    Pop $2
    Pop $1
    Pop $0
    ; Give the OS a moment to release the image lock before removing the tree.
    Sleep 500
    RMDir /r "$LOCALAPPDATA\Madang\daemon-host"
    RMDir /r "$LOCALAPPDATA\Madang\daemon-host-profiles"
  ${endIf}
  ; customInstall rewrites associations on every update, so remove them during uninstallOldVersion too.
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${MARKDOWN_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${TABULAR_PROGID}"
  !insertmacro ORCA_UNREGISTER_DOCUMENT_OPEN_WITH ".md" "${MARKDOWN_PROGID}"
  !insertmacro ORCA_UNREGISTER_DOCUMENT_OPEN_WITH ".markdown" "${MARKDOWN_PROGID}"
  !insertmacro ORCA_UNREGISTER_DOCUMENT_OPEN_WITH ".mdx" "${MARKDOWN_PROGID}"
  !insertmacro ORCA_UNREGISTER_DOCUMENT_OPEN_WITH ".csv" "${TABULAR_PROGID}"
  !insertmacro ORCA_UNREGISTER_DOCUMENT_OPEN_WITH ".tsv" "${TABULAR_PROGID}"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend
