@echo off
rem Keeps the Postline bridge running; restarts it if it ever exits (exit code 2 = Google login expired -> stop, 3 = already running -> stop).
rem A second copy of this launcher cannot open the lock file, so it exits at once instead of looping forever.
cd /d "%~dp0\.."
( call :run ) 9>>"%~dp0launcher.lock" || exit /b 3
exit /b
:run
:loop
"C:\Users\Soly\tools\nodejs\node.exe" bridge\bridge.mjs >> bridge\bridge-console.log 2>&1
set RC=%errorlevel%
echo %date% %time% node exited %RC% >> bridge\bridge-exits.log
if %RC%==2 exit /b 2
if %RC%==3 exit /b 3
ping -n 16 127.0.0.1 >nul
goto loop
