# KodexLink

**Your local Codex, paired to your phone.**

KodexLink starts on your desktop, opens a local pairing panel, and connects the KodexLink mobile app to your local Codex runtime.
Scan once from iPhone or Android, then keep the same Codex-backed workflow available away from your desk.

> The mobile app is required for pairing. KodexLink is not a standalone desktop GUI.

## Why Developers Install It

- Start on desktop, continue on mobile
- Pair through one QR scan from a local browser panel
- Inspect relay, service, and runtime state from one page
- Refresh pairing or reset identity when local state drifts

## 60-Second Setup

1. Install the desktop CLI:

```bash
npm install -g kodexlink
```

2. Start KodexLink:

```bash
kodexlink start
```

3. Open the KodexLink mobile app and scan the pairing QR code shown in the terminal or local panel.

## Mobile App

KodexLink pairing requires the mobile companion app:

- iPhone app (App Store): https://apps.apple.com/us/app/kodexlink-codex-mobile-chat/id6761055159?uo=4
- Android app (Google Play): https://play.google.com/store/apps/details?id=com.kodexlink.android

## What Opens When You Start

Every time you run `kodexlink start`, KodexLink:

1. Checks your local Codex runtime prerequisites.
2. Starts the desktop agent in the platform-appropriate mode.
3. Opens the local panel in your browser.
4. Prints the local panel URL in the terminal.
5. Prints a pairing QR code for the KodexLink mobile app.
6. Prints a mobile app download reminder so first-time users know what to scan.

## Platform Support

- macOS: managed background service
- Windows / Linux: foreground manual mode

## Requirements

- Node.js 18 or later
- A working `codex` command in your shell
- A local Codex session that has already completed `codex login`

## Install

```bash
npm install -g kodexlink
```

If you only want the pairing QR code in the terminal and do not want to open the browser automatically:

```bash
kodexlink pair --no-open
```

## Local Panel

The local panel is the browser-based companion page opened by KodexLink during `kodexlink start`. It provides:

- Pairing QR code and manual pairing payload
- Identity reset and fresh QR regeneration when pairing state is stale
- Relay status and current relay source
- Background service status
- Background service restart actions
- Recent local paths for logs and runtime state

## Common Commands

```bash
kodexlink start
kodexlink pair --no-open
kodexlink status
kodexlink doctor
kodexlink service-install
kodexlink service-status
kodexlink service-stop
kodexlink service-remove
```

## Relay Override

KodexLink uses the built-in relay by default:

```text
wss://relay.example.com/v1/connect
```

You can override it with a command flag:

```bash
kodexlink start --relay https://your-relay.example.com/
```

Or with an environment variable:

```bash
KODEXLINK_RELAY_URL=https://your-relay.example.com/ kodexlink start
```

KodexLink normalizes relay inputs such as `https://.../` and converts them to the correct WebSocket endpoint internally.

## Background Service

KodexLink currently supports managed background service mode on macOS only.

- macOS: per-user `launchd` agent
- Windows / Linux: keep `kodexlink start` running in the terminal for now

Useful commands:

```bash
kodexlink service-install
kodexlink service-status
kodexlink service-stop
kodexlink service-remove
```

## Known Limitations

- Windows and Linux currently run in foreground manual mode and do not yet support system-managed background service.
- KodexLink expects the local `codex` command to already be installed and authenticated.
- The current release focuses on pairing, status, local panel access, and relay connectivity. It is not a full desktop GUI client.
- `--show-pairing` is still accepted for compatibility, but `start` already shows pairing by default.

## Troubleshooting

Use:

```bash
kodexlink status
kodexlink doctor
```

If you need to switch relays, start by checking the currently active relay source in the local panel or `kodexlink status`.
