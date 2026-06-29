@echo off
cd /d "C:\Users\Alex\Claude\Gym"

echo Pulling remote changes (rebase)...
git pull --rebase

echo Pushing...
git push

echo.
echo Done. Press any key to close.
pause >nul
