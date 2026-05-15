@echo off
chcp 65001 >nul
title Weather App

echo.
echo ============================================
echo          Weather App 启动中...
echo ============================================
echo.

echo [1/2] 启动本地服务端...
start /b node server.js > nul 2>&1
timeout /t 2 /nobreak > nul

echo [2/2] 创建公网隧道...
echo.
echo 公网地址将在下方显示，分享给其他人即可访问:
echo ============================================
echo.

npx localtunnel --port 3000

pause
