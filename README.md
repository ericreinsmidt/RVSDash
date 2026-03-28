<!--
==============================================================================
File: README.md
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

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

# RVSDash - Raven Shield Dashboard (Status, Stats and Admin)

This repo provides
* A **built-in** [uvicorn](https://uvicorn.dev) **web server** with [FastAPI](https://fastapi.tiangolo.com)
* A **status dashboard** page (`/status`) that shows server summary, players, maplist, and raw KV.
* A **statistics dashboard** page (`/stats`) that shows server and player statistics.
* An **admin dashboard** page (`/admin`) that sends **allowlisted** UDP admin commands.
* A small **landing page** (`/`) linking to all three.

## Requirements

* Raven Shield game server
* Machine to run this app
	* Python 3.11+ (probably works with 3.8+, but untested)

## Install

* On game server
	* Place `N4Admin.u` in your `System` directory
	* Place `URLPost.u` in your `System` directory
	* Place `N4IDMod.utx` in your `Textures` directory
	* Edit `RavenShield.ini` in your `System` directory

		* Take note of your `BeaconPort` value

				[IpDrv.UdpBeacon]
				DoBeacon=True
				ServerBeaconPort=8777
				BeaconPort=9777
				BeaconTimeout=10.000000
		* Add 	

				[N4Admin.UDPBeaconEx]
				AdminPassword=YOUR_ADMIN_PASSWORD # This is not the password for in-game admin, just for this tool

		* Add

				[urlPost.urlPost]
				postHost=YOUR_DOMAIN_NAME.TLD
				postURL=/api/ingest
				postPort=YOUR_PORT
				postIdent=YOUR_UNIQUE_SERVER_ID

			- Note: this has not been tested with HTTPS, and should be assumed it will only work with HTTP

	* Edit `Ravenshield.mod` in your `Mods` directory
		* In the `[Engine.GameEngine]` section, comment out the default beacon and add in the N4Admin extended beacon and URLPost underneath with

				;ServerActors=IpDrv.UdpBeacon
				ServerActors=N4Admin.UdpBeaconEx
				ServerActors=urlPost.urlPost

		* In the same section, add in the N4IDMod identification service for statistics with

				ServerPackages=N4IDMod
				ServerActors=N4IDMod.N4IDMod

			- Note: after being installed and run once, you can edit `N44IDMod.ini` in the `System` directory to show players where the statistics can be viewed.

* On machine running `RVSDash`
	* Add `RVSDash` folder to the directory of your choice

	* Edit `app/config.py`
	
			DEFAULT_SERVER_IP # Change to your game server IP address
			DEFAULT_SERVER_PORT # Change to the BeaconPort from [IpDrv.UdpBeacon] in Ravenshield.ini

## Run

* In `RVSDash` directory

	* Set up environment and install requirements

			python3 -m venv .venv
			source .venv/bin/activate
			pip install -r requirements.txt

	* Add your password as an environment variable

		* macOS / Linux

				export RVS_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD

		* Windows (PowerShell)

				$env:RVS_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD

		* Windows (CMD)

				set RVS_ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD

	* Start the web server

			uvicorn app.main:app --reload --host 127.0.0.1 --port 2003
			
		- Note: use `0.0.0.0` to bind instead of `127.0.0.1` if you intend to have this open outside your local machine.

## Open
- Landing page http://127.0.0.1:2003/
- Status page http://127.0.0.1:2003/status
- Statistics page http://127.0.0.1:2003/stats
- Administration page http://127.0.0.1:2003/admin
	- Note: Use appropriate IP address if bound to `0.0.0.0`.

## Important Note!
* There is no authentication on the `admin` endpoint. This means it is up to you to secure it if this is exposed to the internet or an untrusted LAN. Otherwise, anyone with access to the `admin` endpoint can send commands to your game server.

* There are many ways to do this
	* Use HTTP basic access authentication (terrible idea. Really.)
	* Use Cloudflare Access on the `/admin` endpoint
	* Use Authelia
	* etc

## To Do
* Improve player and server stats
* Add tooltips about existing admin commands
* Add toggles for various simple game server settings
* Add commands for inserting/deleting maps
* Add command to create/save map lists

## License and Notice
* All code is licensed under MIT except `N4Admin.u`,`URLPost.u` (© 2004 Neil Popplewell) and `N4IDMod.utx` (© 2020 [Dateranoth](https://github.com/Dateranoth/RainbowSix-Ravenshield-N4Admin/releases)), which are covered under their respective licenses.
