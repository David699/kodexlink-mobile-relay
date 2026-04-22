# Fake Agent

`fake-agent` is a lightweight relay-connected test agent used for protocol development and local debugging.

## What It Is

This app connects to the relay server as an agent and simulates Codex-style behavior without depending on the real desktop runtime.

It is useful when you want to:

- test relay message flow end to end
- exercise mobile-to-agent interactions locally
- debug protocol handling without running the full desktop agent

## Main Use Cases

- local protocol regression checks
- development-time smoke tests
- validating pairing, thread, turn, approval, and interrupt flows

## Commands

From the repository root:

```bash
pnpm fake-agent:serve
```

From this directory:

```bash
pnpm serve
pnpm build
pnpm typecheck
```

## Relationship To Other Apps

- Works with `runtime-apps/relay-server` as the relay backend
- Can be used together with `runtime-apps/load-mobile` for load and protocol testing
- Exists for testing and development, not for production deployment
