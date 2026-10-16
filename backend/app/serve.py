"""Production launcher: one dual-stack socket so http://localhost works over IPv4 and IPv6."""
from __future__ import annotations

import os
import socket

import uvicorn


def _socket(host: str, port: int) -> socket.socket:
    if host in ("::", "") and socket.has_ipv6:
        try:
            sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
            # asyncio would set IPV6_V6ONLY=1 on "::"; clearing it accepts IPv4 (mapped) and IPv6 on one port.
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("::", port))
            return sock
        except OSError:
            sock.close()
        host = "0.0.0.0"
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    return sock


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    sock = _socket(os.environ.get("HOST", "::"), port)
    config = uvicorn.Config("app.main:app", proxy_headers=True, forwarded_allow_ips="*", log_level="info")
    uvicorn.Server(config).run(sockets=[sock])


if __name__ == "__main__":
    main()
