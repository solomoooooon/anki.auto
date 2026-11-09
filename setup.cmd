@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (python scripts\setup.py) else (py -3 scripts\setup.py)
pause
