@echo off
cd /d "C:\Users\Alex\Claude\Gym"

echo Clearing stale git locks...
del /f .git\index.lock .git\HEAD.lock .git\ORIG_HEAD.lock 2>nul
del /f .git\objects\maintenance.lock 2>nul

echo Staging files...
git add CLAUDE.md
git add icon-192.png icon-512.png
git add icon-progress-192.png icon-progress-512.png
git add icon-settings-192.png icon-settings-512.png
git add manifest.json manifest-progress.json manifest-settings.json
git add overload-params.json progress.html settings.html

echo Committing...
git commit -m "feat: settings dashboard, fix PWA multi-install, distinct icons per app"

echo Pushing...
git push

echo.
echo Done. Press any key to close.
pause >nul
