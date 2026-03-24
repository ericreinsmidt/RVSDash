"""
================================================================================
File: app/config.py
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

What this file does (high-level):
- Centralizes configuration constants used across the backend.
- Defines the default Raven Shield server target (IP + UDP port) that the UI and
  API will talk to when no other target-selection mechanism exists.
- Defines UDP behavior tuning knobs used by both:
  - status queries (REPORTEXT)
  - admin commands (ADMIN ...)

Why this file exists:
- Keeps “magic numbers” (timeouts, retries, limits) in one place so you can tune
  behavior without digging through networking code.
- Allows deployments to change the default target server without modifying logic.

Operational notes:
- These values are imported by app/main.py (for the default target and admin send)
  and by app/udp.py (for socket timeouts and drain/limit behavior).
================================================================================
"""

# ------------------------------------------------------------------------------
# Default server target
# ------------------------------------------------------------------------------

# The default Raven Shield game server IP that the dashboards will query/control.
# This value is injected into the HTML pages via the __DEFAULT_TARGET__ placeholder
# replacement in app/main.py, so the operator can confirm what the backend is using.
DEFAULT_SERVER_IP = "XXX.XXX.XXX.XXX"

# The UDP port on the Raven Shield server that responds to REPORTEXT queries and
# accepts ADMIN commands (as configured on your game server).
DEFAULT_SERVER_PORT = 8877


# ------------------------------------------------------------------------------
# UDP settings (query + admin)
# ------------------------------------------------------------------------------
# These values control how aggressively we try to talk to the server and how long
# we wait for UDP packets to arrive. UDP is lossy and unordered, so reasonable
# timeouts + retries are important for a good operator experience.

# Socket receive timeout (seconds) used for the *initial* receive window when we
# have not yet gotten any response datagrams. If this is too low, high-latency
# links may time out prematurely. If too high, the UI feels sluggish on failure.
UDP_TIMEOUT_S = 1.2

# Number of times to retry a REPORTEXT query if we receive *no* datagrams back.
# Helps in cases of packet loss or a busy server.
UDP_RETRIES = 3

# Maximum time (seconds) we will spend draining a burst of REPORTEXT datagrams
# after sending the query. This provides an upper bound so we don’t hang forever
# if the server is chatty or the network is noisy.
DRAIN_MAX_S = 0.8

# “Idle stop” window (seconds). Once we have received at least one datagram, we
# keep receiving until there has been no new datagram for this long.
# Lower values return faster but risk truncating multi-packet responses.
IDLE_STOP_S = 0.15


# ------------------------------------------------------------------------------
# Safety limits (memory + worst-case behavior)
# ------------------------------------------------------------------------------
# These protect the web process from runaway UDP responses (or accidental loops),
# ensuring we cap memory/time spent collecting datagrams.

# Hard cap on number of datagrams collected for a single REPORTEXT query.
MAX_DATAGRAMS = 64

# Hard cap on total response bytes collected across all datagrams for a single
# query. If exceeded, draining stops to prevent excessive memory usage.
MAX_TOTAL_BYTES = 256 * 1024  # 256 KB