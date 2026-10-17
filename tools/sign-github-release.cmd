@echo off
rem KeePassNC-Release signieren, ohne App Store (neuestes GitHub-Release). Startet tools\sign-github-release.sh in WSL.
rem Siehe docs/APPSTORE.md. Eine bestimmte Version: im Terminal "sign-github-release.cmd 0.8.1".
title KeePassNC signieren
wsl.exe -e bash -lc "bash \"$(wslpath '%~dp0sign-github-release.sh')\" %*"
echo.
pause
