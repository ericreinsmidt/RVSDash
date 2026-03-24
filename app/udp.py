"""
================================================================================
Logical path (in-project): app/udp.py
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

What this file does (high-level):
- Implements the UDP transport layer for talking to the Raven Shield server.
- Provides two main operations:
  1) udp_query_reportext(ip, port):
     - sends a REPORTEXT query
     - drains multiple UDP datagrams until the server stops sending
     - returns both datagrams and metadata (timing, bytes, counts)
  2) udp_send_admin_command(ip, port, payload):
     - sends a single ADMIN command payload
     - optionally reads a single reply datagram (best-effort)
     - returns metadata plus decoded reply_text when possible

Why this file exists:
- UDP is connectionless and responses may arrive in bursts across multiple
  datagrams. A naive single recv() would often miss most data.
- Admin commands may or may not reply; we treat responses as optional.
================================================================================
"""

import socket  # Low-level UDP socket API.
import time  # Used for timeout tracking, elapsed time measurement.
from typing import List, Tuple  # Type annotations.

# Import UDP behavior tuning knobs (timeouts, retries, datagram limits).
from .config import (
    UDP_TIMEOUT_S,
    UDP_RETRIES,
    DRAIN_MAX_S,
    IDLE_STOP_S,
    MAX_DATAGRAMS,
    MAX_TOTAL_BYTES,
)

# The protocol query bytes sent to request the extended report from the server.
REPORTEXT = b"REPORTEXT"

# The protocol query bytes sent to request available maps + gametypes.
AVAILABLEMAPS = b"AVAILABLEMAPS"


def udp_query_reportext(ip: str, port: int) -> Tuple[List[bytes], dict]:
    """
    Send REPORTEXT, then drain multiple datagrams until idle.

    Args:
        ip: Target server IP address.
        port: Target server UDP port.

    Returns:
        (datagrams, meta)
        datagrams: List[bytes] of raw UDP payloads.
        meta: dict with target, counts, bytes, elapsed time.

    High-level algorithm:
    - Open UDP socket and "connect" it (sets default remote).
    - For up to UDP_RETRIES attempts:
      - send REPORTEXT
      - receive datagrams until:
        - we have too many (MAX_DATAGRAMS), or
        - we spent too long draining (DRAIN_MAX_S), or
        - bytes exceed MAX_TOTAL_BYTES, or
        - we go idle for IDLE_STOP_S after receiving at least one packet
    - If we never receive any datagrams, raise TimeoutError.
    """
    t0 = time.time()  # Start time for performance/telemetry.
    target = (ip, port)  # Remote endpoint tuple used by socket.

    datagrams: List[bytes] = []  # Accumulate received packets here.
    total_bytes = 0  # Track total bytes for safety limits and meta reporting.

    # Create an IPv4 UDP socket.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    # Set the baseline timeout used for initial receive.
    sock.settimeout(UDP_TIMEOUT_S)

    try:
        # UDP "connect" doesn't create a session; it just sets a default peer
        # and filters received packets to that peer.
        sock.connect(target)

        # Retry loop to handle packet loss or initial server delay.
        for _attempt in range(UDP_RETRIES):
            # Reset accumulators for each attempt.
            datagrams = []
            total_bytes = 0

            try:
                # Send the query.
                sock.send(REPORTEXT)

                drain_start = time.time()  # When this drain cycle began.
                last_rx = None  # Timestamp of last received datagram.

                while True:
                    # Stop conditions: safety limits.
                    if len(datagrams) >= MAX_DATAGRAMS:
                        break
                    if (time.time() - drain_start) > DRAIN_MAX_S:
                        break
                    if total_bytes > MAX_TOTAL_BYTES:
                        break

                    # Timeout strategy:
                    # - If we have never received anything, use standard UDP timeout.
                    # - Once we have received something, switch to "idle timeout":
                    #   if no packet arrives within IDLE_STOP_S since last_rx, stop.
                    if last_rx is None:
                        sock.settimeout(UDP_TIMEOUT_S)
                    else:
                        idle_left = IDLE_STOP_S - (time.time() - last_rx)
                        if idle_left <= 0:
                            break
                        sock.settimeout(max(0.01, idle_left))

                    try:
                        # Read up to max UDP payload size.
                        data = sock.recv(65535)
                    except socket.timeout:
                        # If we haven't received anything yet, treat as a failed attempt.
                        if last_rx is None:
                            raise
                        # If we've already received data, a timeout means the stream ended.
                        break

                    # Update last receive timestamp.
                    last_rx = time.time()

                    # Ignore empty payloads (rare, but defensive).
                    if not data:
                        continue

                    # Store payload and update counters.
                    datagrams.append(data)
                    total_bytes += len(data)

                # If we received anything, consider it a success and stop retrying.
                if datagrams:
                    break

            except socket.timeout:
                # If sending succeeded but first receive timed out, try again.
                continue

        # After retries, if still nothing, surface a clear error.
        if not datagrams:
            raise TimeoutError(f"No UDP response after {UDP_RETRIES} attempt(s)")

    finally:
        # Always close sockets to avoid resource leaks.
        try:
            sock.close()
        except Exception:
            pass

    # Compute elapsed time and build a meta dict for logging/UI display.
    elapsed_ms = int((time.time() - t0) * 1000)
    meta = {
        "target": {"ip": ip, "port": port},
        "datagrams": len(datagrams),
        "total_bytes": total_bytes,
        "elapsed_ms": elapsed_ms,
    }

    return datagrams, meta


def udp_query_availablemaps(ip: str, port: int) -> Tuple[List[bytes], dict]:
    """
    Send AVAILABLEMAPS, then drain multiple datagrams until idle.

    Design goal:
    - Use the SAME safe drain behavior as udp_query_reportext().
    - Do not treat missing packets as fatal until retries are exhausted.
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
                sock.send(AVAILABLEMAPS)

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
        "query": "AVAILABLEMAPS",
    }
    return datagrams, meta


def udp_send_admin_command(ip: str, port: int, payload: bytes, timeout_s: float = 1.2) -> dict:
    """
    Send a single ADMIN command over UDP and try to read one reply datagram (best-effort).

    Args:
        ip: Target server IP address.
        port: Target server UDP port.
        payload: The UDP payload bytes (e.g., b"ADMIN <pw> SETSERVEROPTION ...")
        timeout_s: How long to wait for an optional reply.

    Returns:
        dict: Metadata about what was sent and what (if anything) came back.

    Key behavior:
    - Some admin commands may not reply; that's not considered an error here.
    - If reply bytes are present, we:
      - return reply_b64 for debugging,
      - attempt to decode to reply_text for operator friendliness.
    """
    import base64  # Local import keeps module imports minimal unless needed.

    t0 = time.time()
    target = (ip, port)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout_s)

    reply_b64 = None  # Base64-encoded reply bytes for safe JSON transport.
    reply_len = 0  # Size of reply in bytes.
    reply_text = None  # Human-readable string version of reply if decodable.

    try:
        sock.connect(target)

        # Send the admin payload exactly once.
        sock.send(payload)

        try:
            # Best-effort: attempt to read one reply packet.
            data = sock.recv(65535)
            if data:
                reply_len = len(data)
                reply_b64 = base64.b64encode(data).decode("ascii")

                # Prefer strict UTF-8 decode if possible.
                try:
                    reply_text = data.decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    # Fall back to latin-1 to avoid failing on non-UTF8 bytes.
                    reply_text = data.decode("latin-1", errors="replace")

                # Normalize whitespace.
                reply_text = reply_text.strip()

        except socket.timeout:
            # No reply is acceptable for some commands.
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