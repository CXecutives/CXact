@echo off
rem The app's UI with demo data in a window of its own (Edge in app mode, else the browser),
rem to click through every screen and button without mails or the engine (the harness stub).
rem It starts like the app's first open; the corner button jumps to other states. It serves
rem the copy in .preview, which is refreshed only when a block is finished and green; without
rem one it builds it first. Close this console to stop it.
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js was not found. & pause & exit /b 1)
if not exist node_modules call npm ci || (pause & exit /b 1)
if not exist .preview\index.html call npm run preview:refresh || (pause & exit /b 1)
node tools\preview.mjs --open
pause
