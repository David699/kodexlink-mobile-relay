# Relay Server

`relay-server` is the backend message relay for KodexLink.

## What It Is

This service sits between mobile clients and desktop or agent-side runtimes. It manages authentication, pairing, bindings, routing, thread actions, turn execution flow, approvals, and connection state.

The relay is the central backend service for the whole KodexLink system.

## Responsibilities

- device bootstrap and token validation
- pairing session creation and claiming
- mobile-to-agent routing
- thread and turn request forwarding
- approval and interrupt coordination
- agent presence and health propagation
- PostgreSQL-backed persistence and Redis-backed runtime state

## Commands

From the repository root:

```bash
pnpm relay-server:migrate
pnpm relay-server:start
pnpm relay-server:threads
pnpm relay-server:resume -- <threadId>
pnpm relay-server:chat -- <threadId>
```

From this directory:

```bash
pnpm migrate
pnpm start
pnpm build
pnpm typecheck
```

## Deployment

For Ubuntu installation and production deployment, see:

- [DEPLOYMENT.md](DEPLOYMENT.md)

## Relationship To Other Apps

- Serves `runtime-apps/desktop-agent`
- Serves the iOS and Android clients
- Supports testing clients such as `runtime-apps/fake-agent` and `runtime-apps/load-mobile`
