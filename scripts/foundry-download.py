#!/usr/bin/env python3
"""Unpack a cached Foundry Node.js zip and the Foundryborne system zip.

The server build is FoundryVTT-Node-14.370.zip (main.js at the archive root).
Nothing in this file logs in to foundryvtt.com or prints secret values.
"""

import hashlib
import json
import os
import pathlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile

USER_AGENT = "daggerheart-demiplane-importer-verify"
ARCHIVE_NAME = "FoundryVTT-Node-14.370.zip"
ARCHIVE_BYTES = 150182237
ARCHIVE_SHA256 = "e891a46b2878745b38dd8c28e843d763f83e69aa14bdbd3156edd8dafaabe846"
SAMPLE_PDFS = {
    "druid.pdf",
    "ex_ampleton.pdf",
    "luph.pdf",
    "oliver.pdf",
    "raelyn.pdf",
    "val.pdf",
}


def fail(message):
    sys.stderr.write(message.rstrip() + "\n")
    return 1


SECRET_ENV = ("FOUNDRY_LICENSE_KEY", "FOUNDRY_PASSWORD", "FOUNDRY_USERNAME", "FOUNDRY_ADMIN_KEY", "DEMIPLANE_SAMPLES_URL")


def redact(text):
    values = []
    for name in SECRET_ENV:
        secret = os.environ.get(name, "")
        if secret:
            values.append(secret)
        stripped = secret.replace("-", "")
        if stripped and stripped != secret:
            values.append(stripped)
    cleaned = str(text)
    for value in sorted(set(values), key=len, reverse=True):
        cleaned = cleaned.replace(value, "[redacted]")
    return cleaned


def redact_file(path):
    file = pathlib.Path(path)
    if file.is_file():
        file.write_text(redact(file.read_text(errors="replace")))
    return 0


def assert_safe(archive):
    for info in archive.infolist():
        name = info.filename.replace("\\", "/")
        parts = [part for part in name.split("/") if part not in ("", ".")]
        if name.startswith("/") or ".." in parts:
            raise RuntimeError("zip contains an unsafe path")


def safe_extract(zip_path, dest):
    with zipfile.ZipFile(zip_path) as archive:
        assert_safe(archive)
        archive.extractall(dest)


def system_meta(zip_path):
    with zipfile.ZipFile(zip_path) as archive:
        assert_safe(archive)
        name = next(
            (
                info.filename
                for info in archive.infolist()
                if info.filename.replace("\\", "/").rstrip("/").endswith("system.json")
            ),
            None,
        )
        if not name:
            return None
        return json.loads(archive.read(name))


def system_ok(zip_path, version):
    try:
        meta = system_meta(zip_path)
    except Exception:
        return False
    return bool(meta) and meta.get("id") == "daggerheart" and meta.get("version") == version


def find_child(root, marker):
    for dirpath, _dirs, files in os.walk(root):
        if marker in files:
            return dirpath
    return None


def read_release(package_json):
    with open(package_json, encoding="utf-8") as handle:
        release = json.load(handle)["release"]
    version = f'{release["generation"]}.{release["build"]}'
    if not version.replace(".", "").isdigit() or version.count(".") != 1:
        raise RuntimeError("Foundry package.json release is not generation.build")
    return version


def app_package(app_dir):
    return os.path.join(app_dir, "resources", "app", "package.json")


def release_ok(app_dir, version):
    package_json = app_package(app_dir)
    main = os.path.join(app_dir, "resources", "app", "main.js")
    if not (os.path.isfile(package_json) and os.path.isfile(main)):
        return False
    try:
        return read_release(package_json) == version
    except Exception:
        return False


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cache_ok(path):
    """Exit 0 only when path is the pinned Node.js 14.370 archive."""
    if not os.path.isfile(path):
        return fail(f"Missing Foundry archive {ARCHIVE_NAME}.")
    size = os.path.getsize(path)
    if size != ARCHIVE_BYTES:
        return fail(f"{ARCHIVE_NAME} is {size} bytes, expected {ARCHIVE_BYTES}.")
    digest = sha256_file(path)
    if digest != ARCHIVE_SHA256:
        return fail(f"{ARCHIVE_NAME} sha256 is {digest}, expected {ARCHIVE_SHA256}.")
    return 0


def extract_system(zip_path, dest, version):
    existing = os.path.join(dest, "system.json")
    if os.path.isfile(existing):
        with open(existing, encoding="utf-8") as handle:
            meta = json.load(handle)
        if meta.get("id") == "daggerheart" and meta.get("version") == version:
            return 0
    if not system_ok(zip_path, version):
        return fail(f"cached system zip is not daggerheart {version}")
    parent = os.path.dirname(dest)
    os.makedirs(parent, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=parent) as tmp:
        safe_extract(zip_path, tmp)
        root = find_child(tmp, "system.json")
        if not root:
            return fail("system zip has no system.json")
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(root, dest)
    return 0


def node_app_root(extracted):
    """Node.js zip: main.js at the archive root, or inside one wrapper folder."""
    if os.path.isfile(os.path.join(extracted, "main.js")):
        return extracted
    entries = [name for name in os.listdir(extracted) if not name.startswith(".")]
    dirs = [name for name in entries if os.path.isdir(os.path.join(extracted, name))]
    if len(entries) == 1 and dirs and os.path.isfile(os.path.join(extracted, dirs[0], "main.js")):
        return os.path.join(extracted, dirs[0])
    return None


def extract_foundry(zip_path, dest, version):
    if release_ok(dest, version):
        return 0
    parent = os.path.dirname(dest) or "."
    os.makedirs(parent, exist_ok=True)
    stage = dest + ".partial"
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)
    try:
        safe_extract(zip_path, stage)
        root = node_app_root(stage)
        if not root or not os.path.isfile(os.path.join(root, "package.json")):
            return fail("archive is not the Foundry Node.js build (main.js and package.json at the archive root)")
        app = os.path.join(dest, "resources", "app")
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        os.makedirs(os.path.dirname(app), exist_ok=True)
        shutil.copytree(root, app)
        # The verify launcher on the skill branch starts resources/app/main.mjs.
        # The Node zip ships main.js. A relative symlink lets that launcher run this file.
        main_mjs = os.path.join(app, "main.mjs")
        if os.path.isfile(os.path.join(app, "main.js")) and not os.path.lexists(main_mjs):
            os.symlink("main.js", main_mjs)
    finally:
        if os.path.isdir(stage):
            shutil.rmtree(stage)
    return 0 if release_ok(dest, version) else fail(f"Foundry {version} did not unpack")


def fetch_samples(dest):
    url = os.environ.get("DEMIPLANE_SAMPLES_URL", "").strip()
    if not url:
        return fail("DEMIPLANE_SAMPLES_URL is not set.")
    if not url.startswith("https://"):
        return fail("DEMIPLANE_SAMPLES_URL must be an https URL.")
    os.makedirs(dest, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as res:
            blob = res.read(200 * 1024 * 1024 + 1)
    except Exception as exc:
        return fail("sample PDF download failed: " + redact(exc))
    if len(blob) > 200 * 1024 * 1024:
        return fail("sample PDF download exceeded 200 MB.")
    with tempfile.TemporaryDirectory() as tmp:
        archive_path = os.path.join(tmp, "samples.zip")
        with open(archive_path, "wb") as handle:
            handle.write(blob)
        if not zipfile.is_zipfile(archive_path):
            return fail("sample download was not a zip.")
        with zipfile.ZipFile(archive_path) as archive:
            assert_safe(archive)
            wrote = 0
            for info in archive.infolist():
                base = info.filename.replace("\\", "/").rstrip("/").split("/")[-1]
                if base not in SAMPLE_PDFS:
                    continue
                target = os.path.join(dest, base)
                with archive.open(info) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
                os.chmod(target, 0o600)
                wrote += 1
        if wrote == 0:
            return fail("sample zip contained none of the suite PDFs.")
    return 0


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if command == "system-ok":
            return 0 if system_ok(sys.argv[2], sys.argv[3]) else 1
        if command == "extract-system":
            return extract_system(sys.argv[2], sys.argv[3], sys.argv[4])
        if command == "release-ok":
            return 0 if release_ok(sys.argv[2], sys.argv[3]) else 1
        if command == "extract-foundry":
            return extract_foundry(sys.argv[2], sys.argv[3], sys.argv[4])
        if command == "cache-ok":
            return cache_ok(sys.argv[2])
        if command == "fetch-samples":
            return fetch_samples(sys.argv[2])
        if command == "redact-file":
            return redact_file(sys.argv[2])
    except Exception as exc:
        return fail(redact(exc))
    return fail(
        "usage: foundry-download.py system-ok|extract-system|release-ok|extract-foundry|cache-ok|fetch-samples|redact-file"
    )


if __name__ == "__main__":
    sys.exit(main())
