#!/usr/bin/env python3
"""
================================================================================
File: tools/import_existing_ndjson.py
Project: RVSDash - Raven Shield Dashboard
Author: Eric Reinsmidt

Purpose:
- Safe-to-re-run importer for existing ingest NDJSON -> SQLite.

- Reads NDJSON line-by-line (one JSON object per line).
- Uses sha256(raw_line) stored in SQLite table import_seen to skip duplicates.
- Inserts ingest_events + per-player upserts (players, player_nicks, player_map_stats).
- Auto-resolves fragmented guest accounts (Player_XXXXXXXX) via db_auto_resolve_ubi,
  matching the live ingest path.

Expected record shape (matches your sample NDJSON):
- ts (ISO string)
- data.ident / data.F1 / data.E1 (optional)
- normalized.server.ident / normalized.server.map / normalized.server.mode (optional)
- normalized.players[] with fields like:
  - ubi, name, kills, deaths, hits, fired

Run:
  python3 tools/import_existing_ndjson.py \
    --ndjson app/data/ingest.ndjson \
    --db app/data/rvsstats.sqlite3
================================================================================
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


def _to_int(x: Any) -> int:
    try:
        return int(x)
    except Exception:
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ndjson", required=True, help="Path to existing NDJSON file")
    ap.add_argument("--db", required=True, help="Path to SQLite DB file")
    ap.add_argument("--max-lines", type=int, default=0, help="Debug cap (0 = no cap)")
    args = ap.parse_args()

    ndjson_path = Path(args.ndjson)
    db_path = Path(args.db)

    # Import helpers from your app module.
    # If your module path is different, adjust the import accordingly.
    from app.rvsstats_db import (
        db_init,
        db_record_seen_hash,
        db_insert_ingest_event,
        db_get_or_create_player,
        db_add_player_nick,
        db_auto_resolve_ubi,
        db_upsert_player_map_stats,
    )

    db_init(db_path)

    processed = 0
    imported = 0
    skipped_seen = 0
    skipped_invalid = 0
    auto_merged = 0

    con = sqlite3.connect(str(db_path))
    try:
        with ndjson_path.open("rb") as f:
            for raw_line in f:
                if args.max_lines and processed >= args.max_lines:
                    break
                processed += 1

                if not raw_line.strip():
                    continue

                # Idempotency gate: if we've seen this exact line before, skip it.
                try:
                    is_new = db_record_seen_hash(con, raw_line)
                except Exception:
                    skipped_invalid += 1
                    continue

                if not is_new:
                    skipped_seen += 1
                    continue

                # Parse JSON
                try:
                    rec = json.loads(raw_line.decode("utf-8", errors="replace"))
                except Exception:
                    skipped_invalid += 1
                    continue

                ts = str(rec.get("ts") or "").strip() or datetime.now(timezone.utc).isoformat()
                data = rec.get("data") if isinstance(rec.get("data"), dict) else {}
                norm = rec.get("normalized") if isinstance(rec.get("normalized"), dict) else {}

                # Prefer normalized.server when present; otherwise fall back to raw data keys.
                server_ident = str(data.get("ident") or "").strip()
                game_mode = str(data.get("F1") or "").strip()
                map_name = str(data.get("E1") or "").strip()

                srv = norm.get("server") if isinstance(norm.get("server"), dict) else {}
                if srv:
                    server_ident = str(srv.get("ident") or server_ident).strip()
                    game_mode = str(srv.get("mode") or srv.get("game_mode") or game_mode).strip()
                    map_name = str(srv.get("map") or map_name).strip()

                # Insert event row (store full record for debugging/reprocessing)
                event = {
                    "ts": ts,
                    "server_ident": server_ident,
                    "game_mode": game_mode,
                    "map": map_name,
                    "raw_json": rec,
                }
                event_id = db_insert_ingest_event(con, event)

                # Upsert players
                players = norm.get("players") if isinstance(norm.get("players"), list) else []
                for p in players:
                    if not isinstance(p, dict):
                        continue

                    ubi = str(p.get("ubi") or "").strip()
                    nick = str(p.get("name") or p.get("nick") or "").strip()

                    if not server_ident or not ubi:
                        continue

                    k = _to_int(p.get("kills"))
                    d = _to_int(p.get("deaths"))
                    rf = _to_int(p.get("fired"))
                    hi = _to_int(p.get("hits"))

                    # Create/find the raw player row
                    raw_player_id = db_get_or_create_player(con, server_ident=server_ident, ubi=ubi)
                    if nick:
                        db_add_player_nick(con, player_id=raw_player_id, nick=nick)

                    # Auto-resolve fragmented guest accounts (Player_XXXXXXXX)
                    resolved_id = db_auto_resolve_ubi(con, server_ident, ubi)
                    effective_id = resolved_id if resolved_id is not None else raw_player_id

                    if resolved_id is not None and resolved_id != raw_player_id:
                        auto_merged += 1

                    db_upsert_player_map_stats(
                        con,
                        player_id=effective_id,
                        game_mode=game_mode,
                        map_name=map_name,
                        add_kills=k,
                        add_deaths=d,
                        add_fired=rf,
                        add_hits=hi,
                        add_rounds=1,
                        event_id=event_id,
                    )

                imported += 1

        con.commit()
    finally:
        con.close()

    print(
        json.dumps(
            {
                "ok": True,
                "ndjson_path": str(ndjson_path),
                "db_path": str(db_path),
                "processed": processed,
                "imported": imported,
                "skipped_seen": skipped_seen,
                "skipped_invalid": skipped_invalid,
                "auto_merged": auto_merged,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())