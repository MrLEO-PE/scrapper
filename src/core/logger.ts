const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 } as const;
export type LogLevel = keyof typeof LEVELS;

let current: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(l: LogLevel): void {
  current = l;
}

const C = {
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

// Honour NO_COLOR and non-TTY pipes.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? code + s + C.reset : s);

function emit(level: LogLevel, colour: string, tag: string, args: unknown[]): void {
  if (LEVELS[level] < LEVELS[current]) return;
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
  stream.write(c(colour, tag) + " " + args.map(fmt).join(" ") + "\n");
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (...a: unknown[]) => emit("debug", C.dim, "  ·", a),
  info: (...a: unknown[]) => emit("info", C.cyan, "  ›", a),
  ok: (...a: unknown[]) => emit("info", C.green, "  ✓", a),
  warn: (...a: unknown[]) => emit("warn", C.yellow, "  !", a),
  error: (...a: unknown[]) => emit("error", C.red, "  ✗", a),
  /** Section heading. */
  step: (s: string) => emit("info", C.bold, "\n▸", [s]),
  plain: (s = "") => {
    if (LEVELS.info >= LEVELS[current]) process.stdout.write(s + "\n");
  },
};
