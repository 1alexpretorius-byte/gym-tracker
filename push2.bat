@echo off
cd /d C:\Users\Alex\Claude\Gym
if exist .git\index.lock del /f .git\index.lock
if exist .git\HEAD.lock del /f .git\HEAD.lock
if exist .git\ORIG_HEAD.lock del /f .git\ORIG_HEAD.lock
git config user.email "1.alexpretorius@gmail.com"
git config user.name "Alex Pretorius"
git add .
git commit -m "feat: progress dashboard, PWA manifest, app icons"
git push origin main
pause
