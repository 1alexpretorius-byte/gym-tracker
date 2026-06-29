@echo off
cd /d "C:\Users\Alex\Claude\Gym"

echo Aborting stuck merge...
git merge --abort

echo Tracking workflow file...
git add .github/workflows/generate-plans.yml

echo Amending last commit to include workflow file...
git commit --amend --no-edit

echo Merging remote changes...
git pull --no-rebase

echo Pushing...
git push

echo.
echo Done. Press any key to close.
pause >nul
