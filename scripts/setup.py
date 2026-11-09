from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if sys.version_info < (3, 11):
    raise SystemExit("Install Python 3.11 or newer first.")
if os.name != "nt":
    raise SystemExit("This setup targets Windows.")
try:
    subprocess.run(["node", "--version"], check=True)
    subprocess.run(["cmd", "/d", "/c", "npm.cmd ci"], cwd=ROOT, check=True)
    subprocess.run(["cmd", "/d", "/c", "npm.cmd run check"], cwd=ROOT, check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/package.py")], cwd=ROOT, check=True)
except (OSError, subprocess.CalledProcessError) as error:
    raise SystemExit("Setup stopped. Install Node.js 24 LTS and check the error above.") from error
print("Ready. Follow README.md to install the Anki add-on and load dist/extension in Chrome.")
