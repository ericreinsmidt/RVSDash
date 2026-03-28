# rvsstats_db.py
"""
SQLite persistence for RVSDash ingest stats.

Design goals:
- Simple deployment: one SQLite file (no server).
- Mirror legacy PHP behavior:
  - create/find player by (server_ident, ubi)
  - record nicks
  - upsert per-(player, map, mode) accumulated stats and increment rounds
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional


def db_init(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA synchronous=NORMAL;")
        con.execute("PRAGMA foreign_keys=ON;")

        ###################################
        #       TEMPORARY
        ###################################

        # Idempotent import support:
        # Stores sha256 hashes of imported NDJSON lines so re-runs skip duplicates.
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS import_seen (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              seen_hash TEXT NOT NULL UNIQUE,
              first_ts TEXT NOT NULL
            );
            """
        )

        ###################################
        #       TEMPORARY
        ###################################

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              server_ident TEXT NOT NULL,
              game_mode TEXT NOT NULL,
              map TEXT NOT NULL,
              raw_json TEXT NOT NULL
            );
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS idx_ingest_events_ts ON ingest_events(ts);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_ingest_events_server ON ingest_events(server_ident);")

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS players (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              server_ident TEXT NOT NULL,
              ubi TEXT NOT NULL,
              UNIQUE(server_ident, ubi)
            );
            """
        )

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS player_nicks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              player_id INTEGER NOT NULL,
              nick TEXT NOT NULL,
              UNIQUE(player_id, nick),
              FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
            );
            """
        )

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS player_map_stats (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              player_id INTEGER NOT NULL,
              game_mode TEXT NOT NULL,
              map TEXT NOT NULL,
              kills INTEGER NOT NULL DEFAULT 0,
              deaths INTEGER NOT NULL DEFAULT 0,
              rounds_played INTEGER NOT NULL DEFAULT 0,
              fired INTEGER NOT NULL DEFAULT 0,
              hits INTEGER NOT NULL DEFAULT 0,
              last_event_id INTEGER,
              UNIQUE(player_id, game_mode, map),
              FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
              FOREIGN KEY(last_event_id) REFERENCES ingest_events(id) ON DELETE SET NULL
            );
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS idx_pms_kills ON player_map_stats(kills);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_pms_player ON player_map_stats(player_id);")

        con.commit()
    finally:
        con.close()


def db_insert_ingest_event(con: sqlite3.Connection, event: Dict[str, Any]) -> int:
    import json

    ts = str(event.get("ts", ""))
    server_ident = str(event.get("server_ident", "") or "")
    game_mode = str(event.get("game_mode", "") or "")
    map_name = str(event.get("map", "") or "")
    # raw_json = json.dumps(event, ensure_ascii=False)
    # Prefer storing the full original record if provided.
    raw_json = json.dumps(event.get("raw_json", event), ensure_ascii=False)

    cur = con.execute(
        "INSERT INTO ingest_events(ts, server_ident, game_mode, map, raw_json) VALUES(?,?,?,?,?)",
        (ts, server_ident, game_mode, map_name, raw_json),
    )
    return int(cur.lastrowid)



def db_record_seen_hash(con: sqlite3.Connection, raw_line: bytes) -> bool:
    """
    Idempotency gate for imports.

    Returns:
      True  -> this line hash was newly recorded (process it)
      False -> already seen (skip it)
    """
    import hashlib
    from datetime import datetime, timezone

    b = raw_line or b""
    h = hashlib.sha256(b).hexdigest()
    ts = datetime.now(timezone.utc).isoformat()

    cur = con.execute(
        "INSERT OR IGNORE INTO import_seen(seen_hash, first_ts) VALUES(?,?)",
        (h, ts),
    )
    return (cur.rowcount or 0) == 1


def db_get_or_create_player(con: sqlite3.Connection, server_ident: str, ubi: str) -> int:
    server_ident = (server_ident or "").strip()
    ubi = (ubi or "").strip()

    cur = con.execute(
        "SELECT id FROM players WHERE server_ident=? AND ubi=?",
        (server_ident, ubi),
    )
    row = cur.fetchone()
    if row:
        return int(row[0])

    cur = con.execute(
        "INSERT INTO players(server_ident, ubi) VALUES(?,?)",
        (server_ident, ubi),
    )
    return int(cur.lastrowid)


def db_add_player_nick(con: sqlite3.Connection, player_id: int, nick: str) -> None:
    nick = (nick or "").strip()
    if not nick:
        return
    # Insert-if-not-exists
    con.execute(
        "INSERT OR IGNORE INTO player_nicks(player_id, nick) VALUES(?,?)",
        (int(player_id), nick),
    )


def db_upsert_player_map_stats(
    con: sqlite3.Connection,
    player_id: int,
    game_mode: str,
    map_name: str,
    add_kills: int,
    add_deaths: int,
    add_fired: int,
    add_hits: int,
    add_rounds: int,
    event_id: Optional[int] = None,
) -> None:
    game_mode = (game_mode or "").strip()
    map_name = (map_name or "").strip()

    # If both are empty, there's nothing meaningful to key on.
    if not game_mode and not map_name:
        return

    # Ensure row exists
    con.execute(
        """
        INSERT OR IGNORE INTO player_map_stats(player_id, game_mode, map, kills, deaths, rounds_played, fired, hits, last_event_id)
        VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (int(player_id), game_mode, map_name, 0, 0, 0, 0, 0, event_id),
    )

    # Then increment totals
    con.execute(
        """
        UPDATE player_map_stats
        SET
          kills = kills + ?,
          deaths = deaths + ?,
          fired = fired + ?,
          hits = hits + ?,
          rounds_played = rounds_played + ?,
          last_event_id = COALESCE(?, last_event_id)
        WHERE player_id=? AND game_mode=? AND map=?
        """,
        (
            int(add_kills),
            int(add_deaths),
            int(add_fired),
            int(add_hits),
            int(add_rounds),
            (int(event_id) if event_id is not None else None),
            int(player_id),
            game_mode,
            map_name,
        ),
    )