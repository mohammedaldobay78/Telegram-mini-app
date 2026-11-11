import { getEnv } from "./env";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function enabled(level: Level): boolean {
  try {
    return ORDER[level] >= ORDER[getEnv().LOG_LEVEL];
  } catch {
    return level !== "debug";
  }
}

function emit(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (!enabled(level)) return;
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
