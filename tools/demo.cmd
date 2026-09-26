@echo off
rem CXact with demo data: its own data folder (demo inside the app's data folder), made anew
rem from invented ads at every start. No mailbox, no portal, the real jobs stay untouched;
rem the window title says "CXact Demo". Load a test profile from tools\test-profiles in
rem Profil (the button to choose a profile file). Close CXact first: one runs at a time.
rem Starts the installed app (the per-user install of CXact), else a build of this checkout.
rem One command per line: cmd reads a file with LF line ends wrongly after a block.
setlocal
set "APP=%LOCALAPPDATA%\CXact\job-alert-monitor.exe"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Software\cxecutives\CXact" /ve 2^>nul ^| find "REG_SZ"') do if exist "%%b\job-alert-monitor.exe" set "APP=%%b\job-alert-monitor.exe"
if not exist "%APP%" set "APP=%~dp0..\target\release\job-alert-monitor.exe"
if not exist "%APP%" set "APP=%~dp0..\target\debug\job-alert-monitor.exe"
if not exist "%APP%" echo CXact is neither installed nor built here. Install it, or build it with: npx tauri build
if not exist "%APP%" exit /b 1
start "" "%APP%" --demo
