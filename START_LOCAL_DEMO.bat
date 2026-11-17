@echo off
cd /d "%~dp0"
if not exist .env (
  echo Copy .env.example to .env and fill the configuration values before starting.
  pause
  exit /b 1
)
py -3.12 -m pip install -r requirements.txt
set LOCAL_DEV=1
for /f "usebackq tokens=1,* delims==" %%A in (".env") do if not "%%A"=="" set "%%A=%%B"
start "" http://127.0.0.1:8766
py -3.12 app.py
pause
