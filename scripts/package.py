"""Build the Anki add-on and a portable Windows project archive. No credentials."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def package():
    DIST.mkdir(exist_ok=True)
    addon = DIST / "anki.auto.ankiaddon"
    with zipfile.ZipFile(addon, "w", zipfile.ZIP_DEFLATED) as archive:
        for source in (ROOT / "anki_addon").glob("*.py"):
            archive.write(source, source.name)
        archive.writestr("manifest.json", json.dumps(dict(package="anki_auto_bridge", name="anki.auto local bridge", mod=0)))
        archive.writestr("_shared/__init__.py", "")
        for name in ("contracts", "matching", "config", "http_utils"):
            archive.write(ROOT / "anki_auto" / (name + ".py"), "_shared/" + name + ".py")
    frontend = DIST / "extension"
    if not (frontend / "manifest.json").is_file():
        raise SystemExit("Run npm run build before packaging the portable copy.")
    portable = DIST / "anki.auto-windows.zip"
    with zipfile.ZipFile(portable, "w", zipfile.ZIP_DEFLATED) as archive:
        for folder in ("anki_auto", "anki_addon", "extension", "scripts", "tests", "docs"):
            for source in (ROOT / folder).rglob("*"):
                if source.is_file() and "__pycache__" not in source.parts and not source.name.endswith(".pyc"):
                    archive.write(source, "anki.auto/" + source.relative_to(ROOT).as_posix())
        for name in ("README.md", "start.cmd", "setup.cmd", "package.json", "package-lock.json", "tsconfig.json", ".gitignore"):
            archive.write(ROOT / name, "anki.auto/" + name)
        archive.write(addon, "anki.auto/dist/" + addon.name)
        for source in frontend.rglob("*"):
            if source.is_file():
                archive.write(source, "anki.auto/" + source.relative_to(ROOT).as_posix())
    print("Built:", addon)
    print("Share:", portable)


if __name__ == "__main__":
    package()
