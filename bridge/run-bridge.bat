@echo off
rem Keeps the Postline bridge running; restarts it if it ever exits (exit code 2 = Google login expired -> stop).
cd /d "%~dp0\.."
:loop
"C:\Users\Soly\tools\nodejs\node.exe" bridge\bridge.mjs >> bridge\bridge-console.log 2>&1
if %errorlevel%==2 exit /b 2
if %errorlevel%==3 exit /b 3
timeout /t 15 /nobreak >nul
goto loop

