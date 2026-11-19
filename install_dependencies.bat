@echo off
chcp 65001 > nul
title LOOK-AT-ME C4I Dependency Installer

if exist "%USERPROFILE%\anaconda3\python.exe" (
    set "PATH=%USERPROFILE%\anaconda3;%USERPROFILE%\anaconda3\Scripts;%USERPROFILE%\anaconda3\Library\bin;%PATH%"
)

echo ===================================================================
echo   LOOK-AT-ME C4I 필수 라이브러리 일괄 설치 스크립트
echo ===================================================================
echo.

echo [1/2] 백엔드 Python 필수 패키지 설치 진행 중...
cd /d "%~dp0backend"
python -m pip install -r requirements.txt

echo.
echo [2/2] 프론트엔드 Node.js 패키지 설치 진행 중...
cd /d "%~dp0frontend"
call npm install

echo.
echo ===================================================================
echo  [설치 완료] 모든 의존성 설치가 정상 완료되었습니다.
echo  이제 "run_look_at_me.bat"을 더블클릭하시면 시스템이 자동 실행됩니다.
echo ===================================================================
pause