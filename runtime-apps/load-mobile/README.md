# Load Mobile

`load-mobile` is a relay protocol load and smoke test client that behaves like many mobile clients at once.

## What It Is

This app bootstraps mobile identities, claims pairings, opens relay connections, creates threads, and starts turns in bulk.

It is useful when you want to:

- stress-test the relay with many simulated mobile clients
- verify that protocol changes still work under concurrency
- run regression checks against local or remote relay environments

## Main Use Cases

- load testing
- remote relay smoke tests
- protocol regression runs
- validating pairing and turn execution at scale

## Commands

From the repository root:

```bash
pnpm load-mobile:run
```

From this directory:

```bash
pnpm run
pnpm build
pnpm typecheck
```

## Relationship To Other Apps

- Usually targets `runtime-apps/relay-server`
- Often used together with `runtime-apps/fake-agent`
- Intended for testing and benchmarking, not for end-user production usage
