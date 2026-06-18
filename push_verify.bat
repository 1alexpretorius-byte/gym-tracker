@echo off
cd /d C:\Users\Alex\Claude\Gym
echo Deleting lock files...
del /f .git\index.lock 2>nul
del /f .git\HEAD.lock 2>nul
echo.
echo Running git add...
git add .
echo.
echo Running git commit...
git commit -m "Week 3 plans: Jun 29 - Jul 4 (Pull A, Legs A, Push A, Pull B, Legs B, Push B)"
echo.
echo Running git push...
git push origin main
echo.
echo Done. Exit code: %errorlevel%
pause
