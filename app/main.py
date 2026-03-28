"""
================================================================================
File: app/main.py
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

This is the "single source of truth" FastAPI app module.

This corrected version focuses on:
- Predictable configuration (no duplicate/conflicting path variables)
- Exactly ONE /api/ingest endpoint (no route collisions)
- Option B ingest behavior:
  - Always persist to SQLite (system of record)
  - Optionally append NDJSON as a write-ahead/audit log (env toggle)
- Read-only stats APIs for /stats UI

================================================================================
"""

##########################################
# Standard library imports
##########################################

import os
import json
import time
import base64
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, List
from urllib.parse import parse_qs, unquote_to_bytes, unquote_plus

##########################################
# FastAPI imports
##########################################

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

##########################################
# Local app imports
##########################################

# Configuration for default target server the dashboards interact with.
from .config import DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT

# UDP transport logic: query server status and send admin commands.
from .udp import udp_query_reportext, udp_send_admin_command, udp_query_availablemaps

# Parsing logic: convert raw UDP datagrams into KV pairs and structured output.
from .parse import (
    parse_kv_from_datagrams,
    build_structured_response,
    parse_availablemaps_from_datagrams,
)

# Allowlisted admin command constructors.
from .admincommands import cmd_set_rt, cmd_set_motd, cmd_load_ini, cmd_say, cmd_restart
from .admincommands import cmd_set_diff_level

# SQLite persistence helpers for stats storage.
from app.rvsstats_db import (
    db_init,
    db_insert_ingest_event,
    db_get_or_create_player,
    db_add_player_nick,
    db_upsert_player_map_stats,
)

##########################################
# Logging
##########################################

logger = logging.getLogger(__name__)

##########################################
# Paths & configuration (AUTHORITATIVE)
##########################################
# IMPORTANT: This section is the only place these values are defined.
# Do not redefine DB_PATH / INGEST_LOG_PATH later in the file.

# Directory containing this Python module (app/). Anchor all relative paths here.
APP_DIR = Path(__file__).resolve().parent

# Static web assets (HTML/CSS/JS/images) served under /web/*
WEB_DIR = APP_DIR / "web"

# Unify ALL runtime artifacts under app/data/
# - SQLite DB lives here
# - NDJSON ingest log lives here (if enabled)
DATA_DIR = APP_DIR / "data"

# SQLite DB path (system of record)
DB_PATH = DATA_DIR / "rvsstats.sqlite3"

# NDJSON ingest log path (write-ahead/audit log)
INGEST_LOG_PATH = str(DATA_DIR / "ingest.ndjson")

# Allow deployments to override ingest log location (optional).
# If you truly want "everything under app/data", do NOT set RVSDASH_INGEST_LOG elsewhere.
INGEST_LOG_PATH = os.environ.get("RVSDASH_INGEST_LOG", INGEST_LOG_PATH)

# Safety cap to avoid unbounded disk/memory usage for ingestion
MAX_INGEST_BODY_BYTES = int(os.environ.get("RVSDASH_MAX_INGEST_BODY_BYTES", str(256 * 1024)))  # 256 KB

# NDJSON write-ahead/audit log toggle (default: enabled)
# Set RVSDASH_ENABLE_NDJSON_LOG=0 to disable.
ENABLE_NDJSON_LOG = (os.environ.get("RVSDASH_ENABLE_NDJSON_LOG", "1").strip() != "0")

##########################################
# FastAPI application
##########################################

app = FastAPI(title="RVS Status + Admin (Whitelist)")

# Mount static assets so the browser can fetch /web/css/*, /web/js/*, /web/img/* etc.
app.mount("/web", StaticFiles(directory=str(WEB_DIR)), name="web")


@app.on_event("startup")
def _startup_init_db():
    """
    Ensure the SQLite DB exists and schema is present.
    This runs once at process startup.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db_init(DB_PATH)


##########################################
# NDJSON helper functions
##########################################

def _ensure_ingest_dir() -> None:
    """
    Ensure the parent directory of INGEST_LOG_PATH exists.
    This supports the NDJSON write-ahead/audit log when enabled.
    """
    os.makedirs(os.path.dirname(INGEST_LOG_PATH) or ".", exist_ok=True)


def _append_ndjson(path: str, obj: Dict[str, Any]) -> None:
    """
    Append a single JSON object as one line of NDJSON.
    This is intentionally "append-only" and cheap to write.

    NOTE: This function expects a *string path*, not a Path object.
    """
    _ensure_ingest_dir()
    line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


##########################################
# URLPost parsing + normalization (for legacy ingest payloads)
##########################################

def _form_fallback_parse_bytes(body: bytes) -> Dict[str, Any]:
    """
    Bytes-safe fallback parser for application/x-www-form-urlencoded payloads.

    Important property:
    - DOES NOT percent-decode values.
    - Returns values as text while preserving raw %XX sequences exactly,
      so later stages can do: unquote_to_bytes(v).decode('cp1252').
    """
    b = body or b""
    # Observed odd prefix: \r\n&key=...
    b = b.lstrip(b"\r\n\t ").lstrip(b"&")

    out: Dict[str, Any] = {}
    if not b:
        return out

    for part in b.split(b"&"):
        if not part:
            continue
        if b"=" in part:
            k_raw, v_raw = part.split(b"=", 1)
        else:
            k_raw, v_raw = part, b""

        k = k_raw.decode("ascii", errors="replace")

        # Keep value as latin-1 so bytes 0x00-0xFF round-trip; DO NOT unquote here.
        v = v_raw.decode("latin-1", errors="replace")

        if k in out:
            if isinstance(out[k], list):
                out[k].append(v)
            else:
                out[k] = [out[k], v]
        else:
            out[k] = v

    return out


def _split_urlpost_list(v: Any) -> list:
    """
    URLPost convention: list values are sent like "/a/b/c" (leading slash).
    Empty list may be "" or "/".
    """
    if v is None:
        return []
    s = str(v)
    if not s:
        return []
    s = s.strip()
    if s in ("/",):
        return []
    if s.startswith("/"):
        s = s[1:]
    if not s:
        return []
    return s.split("/")


def _as_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        s = str(x).strip()
        if s == "":
            return None
        return int(float(s))
    except Exception:
        return None


def _as_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        s = str(x).strip()
        if s == "":
            return None
        return float(s)
    except Exception:
        return None


def normalize_urlpost(d: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert legacy URLPost flat dict into a structured shape:
      {
        server: {ident, map, mode, sbpt, vs, rt},
        totals: {t_k, t_d, t_s, t_tk, t_n},
        players: [{idx, name, ubi, start_ubi, ip, kills, deaths, hits, fired, ...}],
        warnings: [...]
      }

    This is additive: does NOT mutate the original dict.
    """
    d = d or {}
    warnings = []

    server = {
        "ident": d.get("ident", ""),
        "map": d.get("E1", ""),
        "mode": d.get("F1", ""),
        "sbpt": d.get("SBPT", ""),
        "vs": d.get("VS", ""),
        "rt": _as_float(d.get("RT", "")),
    }

    totals = {
        "t_k": _as_int(d.get("T_K", "")),
        "t_d": _as_int(d.get("T_D", "")),
        "t_s": _as_int(d.get("T_S", "")),
        "t_tk": _as_int(d.get("T_TK", "")),
        "t_n": _as_int(d.get("T_N", "")),
    }

    def _decode_urlpost_text(s: Any) -> str:
        """
        URLPost sometimes sends percent-encoded bytes that are NOT UTF-8.
        Strategy:
        - If string contains '%' then percent-decode to raw bytes and decode using cp1252.
        - Else return as plain string.
        """
        if s is None:
            return ""
        t = str(s)
        if "%" not in t:
            return t
        try:
            b = unquote_to_bytes(t)
            return b.decode("cp1252", errors="replace")
        except Exception:
            return unquote_plus(t)

    # Per-player list fields
    names = _split_urlpost_list(d.get("L1", ""))
    ubi = _split_urlpost_list(d.get("UB", ""))
    start_ubi = _split_urlpost_list(d.get("US", ""))
    ip = _split_urlpost_list(d.get("PGID", ""))

    kills = _split_urlpost_list(d.get("O1", ""))
    deaths = _split_urlpost_list(d.get("DE", ""))
    hits = _split_urlpost_list(d.get("HI", ""))
    fired = _split_urlpost_list(d.get("RF", ""))

    rp = _split_urlpost_list(d.get("RP", ""))
    rs = _split_urlpost_list(d.get("RS", ""))
    hs = _split_urlpost_list(d.get("HS", ""))
    nk = _split_urlpost_list(d.get("NK", ""))
    s1 = _split_urlpost_list(d.get("S1", ""))
    tk = _split_urlpost_list(d.get("TK", ""))
    td = _split_urlpost_list(d.get("TD", ""))
    kb = _split_urlpost_list(d.get("KB", ""))

    lengths = {
        "L1": len(names), "UB": len(ubi), "US": len(start_ubi), "PGID": len(ip),
        "O1": len(kills), "DE": len(deaths), "HI": len(hits), "RF": len(fired),
        "RP": len(rp), "RS": len(rs), "HS": len(hs), "NK": len(nk), "S1": len(s1),
        "TK": len(tk), "TD": len(td), "KB": len(kb),
    }
    n = max(lengths.values() or [0])

    nonzero = {k: v for k, v in lengths.items() if v}
    if nonzero:
        min_len = min(nonzero.values())
        max_len = max(nonzero.values())
        if min_len != max_len:
            warnings.append({"type": "list_length_mismatch", "lengths": nonzero})

    def get_i(arr: list, i: int) -> str:
        return arr[i] if i < len(arr) else ""

    players_out = []
    for i in range(n):
        name_i = _decode_urlpost_text(get_i(names, i))
        ubi_i = _decode_urlpost_text(get_i(ubi, i))
        ip_i = get_i(ip, i)
        kb_i = _decode_urlpost_text(get_i(kb, i))

        # CRITICAL FIX: idx must use "i" not "I"
        players_out.append({
            "idx": i,
            "name": name_i,
            "ubi": ubi_i,
            "start_ubi": _decode_urlpost_text(get_i(start_ubi, i)),
            "ip": ip_i,
            "kills": _as_int(get_i(kills, i)),
            "deaths": _as_int(get_i(deaths, i)),
            "hits": _as_int(get_i(hits, i)),
            "fired": _as_int(get_i(fired, i)),
            "rp": _as_int(get_i(rp, i)),
            "rs": _as_int(get_i(rs, i)),
            "hs": _as_int(get_i(hs, i)),
            "nk": _as_int(get_i(nk, i)),
            "s1": _as_int(get_i(s1, i)),
            "tk": _as_int(get_i(tk, i)),
            "td": _as_int(get_i(td, i)),
            "kb": kb_i,
        })

    return {
        "server": server,
        "totals": totals,
        "players": players_out,
        "warnings": warnings,
    }


##########################################
# Ingest endpoint (ONE route only)
##########################################

@app.post("/api/ingest")
async def api_ingest(request: Request):
    """
    Ingest endpoint (single authoritative handler).

    Behavior:
    1) Parse input (JSON or form) into a dict, with a fallback parser for "weird" URLPost bodies.
    2) Normalize URLPost-style fields into {server, totals, players}.
    3) Persist to SQLite (system of record).
    4) Optionally append to NDJSON audit log (write-ahead log) if ENABLE_NDJSON_LOG=1.

    IMPORTANT:
    - This route is intentionally tolerant:
      - SQLite persist errors are logged but do not necessarily kill the request,
        HOWEVER if NDJSON is enabled and fails, the request should still indicate an error
        (you can change this policy, but this mirrors your earlier behavior).
    """
    body = await request.body()
    body = body or b""

    if len(body) > MAX_INGEST_BODY_BYTES:
        return JSONResponse(
            {"ok": False, "error": f"Body too large (max {MAX_INGEST_BODY_BYTES} bytes)"},
            status_code=413,
        )

    ctype = (request.headers.get("content-type") or "").lower()

    parsed: Optional[Dict[str, Any]] = None
    parse_kind = "raw"

    if "application/json" in ctype:
        try:
            parsed = await request.json()
            parse_kind = "json"
        except Exception:
            parsed = None
            parse_kind = "json_parse_error"
    elif ("application/x-www-form-urlencoded" in ctype) or ("multipart/form-data" in ctype):
        try:
            form = await request.form()
            out: Dict[str, Any] = {}
            for k in form.keys():
                vals = form.getlist(k)
                out[k] = vals[0] if len(vals) == 1 else vals
            parsed = out
            parse_kind = "form"
        except Exception:
            try:
                parsed = _form_fallback_parse_bytes(body)
                parse_kind = "form_fallback"
            except Exception:
                parsed = None
                parse_kind = "form_parse_error"

    now = datetime.now(timezone.utc)
    record: Dict[str, Any] = {
        "ts": now.isoformat(),
        "epoch_ms": int(time.time() * 1000),
        "client": {
            "host": getattr(request.client, "host", None),
            "port": getattr(request.client, "port", None),
        },
        "http": {
            "method": request.method,
            "path": request.url.path,
            "query": str(request.url.query or ""),
            "content_type": request.headers.get("content-type"),
            "user_agent": request.headers.get("user-agent"),
        },
        "parse_kind": parse_kind,
        "data": parsed,
        "raw": body.decode("utf-8", errors="replace"),
    }

    # Add a normalized view for URLPost-style payloads
    try:
        norm_full = normalize_urlpost(parsed if isinstance(parsed, dict) else None)
        record["normalized"] = {
            "server": norm_full.get("server"),
            "totals": norm_full.get("totals"),
            "players": norm_full.get("players"),
        }
        record["normalize_warnings"] = norm_full.get("warnings", [])
    except Exception as e:
        record["normalized"] = None
        record["normalize_warnings"] = [{"type": "normalize_error", "error": str(e)}]

    # Persist to SQLite (system of record).
    # We treat this as best-effort, but in your workflow you likely want it to succeed.
    # If you want to fail the request when SQLite fails, change except behavior.
    sqlite_ok = True
    try:
        norm = record.get("normalized") if isinstance(record.get("normalized"), dict) else {}
        srv = norm.get("server") if isinstance(norm.get("server"), dict) else {}
        players = norm.get("players") if isinstance(norm.get("players"), list) else []

        server_ident = str(srv.get("ident") or "").strip()
        game_mode = str(srv.get("mode") or "").strip()
        map_name = str(srv.get("map") or "").strip()

        # Fallback to raw URLPost keys if normalized missing.
        if isinstance(parsed, dict):
            server_ident = server_ident or str(parsed.get("ident") or "").strip()
            game_mode = game_mode or str(parsed.get("F1") or "").strip()
            map_name = map_name or str(parsed.get("E1") or "").strip()

        con = sqlite3.connect(str(DB_PATH))
        try:
            event = {
                "ts": record.get("ts"),
                "server_ident": server_ident,
                "game_mode": game_mode,
                "map": map_name,
                "raw_json": record,  # store full ingest record
            }
            event_id = db_insert_ingest_event(con, event)

            def to_int(x):
                try:
                    return int(x)
                except Exception:
                    return 0

            for p in players:
                if not isinstance(p, dict):
                    continue

                ubi = str(p.get("ubi") or "").strip()
                nick = str(p.get("name") or "").strip()

                if not server_ident or not ubi:
                    continue

                player_id = db_get_or_create_player(con, server_ident=server_ident, ubi=ubi)
                if nick:
                    db_add_player_nick(con, player_id=player_id, nick=nick)

                db_upsert_player_map_stats(
                    con,
                    player_id=player_id,
                    game_mode=game_mode,
                    map_name=map_name,
                    add_kills=to_int(p.get("kills")),
                    add_deaths=to_int(p.get("deaths")),
                    add_fired=to_int(p.get("fired")),
                    add_hits=to_int(p.get("hits")),
                    add_rounds=1,
                    event_id=event_id,
                )

            con.commit()
        finally:
            con.close()
    except Exception:
        sqlite_ok = False
        logger.exception("sqlite persist failed")

    # NDJSON audit log (optional)
    try:
        if ENABLE_NDJSON_LOG:
            _append_ndjson(INGEST_LOG_PATH, record)
            return {"ok": sqlite_ok, "logged_to": INGEST_LOG_PATH, "parse_kind": parse_kind}
        return {"ok": sqlite_ok, "logged_to": None, "parse_kind": parse_kind}
    except Exception:
        # If the log write fails, log the exception server-side and return a generic error to the client.
        logger.exception("NDJSON log write failed")
        return JSONResponse({"ok": False, "error": "Failed to write log"}, status_code=500)


##########################################
# HTML routes
##########################################

@app.get("/", response_class=HTMLResponse)
def index():
    html = (WEB_DIR / "index.html").read_text("utf-8")
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")
    return HTMLResponse(html)


@app.get("/status", response_class=HTMLResponse)
def status_page():
    html = (WEB_DIR / "status.html").read_text("utf-8")
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")
    return HTMLResponse(html)


@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    html = (WEB_DIR / "admin.html").read_text("utf-8")
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")
    return HTMLResponse(html)


@app.get("/stats", response_class=HTMLResponse)
def stats_page():
    html = (WEB_DIR / "stats.html").read_text("utf-8")
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")
    return HTMLResponse(html)


##########################################
# Stats API (read-only)
##########################################

def _db_con() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    return con


@app.get("/api/stats/servers")
def api_stats_servers(server_ident: Optional[str] = None):
    con = _db_con()
    try:
        where = ""
        args: List[object] = []
        if server_ident:
            where = "WHERE p.server_ident = ?"
            args.append(server_ident)

        rows = con.execute(
            f"""
            SELECT
              p.server_ident AS server_ident,
              SUM(s.kills) AS kills,
              SUM(s.deaths) AS deaths,
              SUM(s.fired) AS fired,
              SUM(s.hits) AS hits,
              SUM(s.rounds_played) AS rounds_played
            FROM player_map_stats s
            JOIN players p ON p.id = s.player_id
            {where}
            GROUP BY p.server_ident
            ORDER BY fired DESC
            """,
            args,
        ).fetchall()

        return {"ok": True, "rows": [dict(r) for r in rows]}
    finally:
        con.close()


@app.get("/api/stats/players")
def api_stats_players(server_ident: Optional[str] = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    con = _db_con()
    try:
        where = ""
        args: List[object] = []
        if server_ident:
            where = "WHERE p.server_ident = ?"
            args.append(server_ident)

        rows = con.execute(
            f"""
            SELECT
              p.server_ident AS server_ident,
              p.ubi AS ubi,
              SUM(s.kills) AS kills,
              SUM(s.deaths) AS deaths,
              SUM(s.fired) AS fired,
              SUM(s.hits) AS hits,
              SUM(s.rounds_played) AS rounds_played
            FROM player_map_stats s
            JOIN players p ON p.id = s.player_id
            {where}
            GROUP BY p.server_ident, p.ubi
            ORDER BY fired DESC
            LIMIT ?
            """,
            [*args, limit],
        ).fetchall()

        return {"ok": True, "rows": [dict(r) for r in rows]}
    finally:
        con.close()


@app.get("/api/stats/maps")
def api_stats_maps(server_ident: Optional[str] = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    con = _db_con()
    try:
        where = ""
        args: List[object] = []
        if server_ident:
            where = "WHERE p.server_ident = ?"
            args.append(server_ident)

        rows = con.execute(
            f"""
            SELECT
              s.map AS map,
              SUM(s.kills) AS kills,
              SUM(s.deaths) AS deaths,
              SUM(s.fired) AS fired,
              SUM(s.hits) AS hits,
              SUM(s.rounds_played) AS rounds_played
            FROM player_map_stats s
            JOIN players p ON p.id = s.player_id
            {where}
            GROUP BY s.map
            ORDER BY fired DESC
            LIMIT ?
            """,
            [*args, limit],
        ).fetchall()

        return {"ok": True, "rows": [dict(r) for r in rows]}
    finally:
        con.close()


@app.get("/api/stats/modes")
def api_stats_modes(server_ident: Optional[str] = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    con = _db_con()
    try:
        where = ""
        args: List[object] = []
        if server_ident:
            where = "WHERE p.server_ident = ?"
            args.append(server_ident)

        rows = con.execute(
            f"""
            SELECT
              s.game_mode AS game_mode,
              SUM(s.kills) AS kills,
              SUM(s.deaths) AS deaths,
              SUM(s.fired) AS fired,
              SUM(s.hits) AS hits,
              SUM(s.rounds_played) AS rounds_played
            FROM player_map_stats s
            JOIN players p ON p.id = s.player_id
            {where}
            GROUP BY s.game_mode
            ORDER BY fired DESC
            LIMIT ?
            """,
            [*args, limit],
        ).fetchall()

        return {"ok": True, "rows": [dict(r) for r in rows]}
    finally:
        con.close()


##########################################
# Status/query API
##########################################

@app.get("/api/query")
def api_query():
    try:
        datagrams, meta = udp_query_reportext(DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT)
        kv = parse_kv_from_datagrams(datagrams)
        structured = build_structured_response(kv)

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
        logging.exception("Error while querying default game server")
        return JSONResponse(
            {
                "ok": False,
                "error": "Internal server error while querying server.",
                "target": {"ip": DEFAULT_SERVER_IP, "port": DEFAULT_SERVER_PORT},
            }
        )


##########################################
# Available maps API (read-only)
##########################################

@app.get("/api/admin/available_maps")
def api_admin_available_maps():
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


##########################################
# Admin commands (whitelist)
##########################################

class SetRTBody(BaseModel):
    seconds: int = Field(..., description="Round time seconds (60..3600)")


class SetMOTDBody(BaseModel):
    motd: str = Field(..., description="MOTD text (<= 30 chars)")


class LoadINIBody(BaseModel):
    inifile: str = Field(..., description="INI base name (no .ini)")


class SayBody(BaseModel):
    msg: str = Field(..., description="Chat message (<= 120 chars)")


class SetDiffLevelBody(BaseModel):
    level: int = Field(..., description="Difficulty level (1..3)")


def _admin_send(payload: bytes, note: str = ""):
    meta = udp_send_admin_command(DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT, payload, timeout_s=1.2)
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
    try:
        payload = cmd_set_rt(body.seconds)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_rt")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_motd")
def api_admin_set_motd(body: SetMOTDBody):
    try:
        payload = cmd_set_motd(body.motd)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_motd")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/load_ini")
def api_admin_load_ini(body: LoadINIBody):
    try:
        payload = cmd_load_ini(body.inifile)
        return _admin_send(payload, note="Allow time for server to apply.")
    except Exception:
        logger.exception("Error in /api/admin/load_ini")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/say")
def api_admin_say(body: SayBody):
    try:
        payload = cmd_say(body.msg)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/say")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/restart")
def api_admin_restart():
    try:
        payload = cmd_restart()
        return _admin_send(payload, note="Server restart requested.")
    except Exception:
        logger.exception("Error in /api/admin/restart")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_diff_level")
def api_admin_set_diff_level(body: SetDiffLevelBody):
    try:
        payload = cmd_set_diff_level(body.level)
        return _admin_send(payload, note="Difficulty level update requested.")
    except Exception:
        logger.exception("Error in /api/admin/set_diff_level")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)