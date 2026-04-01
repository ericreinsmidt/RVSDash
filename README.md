<!--
==============================================================================
File: README.md
Project: RVSDash - Raven Shield Dashboard
Author: [Eric Reinsmidt](https://reinsmidt.com)

What this file does:
- Provides human-readable setup and run instructions for the project.
- Explains what pages/endpoints the application exposes.
- Documents required configuration (DEFAULT_SERVER_IP/PORT, env vars).
- Acts as the first place an operator looks when deploying.

How to use it:
- Read top-to-bottom to install dependencies and run uvicorn.
- Use it as a checklist when troubleshooting (env var, binding, ports).
==============================================================================
-->

# RVSDash - Raven Shield Dashboard (Status and Admin)

A modern web dashboard for monitoring and administering a **Tom Clancy's Rainbow Six: Raven Shield** (2003) dedicated game server.

## What It Does

### Status Page (`/status`)
- Live server status with auto-refresh (server name, map, game mode, player count)
- Live player list with names, pings, kills, deaths
- Last 5 completed rounds with player links
- Loadout viewer (primary/secondary weapons, gadgets)

### Statistics Page (`/stats`)
- Player leaderboard with sortable columns
- Per-player detail pages with round history, weapon stats, accuracy, and score
- Player identity merging for fragmented guest accounts
- Game mode friendly names

### Admin Page (`/admin`)
- **Live Players** - auto-refreshing player list with kick and ban buttons
- **Messenger** - set the three auto-messenger text lines, toggle messenger on/off
- **Server Commands** - say (chat as admin), set server name, set MOTD, set max players, set/disable game password
- **Server Control** - restart round, restart match, restart server, toggle messenger
- **Server Settings** (accordion sections, changes require restart match):
  - *Game Rules* - round time, difficulty, rounds per match, bomb time, between-round time, terrorist count
  - *Chat & Voting* - spam threshold, chat lock duration, vote broadcast max frequency
  - *Server Options* - toggle friendly fire, auto team balance, radar, team names, team killer penalty, map rotation, AI backup, force first person weapon
  - *Camera Options* - toggle first person, third person, free third person, ghost, fade to black, team only
- **Map Management** — load/save map lists, go to map, add/remove maps from rotation, clear rotation (bulk remove), fetch available maps with game modes
- **Player Merge** - detect and merge fragmented guest accounts (e.g. `Player_XXXXXXXX` variants)
- **Ban List** - fetch and view the server's ban list (GUIDs and IPs)

### Data Pipeline
- The game server pushes round data to RVSDash via the URLPost mod after each round
- Round data is stored in a SQLite database (`app/data/rvsstats.sqlite3`)
- An NDJSON audit log is written alongside the database (`app/data/ingest.ndjson`)
- The `app/data/` directory is created automatically on first run

## Project Structure

```
RVSDash/
├── run.sh
├── requirements.txt
├── README.md
│
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── main.py
│   ├── udp.py
│   ├── parse.py
│   ├── admincommands.py
│   ├── rvsstats_db.py
│   ├── ingest.py
│   │
│   ├── data/                          (created automatically on first run)
│   │   ├── rvsstats.sqlite3
│   │   └── ingest.ndjson
│   │
│   └── web/
│       ├── index.html
│       ├── status.html
│       ├── stats.html
│       ├── admin.html
│       ├── player.html
│       │
│       ├── css/
│       │   ├── common.css
│       │   ├── landing.css
│       │   ├── status.css
│       │   ├── stats.css
│       │   └── admin.css
│       │
│       ├── js/
│       │   ├── common.js
│       │   ├── landing.js
│       │   ├── status.js
│       │   ├── stats.js
│       │   ├── admin.js
│       │   └── player.js
│       │
│       └── img/
│           └── paper.jpg
│
└── tools/
    └── import_existing_ndjson.py
```

## Requirements

* Raven Shield dedicated game server
* A machine to run RVSDash (can be the same machine or a different one)
  * Python 3.11+
  * Network access to the game server's beacon UDP port

### Network / Port Requirements

| Direction | Protocol | Port | Purpose |
|-----------|----------|------|---------|
| RVSDash → Game Server | UDP | ServerBeaconPort (e.g. 8877) | Status queries and admin commands |
| Game Server → RVSDash | HTTP | RVSDash port (e.g. 2003) | URLPost round data ingestion |

Both machines need to be able to reach each other on the respective ports. If a firewall is in between, ensure these ports are open in the correct direction.

## Install

### On the Game Server

1. Place `N4Admin.u` in your `System` directory.
2. Place `URLPast.u` in your `System` directory.
3. Place `N4IDMod.utx` in your `Textures` directory.
4. Edit `RavenShield.ini` in your `System` directory:

   * Take note of your `ServerBeaconPort` value. You will need this when configuring RVSDash.

         [IpDrv.UdpBeacon]
         DoBeacon=True
         ServerBeaconPort=8877
         BeaconPort=9877
         BeaconTimeout=10.000000

   * Add the N4Admin UDP beacon configuration:

         [N4Admin.UDPBeaconEx]
         AdminPassword=YOUR_ADMIN_PASSWORD

     > This is **not** the in-game admin password. This is a separate password used only by RVSDash to send admin commands over UDP.

   * Add the URLPost configuration for round data ingestion:

         [urlPost.urlPost]
         postHost=YOUR_RVSDASH_IP_OR_HOSTNAME
         postURL=/api/ingest
         postPort=2003
         postIdent=YOUR_UNIQUE_SERVER_ID

     | Setting | Description |
     |---------|-------------|
     | `postHost` | The IP address or hostname of the machine running RVSDash. This is where the game server will send round data after each round. Do not include `http://` - just the bare IP or hostname. |
     | `postURL` | Must be `/api/ingest` - this is the RVSDash endpoint that receives round data. Do not change this. |
     | `postPort` | The port RVSDash is listening on (default `2003`). Must match the `--port` value used when starting RVSDash. If RVSDash is behind a reverse proxy, use the proxy's port instead (e.g. `80` or `443`). |
     | `postIdent` | A unique identifier for this game server. Used to distinguish data if you run multiple servers pointing at the same RVSDash instance. Can be any short string (e.g. `myserver1`). |

     > **Note:** URLPost has not been tested with HTTPS. Assume HTTP only. If RVSDash is behind a reverse proxy that terminates TLS, point `postHost` and `postPort` at the proxy and let it forward to RVSDash over HTTP internally.

5. Edit `RavenShield.mod` in your `Mods` directory:

   * In the `[Engine.GameEngine]` section, comment out the default beacon and add N4Admin + URLPost:

         ;ServerActors=IpDrv.UdpBeacon
         ServerActors=N4Admin.UdpBeaconEx
         ServerActors=urlPost.urlPost

     > **Note:** The base `RavenShield.ini` may still have `ServerActors=IpDrv.UdpBeacon` in its `[Engine.GameEngine]` section. That's fine - the mod file overrides it. Just make sure the mod file has the line commented out and the N4Admin replacement added.

   * In the same section, add N4IDMod for player identification:

         ServerPackages=N4IDMod
         ServerActors=N4IDMod.N4IDMod

     > After running once, you can edit `N4IDMod.ini` in the `System` directory to configure where players are told to view their statistics.

6. Restart the game server.

### On the Machine Running RVSDash

1. Clone or copy the `RVSDash` folder to the directory of your choice.

2. Edit `app/config.py`:

       DEFAULT_SERVER_IP   = "YOUR_GAME_SERVER_IP"
       DEFAULT_SERVER_PORT = 8877  # ServerBeaconPort from [IpDrv.UdpBeacon] in RavenShield.ini

3. (Optional) Customize `SITE_TITLE`, `SITE_HEADING`, `NAV_LINKS`, and `FOOTER_HTML` in `config.py` to personalize the dashboard.

## Run

1. Set up the Python environment and install dependencies:

       python3 -m venv .venv
       source .venv/bin/activate
       pip install -r requirements.txt

2. Set the admin password environment variable:

   * macOS / Linux:

         export RVS_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD

   * Windows (PowerShell):

         $env:RVS_ADMIN_PASSWORD="YOUR_ADMIN_PASSWORD"

   * Windows (CMD):

         set RVS_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD

   > This must match the `AdminPassword` value in `RavenShield.ini` under `[N4Admin.UDPBeaconEx]`.

3. Start the web server:

       uvicorn app.main:app --host 127.0.0.1 --port 2003

   > Use `0.0.0.0` instead of `127.0.0.1` if you want the dashboard accessible from other machines on the network.

   > **Tip:** Add `--reload` if updating to auto-restart on file changes (e.g. when customizing for site branding via `config.py`).

   Alternatively, you can create a `run.sh` script:

   ```bash
   #!/bin/bash
   export RVS_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
   source .venv/bin/activate
   uvicorn app.main:app --host 0.0.0.0 --port 2003
   ```

## Pages

| URL | Description |
|-----|-------------|
| `http://YOUR_IP:2003/` | Landing page with links to all sections |
| `http://YOUR_IP:2003/status` | Live server status and recent rounds |
| `http://YOUR_IP:2003/stats` | Player statistics leaderboard |
| `http://YOUR_IP:2003/stats/player/<id>` | Per-player detail page |
| `http://YOUR_IP:2003/admin` | Admin control panel |

## Security

**There is no built-in authentication on the admin page.** If the dashboard is exposed to the internet or an untrusted network, anyone with access to `/admin` can send commands to your game server (kick players, ban players, change maps, restart the server, etc.).

**You are responsible for securing access.** Options include:

- **Cloudflare Access** - protect the `/admin` path with identity-aware access control (recommended if using Cloudflare)
- **Authelia** or **Authentik** - self-hosted identity-aware proxy
- **Reverse proxy with IP allowlisting** - restrict `/admin` to specific IPs via nginx/Caddy
- **VPN** - only expose the dashboard on a VPN network
- HTTP basic auth (functional but not recommended as a sole measure)

The status, stats, player, and landing pages are read-only and safe to expose publicly.

## Data and Backups

Stats data is stored in `app/data/`, which is created automatically on first run:

| File | Description |
|------|-------------|
| `app/data/rvsstats.sqlite3` | SQLite database with all player stats, round history, and merge aliases |
| `app/data/ingest.ndjson` | Newline-delimited JSON audit log of every round received from the game server |

To back up your stats, copy the `app/data/` directory while RVSDash is stopped:

```bash
# Stop RVSDash first, then:
cp -r app/data/ /path/to/your/backup/rvsdash-data-$(date +%Y%m%d)/
```

### Rebuilding the Database from NDJSON

If the SQLite database is lost or corrupted, you can rebuild it from the NDJSON audit log using the included import tool:

```bash
# Remove or rename the corrupted database (if it exists)
mv app/data/rvsstats.sqlite3 app/data/rvsstats.sqlite3.bak

# Rebuild from the NDJSON log (run from the project root)
python3 tools/import_existing_ndjson.py \
  --ndjson app/data/ingest.ndjson \
  --db app/data/rvsstats.sqlite3
```

The import tool is safe to re-run - it tracks which lines have already been imported and skips duplicates. Fragmented guest accounts (`Player_XXXXXXXX` variants) are automatically detected and merged during import, matching the behavior of the live ingest pipeline. However, any manual merge aliases created via the admin page are stored only in the database and will need to be re-created after a rebuild.

## Troubleshooting

| Problem | Check |
|---------|-------|
| Admin commands fail silently | Verify `RVS_ADMIN_PASSWORD` env var matches `AdminPassword` in `RavenShield.ini` under `[N4Admin.UDPBeaconEx]` |
| Status page shows "No response" | Verify `DEFAULT_SERVER_IP` and `DEFAULT_SERVER_PORT` in `config.py` match your game server's `ServerBeaconPort`. Check that UDP traffic can reach the game server on that port. |
| Stats page is empty | Verify URLPost is configured correctly and the game server can reach RVSDash via HTTP on the configured `postPort`. At least one round must complete before stats appear. |
| Fragmented guest accounts | Players connecting without a Ubi account get names like `Player_XXXXXXXX`. Use the Player Merge feature on the admin page to combine these under the canonical account. |
| Admin page accessible to everyone | RVSDash has no built-in auth. See the [Security](#security) section for options to restrict access. |
| Changes to server settings not taking effect | Settings in the Server Settings section (round time, difficulty, rounds per match, bomb time, between-round time, terrorist count, boolean toggles, camera options) require a **Restart Match** from the Server Control section to apply. |
| Database corrupted or lost | Rebuild from the NDJSON audit log. See [Rebuilding the Database from NDJSON](#rebuilding-the-database-from-ndjson). |

## License and Notice

All code is licensed under **MIT** except:
- `N4Admin.u`, `URLPost.u` - © 2004 Neil Popplewell, covered under their respective licenses
- `N4IDMod.utx` - © 2020 [Dateranoth](https://github.com/Dateranoth/RainbowSix-Ravenshield-N4Admin/releases), covered under its respective license