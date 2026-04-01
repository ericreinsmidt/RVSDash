"""
================================================================================
File: app/rvsstats_db.py
Project: RVSDash - Raven Shield Dashboard
Author: Eric Reinsmidt

What this file does (high-level):
- SQLite persistence for RVSDash ingest stats.
- Simple deployment: one SQLite file (no server).
- Mirror legacy PHP behavior:
  - create/find player by (server_ident, ubi)
  - record nicks
  - upsert per-(player, map, mode) accumulated stats and increment rounds

Why this file exists:
- Provides a single module for all database operations so the rest of the
  codebase never touches SQLite directly.
================================================================================
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Pre-compiled regex for detecting Player_XXXXXXXX suffix pattern.
_SUFFIX_RE = re.compile(r"^(.+)_([A-Za-z0-9]{8})$")


def db_init(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA synchronous=NORMAL;")
        con.execute("PRAGMA foreign_keys=ON;")

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

        # ------------------------------------------------------------------
        # Player alias / merge table
        # ------------------------------------------------------------------
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS player_aliases (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              canonical_player_id INTEGER NOT NULL,
              alias_player_id INTEGER NOT NULL UNIQUE,
              created_ts TEXT NOT NULL,
              FOREIGN KEY(canonical_player_id) REFERENCES players(id) ON DELETE CASCADE,
              FOREIGN KEY(alias_player_id) REFERENCES players(id) ON DELETE CASCADE
            );
            """
        )
        con.execute("CREATE INDEX IF NOT EXISTS idx_pa_canonical ON player_aliases(canonical_player_id);")

        con.commit()
    finally:
        con.close()


def db_insert_ingest_event(con: sqlite3.Connection, event: Dict[str, Any]) -> int:

    ts = str(event.get("ts", ""))
    server_ident = str(event.get("server_ident", "") or "")
    game_mode = str(event.get("game_mode", "") or "")
    map_name = str(event.get("map", "") or "")
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

    # Then increment totals (matches the PHP UPDATE accumulation pattern)
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


# ------------------------------------------------------------------------------
# Player alias / merge helpers
# ------------------------------------------------------------------------------

# Ubi names that should never be auto-merged (default/generic names).
_GENERIC_UBI_NAMES = {"JOHNDOE"}


def db_resolve_canonical_player_id(con: sqlite3.Connection, player_id: int) -> int:
    """
    Given a player_id, return its canonical player_id.

    If the player has an alias entry, return the canonical.
    Otherwise return the player_id itself (it is its own canonical).
    """
    cur = con.execute(
        "SELECT canonical_player_id FROM player_aliases WHERE alias_player_id=?",
        (int(player_id),),
    )
    row = cur.fetchone()
    if row:
        return int(row[0])
    return int(player_id)


def db_add_player_alias(
    con: sqlite3.Connection,
    canonical_player_id: int,
    alias_player_id: int,
) -> bool:
    """
    Record that alias_player_id is an alias of canonical_player_id.

    Returns True if newly inserted, False if already existed.

    Safety:
    - Cannot alias a player to itself.
    - Cannot alias a player that is already a canonical for other aliases
      (would create chains). Caller should resolve first.
    """

    canonical_player_id = int(canonical_player_id)
    alias_player_id = int(alias_player_id)

    if canonical_player_id == alias_player_id:
        return False

    ts = datetime.now(timezone.utc).isoformat()

    cur = con.execute(
        "INSERT OR IGNORE INTO player_aliases(canonical_player_id, alias_player_id, created_ts) VALUES(?,?,?)",
        (canonical_player_id, alias_player_id, ts),
    )
    return (cur.rowcount or 0) == 1


def db_get_aliases_for_canonical(con: sqlite3.Connection, canonical_player_id: int) -> List[int]:
    """Return all alias player_ids that point to this canonical."""
    rows = con.execute(
        "SELECT alias_player_id FROM player_aliases WHERE canonical_player_id=?",
        (int(canonical_player_id),),
    ).fetchall()
    return [int(r[0]) for r in rows]


def db_get_all_aliases(con: sqlite3.Connection) -> List[Dict[str, Any]]:
    """Return all alias mappings with ubi names for display."""
    rows = con.execute(
        """
        SELECT
          pa.id,
          pa.canonical_player_id,
          cp.ubi AS canonical_ubi,
          cp.server_ident,
          pa.alias_player_id,
          ap.ubi AS alias_ubi,
          pa.created_ts
        FROM player_aliases pa
        JOIN players cp ON cp.id = pa.canonical_player_id
        JOIN players ap ON ap.id = pa.alias_player_id
        ORDER BY cp.ubi, ap.ubi
        """,
    ).fetchall()
    return [
        {
            "id": r[0],
            "canonical_player_id": r[1],
            "canonical_ubi": r[2],
            "server_ident": r[3],
            "alias_player_id": r[4],
            "alias_ubi": r[5],
            "created_ts": r[6],
        }
        for r in rows
    ]


def db_remove_alias(con: sqlite3.Connection, alias_player_id: int) -> bool:
    """Remove an alias mapping. Returns True if a row was deleted."""
    cur = con.execute(
        "DELETE FROM player_aliases WHERE alias_player_id=?",
        (int(alias_player_id),),
    )
    return (cur.rowcount or 0) > 0


def db_detect_merge_candidates(con: sqlite3.Connection) -> List[Dict[str, Any]]:
    """
    Scan for players whose ubi matches the BaseName_XXXXXXXX pattern
    (8-char alphanumeric suffix after underscore) and group them by base name.

    Excludes:
    - Generic names (JOHNDOE)
    - Players already aliased
    - Groups with only one member (nothing to merge)

    Returns a list of candidate groups:
    [
      {
        "base_name": "Miyagi_OR6",
        "server_ident": "obsolete_superstars",
        "canonical": {"player_id": 4, "ubi": "Miyagi_OR6", "rounds": 4},
        "aliases": [
          {"player_id": 20, "ubi": "Miyagi_OR6_t80780aj", "rounds": 1},...
        ]
      },...
    ]
    """

    # Pattern: base name, underscore, exactly 8 alphanumeric chars at end
    suffix_re = _SUFFIX_RE

    # Get all players not already aliased
    rows = con.execute(
        """
        SELECT p.id, p.server_ident, p.ubi,
               COALESCE(SUM(s.rounds_played), 0) AS total_rounds
        FROM players p
        LEFT JOIN player_map_stats s ON s.player_id = p.id
        WHERE p.id NOT IN (SELECT alias_player_id FROM player_aliases)
        GROUP BY p.id
        ORDER BY p.server_ident, p.ubi
        """,
    ).fetchall()

    # Group by (server_ident, base_name)
    groups: Dict[tuple, List[Dict[str, Any]]] = {}

    for r in rows:
        player_id, server_ident, ubi, total_rounds = r[0], r[1], r[2], r[3]

        m = suffix_re.match(ubi)
        if m:
            base_name = m.group(1)
        else:
            base_name = ubi

        # Skip generic names
        if base_name in _GENERIC_UBI_NAMES:
            continue

        key = (server_ident, base_name)
        if key not in groups:
            groups[key] = []
        groups[key].append({
            "player_id": player_id,
            "ubi": ubi,
            "rounds": total_rounds,
            "is_base": (ubi == base_name),
        })

    # Build candidate list — only groups with more than one member
    candidates = []
    for (server_ident, base_name), members in sorted(groups.items()):
        if len(members) < 2:
            continue

        # Pick canonical: prefer the "base" ubi (no suffix), then most rounds
        base_members = [m for m in members if m["is_base"]]
        if base_members:
            canonical = base_members[0]
        else:
            canonical = max(members, key=lambda m: m["rounds"])

        aliases = [m for m in members if m["player_id"] != canonical["player_id"]]

        candidates.append({
            "base_name": base_name,
            "server_ident": server_ident,
            "canonical": {
                "player_id": canonical["player_id"],
                "ubi": canonical["ubi"],
                "rounds": canonical["rounds"],
            },
            "aliases": [
                {
                    "player_id": a["player_id"],
                    "ubi": a["ubi"],
                    "rounds": a["rounds"],
                }
                for a in sorted(aliases, key=lambda x: x["ubi"])
            ],
        })

    return candidates


def db_auto_resolve_ubi(con: sqlite3.Connection, server_ident: str, ubi: str) -> Optional[int]:
    """
    At ingest time, check if a ubi matches the BaseName_XXXXXXXX pattern
    and a canonical player with BaseName already exists on this server.

    If so, return the canonical player_id (and create the alias mapping).
    If not, return None (caller proceeds with normal get_or_create).

    Excludes generic names (JOHNDOE).
    """

    suffix_re = _SUFFIX_RE

    ubi = (ubi or "").strip()
    server_ident = (server_ident or "").strip()

    if not ubi or not server_ident:
        return None

    m = suffix_re.match(ubi)
    if not m:
        return None

    base_name = m.group(1)

    # Skip generic names
    if base_name in _GENERIC_UBI_NAMES:
        return None

    # Check if a canonical player with the base name exists
    cur = con.execute(
        "SELECT id FROM players WHERE server_ident=? AND ubi=?",
        (server_ident, base_name),
    )
    row = cur.fetchone()
    if not row:
        return None

    canonical_player_id = int(row[0])

    # Make sure the canonical isn't itself an alias
    cur2 = con.execute(
        "SELECT canonical_player_id FROM player_aliases WHERE alias_player_id=?",
        (canonical_player_id,),
    )
    row2 = cur2.fetchone()
    if row2:
        canonical_player_id = int(row2[0])

    # Now get or create the suffixed player row
    alias_player_id = db_get_or_create_player(con, server_ident, ubi)

    # If they're the same (shouldn't happen, but defensive), skip
    if alias_player_id == canonical_player_id:
        return canonical_player_id

    # Check if already aliased
    cur3 = con.execute(
        "SELECT id FROM player_aliases WHERE alias_player_id=?",
        (alias_player_id,),
    )
    if not cur3.fetchone():
        ts = datetime.now(timezone.utc).isoformat()
        con.execute(
            "INSERT OR IGNORE INTO player_aliases(canonical_player_id, alias_player_id, created_ts) VALUES(?,?,?)",
            (canonical_player_id, alias_player_id, ts),
        )

    return canonical_player_id