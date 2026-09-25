/**
 * Polite HTTP client.
 *
 * Every outbound request goes through here so that rate limiting, robots.txt,
 * retries and the on-disk cache are impossible to bypass by accident.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./logger.ts";
import { checkUrl } from "./robots.ts";

export const USER_AGENT =
  process.env.SCRAPPER_UA ||
  "pe-schools-scrapper/0.1 (personal job search; +https://github.com/jokoleley/scrapper)";

export interface FetchOptions {
  /** Skip the cache and force a live request. */
  fresh?: boolean;
  /** Cache lifetime in ms. Default 6h. */
  ttlMs?: number;
  headers?: Record<string, string>;
  /**
   * POST, for the handful of APIs that take a query in the body rather than
   * the URL — Workday's career sites among them. A POST is never cached: the
   * cache is keyed on the URL alone, so two different queries to one endpoint
   * would otherwise return each other's results.
   */
  method?: "GET" | "POST";
  body?: string;
  /** Treat a non-2xx as a soft failure returning null rather than throwing. */
  soft?: boolean;
  timeoutMs?: number;
  /** Bypass robots.txt. Only set for explicitly user-authorised sources. */
  ignoreRobots?: boolean;
  label?: string;
  /**
   * Retries on network error / 5xx. Defaults to 3, which suits the job-board
   * APIs we depend on. Crawling arbitrary school websites should pass 0 or 1:
   * many are slow or dead, and the full ladder can cost minutes per URL.
   */
  retries?: number;
}

const CACHE_DIR = process.env.SCRAPPER_CACHE_DIR || join(process.cwd(), "data", "cache");
const DEFAULT_TTL = Number(process.env.SCRAPPER_TTL_MS || 6 * 60 * 60 * 1000);
/** Minimum gap between requests to the same origin. */
const MIN_GAP_MS = Number(process.env.SCRAPPER_MIN_GAP_MS || 1200);
const MAX_RETRIES = 3;

const lastHit = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();

export const stats = { requests: 0, cacheHits: 0, blocked: 0, failures: 0, bytes: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(url: string): string {
  const h = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return join(CACHE_DIR, h + ".json");
}

async function readCache(url: string, ttlMs: number): Promise<string | null> {
  try {
    const buf = await readFile(cachePath(url), "utf8");
    const entry = JSON.parse(buf) as { at: number; body: string };
    if (Date.now() - entry.at > ttlMs) return null;
    return entry.body;
  } catch {
    return null;
  }
}

async function writeCache(url: string, body: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(url), JSON.stringify({ at: Date.now(), url, body }), "utf8");
  } catch (err) {
    log.debug("cache write failed:", (err as Error).message);
  }
}

/**
 * Serialise requests per origin and honour the crawl delay. Each origin gets a
 * promise chain so concurrent callers queue instead of stampeding.
 */
function perOrigin<T>(origin: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(origin) ?? Promise.resolve();
  const next = prev.then(task, task);
  // Keep the chain alive but don't leak rejections into the next caller.
  queues.set(
    origin,
    next.catch(() => undefined),
  );
  return next;
}

async function gate(origin: string, crawlDelayMs: number): Promise<void> {
  const gap = Math.max(MIN_GAP_MS, crawlDelayMs);
  const last = lastHit.get(origin) ?? 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(origin, Date.now());
}

/** Fetch a URL as text, honouring robots.txt, cache and rate limits. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL;

  // The cache is keyed on the URL alone, so a POST — whose query lives in the
  // body — must not touch it. Five different searches against one Workday
  // endpoint would otherwise all return the first one's results.
  const cacheable = (opts.method ?? "GET") === "GET";

  if (!opts.fresh && cacheable) {
    const hit = await readCache(url, ttl);
    if (hit !== null) {
      stats.cacheHits++;
      log.debug(`cache hit ${opts.label || url}`);
      return hit;
    }
  }

  const verdict = opts.ignoreRobots
    ? { allowed: true, reason: "robots bypass (explicitly enabled)", crawlDelayMs: 0 }
    : await checkUrl(url, USER_AGENT);

  if (!verdict.allowed) {
    stats.blocked++;
    log.warn(`robots blocked ${url} (${verdict.reason})`);
    return null;
  }

  const origin = new URL(url).origin;

  const maxRetries = opts.retries ?? MAX_RETRIES;

  return perOrigin(origin, async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await gate(origin, verdict.crawlDelayMs);
      try {
        stats.requests++;
        const res = await fetch(url, {
          method: opts.method ?? "GET",
          ...(opts.body != null ? { body: opts.body } : {}),
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/json,application/xhtml+xml,*/*;q=0.8",
            "accept-language": "en-GB,en;q=0.9",
            ...opts.headers,
          },
          redirect: "follow",
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
        });

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30000, 2 ** attempt * 1500);
          if (attempt < maxRetries) {
            log.debug(`${res.status} on ${url}; retrying in ${backoff}ms`);
            await sleep(backoff);
            continue;
          }
        }

        if (!res.ok) {
          stats.failures++;
          if (opts.soft) {
            log.debug(`${res.status} ${url}`);
            return null;
          }
          throw new Error(`HTTP ${res.status} for ${url}`);
        }

        const body = await res.text();
        stats.bytes += body.length;
        if (cacheable) await writeCache(url, body);
        return body;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          await sleep(Math.min(20000, 2 ** attempt * 1200));
          continue;
        }
      }
    }
    stats.failures++;
    if (opts.soft) {
      log.debug(`failed ${url}: ${(lastErr as Error)?.message}`);
      return null;
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  });
}

/** Fetch and JSON-parse. Returns null on failure when `soft`. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const body = await fetchText(url, {
    ...opts,
    headers: { accept: "application/json", ...opts.headers },
  });
  if (body === null) return null;
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    log.warn(`bad JSON from ${url}: ${(err as Error).message}`);
    return null;
  }
}

/** Fetch binary content (PDFs). Cached as base64. */
export async function fetchBuffer(url: string, opts: FetchOptions = {}): Promise<Buffer | null> {
  const key = "buffer:" + url;
  const ttl = opts.ttlMs ?? DEFAULT_TTL;
  if (!opts.fresh) {
    const hit = await readCache(key, ttl);
    if (hit !== null) {
      stats.cacheHits++;
      return Buffer.from(hit, "base64");
    }
  }

  const verdict = opts.ignoreRobots
    ? { allowed: true, reason: "bypass", crawlDelayMs: 0 }
    : await checkUrl(url, USER_AGENT);
  if (!verdict.allowed) {
    stats.blocked++;
    return null;
  }

  const origin = new URL(url).origin;
  return perOrigin(origin, async () => {
    try {
      await gate(origin, verdict.crawlDelayMs);
      stats.requests++;
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/pdf,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
      });
      if (!res.ok) {
        stats.failures++;
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      stats.bytes += buf.length;
      await writeCache(key, buf.toString("base64"));
      return buf;
    } catch (err) {
      stats.failures++;
      log.debug(`buffer fetch failed ${url}: ${(err as Error).message}`);
      return null;
    }
  });
}

/** Run tasks with bounded concurrency, preserving input order in the result. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
