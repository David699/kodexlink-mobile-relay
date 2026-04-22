import { configureFileLogger, createId, createLogger } from "@kodexlink/shared";

import {
  MobileLoadClient,
  bootstrapAgent,
  bootstrapMobile,
  claimPairing,
  createPairing,
  type AgentIdentity,
  type TurnResult
} from "./client.js";
import { loadConfig, type LoadMobileConfig } from "./config.js";
import { summarizeTurnsFromStats } from "./metrics.js";

configureFileLogger({
  appName: "load-mobile"
});

interface SetupSuccess {
  index: number;
  mobileId: string;
  bindingId: string;
  threadId: string;
  client: MobileLoadClient;
}

interface SetupFailure {
  index: number;
  mobileId: string;
  error: string;
}

interface TurnFailure {
  index: number;
  mobileId: string;
  threadId: string;
  error: string;
}

interface TurnStats {
  attempted: number;
  failed: number;
  statusCounts: Record<string, number>;
  durationMsValues: number[];
  failureSamples: TurnFailure[];
}

function createMobileId(runTag: string, index: number): string {
  const suffix = String(index).padStart(4, "0");
  return `load-mobile-${runTag}-${suffix}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function randomIntInRange(minValue: number, maxValue: number): number {
  if (maxValue <= minValue) {
    return minValue;
  }
  const span = maxValue - minValue + 1;
  return minValue + Math.floor(Math.random() * span);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSetupSuccess(result: SetupSuccess | SetupFailure): result is SetupSuccess {
  return "client" in result;
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  if (items.length === 0) {
    return results;
  }

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const runners: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i += 1) {
    runners.push(
      (async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= items.length) {
            return;
          }
          const item = items[index] as T;
          results[index] = await worker(item, index);
        }
      })()
    );
  }

  await Promise.all(runners);
  return results;
}

async function setupSingleClient(
  index: number,
  runTag: string,
  relayHttpBaseUrl: string,
  relayWsUrl: string,
  turnTimeoutMs: number,
  agentIdentity: AgentIdentity
): Promise<SetupSuccess | SetupFailure> {
  const logger = createLogger(`load-mobile#${index}`);
  const mobileId = createMobileId(runTag, index);
  let client: MobileLoadClient | null = null;

  try {
    const mobileIdentity = await bootstrapMobile(relayHttpBaseUrl, mobileId);
    const pairing = await createPairing(relayHttpBaseUrl, agentIdentity, `load-client-${index}`);
    const bindingId = await claimPairing(relayHttpBaseUrl, mobileIdentity, pairing, `LoadClient-${index}`);

    client = new MobileLoadClient(relayWsUrl, turnTimeoutMs, logger);
    await client.connect(mobileIdentity, bindingId);
    const threadId = await client.createThread();

    return {
      index,
      mobileId,
      bindingId,
      threadId,
      client
    };
  } catch (error) {
    if (client) {
      client.close();
    }
    return {
      index,
      mobileId,
      error: toErrorMessage(error)
    };
  }
}

async function runSingleTurn(session: SetupSuccess, text: string): Promise<TurnResult | TurnFailure> {
  try {
    const result = await session.client.startTurn(session.threadId, text);
    return result;
  } catch (error) {
    return {
      index: session.index,
      mobileId: session.mobileId,
      threadId: session.threadId,
      error: toErrorMessage(error)
    };
  }
}

function isTurnResult(result: TurnResult | TurnFailure): result is TurnResult {
  return "requestId" in result;
}

function isTurnFailure(result: TurnResult | TurnFailure): result is TurnFailure {
  return "error" in result;
}

function recordTurnFailure(stats: TurnStats, failure: TurnFailure): void {
  stats.failed += 1;
  if (stats.failureSamples.length < 10) {
    stats.failureSamples.push(failure);
  }
}

async function runSessionLoop(
  session: SetupSuccess,
  config: LoadMobileConfig,
  deadlineMs: number,
  stats: TurnStats
): Promise<void> {
  let turnSequence = 0;

  while (Date.now() < deadlineMs) {
    turnSequence += 1;
    const text = `${config.requestText} [client-${session.index}] [turn-${turnSequence}]`;
    const result = await runSingleTurn(session, text);
    stats.attempted += 1;

    if (isTurnResult(result)) {
      stats.statusCounts[result.status] = (stats.statusCounts[result.status] ?? 0) + 1;
      stats.durationMsValues.push(result.durationMs);
    } else if (isTurnFailure(result)) {
      recordTurnFailure(stats, result);
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    const thinkTimeMs = randomIntInRange(config.thinkTimeMsMin, config.thinkTimeMsMax);
    if (thinkTimeMs > 0) {
      await sleep(Math.min(thinkTimeMs, remainingMs));
    }
  }
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger("load-mobile");
  const durationMs = Math.floor(config.durationMinutes * 60_000);
  const reportIntervalMs = config.reportIntervalSec * 1_000;

  const runTag = createId("run").replace("run_", "").slice(0, 8);
  logger.info("load test started", {
    runTag,
    relayHttpBaseUrl: config.relayHttpBaseUrl,
    relayWsUrl: config.relayWsUrl,
    agentId: config.agentId,
    totalClients: config.totalClients,
    setupParallelism: config.setupParallelism,
    turnTimeoutMs: config.turnTimeoutMs,
    durationMinutes: config.durationMinutes,
    thinkTimeMsMin: config.thinkTimeMsMin,
    thinkTimeMsMax: config.thinkTimeMsMax,
    reportIntervalSec: config.reportIntervalSec
  });

  const startedAtMs = Date.now();
  const agentIdentity = await bootstrapAgent(config.relayHttpBaseUrl, config.agentId);

  const indexes = Array.from({ length: config.totalClients }, (_unused, index) => index + 1);
  const setupStartedAt = Date.now();

  const setupResults = await mapWithConcurrency(indexes, config.setupParallelism, (index) =>
    setupSingleClient(
      index,
      runTag,
      config.relayHttpBaseUrl,
      config.relayWsUrl,
      config.turnTimeoutMs,
      agentIdentity
    )
  );

  const setupDurationMs = Date.now() - setupStartedAt;
  const sessions = setupResults.filter(isSetupSuccess);
  const setupFailures = setupResults.filter((result) => !isSetupSuccess(result));

  logger.info("setup completed", {
    setupDurationMs,
    successCount: sessions.length,
    failureCount: setupFailures.length
  });

  for (const failure of setupFailures.slice(0, 10)) {
    logger.warn("setup failed", { ...failure });
  }

  if (sessions.length === 0) {
    throw new Error("no mobile sessions are ready, load test aborted");
  }

  try {
    logger.info("starting sustained turns", {
      activeClients: sessions.length,
      durationMinutes: config.durationMinutes,
      thinkTimeMsMin: config.thinkTimeMsMin,
      thinkTimeMsMax: config.thinkTimeMsMax
    });

    const stats: TurnStats = {
      attempted: 0,
      failed: 0,
      statusCounts: {},
      durationMsValues: [],
      failureSamples: []
    };

    const deadlineMs = Date.now() + durationMs;
    const turnsStartedAt = Date.now();
    const reportTimer = setInterval(() => {
      const progress = summarizeTurnsFromStats(stats.statusCounts, stats.durationMsValues, stats.failed);
      logger.info("load test progress", {
        elapsedMs: Date.now() - turnsStartedAt,
        attemptedTurns: stats.attempted,
        ...progress
      });
    }, reportIntervalMs);

    try {
      await Promise.all(
        sessions.map((session) => runSessionLoop(session, config, deadlineMs, stats))
      );
    } finally {
      clearInterval(reportTimer);
    }

    const turnsDurationMs = Date.now() - turnsStartedAt;
    const summary = summarizeTurnsFromStats(stats.statusCounts, stats.durationMsValues, stats.failed);

    logger.info("turns completed", {
      turnsDurationMs,
      attemptedTurns: stats.attempted,
      ...summary
    });

    for (const failure of stats.failureSamples) {
      logger.warn("turn failed", { ...failure });
    }

    const totalDurationMs = Date.now() - startedAtMs;
    logger.info("load test finished", {
      totalDurationMs,
      runTag,
      setupDurationMs,
      turnsDurationMs,
      summary
    });

    if (stats.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    for (const session of sessions) {
      session.client.close();
    }
  }
}

if (import.meta.url === new URL(`file://${process.argv[1] ?? ""}`).toString()) {
  main().catch((error) => {
    const logger = createLogger("load-mobile");
    logger.error("load test crashed", {
      error: toErrorMessage(error)
    });
    process.exitCode = 1;
  });
}
