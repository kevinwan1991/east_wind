#!/usr/bin/env python3
"""
Reads Google session cookies directly from Chrome's SQLite database on macOS.
Decrypts values using the key stored in the macOS Keychain.
Saves to cookies/google.json (same format as Cookie-Editor export).

Usage: python3 scraper/refresh_cookies.py
No arguments needed — Chrome does not need to be open.
"""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def get_encryption_key() -> bytes:
    result = subprocess.run(
        ['security', 'find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
        capture_output=True, text=True, check=True,
    )
    password = result.stdout.strip().encode('utf-8')
    return hashlib.pbkdf2_hmac('sha1', password, b'saltysalt', 1003, dklen=16)


def decrypt(encrypted_value: bytes, key: bytes) -> str:
    if not encrypted_value:
        return ''
    if encrypted_value[:3] != b'v10':
        return encrypted_value.decode('utf-8', errors='ignore')
    payload = encrypted_value[3:]
    iv = b' ' * 16
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    dec = cipher.decryptor()
    raw = dec.update(payload) + dec.finalize()
    pad = raw[-1]
    return raw[16:-pad].decode('utf-8', errors='ignore')


def main():
    db_path = Path.home() / 'Library/Application Support/Google/Chrome/Default/Cookies'
    if not db_path.exists():
        raise FileNotFoundError(f"Chrome cookie DB not found: {db_path}")

    key = get_encryption_key()

    # Copy DB to temp file — avoids SQLite lock if Chrome is open
    tmp = tempfile.mktemp(suffix='.db')
    shutil.copy2(db_path, tmp)

    samesite_map = {-1: None, 0: 'no_restriction', 1: 'lax', 2: 'strict'}

    try:
        conn = sqlite3.connect(tmp)
        rows = conn.execute("""
            SELECT host_key, name, value, encrypted_value, path,
                   expires_utc, is_secure, is_httponly, samesite
            FROM cookies
            WHERE host_key LIKE '%google.com%'
            ORDER BY host_key, name
        """).fetchall()
        conn.close()
    finally:
        os.unlink(tmp)

    cookies = []
    for host_key, name, value, enc_val, path, expires_utc, is_secure, is_httponly, samesite in rows:
        actual_value = value if value else decrypt(bytes(enc_val), key)
        # Chrome stores time as microseconds since Windows epoch (1601-01-01)
        expires_unix = (expires_utc / 1_000_000) - 11_644_473_600 if expires_utc else -1
        cookies.append({
            'domain':         host_key,
            'expirationDate': expires_unix,
            'hostOnly':       not host_key.startswith('.'),
            'httpOnly':       bool(is_httponly),
            'name':           name,
            'path':           path,
            'sameSite':       samesite_map.get(samesite),
            'secure':         bool(is_secure),
            'session':        expires_utc == 0,
            'storeId':        None,
            'value':          actual_value,
        })

    out = Path(__file__).parent.parent / 'cookies' / 'google.json'
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(cookies, indent=2))
    print(f"[cookies] saved {len(cookies)} google.com cookies → {out}")


if __name__ == '__main__':
    main()
