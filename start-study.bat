@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动【48 音标小铺】本地学习服务...
start "" "http://localhost:4173"
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 4173 --directory dist
) else (
  npm run preview -- --port 4173
)
