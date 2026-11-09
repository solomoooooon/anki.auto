@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (python -m anki_auto.backend) else (py -3 -m anki_auto.backend)
pause
