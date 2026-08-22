!macro customHeader
  ; Aproveita a opção de "Mostrar Readme" para criar o atalho na Área de Trabalho
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Criar atalho na Área de Trabalho"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!macroend

Function CreateDesktopShortcut
  ; Cria o atalho apontando para o executável instalado
  ; Usamos ${APP_FILENAME}.exe que é o padrão do electron-builder
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_FILENAME}.exe"
FunctionEnd

!macro customUnInstall
  ; Remove o atalho se o programa for desinstalado
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
!macroend
