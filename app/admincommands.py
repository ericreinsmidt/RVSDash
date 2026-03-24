# admincommands.py
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


# ------------------------------------------------------------------------------
# allowlisted command constructors
# ------------------------------------------------------------------------------

def cmd_set_rt(seconds: int) -> bytes:
    """
    Construct a allowlisted command to set RoundTime.
    """
    seconds = validate_rt_seconds(seconds)
    return build_admin_payload(f"SETSERVEROPTION RoundTime {seconds}")


def cmd_set_motd(text: str) -> bytes:
    """
    Construct a allowlisted command to set MOTD.

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
    Construct a allowlisted command to load an INI.

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
    Construct a allowlisted SAY command.

    """
    msg = validate_say_message(msg)
    return build_admin_payload(f"SAY ADMIN: {msg}")


def cmd_restart() -> bytes:
    """
    Construct a allowlisted RESTART command.

    """
    return build_admin_payload("RESTART")


# Set difficulty SETSERVEROPTION DiffLevel <n>
def cmd_set_diff_level(level: int) -> bytes:
    """
    Construct a allowlisted command to set server difficulty.

    """
    level = validate_diff_level(level)
    return build_admin_payload(f"SETSERVEROPTION DiffLevel {level}")