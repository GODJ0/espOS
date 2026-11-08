"""Opt-in LAN service. HTTP is not encrypted: isolated trusted LAN only."""
import asyncio
import json
import gc
import sys
import time
from espos.net_protocol import Protocol, MAX_BODY, AuthenticationError, sha


class Service:
    def __init__(self, settings, wlan):
        self.wlan = wlan
        self.settings = settings
        self.protocol = Protocol(settings.PAIRING_TOKEN, info=self.info)
        self.busy = False
        self.reset_pending = False
        self.last_challenge = 0

    def info(self):
        import config
        return {"name": config.DEVICE_NAME, "version": config.FIRMWARE_VERSION,
                "platform": sys.platform, "freeMem": gc.mem_free(), "ip": self.wlan.ifconfig()[0]}

    async def _read(self, reader, count):
        data = b""
        while len(data) < count:
            part = await reader.read(count - len(data))
            if not part:
                raise ValueError("Truncated request")
            data += part
        return data

    async def parse(self, reader, binding):
        # Read a bounded header byte-by-byte: slow clients cannot grow readline buffers.
        header = b""
        while not header.endswith(b"\r\n\r\n"):
            if len(header) >= 2048:
                raise ValueError("Headers too large")
            header += await self._read(reader, 1)
        lines = header.decode("ascii").split("\r\n")
        method, path, version = lines[0].split(" ")
        if version != "HTTP/1.1":
            raise ValueError("HTTP/1.1 required")
        headers = {}
        for line in lines[1:]:
            if not line:
                continue
            k, v = line.split(":", 1)
            k = k.lower().strip()
            if k in headers:
                raise ValueError("Duplicate header")
            headers[k] = v.strip()
        if "transfer-encoding" in headers:
            raise ValueError("Chunked requests unsupported")
        length = int(headers.get("content-length", "0"))
        if length < 0 or length > MAX_BODY:
            raise ValueError("Body too large")
        body = await self._read(reader, length)
        if method == "GET" and path.startswith("/espos/v2/challenge?client=") and length == 0:
            now = time.ticks_ms()
            if time.ticks_diff(now, self.last_challenge) < 250:
                raise ValueError("Challenge rate limit")
            self.last_challenge = now
            return self.protocol.challenge(path.split("=", 1)[1])
        if method != "POST" or path != "/espos/v2/rpc":
            raise ValueError("Unknown endpoint")
        nonce = headers.get("x-espos-nonce", "")
        if len(nonce) == 32 and all(c in "0123456789abcdef" for c in nonce):
            binding.extend([nonce, sha(body)])
        self.protocol.authenticate(nonce, headers.get("x-espos-signature", ""), body)
        request = json.loads(body.decode("utf-8"))
        if not isinstance(request, dict):
            raise ValueError("Object required")
        return self.protocol.dispatch(request)

    async def respond(self, writer, status, data, binding=None):
        if binding:
            data = self.protocol.response(status, data, binding[0], binding[1])
        body = json.dumps(data).encode("utf-8")
        writer.write(("HTTP/1.1 %d Response\r\nContent-Type: application/json\r\nContent-Length: %d\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n" % (status, len(body))).encode() + body)
        await asyncio.wait_for_ms(writer.drain(), 3000)

    async def handle(self, reader, writer):
        binding = []
        owner = not self.busy
        if owner:
            self.busy = True
        try:
            if not owner:
                await self.respond(writer, 503, {"error": "Device busy"})
                return
            try:
                data = await asyncio.wait_for_ms(self.parse(reader, binding), 5000)
                await self.respond(writer, 200, data, binding)
            except AuthenticationError:
                await self.respond(writer, 403, {"error": "Authentication failed"}, binding)
            except OSError:
                await self.respond(writer, 404, {"error": "File unavailable"}, binding)
            except Exception as e:
                await self.respond(writer, 400, {"error": str(e)[:160]}, binding)
        finally:
            writer.close()
            try:
                await asyncio.wait_for_ms(writer.wait_closed(), 1000)
            except Exception:
                pass
            if owner:
                self.busy = False
                if self.protocol.reboot_requested and not self.reset_pending:
                    self.reset_pending = True
                    asyncio.create_task(self.reset())

    async def reset(self):
        await asyncio.sleep_ms(750)
        import machine
        machine.reset()


async def start():
    try:
        import network_config as settings
    except ImportError:
        return None
    if not getattr(settings, "ENABLED", False):
        return None
    import network
    if not settings.WIFI_SSID or not settings.WIFI_PASSWORD:
        raise ValueError("Wi-Fi requires a protected trusted LAN")
    wlan = network.WLAN(network.STA_IF)
    service = Service(settings, wlan)  # Validate token before enabling radio.
    wlan.active(True)
    wlan.connect(settings.WIFI_SSID, settings.WIFI_PASSWORD)
    for _ in range(100):
        if wlan.isconnected():
            break
        await asyncio.sleep_ms(200)
    if not wlan.isconnected():
        wlan.active(False)
        raise OSError("Wi-Fi connection timed out; USB recovery remains available")
    server = await asyncio.start_server(service.handle, wlan.ifconfig()[0], 8765, backlog=2)
    print("espOS LAN: %s:8765 (trusted LAN only; no TLS)" % wlan.ifconfig()[0])
    return server