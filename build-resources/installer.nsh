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
