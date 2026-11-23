#!/usr/bin/env python3
"""Download and unpack Foundry VTT and the Foundryborne system zip.

fetch-foundry talks to foundryvtt.com. A licence key is not accepted there.
Nothing in this file prints secret values, presigned URLs, or zip member names.
"""

import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http.cookiejar import CookieJar

FOUNDRY = "https://foundryvtt.com"
USER_AGENT = "daggerheart-demiplane-importer-verify"
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


def require_secret(name):
    if os.environ.get(name, "").strip():
        return True
    sys.stderr.write(f"Missing Runtime Secret {name}.\n")
    return False


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


def release_ok(app_dir, version):
    package_json = os.path.join(app_dir, "resources", "app", "package.json")
    main = os.path.join(app_dir, "resources", "app", "main.mjs")
    if not (os.path.isfile(package_json) and os.path.isfile(main)):
        return False
    try:
        return read_release(package_json) == version
    except Exception:
        return False


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


def extract_foundry(zip_path, dest, version):
    if release_ok(dest, version):
        return 0
    parent = os.path.dirname(dest)
    os.makedirs(parent, exist_ok=True)
    stage = dest + ".partial"
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    os.makedirs(stage)
    try:
        safe_extract(zip_path, stage)
        root = None
        for dirpath, _dirs, _files in os.walk(stage):
            if os.path.isfile(os.path.join(dirpath, "resources", "app", "main.mjs")):
                root = dirpath
                break
        if not root or not release_ok(root, version):
            return fail(f"download is not Foundry VTT {version}")
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.move(root, dest)
    finally:
        if os.path.isdir(stage):
            shutil.rmtree(stage)
    return 0 if release_ok(dest, version) else fail(f"Foundry {version} did not unpack")


def opener():
    jar = CookieJar()
    handler = urllib.request.HTTPCookieProcessor(jar)
    built = urllib.request.build_opener(handler)
    built.addheaders = [("User-Agent", USER_AGENT)]
    return built, jar


def request(opener_, url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with opener_.open(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def fetch_foundry(dest, version):
    if not (require_secret("FOUNDRY_USERNAME") and require_secret("FOUNDRY_PASSWORD")):
        sys.stderr.write(
            "A Foundry licence key does not download the server. "
            "FOUNDRY_USERNAME and FOUNDRY_PASSWORD are the foundryvtt.com account.\n"
        )
        return 1
    build = version.split(".")[-1]
    if not build.isdigit():
        return fail(f"refusing Foundry version {version}")
    client, jar = opener()
    status, body = request(client, FOUNDRY + "/auth/login/")
    if status != 200:
        return fail(f"Foundry login page returned {status}.")
    html = body.decode("utf-8", "replace")
    token = ""
    match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html) or re.search(
        r'value="([^"]+)"[^>]*name="csrfmiddlewaretoken"', html
    )
    if match:
        token = match.group(1)
    if not token:
        return fail("Foundry login page did not include a CSRF token.")
    form = urllib.parse.urlencode(
        {
            "csrfmiddlewaretoken": token,
            "username": os.environ["FOUNDRY_USERNAME"],
            "password": os.environ["FOUNDRY_PASSWORD"],
            "next": "/",
        }
    ).encode()
    status, body = request(
        client,
        FOUNDRY + "/auth/login/",
        data=form,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": FOUNDRY,
            "Referer": FOUNDRY + "/auth/login/",
        },
    )
    html = body.decode("utf-8", "replace")
    has_session = any(cookie.name == "sessionid" for cookie in jar)
    if status >= 400 or not has_session or 'id="id_password"' in html:
        return fail(
            "Foundry account login failed. Check the Runtime Secrets FOUNDRY_USERNAME and FOUNDRY_PASSWORD."
        )
    release_url = f"{FOUNDRY}/releases/download?build={build}&platform=node&response_type=json"
    payload = None
    for attempt in range(3):
        status, body = request(client, release_url, headers={"Accept": "application/json", "Referer": FOUNDRY})
        if status == 200:
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                return fail("Foundry release response was not JSON.")
            break
        if status in (429, 503) and attempt < 2:
            time.sleep(5 * (attempt + 1))
            continue
        return fail(
            f"This Foundry account could not download build {version} (HTTP {status}). "
            "A licence key does not download the server."
        )
    presigned = payload.get("url") if isinstance(payload, dict) else None
    if not isinstance(presigned, str) or not presigned.startswith("https://"):
        return fail(f"Foundry did not return a download URL for {version}.")
    found = re.search(r"(?:releases/|foundryvtt[^/]*?-)(\d+\.\d+(?:\.\d+)?)", presigned, re.IGNORECASE)
    if found and found.group(1) != version:
        return fail(f"Foundry offered {found.group(1)} instead of {version}.")
    partial = dest + ".partial"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        bare = urllib.request.build_opener()
        req = urllib.request.Request(presigned, headers={"User-Agent": USER_AGENT})
        with bare.open(req, timeout=300) as res, open(partial, "wb") as out:
            total = 0
            while True:
                chunk = res.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 800 * 1024 * 1024:
                    return fail("Foundry download exceeded 800 MB.")
                out.write(chunk)
        os.replace(partial, dest)
    except Exception as exc:
        if os.path.exists(partial):
            os.remove(partial)
        return fail("Foundry download failed: " + redact(exc))
    finally:
        jar.clear()
    if not zipfile.is_zipfile(dest):
        os.remove(dest)
        return fail("Foundry download was not a zip. Login may have failed.")
    return 0


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
        if command == "fetch-foundry":
            return fetch_foundry(sys.argv[2], sys.argv[3])
        if command == "fetch-samples":
            return fetch_samples(sys.argv[2])
        if command == "redact-file":
            return redact_file(sys.argv[2])
    except Exception as exc:
        return fail(redact(exc))
    return fail(
        "usage: foundry-download.py system-ok|extract-system|release-ok|extract-foundry|fetch-foundry|fetch-samples|redact-file"
    )


if __name__ == "__main__":
    sys.exit(main())
