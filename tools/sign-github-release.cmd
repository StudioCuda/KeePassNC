@echo off
rem KeePassNC signieren und das Archiv im GitHub-Release ersetzen, ohne App Store (neuestes GitHub-Release).
rem Startet tools\publish-release.sh mit SKIP_STORE=1 in WSL. Siehe docs/APPSTORE.md.
rem Eine bestimmte Version: im Terminal "sign-github-release.cmd 0.8.1".
title KeePassNC signieren
wsl.exe -e bash -lc "SKIP_STORE=1 bash \"$(wslpath '%~dp0publish-release.sh')\" %*"
echo.
pause
