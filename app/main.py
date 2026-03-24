"""
================================================================================
File: app/main.py
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

What this file does (high-level):
- Creates the FastAPI application instance.
- Serves HTML pages:
  - GET /      -> landing page (index.html)
  - GET /status -> status dashboard (status.html)
  - GET /admin  -> admin dashboard (admin.html)
- Mounts static assets so the browser can fetch /web/* (CSS/JS/images).
- Exposes a status/query JSON endpoint at GET /api/query that:
  1) sends a UDP "REPORTEXT" query to the game server,
  2) parses returned datagrams into key/value pairs,
  3) converts that KV data into a structured JSON response for the UI.
- Exposes admin endpoints (whitelist) that:
  - validate inputs via app/admincommands.py,
  - build UDP "ADMIN ..." payloads,
  - send them to the game server over UDP.

Why the /status and /admin routes exist:
- /web is only for static assets (CSS/JS/images).
- The HTML pages themselves are NOT under /web; they are meant to be served as
  full pages at clean routes (/status and /admin), just like the landing page (/).
- These handlers read the HTML file, inject __DEFAULT_TARGET__, and return it.

Operational context:
- Typically reverse proxied (e.g., Caddy) to Uvicorn.
- Static + HTML are served by this app; JS then calls /api/query and /api/admin/*.
================================================================================
"""

import base64  # Used to return datagrams in a debuggable Base64 form to clients.
from pathlib import Path  # Used for reliable filesystem paths relative to this file.
import logging
import traceback

from fastapi import FastAPI  # The web framework used to build API + HTML endpoints.
from fastapi.responses import HTMLResponse, JSONResponse  # Response helpers.
from fastapi.staticfiles import StaticFiles  # Used to serve static web assets.
from pydantic import BaseModel, Field  # Used for validating request bodies.

logger = logging.getLogger(__name__)

# Configuration for default target server the dashboards interact with.
from .config import DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT

# UDP transport logic: query server status and send admin commands.
from .udp import udp_query_reportext, udp_send_admin_command, udp_query_availablemaps

# Parsing logic: convert raw UDP datagrams into KV pairs and structured output.
from .parse import parse_kv_from_datagrams, build_structured_response, parse_availablemaps_from_datagrams

# allowlisted admin command constructors.
from .admincommands import cmd_set_rt, cmd_set_motd, cmd_load_ini, cmd_say, cmd_restart
from .admincommands import cmd_set_diff_level  # CHANGE: difficulty setter


# -----------------------------------------------------------------------------
# Path setup
# -----------------------------------------------------------------------------

# Directory containing this Python module (app/).
# We use this as an anchor so the app works regardless of the current working dir.
APP_DIR = Path(__file__).resolve().parent

# Directory containing browser-facing resources (HTML/CSS/JS).
# This is where index.html, status.html, admin.html, and /css /js /img live.
WEB_DIR = APP_DIR / "web"


# -----------------------------------------------------------------------------
# FastAPI application
# -----------------------------------------------------------------------------

# Create the FastAPI app with a human-friendly title.
app = FastAPI(title="RVS Status + Admin (Whitelist)")

# Mount the static directory so the browser can load CSS, JS, images, etc.
# Example: /web/css/status.css is served from app/web/css/status.css
app.mount("/web", StaticFiles(directory=str(WEB_DIR)), name="web")


# -----------------------------------------------------------------------------
# Main HTML route
# -----------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def index():
    """
    Serve the landing page (/).

    This function:
    - Reads app/web/index.html from disk
    - Replaces the __DEFAULT_TARGET__ placeholder with DEFAULT_SERVER_IP:PORT
    - Returns HTML so the browser renders it as a page

    Why the replacement matters:
    - It makes the UI self-documenting: operators can immediately see which game
      server the backend is configured to target by default.
    """
    # Read index.html into a string (UTF-8).
    html = (WEB_DIR / "index.html").read_text("utf-8")

    # Inject the default target into HTML so users see current configured target.
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")

    # Return an HTMLResponse so browsers render it as HTML, not as plain text.
    return HTMLResponse(html)


# -----------------------------------------------------------------------------
# Status HTML route
# -----------------------------------------------------------------------------

@app.get("/status", response_class=HTMLResponse)
def status_page():
    """
    Serve the status dashboard page (/status).

    Relationship to the frontend:
    - The HTML structure is in app/web/status.html.
    - The behavior is in /web/js/status.js (loaded by that HTML).
    - status.js calls GET /api/query to fetch live server info.

    Templating behavior:
    - Just like index(), we replace __DEFAULT_TARGET__ so the page displays the
      configured DEFAULT_SERVER_IP:DEFAULT_SERVER_PORT.
    """
    # Read the status dashboard HTML template from disk.
    html = (WEB_DIR / "status.html").read_text("utf-8")

    # Inject the configured default game server target into the HTML.
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")

    # Return HTML for browser rendering.
    return HTMLResponse(html)


# -----------------------------------------------------------------------------
# Admin HTML route
# -----------------------------------------------------------------------------

@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    """
    Serve the admin dashboard page (/admin).

    Relationship to the frontend:
    - The HTML structure is in app/web/admin.html.
    - The behavior is in /web/js/admin.js (loaded by that HTML).
    - admin.js calls POST /api/admin/* endpoints that build and send allowlisted
      UDP ADMIN commands.

    Templating behavior:
    - Replace __DEFAULT_TARGET__ so operators can see where commands will be sent.
    """
    # Read the admin dashboard HTML template from disk.
    html = (WEB_DIR / "admin.html").read_text("utf-8")

    # Inject the configured default game server target into the HTML.
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")

    # Return HTML for browser rendering.
    return HTMLResponse(html)


# -----------------------------------------------------------------------------
# Status/query API
# -----------------------------------------------------------------------------

@app.get("/api/query")
def api_query():
    """
    Query the game server over UDP and return a structured JSON payload.

    On success, the response includes:
    - ok: True
    - meta: UDP timing/byte metadata from udp_query_reportext
    - server/players/maplist: structured representation for the UI
    - kv: raw KV map for debugging
    - datagrams_b64: raw UDP datagrams base64-encoded for deep debugging
    """
    try:
        # Send the UDP REPORTEXT query to the configured default server.
        datagrams, meta = udp_query_reportext(DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT)

        # Parse the UDP response into key/value pairs.
        kv = parse_kv_from_datagrams(datagrams)

        # Convert KV into UI-friendly structured JSON.
        structured = build_structured_response(kv)

        # Return everything a UI or operator might want for diagnostics.
        return JSONResponse(
            {
                "ok": True,
                "meta": meta,
                **structured,
                "kv": kv,
                "datagrams_b64": [base64.b64encode(d).decode("ascii") for d in datagrams],
            }
        )
    except Exception:
        # Convert any error into a JSON response rather than crashing the server.
        # Log full exception details server-side for debugging.
        logging.exception("Error while querying default game server")
        return JSONResponse(
            {
                "ok": False,
                "error": "Internal server error while querying server.",
                "target": {"ip": DEFAULT_SERVER_IP, "port": DEFAULT_SERVER_PORT},
            }
        )


# -----------------------------------------------------------------------------
# Available maps API (read-only)
# -----------------------------------------------------------------------------

@app.get("/api/admin/available_maps")
def api_admin_available_maps():
    """
    Read-only endpoint:
    - Sends AVAILABLEMAPS query (not REPORTEXT, not ADMIN).
    - Returns parsed map list + raw datagrams for debugging.

    This endpoint is intentionally read-only and does not accept user input.
    """
    try:
        datagrams, meta = udp_query_availablemaps(DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT)
        parsed = parse_availablemaps_from_datagrams(datagrams)

        return JSONResponse(
            {
                "ok": True,
                "meta": meta,
                "available_maps": parsed,
                "datagrams_b64": [base64.b64encode(d).decode("ascii") for d in datagrams],
            }
        )
    except Exception:
        logging.exception("Error while retrieving available maps from default game server")
        return JSONResponse(
            {
                "ok": False,
                "error": "Internal server error while retrieving available maps.",
                "target": {"ip": DEFAULT_SERVER_IP, "port": DEFAULT_SERVER_PORT},
            },
            status_code=400,
        )


# -----------------------------------------------------------------------------
# Admin commands (whitelist)
# -----------------------------------------------------------------------------
# The following endpoints accept JSON bodies, validate them, build allowlisted
# UDP ADMIN payloads (never raw user strings), and send them to the game server.

class SetRTBody(BaseModel):
    """
    Request body for setting the server RoundTime.
    """
    seconds: int = Field(..., description="Round time seconds (60..3600)")


class SetMOTDBody(BaseModel):
    """
    Request body for setting Message of the Day.
    """
    motd: str = Field(..., description="MOTD text (<= 30 chars)")


class LoadINIBody(BaseModel):
    """
    Request body for loading an INI base name (without .ini).
    """
    inifile: str = Field(..., description="INI base name (no .ini)")


class SayBody(BaseModel):
    """
    Request body for sending a server chat message as Webadmin.
    """
    msg: str = Field(..., description="Chat message (<= 120 chars)")


# CHANGE: difficulty body
class SetDiffLevelBody(BaseModel):
    """
    Request body for setting server difficulty (DiffLevel).
    """
    level: int = Field(..., description="Difficulty level (1..3)")


def _admin_send(payload: bytes, note: str = ""):
    """
    Internal helper to send a prepared admin payload to the configured server.

    Args:
        payload (bytes): The fully-built UDP payload (already includes ADMIN + pw).
        note (str): Optional human-readable context to return to the caller.

    Returns:
        JSONResponse: Standardized "ok: True" response with UDP metadata.
    """
    # Send the payload over UDP, using a slightly longer timeout to allow a reply.
    meta = udp_send_admin_command(DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT, payload, timeout_s=1.2)

    # Return JSON including where we sent it and any reply details.
    return JSONResponse(
        {
            "ok": True,
            "note": note,
            "target": {"ip": DEFAULT_SERVER_IP, "port": DEFAULT_SERVER_PORT},
            "udp": meta,
        }
    )


@app.post("/api/admin/set_rt")
def api_admin_set_rt(body: SetRTBody):
    """
    allowlisted admin endpoint: set RoundTime.
    """
    try:
        # Convert input into a strict allowlisted UDP command payload.
        payload = cmd_set_rt(body.seconds)

        # Send it and return the standardized response.
        return _admin_send(payload)
    except Exception:
        # Validation errors and runtime errors become 400 for client clarity.
        logger.exception("Error in /api/admin/set_rt")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_motd")
def api_admin_set_motd(body: SetMOTDBody):
    """
    allowlisted admin endpoint: set MOTD.
    """
    try:
        payload = cmd_set_motd(body.motd)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_motd")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/load_ini")
def api_admin_load_ini(body: LoadINIBody):
    """
    allowlisted admin endpoint: load server INI to LOADSERVER.
    """
    try:
        payload = cmd_load_ini(body.inifile)

        # Provide an operator note if the server applies changes asynchronously.
        return _admin_send(payload, note="Allow time for server to apply.")
    except Exception:
        logger.exception("Error in /api/admin/load_ini")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/say")
def api_admin_say(body: SayBody):
    """
    allowlisted admin endpoint: SAY (prefixes as "Webadmin:").
    """
    try:
        payload = cmd_say(body.msg)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/say")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/restart")
def api_admin_restart():
    """
    allowlisted admin endpoint: RESTART.

    No user input: always sends ADMIN <pw> RESTART.
    """
    try:
        payload = cmd_restart()
        return _admin_send(payload, note="Server restart requested.")
    except Exception:
        logger.exception("Error in /api/admin/restart")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


# CHANGE: set difficulty endpoint
@app.post("/api/admin/set_diff_level")
def api_admin_set_diff_level(body: SetDiffLevelBody):
    """
    allowlisted admin endpoint: set server difficulty (DiffLevel).

    Sends: ADMIN <pw> SETSERVEROPTION DiffLevel <n>
    """
    try:
        payload = cmd_set_diff_level(body.level)
        return _admin_send(payload, note="Difficulty level update requested.")
    except Exception:
        logger.exception("Error in /api/admin/set_diff_level")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)