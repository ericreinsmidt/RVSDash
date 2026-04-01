"""
==============================================================================
File: app/ingest.py
Project: RVSDash - Raven Shield Dashboard

Purpose:
- Decomposed ingest logic, extracted from main.py.
- Handles parsing, normalization, SQLite persistence, and NDJSON audit logging
  for incoming URLPost round-end payloads.

Functions:
- parse_request_body: Parse raw HTTP body into a dict.
- normalize_urlpost: Convert flat URLPost dict into structured shape.
- persist_to_sqlite: Write event + per-player stats to SQLite.
- append_ndjson: Write a single JSON line to the audit log.
- build_ingest_record: Assemble the full ingest record from parsed data.
==============================================================================
"""

import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import unquote_plus, unquote_to_bytes

from .rvsstats_db import (
    db_add_player_nick,
    db_auto_resolve_ubi,
    db_get_or_create_player,
    db_insert_ingest_event,
    db_upsert_player_map_stats,
)

logger = logging.getLogger(__name__)


# ---- Parsing ----

def parse_form_fallback(body: bytes) -> Dict[str, Any]:
    """
    Bytes-safe fallback parser for application/x-www-form-urlencoded payloads.

    Important property:
    - DOES NOT percent-decode values.
    - Returns values as text while preserving raw %XX sequences exactly,
      so later stages can do: unquote_to_bytes(v).decode('cp1252').
    """
    b = body or b""
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
        v = v_raw.decode("latin-1", errors="replace")

        if k in out:
            if isinstance(out[k], list):
                out[k].append(v)
            else:
                out[k] = [out[k], v]
        else:
            out[k] = v

    return out


async def parse_request_body(request) -> tuple:
    """
    Parse the ingest request body into a dict.

    Returns:
        (parsed_dict_or_None, parse_kind_string)
    """
    ctype = (request.headers.get("content-type") or "").lower()
    body = await request.body()
    body = body or b""

    if "application/json" in ctype:
        try:
            return (await request.json(), "json")
        except Exception:
            return (None, "json_parse_error")

    if ("application/x-www-form-urlencoded" in ctype) or ("multipart/form-data" in ctype):
        try:
            form = await request.form()
            out: Dict[str, Any] = {}
            for k in form.keys():
                vals = form.getlist(k)
                out[k] = vals[0] if len(vals) == 1 else vals
            return (out, "form")
        except Exception:
            try:
                return (parse_form_fallback(body), "form_fallback")
            except Exception:
                return (None, "form_parse_error")

    return (None, "raw")


# ---- Normalization ----

def _split_urlpost_list(v: Any) -> list:
    """
    URLPost convention: list values are sent like "/a/b/c" (leading slash).
    Empty list may be "" or "/".
    """
    if v is None:
        return []
    s = str(v).strip()
    if not s or s == "/":
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


def normalize_urlpost(d: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Convert legacy URLPost flat dict into a structured shape:
      {
        server: {ident, map, mode, sbpt, vs, rt},
        totals: {t_k, t_d, t_s, t_tk, t_n},
        players: [{idx, name, ubi, start_ubi, ip, kills, deaths,...}],
        warnings: [...]
      }

    This is additive: does NOT mutate the original dict.
    """
    d = d or {}
    warnings: List[dict] = []

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

    players_out: List[dict] = []
    for i in range(n):
        name_i = _decode_urlpost_text(get_i(names, i))
        ubi_i = _decode_urlpost_text(get_i(ubi, i))
        ip_i = get_i(ip, i)
        kb_i = _decode_urlpost_text(get_i(kb, i))

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


# ---- Record building ----

def build_ingest_record(
    request,
    body: bytes,
    parsed: Optional[Dict[str, Any]],
    parse_kind: str,
) -> Dict[str, Any]:
    """
    Assemble the full ingest record with metadata, parsed data,
    and normalized URLPost fields.
    """
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

    return record


# ---- SQLite persistence ----

# NOTE: a different _to_int exists in parse.py (returns None instead of 0)
def _to_int(x: Any) -> int:
    try:
        return int(x)
    except Exception:
        return 0


def persist_to_sqlite(db_path: str, record: Dict[str, Any], parsed: Optional[Dict[str, Any]]) -> bool:
    """
    Persist an ingest record to SQLite.

    Writes:
    - One ingest_events row
    - Per-player: player row, nick, and map stats

    Returns True on success, False on failure.
    """
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

        con = sqlite3.connect(db_path)
        try:
            event = {
                "ts": record.get("ts"),
                "server_ident": server_ident,
                "game_mode": game_mode,
                "map": map_name,
                "raw_json": record,
            }
            event_id = db_insert_ingest_event(con, event)

            for p in players:
                if not isinstance(p, dict):
                    continue

                ubi = str(p.get("ubi") or "").strip()
                nick = str(p.get("name") or "").strip()

                if not server_ident or not ubi:
                    continue

                raw_player_id = db_get_or_create_player(con, server_ident=server_ident, ubi=ubi)

                if nick:
                    db_add_player_nick(con, player_id=raw_player_id, nick=nick)

                resolved_id = db_auto_resolve_ubi(con, server_ident, ubi)
                stats_player_id = resolved_id if resolved_id is not None else raw_player_id

                db_upsert_player_map_stats(
                    con,
                    player_id=stats_player_id,
                    game_mode=game_mode,
                    map_name=map_name,
                    add_kills=_to_int(p.get("kills")),
                    add_deaths=_to_int(p.get("deaths")),
                    add_fired=_to_int(p.get("fired")),
                    add_hits=_to_int(p.get("hits")),
                    add_rounds=1,
                    event_id=event_id,
                )

            con.commit()
        finally:
            con.close()

        return True
    except Exception:
        logger.exception("sqlite persist failed")
        return False


# ---- NDJSON audit log ----

_ingest_dir_ensured = False

def ensure_ingest_dir(path: str) -> None:
    """Ensure the parent directory of the log path exists."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)


def append_ndjson(path: str, obj: Dict[str, Any]) -> None:
    """
    Append a single JSON object as one line of NDJSON.
    Append-only and cheap to write.
    """
    global _ingest_dir_ensured
    if not _ingest_dir_ensured:
        ensure_ingest_dir(path)
        _ingest_dir_ensured = True
    line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")
