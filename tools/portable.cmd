@echo off
rem CXact and CXact Demo as one exe each, no setup (user 2026-09-30): target\portable\CXact.exe
rem and target\portable\CXact Demo.exe. The demo carries its ads inside (feature
rem embedded-demo); both carry their licences (THIRD-PARTY.txt). Windows 10 and 11 bring the
rem WebView2 runtime the app needs.
setlocal
cd /d "%~dp0.."
call npx tauri build --no-bundle || exit /b 1
if not exist target\portable mkdir target\portable
call :place target\release\job-alert-monitor.exe "target\portable\CXact.exe" || exit /b 1
call npx tauri build --no-bundle --config src-tauri\tauri.demo.conf.json --features embedded-demo || exit /b 1
call :place target\release\cxact-demo.exe "target\portable\CXact Demo.exe" || exit /b 1
echo target\portable\CXact.exe
echo target\portable\CXact Demo.exe
exit /b 0

rem Copies %1 to %2 and checks the copy: an exe that is still open keeps the old file.
:place
copy /y %1 %2 >nul
fc /b %1 %2 >nul || (echo %~2 is still open: close it and run this again. & exit /b 1)
exit /b 0
