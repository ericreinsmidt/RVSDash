"""
================================================================================
Logical path (in-project): app/udp.py
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

What this file does (high-level):
- Implements the UDP transport layer for talking to the Raven Shield server.
- Provides three main operations:
  1) udp_query_reportext(ip, port):
     - sends a REPORTEXT query and drains response datagrams
  2) udp_query_availablemaps(ip, port):
     - sends an AVAILABLEMAPS query and drains response datagrams
  3) udp_send_admin_command(ip, port, payload):
     - sends a single ADMIN command payload
     - optionally reads a single reply datagram (best-effort)

Why this file exists:
- UDP is connectionless and responses may arrive in bursts across multiple
  datagrams. A naive single recv() would often miss most data.
- Admin commands may or may not reply; we treat responses as optional.
================================================================================
"""

import socket
import time
from typing import List, Tuple

from .config import (
    UDP_TIMEOUT_S,
    UDP_RETRIES,
    DRAIN_MAX_S,
    IDLE_STOP_S,
    MAX_DATAGRAMS,
    MAX_TOTAL_BYTES,
)

# Protocol query constants.
REPORTEXT = b"REPORTEXT"
AVAILABLEMAPS = b"AVAILABLEMAPS"
BANLIST = b"BANLIST"


def _udp_query_drain(ip: str, port: int, query: bytes, extra_meta: dict | None = None) -> Tuple[List[bytes], dict]:
    """
    Shared UDP query + drain implementation.

    Sends `query` bytes to (ip, port), then drains multiple response datagrams
    until idle. Retries up to UDP_RETRIES times on initial timeout.

    Args:
        ip: Target server IP address.
        port: Target server UDP port.
        query: The protocol query bytes to send (e.g., REPORTEXT, AVAILABLEMAPS).
        extra_meta: Optional dict of extra fields to include in returned metadata.

    Returns:
        (datagrams, meta)
        datagrams: List[bytes] of raw UDP payloads.
        meta: dict with target, counts, bytes, elapsed time, plus any extra_meta.

    Raises:
        TimeoutError: If no datagrams received after all retry attempts.
    """
    t0 = time.time()
    target = (ip, port)

    datagrams: List[bytes] = []
    total_bytes = 0

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(UDP_TIMEOUT_S)

    try:
        sock.connect(target)

        for _attempt in range(UDP_RETRIES):
            datagrams = []
            total_bytes = 0

            try:
                sock.send(query)

                drain_start = time.time()
                last_rx = None

                while True:
                    if len(datagrams) >= MAX_DATAGRAMS:
                        break
                    if (time.time() - drain_start) > DRAIN_MAX_S:
                        break
                    if total_bytes > MAX_TOTAL_BYTES:
                        break

                    if last_rx is None:
                        sock.settimeout(UDP_TIMEOUT_S)
                    else:
                        idle_left = IDLE_STOP_S - (time.time() - last_rx)
                        if idle_left <= 0:
                            break
                        sock.settimeout(max(0.01, idle_left))

                    try:
                        data = sock.recv(65535)
                    except socket.timeout:
                        if last_rx is None:
                            raise
                        break

                    last_rx = time.time()

                    if not data:
                        continue

                    datagrams.append(data)
                    total_bytes += len(data)

                if datagrams:
                    break

            except socket.timeout:
                continue

        if not datagrams:
            raise TimeoutError(f"No UDP response after {UDP_RETRIES} attempt(s)")

    finally:
        try:
            sock.close()
        except Exception:
            pass

    elapsed_ms = int((time.time() - t0) * 1000)
    meta = {
        "target": {"ip": ip, "port": port},
        "datagrams": len(datagrams),
        "total_bytes": total_bytes,
        "elapsed_ms": elapsed_ms,
    }
    if extra_meta:
        meta.update(extra_meta)

    return datagrams, meta


def udp_query_reportext(ip: str, port: int) -> Tuple[List[bytes], dict]:
    """
    Send REPORTEXT, then drain multiple datagrams until idle.

    Returns:
        (datagrams, meta)
    """
    return _udp_query_drain(ip, port, REPORTEXT)


def udp_query_availablemaps(ip: str, port: int) -> Tuple[List[bytes], dict]:
    """
    Send AVAILABLEMAPS, then drain multiple datagrams until idle.

    Returns:
        (datagrams, meta)
    """
    return _udp_query_drain(ip, port, AVAILABLEMAPS, extra_meta={"query": "AVAILABLEMAPS"})

def udp_query_banlist(ip: str, port: int) -> Tuple[List[bytes], dict]:
    """
    Send BANLIST, then drain multiple datagrams until idle.

    Returns:
        (datagrams, meta)
    """
    return _udp_query_drain(ip, port, BANLIST, extra_meta={"query": "BANLIST"})

def udp_send_admin_command(ip: str, port: int, payload: bytes, timeout_s: float = 1.2) -> dict:
    """
    Send a single ADMIN command over UDP and try to read one reply datagram (best-effort).

    Args:
        ip: Target server IP address.
        port: Target server UDP port.
        payload: The UDP payload bytes (e.g., b"ADMIN <pw> SETSERVEROPTION...")
        timeout_s: How long to wait for an optional reply.

    Returns:
        dict: Metadata about what was sent and what (if anything) came back.
    """
    import base64

    t0 = time.time()
    target = (ip, port)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout_s)

    reply_b64 = None
    reply_len = 0
    reply_text = None

    try:
        sock.connect(target)
        sock.send(payload)

        try:
            data = sock.recv(65535)
            if data:
                reply_len = len(data)
                reply_b64 = base64.b64encode(data).decode("ascii")

                try:
                    reply_text = data.decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    reply_text = data.decode("latin-1", errors="replace")

                reply_text = reply_text.strip()

        except socket.timeout:
            pass

    finally:
        try:
            sock.close()
        except Exception:
            pass

    elapsed_ms = int((time.time() - t0) * 1000)
    return {
        "target": {"ip": ip, "port": port},
        "sent_len": len(payload),
        "reply_len": reply_len,
        "reply_b64": reply_b64,
        "reply_text": reply_text,
        "elapsed_ms": elapsed_ms,
    }