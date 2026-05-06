#!/usr/bin/env python3
"""Bulk-upload photos from a local folder to mom's gallery.

Usage:
  python scripts/bulk-upload-photos.py <photo_folder> [--captions <captions.txt>]

The script walks the folder for image files (.jpg .jpeg .png .heic .webp),
compresses each to max 1280px wide / JPEG quality 85, then uses the same
admin gallery pipeline as the inbox UI:

  1. POST /api/site-content?action=gallery-upload-url  → get Convex upload URL
  2. POST <upload_url>                                 → file body
  3. POST /api/site-content?action=gallery-add         → commit storageId

Requires:
  - ADMIN_API_KEY env var set (or paste in script below)
  - Pillow installed (pip install Pillow)
  - Image files readable

If a captions.txt is provided, each line is a caption for the corresponding
file (in alphabetical order). Missing entries → empty caption.
"""
from __future__ import annotations
import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("PUBLIC_BASE_URL", "https://<your-app>.vercel.app")
ADMIN_KEY = os.environ.get("ADMIN_API_KEY", "")
if not ADMIN_KEY:
    print("ERROR: ADMIN_API_KEY env var not set. Get it from your Vercel project env, then:")
    print("  PowerShell: $env:ADMIN_API_KEY = '...'")
    print("  bash:       export ADMIN_API_KEY='...'")
    sys.exit(1)
EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}


def compress_image(path: Path, max_dim: int = 1280, quality: int = 85) -> bytes:
    """Resize + recompress to JPEG. Returns bytes."""
    try:
        from PIL import Image, ImageOps  # noqa
    except ImportError:
        print("ERROR: Pillow not installed. Run: pip install Pillow")
        sys.exit(1)

    # HEIC support
    try:
        from pillow_heif import register_heif_opener  # noqa
        register_heif_opener()
    except ImportError:
        if path.suffix.lower() in {".heic", ".heif"}:
            print(f"  WARN: {path.name} is HEIC — pip install pillow-heif")

    img = Image.open(path)
    img = ImageOps.exif_transpose(img)  # Honor phone orientation tag
    img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > max_dim:
        if w >= h:
            new_w, new_h = max_dim, int(h * max_dim / w)
        else:
            new_w, new_h = int(w * max_dim / h), max_dim
        img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def post_json(path: str, body: dict | None) -> dict:
    url = BASE + path
    req = urllib.request.Request(
        url,
        data=json.dumps(body or {}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": ADMIN_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"ok": False, "_http": e.code, "_body": e.read().decode()[:300]}


def upload_to_convex(upload_url: str, blob: bytes) -> dict:
    req = urllib.request.Request(
        upload_url,
        data=blob,
        headers={"Content-Type": "image/jpeg"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http": e.code, "_body": e.read().decode()[:300]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", help="Path to local folder of photos")
    parser.add_argument("--captions", help="Path to captions.txt (one per line, alpha order)")
    parser.add_argument("--limit", type=int, default=24, help="Max photos to upload (default 24)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        print(f"ERROR: not a directory: {folder}")
        sys.exit(1)

    photos = sorted(p for p in folder.iterdir()
                    if p.is_file() and p.suffix.lower() in EXTS)
    if args.limit:
        photos = photos[: args.limit]
    print(f"Found {len(photos)} photos in {folder}")

    captions: list[str] = []
    if args.captions:
        captions = Path(args.captions).read_text(encoding="utf-8").splitlines()

    if args.dry_run:
        for i, p in enumerate(photos):
            cap = captions[i] if i < len(captions) else ""
            print(f"  [{i+1:2d}] {p.name} ({p.stat().st_size//1024}KB) → caption={cap!r}")
        print("DRY RUN — nothing uploaded.")
        return

    success, failed = 0, 0
    for i, photo in enumerate(photos, 1):
        cap = captions[i - 1] if i - 1 < len(captions) else ""
        print(f"[{i}/{len(photos)}] {photo.name} → ", end="", flush=True)
        try:
            blob = compress_image(photo)
            print(f"compressed {len(blob)//1024}KB → ", end="", flush=True)

            url_resp = post_json("/api/site-content?action=gallery-upload-url", {})
            if not url_resp.get("ok"):
                print(f"FAIL upload-url: {url_resp}")
                failed += 1
                continue
            upload_url = url_resp["uploadUrl"]

            up = upload_to_convex(upload_url, blob)
            sid = up.get("storageId")
            if not sid:
                print(f"FAIL convex-upload: {up}")
                failed += 1
                continue

            add = post_json("/api/site-content?action=gallery-add",
                            {"storageId": sid, "caption": cap})
            if not add.get("ok"):
                print(f"FAIL gallery-add: {add}")
                failed += 1
                continue

            print(f"OK sid={sid[:12]}…")
            success += 1
            time.sleep(0.4)  # Be gentle on the API
        except Exception as e:
            print(f"EXCEPTION: {e}")
            failed += 1

    print(f"\nDone: {success} uploaded, {failed} failed.")
    print(f"Visit https://<your-app>.vercel.app/ to see them — bottom of page.")


if __name__ == "__main__":
    main()
