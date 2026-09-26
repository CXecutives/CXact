; Installer hooks of the Windows setup (tauri.windows.conf.json > bundle > windows > nsis >
; installerHooks). After every install the shortcuts name the app's own icon explicitly and the
; shell is told to reload its icons: a shortcut without an icon path (",0") could keep a stale
; or blank picture from the icon cache after an update.

; The app was called Job-Alert-Monitor before, with the same identifier and so the same data
; folder (%LOCALAPPDATA%\de.cxecutives.job-alert-monitor: the database, its backups, the
; settings, the logs, the freelance.de session). An install of that name goes first,
; silently and without its data: left in place, it would be a second entry under Apps whose
; uninstaller deletes that shared folder when its "delete the app data" box is ticked.
;
; What Tauri's NSIS template (tauri-bundler 2.x, the one of CLI 2.11 that built both names)
; writes and does, and so what this hook relies on:
; - A per-user install (installMode currentUser) keeps its Apps entry in
;   HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<product name> with DisplayName
;   = the product name and UninstallString = "<install folder>\uninstall.exe" in quotes. It
;   never writes a QuietUninstallString. The key is named by the product name, not by the
;   identifier: the old entry is "Job-Alert-Monitor", CXact's own is "CXact", so this hook
;   never reads or runs the new install's uninstaller.
; - The uninstaller deletes the app data only when the user ticks the box on its confirm page
;   (DeleteAppDataCheckboxState, read when that page is left). A silent run (/S) shows no page,
;   so the box is never read and the data stays. /UPDATE would keep the data too, but also the
;   old Start menu and desktop shortcuts, which should go; it is not passed.
; - An NSIS uninstaller copies itself to %TEMP% and returns at once, unless _?=<folder> runs it
;   in place (the last argument, never in quotes): only then does ExecWait wait for the end.
;   In place it cannot delete itself or its folder, so that is done here once it succeeded.
; - Exit code 0 is success, 1 cancelled, 2 aborted (it could not close a running app). On a
;   failure uninstall.exe stays, so the old Apps entry still works and can be removed by hand.
; - The old uninstaller closes a running job-alert-monitor.exe without asking, and that is
;   CXact's binary too: the template's own check runs first here, so the user is asked (or, in
;   a silent install, the app is closed as the template would close it right after this hook).
!macro NSIS_HOOK_PREINSTALL
  !if "${PRODUCTNAME}" != "Job-Alert-Monitor"
    Push $0
    Push $1
    Push $2
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Job-Alert-Monitor" "UninstallString"
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Job-Alert-Monitor" "DisplayName"
    ${If} $0 != ""
    ${AndIf} $1 == "Job-Alert-Monitor"
      ; "<folder>\uninstall.exe" in quotes: the quotes go, the folder is its parent.
      StrCpy $1 $0 1
      ${If} $1 == '"'
        StrCpy $0 $0 "" 1
        StrCpy $0 $0 -1
      ${EndIf}
      ${GetParent} $0 $2
      ${If} $2 != ""
      ${AndIf} ${FileExists} "$2\uninstall.exe"
        !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
        ClearErrors
        ExecWait '"$2\uninstall.exe" /S _?=$2' $1
        ${IfNot} ${Errors}
        ${AndIf} $1 = 0
          Delete "$2\uninstall.exe"
          RMDir "$2"
          DeleteRegKey HKCU "Software\${MANUFACTURER}\Job-Alert-Monitor"
        ${EndIf}
        ; The old folder may have been this install's folder: it is there again, and current.
        SetOutPath $INSTDIR
      ${EndIf}
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 +2
    CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  ; SHCNE_ASSOCCHANGED: the shell drops its cached icons and reads them again.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
