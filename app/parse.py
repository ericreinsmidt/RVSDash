"""
==============================================================================
File: app/parse.py
Project: RVSDash - Raven Shield Dashboard
Author: Eric Reinsmidt
Purpose:
  - Parse REPORTEXT UDP datagrams into a simple KV dict.
  - Convert raw KV into a structured JSON response for the UI.

Protocol notes:
- REPORTEXT returns multiple datagrams containing key/value fragments separated
  by byte 0xB6 (¶ in some legacy dumps). We join + split on that delimiter.
- Keys are 2 characters (e.g., A1, B1, L1, etc.).
- IMPORTANT: hits field is parsed from key "HI" (requested change from "H1").

Fields used:
- A1: max players
- B1: current players
- I1 or MM: server name
- E1: map
- F1: game mode
- D2: version
- TA/TB/TC: message lines
- K1: maplist (slash-separated)
- L1: player names
- O1: player kills
- DE: player deaths
- N1: player ping
- HI: player hits
- RF: rounds fired
- AC: accuracy
- DL: difficulty level
- PW/SW/PG/SG: weapons & gadgets (slash-separated)
==============================================================================
"""

from typing import Dict, List, Optional

import re

# REPORTEXT internal delimiter (matches earlier implementation).
DELIM = b"\xB6"

# AVAILABLEMAPS legacy separator byte: " �"
# We parse loosely by splitting on the '�' character after decoding.
AM_SEP_CHAR = "�"


def _split_slash_list(s: Optional[str]) -> List[str]:
    """Split slash-separated payloads, dropping empty segments."""
    s = s or ""
    if s == "":
        return []
    return [p for p in s.split("/") if p != ""]


def _split_numeric_list(s: Optional[str]) -> List[Optional[int]]:
    """Split into ints; invalid items become None."""
    out: List[Optional[int]] = []
    for item in _split_slash_list(s):
        try:
            out.append(int(item))
        except Exception:
            out.append(None)
    return out


def _split_float_list(s: Optional[str]) -> List[Optional[float]]:
    """Split into floats; invalid items become None."""
    out: List[Optional[float]] = []
    for item in _split_slash_list(s):
        try:
            out.append(float(item))
        except Exception:
            out.append(None)
    return out


# NOTE: a different _to_int exists in ingest.py (defaults to 0 instead of None)
def _to_int(x: Optional[str]) -> Optional[int]:
    """
    Convert a KV string to int safely.

    Why defensive:
    - Some servers/mods omit certain keys.
    - Some values may be blank or non-numeric depending on server state.
    """
    if x is None:
        return None
    x = x.strip()
    if x == "":
        return None
    try:
        return int(x)
    except Exception:
        return None


def _norm_str(x: Optional[str]) -> str:
    """
    Normalize a KV string to a UI-friendly form.

    Why:
    - Prevent None from leaking into JSON.
    - Strip trailing/leading whitespace commonly present in legacy dumps.
    """
    return (x or "").strip()


def parse_kv_from_datagrams(datagrams: List[bytes]) -> Dict[str, str]:
    """
    Turn a list of UDP datagrams into a KV mapping.

    IMPORTANT (fix ImportError):
    - app/main.py imports `parse_kv_from_datagrams` by this exact name.
    - If this function is missing or renamed, you'll get:
      ImportError: cannot import name 'parse_kv_from_datagrams'

    Steps:
    1) Join datagrams with DELIM to form a single byte stream.
    2) Split by DELIM to get individual entries.
    3) Decode each entry using latin-1 (preserves bytes 0..255).
    4) Validate key format (2 alphanumeric characters).
    5) Store key -> value.
    """
    blob = DELIM.join(datagrams)
    parts = blob.split(DELIM)

    kv: Dict[str, str] = {}
    for raw in parts:
        raw = raw.strip()
        if not raw:
            continue

        s = raw.decode("latin-1", errors="replace").strip()
        if len(s) < 2:
            continue

        key = s[:2]
        # Only accept 2-char alphanumeric keys.
        if len(key) != 2 or not key.isalnum():
            continue

        val = s[2:].lstrip()
        kv[key] = val

    return kv


def summarize_server(kv: Dict[str, str]) -> dict:
    """
    Extract server-level summary information used by the status UI.

    IMPORTANT (mapping changes):
    - I1 is the server name (authoritative per your request).
    - MM should be the Message of the Day (MotD).

    Also important for the UI contract:
    - status.js renders:
        - server name from s.name
        - game mode   from s.mode
      So we MUST return keys named exactly "name" and "mode".

    Message/Messenger vs MOTD:
    - This project already has "message lines" TA/TB/TC (protocol notes).
      We keep those as a separate field named "message" so the UI can label it
      "Messenger".
    - MM is treated as the MOTD field, returned as "motd".
    """
    max_players = _to_int(kv.get("A1"))
    cur_players = _to_int(kv.get("B1"))

    # Requested: I1 is the server name (no fallback to MM).
    name = _norm_str(kv.get("I1"))

    # Game mode is F1 (per protocol notes).
    mode = _norm_str(kv.get("F1"))

    map_name = _norm_str(kv.get("E1"))
    version = _norm_str(kv.get("D2"))

    # Existing multi-line message system: TA/TB/TC.
    msg_lines = [_norm_str(kv.get("TA")), _norm_str(kv.get("TB")), _norm_str(kv.get("TC"))]
    message = "\n".join([x for x in msg_lines if x != ""]).strip()

    # Requested: MM is the Message of the Day (MotD).
    motd = _norm_str(kv.get("MM"))

    # Difficulty level from KV "DL"
    difficulty_level = _to_int(kv.get("DL"))

    return {
        # Keys expected by the frontend status page:
        "name": name,
        "mode": mode,

        # Additional server fields used/displayed by the UI:
        "map": map_name,
        "version": version,
        "players_max": max_players,
        "players_current": cur_players,

        # Requested: expose both Messenger message and MOTD separately.
        "message": message,  # TA/TB/TC composite
        "motd": motd,        # MM

        # CHANGE: expose difficulty
        "difficulty_level": difficulty_level,
    }


def parse_maplist(kv: Dict[str, str]) -> List[str]:
    """Maplist is in K1 as slash-separated values."""
    return _split_slash_list(kv.get("K1"))


def parse_players(kv: Dict[str, str]) -> List[dict]:
    """
    Parse players from slash-separated arrays.

    """
    names = _split_slash_list(kv.get("L1"))
    ubi = _split_slash_list(kv.get("UB"))

    kills = _split_numeric_list(kv.get("O1"))
    deaths = _split_numeric_list(kv.get("DE"))
    ping = _split_numeric_list(kv.get("N1"))

    hits = _split_numeric_list(kv.get("HI"))

    rounds_fired = _split_numeric_list(kv.get("RF"))
    accuracy = _split_float_list(kv.get("AC"))

    pw = _split_slash_list(kv.get("PW"))
    sw = _split_slash_list(kv.get("SW"))
    pg = _split_slash_list(kv.get("PG"))
    sg = _split_slash_list(kv.get("SG"))

    def get(lst, i, default=None):
        return lst[i] if i < len(lst) else default

    players: List[dict] = []
    for i, name in enumerate(names):
        players.append(
            {
                "name": name,
                "ubi": get(ubi, i, ""),
                "ping": get(ping, i, None),
                "kills": get(kills, i, None),
                "deaths": get(deaths, i, None),
                "hits": get(hits, i, None),
                "rounds_fired": get(rounds_fired, i, None),
                "accuracy": get(accuracy, i, None),
                "primary_weapon": get(pw, i, ""),
                "secondary_weapon": get(sw, i, ""),
                "primary_gadget": get(pg, i, ""),
                "secondary_gadget": get(sg, i, ""),
            }
        )

    return players


def build_structured_response(kv: Dict[str, str]) -> dict:
    """
    Build JSON object that the UI expects.

    Safety guard:
    - If server reports 0 players but arrays contain players, clear the list.
      (Some servers may produce stale player arrays.)
    """
    server = summarize_server(kv)
    players = parse_players(kv)
    maplist = parse_maplist(kv)

    if server.get("players_current") == 0 and len(players) > 0:
        players = []

    return {
        "server": server,
        "players": players,
        "maplist": maplist,
    }


def parse_availablemaps_from_datagrams(datagrams: List[bytes]) -> dict:
    """
    Parse AVAILABLEMAPS datagrams into a UI-friendly structure.

    Observed behavior (from live capture):
    - Segments include tokens like:
        - "AM <mapname>:<mode>/<mode>/..."
        - "PN <number>"
    - Delimiter between fragments is consistent with other beacon data:
        - 0xB6 (often rendered as '�' when decoded)

    We:
    - split datagrams using the raw 0xB6 delimiter first,
    - also split on the '�' character as a fallback,
    - extract every AM entry independently (do NOT assume AM is one giant value).

    Returns:
      {
        "maps": [{"map": "...", "modes": ["..."]}, ...],
        "map_to_modes": {"map": ["..."]},
        "raw": {"PN": "40", "AM_count": "..."}
      }
    """
    if not datagrams:
        return {"maps": [], "map_to_modes": {}, "raw": {}}

    # 1) Build a list of "segments" by splitting on the raw delimiter (preferred).
    segments: List[str] = []
    for d in datagrams:
        if not d:
            continue

        # Split by the raw delimiter first so we don't rely on any particular decoding
        # of 0xB6 into a Unicode replacement char.
        raw_parts = d.split(DELIM)
        for rp in raw_parts:
            rp = rp.strip()
            if not rp:
                continue
            try:
                s = rp.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                s = rp.decode("latin-1", errors="replace")
            s = s.strip()
            if not s:
                continue

            # Fallback: sometimes decoded text may still contain the visible separator.
            if AM_SEP_CHAR in s:
                for sub in s.split(AM_SEP_CHAR):
                    sub = sub.strip()
                    if sub:
                        segments.append(sub)
            else:
                segments.append(s)

    # 2) Extract PN and AM entries.
    pn_val: Optional[str] = None
    am_entries: List[str] = []

    for seg in segments:
        # Normalize leading whitespace.
        seg2 = seg.strip()
        if not seg2:
            continue

        # Packet count (observed as "PN 40")
        if seg2.startswith("PN "):
            pn_val = seg2[3:].strip()
            continue

        # Map entry (observed as "AM <map>:<modes>")
        if seg2.startswith("AM "):
            am_entries.append(seg2[3:].strip())
            continue

    # 3) Parse AM entries of the form "mapname:mode/mode/..."
    map_to_modes: Dict[str, List[str]] = {}

    for entry in am_entries:
        if ":" not in entry:
            continue

        map_name, modes_blob = entry.split(":", 1)
        map_name = map_name.strip()
        if not map_name:
            continue

        # Modes are slash-separated (keep raw tokens; UI can display friendly names later if desired).
        modes = [m for m in (modes_blob or "").split("/") if m]

        # Deduplicate while preserving order.
        seen = set()
        deduped: List[str] = []
        for m in modes:
            if m in seen:
                continue
            seen.add(m)
            deduped.append(m)

        map_to_modes[map_name] = deduped

    maps = [{"map": m, "modes": map_to_modes[m]} for m in sorted(map_to_modes.keys())]
    raw = {
        "PN": pn_val or "",
        "AM_count": str(len(am_entries)),
    }
    return {"maps": maps, "map_to_modes": map_to_modes, "raw": raw}

def parse_banlist_from_datagrams(datagrams: List[bytes]) -> dict:
    """
    Parse BANLIST datagrams into a UI-friendly structure.

    The ban list response uses the same ¶-delimited format as other
    beacon data. Entries are prefixed with "BL" followed by an index
    number and the banned value (GUID or IP).

    Returns:
      {
        "bans": [{"index": 1, "value": "85CDECAA41264FD1B49D6640DE678A21", "type": "guid"},...],
        "count": 5
      }
    """
    if not datagrams:
        return {"bans": [], "count": 0}

    # Build segments from all datagrams
    segments: List[str] = []
    for d in datagrams:
        if not d:
            continue
        try:
            text = d.decode("latin-1")
        except Exception:
            continue

        # Split on 0xB6 delimiter (same as other beacon data)
        raw_parts = text.split("\xb6")
        for part in raw_parts:
            part = part.strip()
            if part:
                segments.append(part)

    bans: List[dict] = []
    for seg in segments:
        # Match BL<index> <value>  e.g. "BL1 85CDECAA41264FD1B49D6640DE678A21"
        if not seg.startswith("BL"):
            continue

        # Find the space separating the key from the value
        space_idx = seg.find(" ")
        if space_idx < 0:
            continue

        key = seg[:space_idx]
        value = seg[space_idx + 1:].strip()

        if not value:
            continue

        # Extract index from key (e.g. "BL1" -> 1)
        idx_str = key[2:]
        try:
            idx = int(idx_str)
        except ValueError:
            continue

        # Determine type: GUID (32 hex chars), IP, or partial IP
        clean = value.replace("-", "")
        if re.match(r"^[A-Fa-f0-9]{32}$", clean):
            ban_type = "guid"
        elif re.match(r"^[0-9]+\.[0-9.]*$", value):
            ban_type = "ip"
        else:
            ban_type = "unknown"

        bans.append({
            "index": idx,
            "value": value,
            "type": ban_type,
        })

    # Sort by index
    bans.sort(key=lambda b: b["index"])

    return {"bans": bans, "count": len(bans)}