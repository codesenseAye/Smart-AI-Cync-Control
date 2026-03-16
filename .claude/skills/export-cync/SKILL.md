---
name: export-cync
description: Export device config from the Cync Cloud API by authenticating with email, password, and OTP
argument-hint: (no arguments)
disable-model-invocation: true
---

Export device configuration from the Cync Cloud API and write `cync_mesh.yaml` to the project root. This is a two-step process that collects credentials interactively.

## Steps

1. **Ask for email and password** — Use AskUserQuestion to ask the user for their Cync account email address and password (two separate questions in one call).

2. **Request OTP** — Run: `npx tsx scripts/export-cync.ts request-otp --email <email>`
   This sends a verification code to the user's email.

3. **Ask for OTP** — Use AskUserQuestion to ask the user for the OTP code they received in their email.

4. **Export** — Run: `npx tsx scripts/export-cync.ts export --email <email> --password <password> --otp <otp>`
   This authenticates, fetches all homes and devices, and writes `cync_mesh.yaml`.

5. **Report results** — Show the user the output. Suggest running `/scan-rooms` to generate `rooms.json` from the exported config.

## What the script does

1. Authenticates with the Cync Cloud API using email, password, and OTP two-factor code
2. Fetches all homes and devices associated with the account
3. Determines device capabilities (RGB, color temperature, plug) from device type codes
4. Writes `cync_mesh.yaml` in the `account data` format that `/scan-rooms` expects

## Direct terminal usage

Users can also run the script directly in their terminal for an interactive experience with masked password input:

```bash
npx tsx scripts/export-cync.ts
```
