@echo off
rem KeePassNC im Nextcloud App Store veroeffentlichen (neuestes GitHub-Release). Startet tools\publish-nextcloud-release.sh in WSL.
rem Siehe docs/APPSTORE.md. Eine bestimmte Version: im Terminal "publish-nextcloud-release.cmd 0.7.1".
title KeePassNC veroeffentlichen
wsl.exe -e bash -lc "bash \"$(wslpath '%~dp0publish-nextcloud-release.sh')\" %*"
echo.
pause
