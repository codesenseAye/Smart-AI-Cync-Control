---
name: dns
description: Manage the DNS override that redirects Cync cloud domains to the local cync-lan server via Technitium DNS
argument-hint: <enable|disable|status>
disable-model-invocation: true
---

Manage the DNS override for cync-lan using Technitium DNS Server. This creates/removes DNS zones in Technitium to redirect Cync cloud domains (`cm.gelighting.com`, `cm-sec.gelighting.com`, `cm-ge.xlink.cn`) to the local cync-lan server IP **network-wide**.

The argument is: $ARGUMENTS

Based on the argument:

## If "enable"

1. Read `CYNC_LAN_IP` and the `TECHNITIUM_*` variables from the `.env` file in the project root. If `CYNC_LAN_IP` is empty or missing, ask the user for the target IP address.
2. Authenticate with Technitium DNS API (`POST http://localhost:5380/api/user/login` with `user` and `pass` form params from `.env`) to get a session token.
3. For each Cync domain (`cm.gelighting.com`, `cm-sec.gelighting.com`, `cm-ge.xlink.cn`):
   - Create a primary zone: `GET /api/zones/create?token=TOKEN&zone=DOMAIN&type=Primary`
   - Add an A record: `GET /api/zones/records/add?token=TOKEN&zone=DOMAIN&domain=DOMAIN&type=A&ipAddress=TARGET_IP&overwrite=true&ttl=60`
4. Verify by querying each zone's records and confirm the override is active.

## If "disable"

1. Authenticate with Technitium DNS API (same as enable).
2. For each Cync domain, delete the zone: `GET /api/zones/delete?token=TOKEN&zone=DOMAIN`
3. Confirm the zones have been removed.

## If "status"

1. Authenticate with Technitium DNS API (same as enable).
2. For each Cync domain, try to get zone records: `GET /api/zones/records/get?token=TOKEN&domain=DOMAIN&zone=DOMAIN`
3. Report whether the override is active and show the current A record entries if so.
4. Also check the legacy hosts file (`C:\Windows\System32\drivers\etc\hosts`) for any old `# >>> cync-lan DNS override` block and mention it if found.

## If no argument or unrecognized

Show usage: `/dns enable`, `/dns disable`, `/dns status`

## Important

- Technitium DNS Server must be running locally (default: `http://localhost:5380`).
- Credentials are in `.env` as `TECHNITIUM_USERNAME` and `TECHNITIUM_PASSWORD`.
- This provides **network-wide** DNS override — all devices on the network using Technitium as their DNS server will resolve the Cync domains to the cync-lan IP.
- If the Technitium API is unreachable, tell the user to ensure Technitium DNS Server is running.
