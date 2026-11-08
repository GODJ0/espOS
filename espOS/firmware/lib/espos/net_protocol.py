"""Transport-neutral v2 app-file protocol. No exec, core updates or firmware OTA."""
import os
import time
import json
import hashlib
import binascii

MAX_FILE = 16384
MAX_BODY = 24576
EXTENSIONS = (".py", ".json", ".txt", ".md")


class AuthenticationError(Exception):
    pass


def sha(data):
    return binascii.hexlify(hashlib.sha256(data).digest()).decode()


def hmac_hex(key, data):
    """RFC 2104 HMAC-SHA256, implemented by hand rather than via the
    stdlib `hmac` module.

    Why: this file runs on both sides of the wire — on-device under
    MicroPython (no `hmac` module in the standard ESP32 build; only
    `hashlib`/`binascii`/`ucryptolib` are guaranteed present) and,
    unmodified, under CPython in `tests/test_net_protocol.py` and
    `test_net_http.py` so the exact same code is what gets verified.
    Shipping one hand-rolled implementation that's covered by those
    tests beats depending on `hmac` on the CPython side and falling
    back to a second, divergent implementation on-device — the two
    could silently disagree. The construction below is the textbook
    inner/outer-pad HMAC; it is not a shortcut or an approximation.
    """
    if len(key) > 64:
        key = hashlib.sha256(key).digest()
    key = key + b"\x00" * (64 - len(key))
    inner = bytes(x ^ 0x36 for x in key)
    outer = bytes(x ^ 0x5c for x in key)
    return binascii.hexlify(hashlib.sha256(outer + hashlib.sha256(inner + data).digest()).digest()).decode()


def equal(a, b):
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a.encode(), b.encode()):
        diff |= x ^ y
    return diff == 0


class ReplaceError(Exception):
    """Not an OSError on purpose: the HTTP layer maps OSError to 404."""
    pass


def replace_file(src, dst):
    """Rename src over dst. CPython (tests, also on Windows) has os.replace;
    MicroPython's LittleFS rename overwrites an existing file. There is
    deliberately no remove-then-rename fallback: if rename refuses (e.g. FAT),
    deleting dst first could lose both copies. Errors propagate unchanged.
    This is fail-closed error handling, not a power-loss atomicity guarantee."""
    replace = getattr(os, "replace", None)
    if replace is not None:
        replace(src, dst)
    else:
        os.rename(src, dst)


def valid_path(path, directory=False):
    if not isinstance(path, str) or len(path) > 160:
        raise ValueError("Invalid path")
    parts = path.split("/")
    if len(parts) < 2 or parts[0] != "" or parts[1] != "apps":
        raise ValueError("Only /apps is accessible")
    if len(parts) > 7:
        raise ValueError("Path too deep")
    for part in parts[2:]:
        if not part or part in (".", "..") or part.startswith("."):
            raise ValueError("Invalid path component")
        if any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for c in part):
            raise ValueError("Invalid path characters")
    if not directory and (len(parts) < 4 or not path.endswith(EXTENSIONS)):
        raise ValueError("Only app text files are supported")
    return path


class Protocol:
    def __init__(self, token, root="", clock=None, random=None, info=None):
        if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
            raise ValueError("A 32-byte hex pairing token is required")
        self.key = binascii.unhexlify(token)
        self.request_key = binascii.unhexlify(hmac_hex(self.key, b"espos-lan-v2/request"))
        self.response_key = binascii.unhexlify(hmac_hex(self.key, b"espos-lan-v2/response"))
        self.challenge_key = binascii.unhexlify(hmac_hex(self.key, b"espos-lan-v2/challenge"))
        self.root = root
        self.clock = clock or time.time
        self.random = random or os.urandom
        self.info = info or (lambda: {})
        self.nonces = {}
        self.reboot_requested = False

    def challenge(self, client):
        if not isinstance(client, str) or len(client) != 32 or any(c not in "0123456789abcdef" for c in client):
            raise ValueError("Fresh 16-byte client challenge required")
        now = self.clock()
        self.nonces = {k: v for k, v in self.nonces.items() if now < v}
        if len(self.nonces) >= 8:
            raise ValueError("Too many pending challenges")
        nonce = binascii.hexlify(self.random(16)).decode()
        self.nonces[nonce] = now + 15
        payload = json.dumps({"protocol": "espos-lan-v2", "client": client, "nonce": nonce, "expiresIn": 15})
        return {"payload": payload, "signature": hmac_hex(self.challenge_key, b"challenge\n" + payload.encode())}

    def response(self, status, data, nonce, request_hash):
        payload = json.dumps(data)
        binding = "response\n%s\n%s\n%d\n" % (nonce, request_hash, status)
        return {"payload": payload, "signature": hmac_hex(self.response_key, binding.encode() + payload.encode())}

    def authenticate(self, nonce, signature, body):
        expiry = self.nonces.pop(nonce, None)
        if expiry is None or self.clock() >= expiry:
            raise AuthenticationError("Expired or replayed challenge")
        if len(body) > MAX_BODY or not equal(hmac_hex(self.request_key, b"request\n" + nonce.encode() + b"\n" + body), signature):
            raise AuthenticationError("Invalid signature")

    def _read(self, path):
        with open(self.root + path, "rb") as f:
            data = f.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise ValueError("File exceeds 16 KiB")
        return data

    def dispatch(self, request):
        op = request.get("op")
        if op == "status":
            return {"protocol": "espos-lan-v2", "capabilities": ["status", "list", "read", "write", "reboot"], "maxFileBytes": MAX_FILE, "device": self.info()}
        if op == "reboot":
            if request.get("confirm") is not True:
                raise ValueError("Explicit reboot confirmation required")
            self.reboot_requested = True
            return {"accepted": True, "reboot": "scheduled"}
        if op == "list":
            path = valid_path(request.get("path", "/apps"), True)
            entries = []
            for name in sorted(os.listdir(self.root + path)):
                full = path + "/" + name
                try:
                    st = os.stat(self.root + full)
                    is_dir = bool(st[0] & 0x4000)
                    valid_path(full, is_dir)
                except (ValueError, OSError):
                    continue
                if len(entries) >= 128:
                    raise ValueError("Directory exceeds 128 entries")
                entries.append({"name": name, "path": full, "directory": is_dir, "size": st[6]})
            return {"path": path, "entries": entries}
        path = valid_path(request.get("path"))
        if op == "read":
            data = self._read(path)
            return {"path": path, "content": data.decode("utf-8"), "revision": sha(data)}
        if op == "write":
            if request.get("confirm") is not True:
                raise ValueError("Explicit write confirmation required")
            content = request.get("content")
            if not isinstance(content, str):
                raise ValueError("UTF-8 text required")
            data = content.encode("utf-8")
            if len(data) > MAX_FILE:
                raise ValueError("File exceeds 16 KiB")
            # Update existing files only. Revision prevents silent lost updates.
            old = self._read(path)
            if request.get("revision") != sha(old):
                raise ValueError("REVISION_CONFLICT: read file again before overwriting")
            target = self.root + path
            temporary = target + ".espos-tmp"
            verified = False
            try:
                with open(temporary, "wb") as f:
                    f.write(data)
                    f.flush()
                if hasattr(os, "sync"):
                    os.sync()
                with open(temporary, "rb") as f:
                    if f.read(MAX_FILE + 1) != data:
                        raise ValueError("WRITE_VERIFY_FAILED: original unchanged")
                # From here the temp may be the only good copy: never delete it.
                verified = True
                try:
                    replace_file(temporary, target)
                except OSError as e:
                    raise ReplaceError("REPLACE_FAILED (%s): original not deleted; verified copy kept as %s.espos-tmp" % (e, path))
                if hasattr(os, "sync"):
                    try:
                        os.sync()
                    except OSError:
                        raise ReplaceError("SYNC_FAILED: file renamed, read it again before continuing")
            finally:
                if not verified:
                    try:
                        os.remove(temporary)
                    except OSError:
                        pass
            return {"path": path, "revision": sha(data), "bytes": len(data), "restartRequired": True}
        raise ValueError("Unsupported operation")