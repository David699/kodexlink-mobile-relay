# KodexLink Relay Deployment Guide

This document explains how to install and deploy the KodexLink relay server in production.

The current production setup in this repository assumes:

- Ubuntu host
- Node.js managed through `nvm`
- `pnpm` for install and build
- PostgreSQL for persistent storage
- Redis for runtime state
- `systemd` for process supervision
- Nginx for HTTPS termination and WebSocket proxying

## Recommended Target

The recommended production target is an Ubuntu server with:

- A public domain such as `relay.example.com`
- TLS certificate and private key already available on disk
- Root or sudo access
- Ports `80` and `443` reachable from the public internet

## Relay Runtime Requirements

The relay server reads these environment variables:

- `NODE_ENV=production`
- `PORT`
- `RELAY_BIND_HOST`
- `RELAY_PUBLIC_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `RELAY_ENABLE_DEV_RESET=0`

Relevant config loader:
`src/config/index.ts`

## Option A: Recommended Automated Host Setup

Use the host bootstrap script from the repository root:

```bash
sudo bash scripts/setup-ubuntu-relay-host.sh \
  --domain relay.example.com \
  --ssl-cert-path /path/to/fullchain.pem \
  --ssl-key-path /path/to/privkey.pem \
  --db-password "strong-password"
```

What this script does:

- Installs base packages
- Installs Node.js through `nvm`
- Installs and enables Nginx, PostgreSQL, and Redis
- Creates the relay system user and directories
- Creates the PostgreSQL database and user
- Writes the relay environment file
- Writes the `systemd` unit
- Writes the Nginx site config
- Runs a post-install verification pass

Related scripts from the repository root:

- `scripts/setup-ubuntu-relay-host.sh`
- `scripts/check-ubuntu-relay-host.sh`

## Recommended Directory Layout

The bootstrap script currently assumes these defaults:

- App directory: `/srv/kodexlink`
- Environment file: `/etc/kodexlink/relay.env`
- Log directory: `/var/log/kodexlink`
- Service unit: `/etc/systemd/system/kodexlink-relay.service`

## Deploy Application Code

After the host has been prepared, copy this repository to the app directory on the server.

Then on the server:

```bash
cd /srv/kodexlink
pnpm install --frozen-lockfile
pnpm build
```

## Run Database Migrations

Run the relay migration before first start or after schema changes:

```bash
cd /srv/kodexlink
pnpm relay-server:migrate
```

The relay package also exposes the local package script:

```bash
cd /srv/kodexlink
pnpm --filter @kodexlink/relay-server migrate
```

## Start and Enable the Relay Service

If you used the Ubuntu setup script, the service unit is named `kodexlink-relay`.

Enable and restart it with:

```bash
sudo systemctl enable kodexlink-relay
sudo systemctl restart kodexlink-relay
```

Check status:

```bash
sudo systemctl status kodexlink-relay
```

## Health Check

After the service is running, verify that the relay is reachable:

```bash
curl -I https://relay.example.com/healthz
```

The WebSocket endpoint is expected to be proxied by Nginx at:

```text
wss://relay.example.com/v1/connect
```

## Nginx Proxy Behavior

The current Ubuntu setup script configures Nginx to:

- Redirect HTTP to HTTPS
- Proxy `/v1/connect` to the relay process on the local relay port
- Forward the remaining HTTP routes to the relay process

This is important because desktop agents may pass `https://relay.example.com/`, and the client normalizes that into the WebSocket endpoint internally.

## Manual Deployment Checklist

If you do not use the setup script, make sure you still provide all of the following:

- Node.js and `pnpm`
- PostgreSQL database and credentials
- Redis instance
- A production `relay.env`
- A process supervisor such as `systemd`
- An HTTPS reverse proxy that supports WebSocket upgrade

## Example `relay.env`

```dotenv
NODE_ENV=production
PORT=8787
RELAY_BIND_HOST=127.0.0.1
RELAY_PUBLIC_BASE_URL=https://relay.example.com
DATABASE_URL=postgres://kodexlink:strong-password@127.0.0.1:5432/codex_mobile
REDIS_URL=redis://127.0.0.1:6379
RELAY_ENABLE_DEV_RESET=0
```

## Useful Commands

From the repository root:

```bash
pnpm relay-server:start
pnpm relay-server:migrate
pnpm relay-server:threads
pnpm relay-server:resume
pnpm relay-server:chat
```

From the relay package directory:

```bash
pnpm build
pnpm start
pnpm migrate
```

## Troubleshooting

If deployment fails, check these in order:

1. `systemctl status kodexlink-relay`
2. Nginx config and certificate paths
3. PostgreSQL connectivity through `DATABASE_URL`
4. Redis connectivity through `REDIS_URL`
5. Port bindings on `80`, `443`, and the internal relay port
6. The output of:

```bash
bash scripts/check-ubuntu-relay-host.sh --phase postinstall \
  --domain relay.example.com \
  --ssl-cert-path /path/to/fullchain.pem \
  --ssl-key-path /path/to/privkey.pem
```
