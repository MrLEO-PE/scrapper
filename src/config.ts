/** Loads config/*.json and applies CLI overrides. */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "./core/logger.ts";
import { DEFAULT_FIELDS, FIELD_MAP } from "./export/fields.ts";

export const CONFIG_DIR = join(process.cwd(), "config");
export const DATA_DIR = join(process.cwd(), "data");
export const OUT_DIR = join(DATA_DIR, "out");

const FIELDS_PATH = join(CONFIG_DIR, "fields.json");

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    log.warn(`could not read ${path}: ${(err as Error).message}`);
    return fallback;
  }
}

/**
 * The ticked columns, in the order they appear in fields.json. Keys starting
 * with "//" are comments and are skipped.
 */
export function loadFields(override?: string[]): string[] {
  if (override?.length) {
    const unknown = override.filter((k) => !FIELD_MAP.has(k));
    if (unknown.length) log.warn(`unknown field(s) ignored: ${unknown.join(", ")}`);
    return override.filter((k) => FIELD_MAP.has(k));
  }

  const raw = readJson<Record<string, unknown>>(FIELDS_PATH, {});
  const picked = Object.entries(raw)
    .filter(([k, v]) => !k.startsWith("//") && v === true)
    .map(([k]) => k)
    .filter((k) => {
      if (FIELD_MAP.has(k)) return true;
      log.warn(`fields.json lists an unknown column "${k}" — ignoring`);
      return false;
    });

  return picked.length ? picked : DEFAULT_FIELDS;
}

/** Write fields.json with every known column, preserving current ticks. */
export function writeFieldsConfig(enabled: Set<string>): void {
  const existing = readJson<Record<string, unknown>>(FIELDS_PATH, {});
  const out: Record<string, unknown> = {
    "//": "Tick the columns you want in the sheet. true = included, false = left out.",
    "//order": "Columns appear in the order listed here. Run `npm run fields` to see every option.",
  };
  // Keep the existing order first, then append anything new.
  for (const key of Object.keys(existing)) {
    if (key.startsWith("//")) continue;
    if (FIELD_MAP.has(key)) out[key] = enabled.has(key);
  }
  for (const key of FIELD_MAP.keys()) {
    if (!(key in out)) out[key] = enabled.has(key);
  }
  mkdirSync(dirname(FIELDS_PATH), { recursive: true });
  writeFileSync(FIELDS_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  log.ok(`saved ${FIELDS_PATH}`);
}

export interface Targets {
  /** Minimum PE score to keep a vacancy. */
  threshold: number;
  /** Only these countries (empty = everywhere). Matched loosely. */
  countries: string[];
  /** Only these cities (empty = all). Matched loosely. */
  cities: string[];
  /** Only these seniority levels (empty = all). */
  seniority: string[];
  sources: string[];
}

export const DEFAULT_TARGETS: Targets = {
  threshold: 40,
  countries: [],
  cities: [],
  seniority: [],
  sources: ["tes", "teachaway", "teacherhorizons", "nordanglia", "inspired"],
};

export function loadTargets(): Targets {
  return { ...DEFAULT_TARGETS, ...readJson<Partial<Targets>>(join(CONFIG_DIR, "targets.json"), {}) };
}
