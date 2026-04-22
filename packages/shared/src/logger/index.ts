import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface FileLoggerConfig {
  appName: string;
  logDir: string;
  retentionDays: number;
}

interface FileLoggerRuntimeState {
  config: FileLoggerConfig;
  currentDateTag: string;
  currentFilePath: string;
  cleanedDateTag: string;
  writeFailed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_LOG_DIR = ".runtime/logs";

let fileLoggerState: FileLoggerRuntimeState | null = null;

function formatDateTag(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLogFilePath(config: FileLoggerConfig, dateTag: string): string {
  return path.join(config.logDir, `${config.appName}.${dateTag}.log`);
}

function parseRetentionDays(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RETENTION_DAYS;
  }
  return parsed;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function cleanupExpiredLogs(config: FileLoggerConfig, today: Date): void {
  const todayStart = startOfDay(today);
  const prefix = `${config.appName}.`;
  const suffix = ".log";

  const entries = readdirSync(config.logDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith(suffix)) {
      continue;
    }

    const dateTag = entry.name.slice(prefix.length, entry.name.length - suffix.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTag)) {
      continue;
    }

    const fileDate = new Date(`${dateTag}T00:00:00`);
    const fileTime = fileDate.getTime();
    if (Number.isNaN(fileTime)) {
      continue;
    }

    const ageDays = Math.floor((todayStart - fileTime) / DAY_MS);
    if (ageDays >= config.retentionDays) {
      unlinkSync(path.join(config.logDir, entry.name));
    }
  }
}

function ensureLogFileReady(now: Date, state: FileLoggerRuntimeState): void {
  const dateTag = formatDateTag(now);

  if (state.currentDateTag !== dateTag) {
    state.currentDateTag = dateTag;
    state.currentFilePath = toLogFilePath(state.config, dateTag);
    state.writeFailed = false;
  }

  if (state.cleanedDateTag !== dateTag) {
    cleanupExpiredLogs(state.config, now);
    state.cleanedDateTag = dateTag;
  }
}

function safeJson(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error)
    });
  }
}

function writeFileLogLine(line: string, now: Date): void {
  const state = fileLoggerState;
  if (!state) {
    return;
  }

  try {
    ensureLogFileReady(now, state);
    appendFileSync(state.currentFilePath, line, { encoding: "utf8" });
  } catch (error) {
    if (!state.writeFailed) {
      state.writeFailed = true;
      console.error("[logger] failed to write file log", {
        appName: state.config.appName,
        logDir: state.config.logDir,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export interface ConfigureFileLoggerOptions {
  appName: string;
  logDir?: string;
  retentionDays?: number;
}

export function configureFileLogger(options: ConfigureFileLoggerOptions): void {
  const logDirFromEnv = process.env.CODEX_MOBILE_LOG_DIR;
  const resolvedLogDir = path.resolve(options.logDir ?? logDirFromEnv ?? DEFAULT_LOG_DIR);
  const retentionDays =
    options.retentionDays ?? parseRetentionDays(process.env.CODEX_MOBILE_LOG_RETENTION_DAYS);

  mkdirSync(resolvedLogDir, { recursive: true });

  const now = new Date();
  const dateTag = formatDateTag(now);
  const config: FileLoggerConfig = {
    appName: options.appName,
    logDir: resolvedLogDir,
    retentionDays
  };

  fileLoggerState = {
    config,
    currentDateTag: dateTag,
    currentFilePath: toLogFilePath(config, dateTag),
    cleanedDateTag: "",
    writeFailed: false
  };
}

function log(
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  const payload = meta ? ` ${safeJson(meta)}` : "";
  const now = new Date();
  const timestamp = now.toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}${payload}`;
  console[level](line);
  writeFileLogLine(`${line}\n`, now);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => log("debug", scope, message, meta),
    info: (message, meta) => log("info", scope, message, meta),
    warn: (message, meta) => log("warn", scope, message, meta),
    error: (message, meta) => log("error", scope, message, meta)
  };
}
