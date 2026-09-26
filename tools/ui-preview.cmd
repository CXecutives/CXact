@echo off
rem The app's UI with demo data in the browser, to click through every screen and button
rem without mails or the engine (the harness stub). It serves the copy in .preview, which is
rem refreshed only when a block is finished and green; without one it builds it first.
rem Variants via the address, e.g. ?platform=macos  ?lang=en  ?scenario=first-run  &palette=dark
rem (see tools\ui-harness\stub.ts for all scenarios). Close the window to stop it.
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js was not found. & pause & exit /b 1)
if not exist node_modules call npm ci || (pause & exit /b 1)
if not exist .preview\index.html call npm run preview:refresh || (pause & exit /b 1)
node tools\preview.mjs --open
pause
