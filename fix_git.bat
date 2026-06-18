@echo off
cd /d C:\Users\Alex\Claude\Gym
del /f .git\index 2>nul
del /f .git\index.lock 2>nul
del /f .git\HEAD.lock 2>nul
del /f .git\refs\heads\main.lock 2>nul
git reset
git fetch origin main
git reset --hard origin/main
echo.
echo Done. Git is clean and up to date.
pause
