; Installer hooks of the Windows setup (tauri.windows.conf.json > bundle > windows > nsis >
; installerHooks). Before the install an old Job-Alert-Monitor install goes. After every
; install the shortcuts name the app's own icon explicitly and the shell is told to reload its
; icons: a shortcut without an icon path (",0") could keep a stale or blank picture from the
; icon cache after an update.

; The app was called Job-Alert-Monitor before, with the same identifier and so the same data
; folder. An install of that name goes first, silently: left in place, its uninstaller would
; delete that shared folder when its "delete the app data" box is ticked. A silent run (/S)
; never reads that box, so the data stays (the start of CXact then resets an old database).
; _?=<folder> runs the uninstaller in place, so ExecWait waits for it; on success its file and
; folder are removed here. Exit code 0 is success; on a failure the old Apps entry still works.
; The old uninstaller closes a running job-alert-monitor.exe (CXact's binary too) without
; asking, so the template's own check asks first.
!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $1
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Job-Alert-Monitor" "UninstallString"
  ${If} $0 != ""
    ; "<folder>\uninstall.exe" in quotes: the quotes go, the folder is its parent.
    StrCpy $1 $0 1
    ${If} $1 == '"'
      StrCpy $0 $0 "" 1
      StrCpy $0 $0 -1
    ${EndIf}
    ${GetParent} $0 $0
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0\uninstall.exe"
      !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
      ClearErrors
      ExecWait '"$0\uninstall.exe" /S _?=$0' $1
      ${IfNot} ${Errors}
      ${AndIf} $1 = 0
        Delete "$0\uninstall.exe"
        RMDir "$0"
      ${EndIf}
      ; The old folder may have been this install's folder.
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 +2
    CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  ; SHCNE_ASSOCCHANGED: the shell drops its cached icons and reads them again.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
