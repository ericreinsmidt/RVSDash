"""
==============================================================================
File: app/admincommands.py
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

Purpose:
- Build allowlisted UDP ADMIN payloads (never arbitrary raw commands).
- Validate/sanitize user inputs before embedding them in server command strings.

Security note:
- Do NOT add "send raw command" endpoints.
- Only add explicit allowlisted command constructors.
==============================================================================
"""

import os
import re


def _get_admin_password() -> str:
    """
    Read the Raven Shield admin password from environment.

    Security:
    - Must never be hard-coded in source.
    """
    pw = os.environ.get("RVS_ADMIN_PASSWORD", "")
    if not pw:
        raise ValueError("RVS_ADMIN_PASSWORD is not set")
    return pw


def build_admin_payload(cmd_tail: str) -> bytes:
    """
    Build full UDP payload for an ADMIN command using the configured password.

    Args:
        cmd_tail: Everything after "ADMIN <pw> ".

    Returns:
        bytes: Full UDP payload bytes.
    """
    pw = _get_admin_password()
    s = f"ADMIN {pw} {cmd_tail}".strip()
    return s.encode("ascii", errors="ignore")


# ------------------------------------------------------------------------------
# Validation helpers
# ------------------------------------------------------------------------------

_SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def validate_rt_seconds(seconds: int) -> int:
    if not isinstance(seconds, int):
        raise ValueError("seconds must be an integer")
    if seconds < 60 or seconds > 3600:
        raise ValueError("seconds must be in range 60..3600")
    return seconds


def validate_motd(text: str) -> str:
    if text is None:
        text = ""
    text = str(text).strip()
    if len(text) > 30:
        raise ValueError("MOTD must be <= 30 chars")
    # Prevent line breaks / control chars in embedded command.
    text = "".join(ch for ch in text if ch >= " " and ch not in "\r\n\t")
    return text


def validate_inifile(inifile: str) -> str:
    if inifile is None:
        inifile = ""
    inifile = str(inifile).strip()
    if len(inifile) == 0:
        raise ValueError("INI name is required")
    if len(inifile) > 64:
        raise ValueError("INI name must be <= 64 chars")
    if not _SAFE_TOKEN_RE.match(inifile):
        raise ValueError("INI name contains invalid characters")
    return inifile


def validate_say_message(msg: str) -> str:
    """
    Validate/sanitize a SAY message.

    Constraints:
    - No newlines or control chars (prevents multi-command injection via formatting).
    - Keep reasonably short for operator UX + UDP payload size.
    """
    if msg is None:
        msg = ""
    msg = str(msg).strip()

    # Remove control chars/newlines/tabs.
    msg = "".join(ch for ch in msg if ch >= " " and ch not in "\r\n\t")

    if len(msg) == 0:
        raise ValueError("Message is required")
    if len(msg) > 120:
        raise ValueError("Message must be <= 120 chars")
    return msg


# Difficulty validation (DL / DiffLevel)
def validate_diff_level(level: int) -> int:
    """
    Validate a difficulty level.

    UI expectation:
    - 1-3 (common Raven Shield difficulty tiers)
    """
    if not isinstance(level, int):
        raise ValueError("level must be an integer")
    if level < 1 or level > 3:
        raise ValueError("level must be in range 1..3")
    return level

# Kick validation
def validate_ubi_for_kick(ubi: str) -> str:
    """
    Validate a ubi name for kick/ban commands.

    Constraints:
    - Must not be empty.
    - Must not contain spaces, newlines, or control chars (prevents injection).
    - Reasonable length limit.
    """
    if ubi is None:
        ubi = ""
    ubi = str(ubi).strip()
    if len(ubi) == 0:
        raise ValueError("UBI name is required")
    if len(ubi) > 128:
        raise ValueError("UBI name must be <= 128 chars")
    if not _SAFE_TOKEN_RE.match(ubi):
        raise ValueError("UBI name contains invalid characters")
    return ubi

def validate_messenger_text(text: str) -> str:
    """
    Validate/sanitize a messenger text line.

    Constraints:
    - No newlines or control chars.
    - Max 100 chars (matches legacy PHP).
    """
    if text is None:
        text = ""
    text = str(text).strip()
    text = "".join(ch for ch in text if ch >= " " and ch not in "\r\n\t")
    if len(text) > 100:
        raise ValueError("Messenger text must be <= 100 chars")
    return text

def validate_max_players(n: int, max_allowed: int = 16) -> int:
    """Validate max players (1..16, or 1..8 for coop modes)."""
    if not isinstance(n, int):
        raise ValueError("max players must be an integer")
    if n < 1 or n > max_allowed:
        raise ValueError(f"max players must be in range 1..{max_allowed}")
    return n


def validate_map_index(index: int) -> int:
    """Validate a map rotation index (1-based)."""
    if not isinstance(index, int):
        raise ValueError("map index must be an integer")
    if index < 1 or index > 32:
        raise ValueError("map index must be in range 1..32")
    return index


def validate_map_name(name: str) -> str:
    """Validate a map name token."""
    if name is None:
        name = ""
    name = str(name).strip()
    if len(name) == 0:
        raise ValueError("Map name is required")
    if len(name) > 128:
        raise ValueError("Map name must be <= 128 chars")
    if not _SAFE_TOKEN_RE.match(name):
        raise ValueError("Map name contains invalid characters")
    return name


def validate_game_type(gtype: str) -> str:
    """Validate a game type token."""
    if gtype is None:
        gtype = ""
    gtype = str(gtype).strip()
    if len(gtype) == 0:
        raise ValueError("Game type is required")
    if len(gtype) > 128:
        raise ValueError("Game type must be <= 128 chars")
    if not _SAFE_TOKEN_RE.match(gtype):
        raise ValueError("Game type contains invalid characters")
    return gtype


def validate_server_password(pw: str) -> str:
    """Validate a game server password (alphanumeric only, per legacy PHP)."""
    if pw is None:
        pw = ""
    pw = str(pw).strip()
    if len(pw) == 0:
        raise ValueError("Password is required")
    if len(pw) > 15:
        raise ValueError("Password must be <= 15 chars")
    if not pw.isalnum():
        raise ValueError("Password must be alphanumeric")
    return pw

# ------------------------------------------------------------------------------
# allowlisted command constructors
# ------------------------------------------------------------------------------

def cmd_restart_match() -> bytes:
    """Construct an allowlisted RESTARTMATCH command."""
    return build_admin_payload("RESTARTMATCH")


def cmd_restart_round() -> bytes:
    """Construct an allowlisted RESTARTROUND command."""
    return build_admin_payload("RESTARTROUND")


def cmd_lock_server(password: str = "") -> bytes:
    """
    Construct an allowlisted LOCKSERVER command.

    With no password: disables the game password.
    With a password: enables the game password.
    """
    password = str(password).strip()
    if password:
        password = validate_server_password(password)
        return build_admin_payload(f"LOCKSERVER {password}")
    return build_admin_payload("LOCKSERVER")


def cmd_set_max_players(n: int) -> bytes:
    """Construct an allowlisted SETMAXPLAYERS command."""
    n = validate_max_players(n)
    return build_admin_payload(f"SETMAXPLAYERS {n}")


def cmd_save_ini(inifile: str) -> bytes:
    """Construct an allowlisted SAVESERVER command."""
    inifile = validate_inifile(inifile)
    return build_admin_payload(f"SAVESERVER {inifile}")


def cmd_messenger_toggle() -> bytes:
    """Construct an allowlisted MESSENGER toggle command."""
    return build_admin_payload("MESSENGER")


# --- Map management commands ---

def cmd_change_map(index: int) -> bytes:
    """Construct an allowlisted MAP command to jump to a map by rotation index."""
    index = validate_map_index(index)
    return build_admin_payload(f"MAP {index}")


def cmd_add_map(map_name: str, game_type: str, position: int) -> bytes:
    """Construct an allowlisted ADDMAP command to insert a map into the rotation."""
    map_name = validate_map_name(map_name)
    game_type = validate_game_type(game_type)
    position = validate_map_index(position)
    return build_admin_payload(f"ADDMAP {map_name} {game_type} {position}")


def cmd_remove_map(index: int) -> bytes:
    """Construct an allowlisted REMOVEMAP command."""
    index = validate_map_index(index)
    return build_admin_payload(f"REMOVEMAP {index}")
    

def cmd_messtext(slot: int, text: str) -> bytes:
    """
    Construct an allowlisted MESSTEXT command.

    Sets one of the three messenger text lines (0, 1, 2).
    """
    if slot not in (0, 1, 2):
        raise ValueError("Messenger slot must be 0, 1, or 2")
    text = validate_messenger_text(text)
    return build_admin_payload(f"MESSTEXT{slot} {text}")

def cmd_set_rt(seconds: int) -> bytes:
    """
    Construct an allowlisted command to set RoundTime.
    """
    seconds = validate_rt_seconds(seconds)
    return build_admin_payload(f"SETSERVEROPTION RoundTime {seconds}")


def cmd_set_motd(text: str) -> bytes:
    """
    Construct an allowlisted command to set MOTD.

    Args:
        text (str): Desired MOTD.

    Returns:
        bytes: Fully formed UDP payload to send.
    """
    # Validate and sanitize the MOTD before embedding.
    text = validate_motd(text)

    # Build the server command tail in a single safe line.
    return build_admin_payload(f"SETSERVEROPTION MOTD {text}")


def cmd_load_ini(inifile: str) -> bytes:
    """
    Construct an allowlisted command to load an INI.

    Args:
        inifile: INI base name (no ".ini").

    Returns:
        bytes: Fully formed UDP payload to send.

    Notes:
    - This maps a UI concept "LoadINI" to server command "LOADSERVER <name>".
    """
    # Validate the token so we only allow safe filename-like values.
    inifile = validate_inifile(inifile)

    # User selects an INI base name,
    # and the server expects "LOADSERVER <inifile>" (without extension).
    return build_admin_payload(f"LOADSERVER {inifile}")


def cmd_say(msg: str) -> bytes:
    """
    Construct an allowlisted SAY command.

    """
    msg = validate_say_message(msg)
    return build_admin_payload(f"SAY ADMIN: {msg}")


def cmd_restart() -> bytes:
    """
    Construct an allowlisted RESTART command.

    """
    return build_admin_payload("RESTART")


# Set difficulty SETSERVEROPTION DiffLevel <n>
def cmd_set_diff_level(level: int) -> bytes:
    """
    Construct an allowlisted command to set server difficulty.

    """
    level = validate_diff_level(level)
    return build_admin_payload(f"SETSERVEROPTION DiffLevel {level}")

def cmd_kick_ubi(ubi: str) -> bytes:
    """
    Construct an allowlisted KICKUBI command.

    Kicks a player by their ubi name.
    """
    ubi = validate_ubi_for_kick(ubi)
    return build_admin_payload(f"KICKUBI {ubi}")

def cmd_ban_ubi(ubi: str) -> bytes:
    """
    Construct an allowlisted BANUBI command.

    Bans a player by their ubi name. The game server resolves
    the ubi to a GlobalID (GUID) and persists it to BanList.ini.
    """
    ubi = validate_ubi_for_kick(ubi)  # same validation rules
    return build_admin_payload(f"BANUBI {ubi}")

def validate_ban_id(ban_id: str) -> str:
    """
    Validate a ban value for removal.

    Accepts:
    - A 32-char hex GUID (e.g. "85CDECAA41264FD1B49D6640DE678A21")
    - An IP or partial IP (e.g. "80.132.254.107" or "63.231.")
    """
    if ban_id is None:
        ban_id = ""
    ban_id = str(ban_id).strip()
    if len(ban_id) == 0:
        raise ValueError("Ban ID is required")
    if len(ban_id) > 64:
        raise ValueError("Ban ID must be <= 64 chars")
    if not re.match(r"^[A-Fa-f0-9.]+$", ban_id):
        raise ValueError("Ban ID contains invalid characters")
    return ban_id

def cmd_remove_ban(ban_value: str) -> bytes:
    """
    Construct an allowlisted REMOVEBAN command.

    Removes a ban entry by its value (GUID or IP).
    """
    ban_value = validate_ban_id(ban_value)
    return build_admin_payload(f"REMOVEBAN {ban_value}")



# ============================================================================
# Server Name
# ============================================================================

def validate_server_name(name: str) -> str:
    """
    Validate a server name.

    UI expectation:
    - 1-30 characters, no control characters.
    """
    if not isinstance(name, str):
        raise ValueError("name must be a string")
    name = name.strip()
    if len(name) == 0:
        raise ValueError("Server name is required")
    if len(name) > 30:
        raise ValueError("Server name must be <= 30 chars")
    if any(ord(c) < 32 for c in name):
        raise ValueError("Server name contains invalid characters")
    return name


def cmd_set_server_name(name: str) -> bytes:
    """Construct an allowlisted command to set the server name."""
    name = validate_server_name(name)
    return build_admin_payload(f"SETSERVEROPTION ServerName {name}")


# ============================================================================
# Rounds Per Match
# ============================================================================

def validate_rounds_per_match(rounds: int) -> int:
    """
    Validate rounds per match.

    UI expectation:
    - 1-20 rounds (matches legacy PHP validation).
    """
    if not isinstance(rounds, int):
        raise ValueError("rounds must be an integer")
    if rounds < 1 or rounds > 20:
        raise ValueError("rounds must be in range 1..20")
    return rounds


def cmd_set_rounds_per_match(rounds: int) -> bytes:
    """Construct an allowlisted command to set rounds per match."""
    rounds = validate_rounds_per_match(rounds)
    return build_admin_payload(f"SETSERVEROPTION RoundsPerMatch {rounds}")


# ============================================================================
# Bomb Time
# ============================================================================

def validate_bomb_time(seconds: int) -> int:
    """
    Validate bomb time.

    UI expectation:
    - 30-60 seconds (matches legacy PHP validation).
    """
    if not isinstance(seconds, int):
        raise ValueError("seconds must be an integer")
    if seconds < 30 or seconds > 60:
        raise ValueError("bomb time must be in range 30..60")
    return seconds


def cmd_set_bomb_time(seconds: int) -> bytes:
    """Construct an allowlisted command to set bomb time."""
    seconds = validate_bomb_time(seconds)
    return build_admin_payload(f"SETSERVEROPTION BombTime {seconds}")


# ============================================================================
# Between Round Time
# ============================================================================

def validate_between_round_time(seconds: int) -> int:
    """
    Validate between-round time.

    UI expectation:
    - 0-99 seconds (matches legacy PHP validation).
    """
    if not isinstance(seconds, int):
        raise ValueError("seconds must be an integer")
    if seconds < 0 or seconds > 99:
        raise ValueError("between-round time must be in range 0..99")
    return seconds


def cmd_set_between_round_time(seconds: int) -> bytes:
    """Construct an allowlisted command to set between-round time."""
    seconds = validate_between_round_time(seconds)
    return build_admin_payload(f"SETSERVEROPTION BetweenRoundTime {seconds}")


# ============================================================================
# Terror Count (NbTerro)
# ============================================================================

def validate_terror_count(count: int) -> int:
    """
    Validate terrorist count for co-op modes.

    UI expectation:
    - 5-40 terrorists (matches legacy PHP validation).
    """
    if not isinstance(count, int):
        raise ValueError("count must be an integer")
    if count < 5 or count > 40:
        raise ValueError("terror count must be in range 5..40")
    return count


def cmd_set_terror_count(count: int) -> bytes:
    """Construct an allowlisted command to set terrorist count."""
    count = validate_terror_count(count)
    return build_admin_payload(f"SETSERVEROPTION NbTerro {count}")


# ============================================================================
# Spam Threshold
# ============================================================================

def validate_spam_threshold(value: int) -> int:
    """
    Validate spam threshold.

    UI expectation:
    - 0-999 (reasonable range; 0 = disabled).
    """
    if not isinstance(value, int):
        raise ValueError("value must be an integer")
    if value < 0 or value > 999:
        raise ValueError("spam threshold must be in range 0..999")
    return value


def cmd_set_spam_threshold(value: int) -> bytes:
    """Construct an allowlisted command to set spam threshold."""
    value = validate_spam_threshold(value)
    return build_admin_payload(f"SETSERVEROPTION SpamThreshold {value}")


# ============================================================================
# Chat Lock Duration
# ============================================================================

def validate_chat_lock_duration(value: int) -> int:
    """
    Validate chat lock duration.

    UI expectation:
    - 0-999 (reasonable range; 0 = disabled).
    """
    if not isinstance(value, int):
        raise ValueError("value must be an integer")
    if value < 0 or value > 999:
        raise ValueError("chat lock duration must be in range 0..999")
    return value


def cmd_set_chat_lock_duration(value: int) -> bytes:
    """Construct an allowlisted command to set chat lock duration."""
    value = validate_chat_lock_duration(value)
    return build_admin_payload(f"SETSERVEROPTION ChatLockDuration {value}")


# ============================================================================
# Vote Broadcast Max Frequency
# ============================================================================

def validate_vote_broadcast_freq(value: int) -> int:
    """
    Validate vote broadcast max frequency.

    UI expectation:
    - 0-999 (reasonable range; 0 = disabled).
    """
    if not isinstance(value, int):
        raise ValueError("value must be an integer")
    if value < 0 or value > 999:
        raise ValueError("vote broadcast frequency must be in range 0..999")
    return value


def cmd_set_vote_broadcast_freq(value: int) -> bytes:
    """Construct an allowlisted command to set vote broadcast max frequency."""
    value = validate_vote_broadcast_freq(value)
    return build_admin_payload(f"SETSERVEROPTION VoteBroadcastMaxFrequency {value}")


# ============================================================================
# Boolean Server Options (toggle True/False)
# ============================================================================

# Allowlisted boolean option names — only these can be toggled.
BOOL_OPTIONS = frozenset({
    "CamFirstPerson",
    "CamThirdPerson",
    "CamFreeThirdP",
    "CamGhost",
    "CamFadeToBlack",
    "CamTeamOnly",
    "ForceFPersonWeapon",
    "FriendlyFire",
    "RotateMap",
    "Autobalance",
    "AllowRadar",
    "AIBkp",
    "TeamKillerPenalty",
    "ShowNames",
})


def validate_bool_option(option: str) -> str:
    """
    Validate a boolean server option name against the allowlist.

    Raises ValueError if the option is not recognized.
    """
    if not isinstance(option, str):
        raise ValueError("option must be a string")
    option = option.strip()
    if option not in BOOL_OPTIONS:
        raise ValueError(f"Unknown or disallowed option: {option}")
    return option


def cmd_set_server_option_bool(option: str, value: bool) -> bytes:
    """
    Construct an allowlisted command to set a boolean server option.

    Args:
        option: One of the allowlisted BOOL_OPTIONS names.
        value:  True or False.

    Returns:
        bytes: Fully formed UDP payload to send.
    """
    option = validate_bool_option(option)
    val_str = "True" if value else "False"
    return build_admin_payload(f"SETSERVEROPTION {option} {val_str}")