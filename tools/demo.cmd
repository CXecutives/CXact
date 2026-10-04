@echo off
rem The demo window: the real app's window (Tauri and WebView2, its own top bar, window buttons,
rem caption drag and snap) around the UI with the harness stub's demo data, so it looks and
rem moves exactly like the app without touching its data: its own name and identifier ("CXact
rem Vorschau", src-tauri/tauri.preview.conf.json), so its data folder and single-instance lock
rem are its own; every data command stays in the page's stub, only the window's commands
rem reach Tauri. It starts like the app's first open. Builds target\portable\CXact Vorschau.exe;
rem start it yourself.
setlocal
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js was not found. & exit /b 1)
if not exist node_modules call npm ci || exit /b 1
call npx vite build ui --mode harness --outDir ../target/demo-ui --emptyOutDir || exit /b 1
call npx tauri build --no-bundle --config src-tauri/tauri.preview.conf.json || exit /b 1
if not exist target\portable mkdir target\portable
copy /y target\release\job-alert-monitor.exe "target\portable\CXact Vorschau.exe" >nul
fc /b target\release\job-alert-monitor.exe "target\portable\CXact Vorschau.exe" >nul || (echo "target\portable\CXact Vorschau.exe" is still open: close it and run this again. & exit /b 1)
echo target\portable\CXact Vorschau.exe
exit /b 0
