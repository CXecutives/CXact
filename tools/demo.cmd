@echo off
rem CXact with demo data: the installed CXact Demo (its setup comes from
rem npx tauri build --config src-tauri\tauri.demo.conf.json, docs\CHANGING.md "The demo app"),
rem else CXact or a build of this checkout with --demo. Either keeps a data folder of its own,
rem made anew at every start with an empty Eingang and the sample profile; every fetch brings
rem new invented ads from a made-up mailbox, no real mailbox, no portal, the real jobs stay
rem untouched; the window title says "CXact Demo". With --demo close CXact first: one runs at
rem a time. One command per line: cmd reads a file with LF line ends wrongly after a block.
setlocal
set "DEMO=%LOCALAPPDATA%\CXact Demo\cxact-demo.exe"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Software\cxecutives\CXact Demo" /ve 2^>nul ^| find "REG_SZ"') do if exist "%%b\cxact-demo.exe" set "DEMO=%%b\cxact-demo.exe"
if exist "%DEMO%" start "" "%DEMO%"
if exist "%DEMO%" exit /b 0
set "APP=%LOCALAPPDATA%\CXact\job-alert-monitor.exe"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Software\cxecutives\CXact" /ve 2^>nul ^| find "REG_SZ"') do if exist "%%b\job-alert-monitor.exe" set "APP=%%b\job-alert-monitor.exe"
if not exist "%APP%" set "APP=%~dp0..\target\release\job-alert-monitor.exe"
if not exist "%APP%" set "APP=%~dp0..\target\debug\job-alert-monitor.exe"
if not exist "%APP%" echo CXact is neither installed nor built here. Install it, or build it with: npx tauri build
if not exist "%APP%" exit /b 1
start "" "%APP%" --demo
