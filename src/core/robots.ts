/**
 * Minimal robots.txt parser and matcher.
 *
 * Implements the parts of RFC 9309 that matter here: user-agent group
 * selection, Allow/Disallow with `*` and `$` wildcards, longest-match-wins
 * precedence (Allow wins ties), and Crawl-delay.
 *
 * Fetches are cached per origin for the life of the process. A fetch failure is
 * treated as "allowed" for 4xx (no robots file) and "denied" for 5xx/network
 * errors, which is the conservative reading of the spec.
 */

import { log } from "./logger.ts";

interface Rule {
  allow: boolean;
  path: string;
  /** Precedence = length of the raw pattern. */
  weight: number;
}

interface RobotsFile {
  rules: Rule[];
  crawlDelayMs: number;
  /** True when we could not read robots.txt and must not crawl. */
  denyAll: boolean;
}

const cache = new Map<string, Promise<RobotsFile>>();

const EMPTY: RobotsFile = { rules: [], crawlDelayMs: 0, denyAll: false };
const DENY: RobotsFile = { rules: [], crawlDelayMs: 0, denyAll: true };

/** Convert a robots path pattern to a RegExp. */
function toRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") re += ".*";
    else if (ch === "$" && i === pattern.length - 1) re += "$";
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re);
}

function parse(text: string, ua: string): RobotsFile {
  const lines = text.split(/\r?\n/);
  // Collect groups keyed by user-agent, then pick the most specific match.
  const groups = new Map<string, { rules: Rule[]; delay: number }>();
  let active: string[] = [];
  let lastWasUa = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group.
      if (!lastWasUa) active = [];
      active.push(value.toLowerCase());
      for (const a of active) if (!groups.has(a)) groups.set(a, { rules: [], delay: 0 });
      lastWasUa = true;
      continue;
    }
    lastWasUa = false;
    if (!active.length) continue;

    if (field === "allow" || field === "disallow") {
      // An empty Disallow means "allow everything" and carries no rule.
      if (field === "disallow" && value === "") continue;
      if (value === "") continue;
      for (const a of active) {
        groups.get(a)!.rules.push({ allow: field === "allow", path: value, weight: value.length });
      }
    } else if (field === "crawl-delay") {
      const d = Number.parseFloat(value);
      if (Number.isFinite(d)) for (const a of active) groups.get(a)!.delay = d;
    }
  }

  // Most specific matching group wins: exact UA token, else "*".
  const needle = ua.toLowerCase();
  let chosen = groups.get("*");
  let bestLen = -1;
  for (const [name, g] of groups) {
    if (name === "*") continue;
    if (needle.includes(name) && name.length > bestLen) {
      chosen = g;
      bestLen = name.length;
    }
  }
  if (!chosen) return EMPTY;
  return { rules: chosen.rules, crawlDelayMs: chosen.delay * 1000, denyAll: false };
}

async function load(origin: string, ua: string): Promise<RobotsFile> {
  const url = origin + "/robots.txt";
  try {
    const res = await fetch(url, {
      headers: { "user-agent": ua, accept: "text/plain" },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (res.status >= 400 && res.status < 500) {
      log.debug(`robots: ${origin} -> ${res.status}, treating as allow-all`);
      return EMPTY;
    }
    if (!res.ok) {
      log.warn(`robots: ${origin} -> ${res.status}; refusing to crawl this origin`);
      return DENY;
    }
    return parse(await res.text(), ua);
  } catch (err) {
    log.warn(`robots: could not fetch ${url} (${(err as Error).message}); refusing to crawl`);
    return DENY;
  }
}

export function getRobots(origin: string, ua: string): Promise<RobotsFile> {
  let p = cache.get(origin);
  if (!p) {
    p = load(origin, ua);
    cache.set(origin, p);
  }
  return p;
}

export interface RobotsVerdict {
  allowed: boolean;
  reason: string;
  crawlDelayMs: number;
}

export async function checkUrl(rawUrl: string, ua: string): Promise<RobotsVerdict> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "invalid URL", crawlDelayMs: 0 };
  }
  const robots = await getRobots(u.origin, ua);
  if (robots.denyAll) {
    return { allowed: false, reason: "robots.txt unreadable", crawlDelayMs: 0 };
  }

  const target = u.pathname + u.search;
  let best: Rule | undefined;
  for (const rule of robots.rules) {
    if (!toRegExp(rule.path).test(target)) continue;
    if (
      !best ||
      rule.weight > best.weight ||
      // Allow wins an exact-length tie, per spec.
      (rule.weight === best.weight && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }

  if (!best) return { allowed: true, reason: "no matching rule", crawlDelayMs: robots.crawlDelayMs };
  return {
    allowed: best.allow,
    reason: `${best.allow ? "Allow" : "Disallow"}: ${best.path}`,
    crawlDelayMs: robots.crawlDelayMs,
  };
}
