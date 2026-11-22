@echo off
rem The live preview: the new UI with the stub's demo data in the browser, to click through every
rem screen and button without mails or the engine. Vite serves it from the UI worktree
rem (.claude\worktrees\ui-preview) while that exists, else from ui\ (tools\preview.mjs), so a
rem saved change shows at once. Variants via the address, e.g. ?platform=macos  ?scenario=first-run
rem (see tools\ui-harness\stub.ts for all scenarios). Close the window to stop it.
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js was not found. & pause & exit /b 1)
node tools\preview.mjs --open
pause
