"""
================================================================================
File: app/config.py
Project: RVSDash - Raven Shield Dashboard
Author: Eric Reinsmidt

Purpose:
- Centralizes configuration constants used across the backend.
- Defines the default Raven Shield server target (IP + UDP port).
- Defines UDP behavior tuning knobs (timeouts, retries, limits).
- Defines site branding, navigation, and footer content.

Notes:
- Imported by app/main.py and app/udp.py.
================================================================================
"""

# ------------------------------------------------------------------------------
# Default server target
# ------------------------------------------------------------------------------

# The default Raven Shield game server IP that the dashboards will query/control.
# This value is injected into the HTML pages via the __DEFAULT_TARGET__ placeholder
# replacement in app/main.py, so the operator can confirm what the backend is using.
DEFAULT_SERVER_IP = "123.123.123.123"

# The UDP port on the Raven Shield server that responds to REPORTEXT queries and
# accepts ADMIN commands (as configured on your game server).
DEFAULT_SERVER_PORT = 8877

# The server_ident string used by the URLPost ingest system.
# This must match the "ident" field sent by the game server's URLPost config.
# Used by the status page to fetch recent round history.
DEFAULT_SERVER_IDENT = "YOUR_UNIQUE_SERVER_IDENT"

# ------------------------------------------------------------------------------
# Site branding
# ------------------------------------------------------------------------------

# Page title prefix shown in the browser tab.
# Each page appends its own suffix (e.g., "Raven Shield Dashboard — Status").
SITE_TITLE = "Raven Shield"

# H1 heading prefix shown at the top of each page.
# Each page appends its own context (e.g., "Raven Shield Status").
SITE_HEADING = "Raven Shield"


# ------------------------------------------------------------------------------
# Site navigation + footer
# ------------------------------------------------------------------------------

# Navigation links shown on every page.
# Each entry is (href, label). Order matters — rendered left to right.
# Change these if your deployment uses a reverse proxy with different paths,
# or if you want to add/remove pages.
NAV_LINKS = [
    ("/", "/main"),
    ("/status", "/status"),
    ("/stats", "/statistics"),
    ("/admin", "/administration"),
]

# Footer HTML content (shared across all pages).
# This is injected raw — HTML entities are fine.
# This MUST REMAIN UNALTERED on any installation as written.
FOOTER_HTML = '&copy; 2026 <a href="https://obsoletesuperstars.com">geekstrada</a>. Uses N4Admin &amp; URLPost &copy; 2004 Neil Popplewell. Uses N4IDMod &copy; 2020 <a href="https://dateranoth.com">Dateranoth</a>.'

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