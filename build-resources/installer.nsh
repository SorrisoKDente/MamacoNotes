; ============================================================================
; Custom NSIS script (included by electron-builder via `nsis.include`).
;
; customCheckAppRunning
; ---------------------
; Overrides electron-builder's default "is the app running?" check
; (templates/nsis/include/allowOnlyOneInstallerInstance.nsh). The default
; implementation can report the app as running when it is not - for example a
; process whose executable path merely starts with the install directory
; (Electron's `crashpad_handler.exe` lives under `$INSTDIR\resources`), or
; another user's process on a terminal server. On such machines the installer
; gets stuck in an endless "Não é possível fechar o Mamaco Notes / cannot be
; closed" retry loop even though the app is closed, and the old-version
; uninstaller then aborts with error 2 ("Falha ao desinstalar os arquivos do
; aplicativo antigo").
;
; This replacement detects only the exact app executable running for the
; current user (tasklist filtered by image name + user name, with an anchored
; findstr match - so no substring/path-prefix false positives) and closes it
; gracefully (WM_CLOSE) before force-killing the whole process tree, with a
; bounded number of attempts.
;
; The macro is used both by the installer and by the uninstaller.
; ============================================================================
!ifndef MN_NSH_INCLUDED
  !define MN_NSH_INCLUDED

  !macro MN_FindApp OUT
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop ${OUT}
  !macroend

  !macro customCheckAppRunning
    Var /GLOBAL MN_AppExe
    Var /GLOBAL MN_RetryCount
    Var /GLOBAL MN_ForceKill
    Var /GLOBAL MN_Result

    StrCpy $MN_AppExe "${APP_EXECUTABLE_FILENAME}"

    ; In the auto-update flow the app is already quitting; give it a moment to
    ; exit on its own before checking.
    ${if} ${isUpdated}
      Sleep 500
    ${endIf}

    !insertmacro MN_FindApp $MN_Result
    ${if} $MN_Result != 0
      Goto mn_done
    ${endIf}

    ; A normal (non-update) install: ask for permission to close the app.
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK mn_close
      Quit
    ${endIf}

    mn_close:
    StrCpy $MN_RetryCount 0
    StrCpy $MN_ForceKill 0

    mn_loop:
      IntOp $MN_RetryCount $MN_RetryCount + 1

      ; First attempt a graceful close (WM_CLOSE), then force-kill the tree.
      ${if} $MN_ForceKill == 0
        nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /T /IM "$MN_AppExe" /FI "USERNAME eq %USERNAME%"`
      ${else}
        nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "$MN_AppExe" /FI "USERNAME eq %USERNAME%"`
      ${endIf}
      Pop $MN_Result

      Sleep 800

      !insertmacro MN_FindApp $MN_Result
      ${if} $MN_Result != 0
        Goto mn_done
      ${endIf}

      StrCpy $MN_ForceKill 1

      ${if} $MN_RetryCount >= 4
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY mn_retry
        Quit
        mn_retry:
        StrCpy $MN_RetryCount 0
        StrCpy $MN_ForceKill 0
      ${endIf}

      Goto mn_loop

    mn_done:
  !macroend

!endif

; During an update, skip the legacy uninstaller. Older versions can abort with
; error 2 because their app-running check falsely detects a process.
!macro customInit
  ${if} ${isUpdated}
    DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
  ${endIf}
!macroend

; Do not block an update if a legacy uninstaller still returns an error.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Legacy uninstaller returned $R0; continuing update."
  ${endIf}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint "Legacy per-user uninstaller returned $R0; continuing update."
  ${endIf}
!macroend

; Verifica se não estamos compilando o desinstalador
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Criar atalho na Área de Trabalho"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

  Function CreateDesktopShortcut
    ; Cria o atalho apontando para o executável instalado
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_FILENAME}.exe"
  FunctionEnd
!endif

!macro customUnInstall
  ; Remove o atalho se o programa for desinstalado
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
