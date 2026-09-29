type LogLevel = "info" | "warn" | "error" | "debug";

const prefix = "[ops]";

function out(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const line = meta && Object.keys(meta).length
    ? `${message} ${JSON.stringify(meta)}`
    : message;
  if (level === "error") {
    console.error(prefix, line);
  } else if (level === "warn") {
    console.warn(prefix, line);
  } else if (level === "debug" && process.env.NODE_ENV === "development") {
    console.debug(prefix, line);
  } else {
    console.log(prefix, line);
  }
}

export const log = {
  info: (message: string, meta?: Record<string, unknown>) => out("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => out("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => out("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => out("debug", message, meta),
};
