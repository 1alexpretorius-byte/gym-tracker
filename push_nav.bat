@echo off
cd /d "C:\Users\Alex\Claude\Gym"

del /f .git\index.lock .git\HEAD.lock .git\ORIG_HEAD.lock 2>nul

git add index.html progress.html settings.html
git commit -m "feat: unified PWA with bottom nav bar (Tracker / Progress / Settings)"
git push

echo.
echo Done. Press any key to close.
pause >nul
