@echo off
cd /d "C:\Users\Alex\Claude\Gym"

echo Aborting any stuck merge...
git merge --abort 2>nul

echo Tracking workflow file...
git add .github/workflows/generate-plans.yml

echo Amending last commit...
git commit --amend --no-edit

echo Merging remote changes (no editor)...
git pull --no-rebase --no-edit

echo Pushing...
git push

echo.
echo Done. Press any key to close.
pause >nul
