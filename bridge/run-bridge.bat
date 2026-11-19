@echo off
rem Keeps the Postline bridge running; restarts it if it ever exits (exit code 2 = Google login expired -> stop).
cd /d "%~dp0\.."
:loop
node bridge\bridge.mjs >> bridge\bridge-console.log 2>&1
if %errorlevel%==2 exit /b 2
timeout /t 15 /nobreak >nul
goto loop
