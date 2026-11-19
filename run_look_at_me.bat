@echo off
chcp 65001 > nul
title LOOK-AT-ME C4I System Launcher

if exist "%USERPROFILE%\anaconda3\python.exe" (
    set "PATH=%USERPROFILE%\anaconda3;%USERPROFILE%\anaconda3\Scripts;%USERPROFILE%\anaconda3\Library\bin;%PATH%"
)

echo ===================================================================
echo   LOOK-AT-ME C4I 무인기 작전통제체계 [통합 기동 스크립트]
echo ===================================================================
echo.

cd /d "%~dp0backend"
python -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 goto INSTALL_BACKEND
goto CHECK_FRONTEND

:INSTALL_BACKEND
echo [알림] 백엔드 필수 패키지가 없어 자동 설치를 진행합니다...
python -m pip install -r requirements.txt
echo.

:CHECK_FRONTEND
if not exist "%~dp0frontend\node_modules" goto INSTALL_FRONTEND
goto START_SERVERS

:INSTALL_FRONTEND
echo [알림] 프론트엔드 라이브러리가 없어 자동 설치를 진행합니다...
cd /d "%~dp0frontend"
call npm install
echo.

:START_SERVERS
echo [점검] 기존 포트[8000, 3000] 점유 프로세스를 정리합니다...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000,3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
if exist "%~dp0frontend\.next\dev\lock" del /f /q "%~dp0frontend\.next\dev\lock" >nul 2>&1

echo [1/2] 백엔드 FastAPI 서버를 시작합니다 [Port 8000]...
start "LOOK-AT-ME C4I Backend" /D "%~dp0backend" cmd /k "chcp 65001 >nul && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak > nul

echo [2/2] 프론트엔드 Next.js 대시보드를 시작합니다 [Port 3000]...
start "LOOK-AT-ME C4I Frontend" /D "%~dp0frontend" cmd /k "chcp 65001 >nul && npm run dev"

echo.
echo ===================================================================
echo  [시스템 기동 완료]
echo   - 작전 대시보드 접속 URL: http://localhost:3000
echo   - 백엔드 REST/WS API URL:  http://localhost:8000
echo   - 백엔드 API 문서:         http://localhost:8000/docs
echo.
echo  [인가 작전통제 로그인 계정]
echo   - 작전지휘관 [LV3, 타격결심 전결권]:
echo     * 19-71502805 / 1q2w3e4r
echo   - 전술통제관 [LV2, 감시관제 통제권]:
echo     * 08-20260428 / 1q2w3e4r
echo     * 01-20230330 / 1q2w3e4r
echo     * 72-09180922 / 1q2w3e4r
echo ===================================================================
echo.
pause