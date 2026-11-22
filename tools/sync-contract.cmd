@echo off
rem Syncs the UI's contract from main without connecting (tools\sync-contract.mjs): the generated
rem IPC types and vocabulary.json as main has them, snapshot.json from main's engine on this
rem branch's demo data, and the stamp npm run check holds them to. Arguments go through
rem (--dry, --from <ref>, --demo-from-main). Commit the synced files with the stamp.
setlocal
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js was not found. & exit /b 1)
where cargo >nul 2>nul || (echo cargo was not found. & exit /b 1)
node tools\sync-contract.mjs %*
exit /b %errorlevel%
