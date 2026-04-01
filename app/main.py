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
- Player alias/merge system for guest ubi fragmentation
- Ingest logic decomposed into app/ingest.py

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
from pathlib import Path
from typing import Any, Dict, Optional, List

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

from .config import (
    DEFAULT_SERVER_IP,
    DEFAULT_SERVER_PORT,
    DEFAULT_SERVER_IDENT,
    NAV_LINKS,
    FOOTER_HTML,
    SITE_TITLE,
    SITE_HEADING,
)

# UDP transport logic: query server status and send admin commands.
from .udp import (
    udp_query_reportext,
    udp_query_availablemaps,
    udp_query_banlist,
    udp_send_admin_command,
)

# Parsing logic: convert raw UDP datagrams into KV pairs and structured output.
from .parse import (
    parse_kv_from_datagrams,
    build_structured_response,
    parse_availablemaps_from_datagrams,
    parse_banlist_from_datagrams,
)

# Allowlisted admin command constructors.
from .admincommands import (
    cmd_set_rt,
    cmd_set_motd,
    cmd_load_ini,
    cmd_say,
    cmd_restart,
    cmd_set_diff_level,
    cmd_kick_ubi,
    cmd_ban_ubi,
    cmd_remove_ban,
    cmd_messtext,
    cmd_restart_match,
    cmd_restart_round,
    cmd_lock_server,
    cmd_set_max_players,
    cmd_save_ini,
    cmd_messenger_toggle,
    cmd_change_map,
    cmd_add_map,
    cmd_remove_map,
    cmd_set_server_name,
    cmd_set_rounds_per_match,
    cmd_set_bomb_time,
    cmd_set_between_round_time,
    cmd_set_terror_count,
    cmd_set_spam_threshold,
    cmd_set_chat_lock_duration,
    cmd_set_vote_broadcast_freq,
    cmd_set_server_option_bool,
)

# SQLite persistence helpers for stats storage.
from .rvsstats_db import (
    db_init,
    db_detect_merge_candidates,
    db_add_player_alias,
    db_get_all_aliases,
    db_remove_alias,
)

# Decomposed ingest logic.
from .ingest import (
    parse_request_body,
    build_ingest_record,
    persist_to_sqlite,
    append_ndjson,
)

##########################################
# Logging
##########################################

logger = logging.getLogger(__name__)

##########################################
# Paths & configuration (AUTHORITATIVE)
##########################################

# Directory containing this Python module (app/). Anchor all relative paths here.
APP_DIR = Path(__file__).resolve().parent

# Static web assets (HTML/CSS/JS/images) served under /web/*
WEB_DIR = APP_DIR / "web"

# Unify ALL runtime artifacts under app/data/
DATA_DIR = APP_DIR / "data"

# SQLite DB path (system of record)
DB_PATH = DATA_DIR / "rvsstats.sqlite3"

# NDJSON ingest log path (write-ahead/audit log)
INGEST_LOG_PATH = str(DATA_DIR / "ingest.ndjson")

# Allow deployments to override ingest log location (optional).
INGEST_LOG_PATH = os.environ.get("RVSDASH_INGEST_LOG", INGEST_LOG_PATH)

# Safety cap to avoid unbounded disk/memory usage for ingestion
MAX_INGEST_BODY_BYTES = int(os.environ.get("RVSDASH_MAX_INGEST_BODY_BYTES", str(256 * 1024)))

# NDJSON write-ahead/audit log toggle (default: enabled)
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

# Cache-bust token: changes every time the app restarts.
_CACHE_BUST = str(int(time.time()))


##########################################
# Ingest endpoint (ONE route only)
##########################################

@app.post("/api/ingest")
async def api_ingest(request: Request):
    """
    Ingest endpoint (single authoritative handler).

    1) Parse input (JSON or form) with fallback for URLPost bodies.
    2) Normalize URLPost fields into {server, totals, players}.
    3) Persist to SQLite (system of record).
    4) Optionally append to NDJSON audit log.
    """
    body = await request.body()
    body = body or b""

    if len(body) > MAX_INGEST_BODY_BYTES:
        return JSONResponse(
            {"ok": False, "error": f"Body too large (max {MAX_INGEST_BODY_BYTES} bytes)"},
            status_code=413,
        )

    parsed, parse_kind = await parse_request_body(request)
    record = build_ingest_record(request, body, parsed, parse_kind)

    sqlite_ok = persist_to_sqlite(str(DB_PATH), record, parsed)

    try:
        if ENABLE_NDJSON_LOG:
            append_ndjson(INGEST_LOG_PATH, record)
            return {"ok": sqlite_ok, "logged_to": INGEST_LOG_PATH, "parse_kind": parse_kind}
        return {"ok": sqlite_ok, "logged_to": None, "parse_kind": parse_kind}
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"Failed to write log: {e}"}, status_code=500)


##########################################
# HTML routes
##########################################

def _build_nav_html() -> str:
    """Build the shared navigation links HTML from config."""
    links = " ".join(
        f'<a href="{href}">{label}</a>' for href, label in NAV_LINKS
    )
    return f'<span>Pages:</span> {links}'


def _build_footer_html() -> str:
    """Build the shared footer HTML from config."""
    return f'<footer class="siteFooter">{FOOTER_HTML}</footer>'


def _render_html(filename: str) -> HTMLResponse:
    """Read an HTML file, inject shared fragments and config values."""
    html = (WEB_DIR / filename).read_text("utf-8")
    html = html.replace("__DEFAULT_TARGET__", f"{DEFAULT_SERVER_IP}:{DEFAULT_SERVER_PORT}")
    html = html.replace("__CACHE_BUST__", _CACHE_BUST)
    html = html.replace("__NAV__", _build_nav_html())
    html = html.replace("__FOOTER__", _build_footer_html())
    html = html.replace("__SITE_TITLE__", SITE_TITLE)
    html = html.replace("__SITE_HEADING__", SITE_HEADING)
    html = html.replace("__SERVER_IDENT__", DEFAULT_SERVER_IDENT)
    return HTMLResponse(html)


@app.get("/", response_class=HTMLResponse)
def index():
    return _render_html("index.html")


@app.get("/status", response_class=HTMLResponse)
def status_page():
    return _render_html("status.html")


@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    return _render_html("admin.html")


@app.get("/stats", response_class=HTMLResponse)
def stats_page():
    return _render_html("stats.html")


@app.get("/player", response_class=HTMLResponse)
def player_page():
    return _render_html("player.html")


##########################################
# Stats API (read-only, alias-aware)
##########################################

from contextlib import contextmanager

@contextmanager
def _db_ctx():
    """Context manager for read-only stats queries."""
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    try:
        yield con
    finally:
        con.close()


def _stats_query(
    select_cols: str,
    group_by: str,
    order_by: str = "fired DESC",
    server_ident: Optional[str] = None,
    limit: Optional[int] = None,
    where_table: str = "p2",
) -> dict:
    """
    Shared stats query builder.

    All stats queries share the same JOIN structure (player_map_stats → players → aliases).
    This helper builds and executes the query, returning {"ok": True, "rows": [...]}.
    """
    try:
        with _db_ctx() as con:
            conditions = [f"p2.ubi NOT LIKE 'JOHNDOE%'"]
            args: List[object] = []
            if server_ident:
                conditions.append(f"{where_table}.server_ident = ?")
                args.append(server_ident)
            where = "WHERE " + " AND ".join(conditions)

            sql = f"""
                SELECT {select_cols}
                FROM player_map_stats s
                JOIN players p ON p.id = s.player_id
                LEFT JOIN player_aliases pa ON pa.alias_player_id = p.id
                JOIN players p2 ON p2.id = COALESCE(pa.canonical_player_id, p.id)
                {where}
                GROUP BY {group_by}
                ORDER BY {order_by}
            """

            if limit is not None:
                sql += " LIMIT ?"
                args.append(limit)

            rows = con.execute(sql, args).fetchall()
            return {"ok": True, "rows": [dict(r) for r in rows]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/stats/servers")
def api_stats_servers(server_ident: Optional[str] = None):
    return _stats_query(
        select_cols="""
            p2.server_ident AS server_ident,
            SUM(s.kills) AS kills,
            SUM(s.deaths) AS deaths,
            SUM(s.fired) AS fired,
            SUM(s.hits) AS hits,
            SUM(s.rounds_played) AS rounds_played
        """,
        group_by="p2.server_ident",
        order_by="fired DESC",
        server_ident=server_ident,
    )


@app.get("/api/stats/players")
def api_stats_players(server_ident: Optional[str] = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    return _stats_query(
        select_cols="""
            p2.server_ident AS server_ident,
            p2.ubi AS ubi,
            SUM(s.kills) AS kills,
            SUM(s.deaths) AS deaths,
            SUM(s.fired) AS fired,
            SUM(s.hits) AS hits,
            SUM(s.rounds_played) AS rounds_played,
            CAST(
              (
                (
                  ( (CAST(SUM(s.kills) AS REAL) / MAX(SUM(s.deaths), 1)) * 1000.0 * (SUM(s.rounds_played) / 500.0) )
                  + ( (CAST(SUM(s.hits) AS REAL) / MAX(SUM(s.fired), 1)) * 50.0 * (SUM(s.rounds_played) / 500.0) )
                  + ( (CAST(SUM(s.kills) AS REAL) / MAX(SUM(s.deaths), 1)) * 1000.0 )
                  + ( (CAST(SUM(s.hits) AS REAL) / MAX(SUM(s.fired), 1)) * 40.0 )
                  + SUM(s.rounds_played)
                )
                * CASE
                    WHEN SUM(s.rounds_played) < 10  THEN 0.1
                    WHEN SUM(s.rounds_played) < 20  THEN 0.2
                    WHEN SUM(s.rounds_played) < 30  THEN 0.4
                    WHEN SUM(s.rounds_played) < 50  THEN 0.6
                    WHEN SUM(s.rounds_played) < 100 THEN 0.8
                    ELSE 1.0
                  END
              ) AS INTEGER
            ) AS score
        """,
        group_by="COALESCE(pa.canonical_player_id, p.id)",
        order_by="score DESC",
        server_ident=server_ident,
        limit=limit,
    )


@app.get("/api/stats/maps")
def api_stats_maps(server_ident: Optional[str] = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    return _stats_query(
        select_cols="""
            s.map AS map,
            SUM(s.kills) AS kills,
            SUM(s.deaths) AS deaths,
            SUM(s.fired) AS fired,
            SUM(s.hits) AS hits,
            SUM(s.rounds_played) AS rounds_played
        """,
        group_by="s.map",
        order_by="fired DESC",
        server_ident=server_ident,
        limit=limit,
    )


@app.get("/api/stats/modes")
def api_stats_modes(server_ident: Optional[str] = None, limit: int = 200):
    limit = max(1, min(int(limit or 200), 1000))
    return _stats_query(
        select_cols="""
            s.game_mode AS game_mode,
            SUM(s.kills) AS kills,
            SUM(s.deaths) AS deaths,
            SUM(s.fired) AS fired,
            SUM(s.hits) AS hits,
            SUM(s.rounds_played) AS rounds_played
        """,
        group_by="s.game_mode",
        order_by="fired DESC",
        server_ident=server_ident,
        limit=limit,
    )


@app.get("/api/stats/player_nicks")
def api_stats_player_nicks(ubi: str = "", server_ident: str = ""):
    """
    Return all known nicknames for a player (by ubi name).
    Resolves aliases so merged players show all nicks from all linked accounts.
    """
    if not ubi:
        return {"ok": False, "error": "ubi parameter required"}

    try:
        with _db_ctx() as con:
            where_si = "AND server_ident = ?" if server_ident else ""
            args: List[object] = [ubi]
            if server_ident:
                args.append(server_ident)

            row = con.execute(
                f"SELECT id FROM players WHERE ubi = ? {where_si} LIMIT 1",
                args,
            ).fetchone()

            if not row:
                return {"ok": True, "ubi": ubi, "nicks": [], "aliases": []}

            player_id = int(row[0])

            canon_row = con.execute(
                "SELECT canonical_player_id FROM player_aliases WHERE alias_player_id = ?",
                (player_id,),
            ).fetchone()
            canonical_id = int(canon_row[0]) if canon_row else player_id

            alias_rows = con.execute(
                "SELECT alias_player_id FROM player_aliases WHERE canonical_player_id = ?",
                (canonical_id,),
            ).fetchall()
            all_ids = [canonical_id] + [int(r[0]) for r in alias_rows]

            placeholders = ",".join("?" * len(all_ids))
            nick_rows = con.execute(
                f"""
                SELECT DISTINCT pn.nick
                FROM player_nicks pn
                WHERE pn.player_id IN ({placeholders})
                ORDER BY pn.nick
                """,
                all_ids,
            ).fetchall()
            nicks = [r[0] for r in nick_rows]

            alias_ubi_rows = con.execute(
                f"""
                SELECT DISTINCT p.ubi
                FROM players p
                WHERE p.id IN ({placeholders}) AND p.ubi != ?
                ORDER BY p.ubi
                """,
                all_ids + [ubi],
            ).fetchall()
            aliases = [r[0] for r in alias_ubi_rows]

            return {"ok": True, "ubi": ubi, "nicks": nicks, "aliases": aliases}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/stats/player_detail")
def api_stats_player_detail(ubi: str = "", server_ident: str = ""):
    """
    Full detail for a single player: totals, per-map breakdown, per-mode breakdown,
    nicks, and aliases. Resolves through alias merges.
    """
    if not ubi:
        return {"ok": False, "error": "ubi parameter required"}

    if ubi.upper().startswith("JOHNDOE"):
        return {"ok": True, "ubi": ubi, "found": False}

    try:
        with _db_ctx() as con:
            where_si = "AND server_ident = ?" if server_ident else ""
            args: List[object] = [ubi]
            if server_ident:
                args.append(server_ident)

            row = con.execute(
                f"SELECT id FROM players WHERE ubi = ? {where_si} LIMIT 1",
                args,
            ).fetchone()

            if not row:
                return {"ok": True, "ubi": ubi, "found": False}

            player_id = int(row[0])

            canon_row = con.execute(
                "SELECT canonical_player_id FROM player_aliases WHERE alias_player_id = ?",
                (player_id,),
            ).fetchone()
            canonical_id = int(canon_row[0]) if canon_row else player_id

            canon_ubi_row = con.execute(
                "SELECT ubi, server_ident FROM players WHERE id = ?",
                (canonical_id,),
            ).fetchone()
            canonical_ubi = canon_ubi_row[0] if canon_ubi_row else ubi
            canonical_si = canon_ubi_row[1] if canon_ubi_row else server_ident

            alias_rows = con.execute(
                "SELECT alias_player_id FROM player_aliases WHERE canonical_player_id = ?",
                (canonical_id,),
            ).fetchall()
            all_ids = [canonical_id] + [int(r[0]) for r in alias_rows]
            placeholders = ",".join("?" * len(all_ids))

            # Totals
            totals_row = con.execute(
                f"""
                SELECT
                    SUM(s.kills) AS kills,
                    SUM(s.deaths) AS deaths,
                    SUM(s.fired) AS fired,
                    SUM(s.hits) AS hits,
                    SUM(s.rounds_played) AS rounds_played
                FROM player_map_stats s
                WHERE s.player_id IN ({placeholders})
                """,
                all_ids,
            ).fetchone()

            kills = int(totals_row[0] or 0)
            deaths = int(totals_row[1] or 0)
            fired = int(totals_row[2] or 0)
            hits = int(totals_row[3] or 0)
            rounds_played = int(totals_row[4] or 0)

            # Compute score
            ratio = kills / max(deaths, 1)
            acc = hits / max(fired, 1)
            rounds_adds = rounds_played / 500.0

            if rounds_played < 10:
                pen = 0.1
            elif rounds_played < 20:
                pen = 0.2
            elif rounds_played < 30:
                pen = 0.4
            elif rounds_played < 50:
                pen = 0.6
            elif rounds_played < 100:
                pen = 0.8
            else:
                pen = 1.0

            score = int((
                (ratio * 1000 * rounds_adds)
                + (acc * 50 * rounds_adds)
                + (ratio * 1000)
                + (acc * 40)
                + rounds_played
            ) * pen)

            totals = {
                "kills": kills,
                "deaths": deaths,
                "fired": fired,
                "hits": hits,
                "rounds_played": rounds_played,
                "score": score,
                "kd_ratio": round(ratio, 2),
                "accuracy": round(acc * 100, 1),
            }

            # Per-map breakdown
            map_rows = con.execute(
                f"""
                SELECT
                    s.map AS map,
                    SUM(s.kills) AS kills,
                    SUM(s.deaths) AS deaths,
                    SUM(s.fired) AS fired,
                    SUM(s.hits) AS hits,
                    SUM(s.rounds_played) AS rounds_played
                FROM player_map_stats s
                WHERE s.player_id IN ({placeholders})
                GROUP BY s.map
                ORDER BY SUM(s.kills) DESC
                """,
                all_ids,
            ).fetchall()
            by_map = [dict(r) for r in map_rows]

            # Per-mode breakdown
            mode_rows = con.execute(
                f"""
                SELECT
                    s.game_mode AS game_mode,
                    SUM(s.kills) AS kills,
                    SUM(s.deaths) AS deaths,
                    SUM(s.fired) AS fired,
                    SUM(s.hits) AS hits,
                    SUM(s.rounds_played) AS rounds_played
                FROM player_map_stats s
                WHERE s.player_id IN ({placeholders})
                GROUP BY s.game_mode
                ORDER BY SUM(s.kills) DESC
                """,
                all_ids,
            ).fetchall()
            by_mode = [dict(r) for r in mode_rows]

            # Nicks
            nick_rows = con.execute(
                f"""
                SELECT DISTINCT pn.nick
                FROM player_nicks pn
                WHERE pn.player_id IN ({placeholders})
                ORDER BY pn.nick
                """,
                all_ids,
            ).fetchall()
            nicks = [r[0] for r in nick_rows]

            # Alias ubis
            alias_ubi_rows = con.execute(
                f"""
                SELECT DISTINCT p.ubi
                FROM players p
                WHERE p.id IN ({placeholders}) AND p.ubi != ?
                ORDER BY p.ubi
                """,
                all_ids + [canonical_ubi],
            ).fetchall()
            aliases = [r[0] for r in alias_ubi_rows]

            return {
                "ok": True,
                "found": True,
                "ubi": canonical_ubi,
                "server_ident": canonical_si,
                "totals": totals,
                "by_map": by_map,
                "by_mode": by_mode,
                "nicks": nicks,
                "aliases": aliases,
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/stats/last_rounds")
def api_stats_last_rounds(server_ident: str = "", limit: int = 5):
    """
    Return the last N rounds (with players) for a given server,
    with per-player stats extracted from the raw ingest JSON.
    """
    if not server_ident:
        return {"ok": False, "error": "server_ident required"}

    if limit < 1:
        limit = 1
    if limit > 20:
        limit = 20

    try:
        with _db_ctx() as con:
            rounds = []
            offset = 0
            batch_size = 10

            while len(rounds) < limit and offset < 100:
                rows = con.execute(
                    """
                    SELECT id, ts, server_ident, game_mode, map, raw_json
                    FROM ingest_events
                    WHERE server_ident = ?
                    ORDER BY id DESC
                    LIMIT ? OFFSET ?
                    """,
                    (server_ident, batch_size, offset),
                ).fetchall()

                if not rows:
                    break

                offset += len(rows)

                for r in rows:
                    raw = r["raw_json"]
                    if isinstance(raw, str):
                        try:
                            raw = json.loads(raw)
                        except Exception:
                            raw = {}
                    elif not isinstance(raw, dict):
                        raw = {}

                    norm = raw.get("normalized") or {}
                    srv = norm.get("server") or {}
                    players_raw = norm.get("players") or []

                    rt = srv.get("rt")
                    if rt is not None:
                        try:
                            rt = float(rt)
                        except Exception:
                            rt = None

                    players = []
                    for p in players_raw:
                        if not isinstance(p, dict):
                            continue
                        name = p.get("name", "")
                        ubi = p.get("ubi", "")
                        if not name and not ubi:
                            continue
                        players.append({
                            "name": name,
                            "ubi": ubi,
                            "kills": p.get("kills"),
                            "deaths": p.get("deaths"),
                            "hits": p.get("hits"),
                            "fired": p.get("fired"),
                        })

                    # Skip rounds with no players
                    if not players:
                        continue

                    rounds.append({
                        "event_id": r["id"],
                        "ts": r["ts"],
                        "map": r["map"],
                        "game_mode": r["game_mode"],
                        "round_time": rt,
                        "players": players,
                    })

                    # Stop once we have enough
                    if len(rounds) >= limit:
                        break

            return {"ok": True, "rounds": rounds}
    except Exception as e:
        return {"ok": False, "error": str(e)}


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

class MaxPlayersBody(BaseModel):
    max_players: int = Field(..., description="Max players (1..16)")

class LockServerBody(BaseModel):
    password: str = Field("", description="Game password (empty to disable)")

class SaveINIBody(BaseModel):
    inifile: str = Field(..., description="INI base name (no.ini)")

class ChangeMapBody(BaseModel):
    index: int = Field(..., description="Map rotation index (1-based)")

class AddMapBody(BaseModel):
    map_name: str = Field(..., description="Map name")
    game_type: str = Field(..., description="Game type identifier")
    position: int = Field(..., description="Position in rotation (1-based)")

class RemoveMapBody(BaseModel):
    index: int = Field(..., description="Map rotation index to remove (1-based)")

class ClearRotationBody(BaseModel):
    count: int = Field(..., description="Total maps in rotation (keeps map #1, removes 2..count)")

class MessTextBody(BaseModel):
    slot: int = Field(..., description="Messenger line (0, 1, or 2)")
    text: str = Field(..., description="Messenger text (<= 100 chars)")

class BanUbiBody(BaseModel):
    ubi: str = Field(..., description="UBI name of the player to ban")

class RemoveBanBody(BaseModel):
    ban_value: str = Field(..., description="Ban entry to remove (GUID or IP)")

class KickUbiBody(BaseModel):
    ubi: str = Field(..., description="UBI name of the player to kick")

class SetRTBody(BaseModel):
    seconds: int = Field(..., description="Round time seconds (60..3600)")

class SetMOTDBody(BaseModel):
    motd: str = Field(..., description="MOTD text (<= 30 chars)")

class LoadINIBody(BaseModel):
    inifile: str = Field(..., description="INI base name (no.ini)")

class SayBody(BaseModel):
    msg: str = Field(..., description="Chat message (<= 120 chars)")

class SetDiffLevelBody(BaseModel):
    level: int = Field(..., description="Difficulty level (1..3)")

class SetServerNameBody(BaseModel):
    name: str = Field(..., description="Server name (<= 30 chars)")

class SetRoundsPerMatchBody(BaseModel):
    rounds: int = Field(..., description="Rounds per match (1..20)")

class SetBombTimeBody(BaseModel):
    seconds: int = Field(..., description="Bomb time in seconds (30..60)")

class SetBetweenRoundTimeBody(BaseModel):
    seconds: int = Field(..., description="Between-round time in seconds (0..99)")

class SetTerrorCountBody(BaseModel):
    count: int = Field(..., description="Terrorist count (5..40)")

class SetSpamThresholdBody(BaseModel):
    value: int = Field(..., description="Spam threshold (0..999)")

class SetChatLockDurationBody(BaseModel):
    value: int = Field(..., description="Chat lock duration (0..999)")

class SetVoteBroadcastFreqBody(BaseModel):
    value: int = Field(..., description="Vote broadcast max frequency (0..999)")

class SetServerOptionBoolBody(BaseModel):
    option: str = Field(..., description="Server option name from allowlist")
    value: bool = Field(..., description="True or False")

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

@app.post("/api/admin/restart_match")
def api_admin_restart_match():
    try:
        payload = cmd_restart_match()
        return _admin_send(payload, note="Restart match command sent.")
    except Exception:
        logger.exception("Error in /api/admin/restart_match")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/restart_round")
def api_admin_restart_round():
    try:
        payload = cmd_restart_round()
        return _admin_send(payload, note="Restart round command sent.")
    except Exception:
        logger.exception("Error in /api/admin/restart_round")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/lock_server")
def api_admin_lock_server(body: LockServerBody):
    try:
        payload = cmd_lock_server(body.password)
        note = "Game password enabled." if body.password else "Game password disabled."
        return _admin_send(payload, note=note)
    except Exception:
        logger.exception("Error in /api/admin/lock_server")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_max_players")
def api_admin_set_max_players(body: MaxPlayersBody):
    try:
        payload = cmd_set_max_players(body.max_players)
        return _admin_send(payload, note=f"Max players set to {body.max_players}.")
    except Exception:
        logger.exception("Error in /api/admin/set_max_players")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/save_ini")
def api_admin_save_ini(body: SaveINIBody):
    try:
        payload = cmd_save_ini(body.inifile)
        return _admin_send(payload, note=f"Save server config to {body.inifile}.ini sent.")
    except Exception:
        logger.exception("Error in /api/admin/save_ini")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/messenger_toggle")
def api_admin_messenger_toggle():
    try:
        payload = cmd_messenger_toggle()
        return _admin_send(payload, note="Messenger toggled.")
    except Exception:
        logger.exception("Error in /api/admin/messenger_toggle")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/change_map")
def api_admin_change_map(body: ChangeMapBody):
    try:
        payload = cmd_change_map(body.index)
        return _admin_send(payload, note=f"Change to map #{body.index} sent.")
    except Exception:
        logger.exception("Error in /api/admin/change_map")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/add_map")
def api_admin_add_map(body: AddMapBody):
    try:
        payload = cmd_add_map(body.map_name, body.game_type, body.position)
        return _admin_send(payload, note=f"Add map {body.map_name} at position {body.position} sent.")
    except Exception:
        logger.exception("Error in /api/admin/add_map")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/remove_map")
def api_admin_remove_map(body: RemoveMapBody):
    try:
        payload = cmd_remove_map(body.index)
        return _admin_send(payload, note=f"Remove map #{body.index} sent.")
    except Exception:
        logger.exception("Error in /api/admin/remove_map")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/clear_rotation")
def api_admin_clear_rotation(body: ClearRotationBody):
    """Remove maps 2 through N, leaving only map #1 in the rotation."""
    try:
        count = body.count
        if count < 2:
            return JSONResponse(
                {"ok": False, "error": "Nothing to remove (need at least 2 maps)"},
                status_code=400,
            )
        if count > 32:
            return JSONResponse(
                {"ok": False, "error": "Count exceeds max rotation size (32)"},
                status_code=400,
            )

        results = []
        for i in range(count - 1):
            payload = cmd_remove_map(2)
            meta = udp_send_admin_command(
                DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT, payload, timeout_s=0.5
            )
            results.append(meta)

        return JSONResponse({
            "ok": True,
            "note": f"Removed {count - 1} map(s) from rotation (kept map #1).",
            "target": {"ip": DEFAULT_SERVER_IP, "port": DEFAULT_SERVER_PORT},
            "removed": count - 1,
            "results": results,
        })
    except Exception:
        logger.exception("Error in /api/admin/clear_rotation")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/messtext")
def api_admin_messtext(body: MessTextBody):
    try:
        payload = cmd_messtext(body.slot, body.text)
        return _admin_send(payload, note=f"Messenger text {body.slot} set.")
    except Exception:
        logger.exception("Error in /api/admin/messtext")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)

@app.post("/api/admin/ban")
def api_admin_ban(body: BanUbiBody):
    try:
        payload = cmd_ban_ubi(body.ubi)
        return _admin_send(payload, note="Ban command sent.")
    except Exception:
        logger.exception("Error in /api/admin/ban")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)

@app.get("/api/admin/banlist")
def api_admin_banlist():
    try:
        datagrams, meta = udp_query_banlist(DEFAULT_SERVER_IP, DEFAULT_SERVER_PORT)
        parsed = parse_banlist_from_datagrams(datagrams)

        return JSONResponse(
            {
                "ok": True,
                "meta": meta,
                "banlist": parsed,
            }
        )
    except Exception:
        logging.exception("Error while retrieving ban list from default game server")
        return JSONResponse(
            {
                "ok": False,
                "error": "Internal server error while retrieving ban list.",
                "target": {"ip": DEFAULT_SERVER_IP, "port": DEFAULT_SERVER_PORT},
            },
            status_code=400,
        )

@app.post("/api/admin/remove_ban")
def api_admin_remove_ban(body: RemoveBanBody):
    try:
        payload = cmd_remove_ban(body.ban_value)
        return _admin_send(payload, note="Remove ban command sent.")
    except Exception:
        logger.exception("Error in /api/admin/remove_ban")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)

@app.post("/api/admin/kick")
def api_admin_kick(body: KickUbiBody):
    try:
        payload = cmd_kick_ubi(body.ubi)
        return _admin_send(payload, note="Kick command sent.")
    except Exception:
        logger.exception("Error in /api/admin/kick")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)

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


@app.post("/api/admin/set_server_name")
def api_admin_set_server_name(body: SetServerNameBody):
    try:
        payload = cmd_set_server_name(body.name)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_server_name")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_rounds_per_match")
def api_admin_set_rounds_per_match(body: SetRoundsPerMatchBody):
    try:
        payload = cmd_set_rounds_per_match(body.rounds)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_rounds_per_match")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_bomb_time")
def api_admin_set_bomb_time(body: SetBombTimeBody):
    try:
        payload = cmd_set_bomb_time(body.seconds)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_bomb_time")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_between_round_time")
def api_admin_set_between_round_time(body: SetBetweenRoundTimeBody):
    try:
        payload = cmd_set_between_round_time(body.seconds)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_between_round_time")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_terror_count")
def api_admin_set_terror_count(body: SetTerrorCountBody):
    try:
        payload = cmd_set_terror_count(body.count)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_terror_count")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_spam_threshold")
def api_admin_set_spam_threshold(body: SetSpamThresholdBody):
    try:
        payload = cmd_set_spam_threshold(body.value)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_spam_threshold")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_chat_lock_duration")
def api_admin_set_chat_lock_duration(body: SetChatLockDurationBody):
    try:
        payload = cmd_set_chat_lock_duration(body.value)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_chat_lock_duration")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_vote_broadcast_freq")
def api_admin_set_vote_broadcast_freq(body: SetVoteBroadcastFreqBody):
    try:
        payload = cmd_set_vote_broadcast_freq(body.value)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_vote_broadcast_freq")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)


@app.post("/api/admin/set_server_option_bool")
def api_admin_set_server_option_bool(body: SetServerOptionBoolBody):
    try:
        payload = cmd_set_server_option_bool(body.option, body.value)
        return _admin_send(payload)
    except Exception:
        logger.exception("Error in /api/admin/set_server_option_bool")
        return JSONResponse({"ok": False, "error": "Internal error"}, status_code=400)

##########################################
# Alias / merge management endpoints
##########################################

@app.get("/api/admin/merge_candidates")
def api_merge_candidates():
    """Detect players that look like fragmented guest ubis."""
    try:
        with _db_ctx() as con:
            candidates = db_detect_merge_candidates(con)
            return {"ok": True, "candidates": candidates}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/merge_apply")
async def api_merge_apply(request: Request):
    """
    Apply a merge: set canonical_player_id for a list of alias_player_ids.

    Body:
    {
      "canonical_player_id": 4,
      "alias_player_ids": [20, 21, 22,...]
    }
    """
    try:
        body = await request.json()
        canonical_id = int(body["canonical_player_id"])
        alias_ids = body.get("alias_player_ids", [])

        with _db_ctx() as con:
            created = 0
            for aid in alias_ids:
                if db_add_player_alias(con, canonical_id, int(aid)):
                    created += 1
            con.commit()

        return {"ok": True, "created": created, "canonical_player_id": canonical_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/admin/aliases")
def api_aliases():
    """List all current alias mappings."""
    try:
        with _db_ctx() as con:
            aliases = db_get_all_aliases(con)
            return {"ok": True, "aliases": aliases}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/merge_remove")
async def api_merge_remove(request: Request):
    """
    Remove an alias mapping.

    Body:
    {
      "alias_player_id": 20
    }
    """
    try:
        body = await request.json()
        alias_id = int(body["alias_player_id"])

        with _db_ctx() as con:
            removed = db_remove_alias(con, alias_id)
            con.commit()

        return {"ok": True, "removed": removed}
    except Exception as e:
        return {"ok": False, "error": str(e)}