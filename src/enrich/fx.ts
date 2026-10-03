/**
 * Currency conversion, for comparing pay across countries.
 *
 * A PE teacher weighing CNY 280,000 in Shanghai against THB 1,200,000 in
 * Bangkok cannot do that in their head, and the sheet should not make them —
 * every salary and every tuition figure converts to one currency so "which
 * pays more" is a sort, not an exercise. Thirty-four currencies appear in the
 * scraped data; all of them convert.
 *
 * Rates come from a free, keyless endpoint, refreshed once per run — a CLI
 * invocation is short-lived, so one fetch stays current for its whole run,
 * the same reasoning the hiring-history cache elsewhere in this codebase
 * already relies on.
 *
 * Converting is never refused for want of a live rate. The table below is a
 * real set of rates — fetched on 2026-10-03, not approximated — used only
 * when the live endpoint cannot be reached. Rates drift by a few percent a
 * year at most, so a figure built on a day-old table is still a genuine
 * comparison; a figure silently left in its original currency, next to one
 * that got converted, is not.
 */

import { fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";

const ENDPOINT = "https://open.er-api.com/v6/latest/USD";

/**
 * USD value of one unit of each currency, fetched 2026-10-03. Covers every
 * currency seen in the scraped salary and fee data, plus every one the
 * advert-text parser (enrich/salary.ts) can recognise even if no school has
 * quoted it yet — AED, QAR and the rest of the Gulf currencies among them.
 * A fallback table that only covered today's snapshot would start silently
 * failing to convert the moment a school in a new currency showed up.
 */
const FALLBACK: Record<string, number> = {
  USD: 1,
  EUR: 1.12517,
  GBP: 1.3222,
  CNY: 0.148934,
  JPY: 0.00633653,
  MYR: 0.244842,
  THB: 0.0298018,
  PHP: 0.0159725,
  VND: 0.0000385298,
  KRW: 0.000742176,
  SGD: 0.7816,
  INR: 0.0103764,
  IDR: 0.0000559189,
  NZD: 0.561365,
  AUD: 0.695056,
  TWD: 0.0313877,
  COP: 0.000301939,
  PEN: 0.290474,
  MVR: 0.0647575,
  UZS: 0.0000846525,
  CRC: 0.00218959,
  TRY: 0.0203521,
  KHR: 0.000246707,
  MMK: 0.000476935,
  BDT: 0.00813367,
  LKR: 0.00302654,
  HKD: 0.127439,
  KES: 0.00771842,
  NPR: 0.00648509,
  BTN: 0.0103761,
  PKR: 0.00361249,
  TZS: 0.000377615,
  DOP: 0.0167805,
  GTQ: 0.130929,
  // Currencies the advert-text parser recognises (enrich/salary.ts) that had
  // not yet appeared in a stored figure as of 2026-10-03.
  AED: 0.272294,
  QAR: 0.274725,
  SAR: 0.266667,
  OMR: 2.6008,
  KWD: 3.23861,
  BHD: 2.65957,
  CHF: 1.20669,
  BRL: 0.191485,
  MXN: 0.054903,
  ZAR: 0.0600273,
};

let rates: Record<string, number> = { ...FALLBACK };
let status: { source: "live" | "fallback"; fetchedAt: string | null } = { source: "fallback", fetchedAt: null };
let loaded = false;

/**
 * Fetch today's rates once per process. Safe to call repeatedly — later
 * calls are a no-op unless `fresh` is set. Never throws: a failed fetch
 * leaves the dated fallback table in place, which is still a real conversion
 * rather than no conversion.
 */
export async function loadFxRates(opts: { fresh?: boolean } = {}): Promise<void> {
  if (loaded && !opts.fresh) return;
  loaded = true;

  const body = await fetchText(ENDPOINT, { soft: true, retries: 1, timeoutMs: 10000, label: "exchange rates" });
  if (!body) {
    log.debug("fx: could not reach the live rate endpoint — using the 2026-10-03 fallback table");
    return;
  }
  try {
    const json = JSON.parse(body) as { result?: string; rates?: Record<string, number> };
    if (json.result !== "success" || !json.rates) {
      log.debug("fx: rate endpoint responded without usable rates — using the fallback table");
      return;
    }
    // The API gives USD→currency; every caller here wants currency→USD.
    const inverted: Record<string, number> = {};
    for (const [code, usdPerUnit] of Object.entries(json.rates)) {
      if (usdPerUnit > 0) inverted[code] = 1 / usdPerUnit;
    }
    rates = { ...FALLBACK, ...inverted };
    status = { source: "live", fetchedAt: new Date().toISOString() };
    log.debug(`fx: live exchange rates loaded (${Object.keys(inverted).length} currencies)`);
  } catch {
    log.debug("fx: rate response was not readable JSON — using the fallback table");
  }
}

/** USD value of one unit of `currency`, or null when the currency is not recognised. */
export function rateFor(currency: string | null | undefined): number | null {
  if (!currency) return null;
  return rates[currency.toUpperCase()] ?? null;
}

/** Convert an amount into USD. Null rather than a guess when the currency is unknown. */
export function toUsd(amount: number, currency: string | null | undefined): number | null {
  const rate = rateFor(currency);
  return rate == null ? null : amount * rate;
}

/** Whether the current table is live or the dated fallback, for a footer note. */
export function fxStatus(): { source: "live" | "fallback"; fetchedAt: string | null } {
  return status;
}

/** Test-only: force the module back to its unloaded, fallback-table state. */
export function resetFxForTests(): void {
  rates = { ...FALLBACK };
  status = { source: "fallback", fetchedAt: null };
  loaded = false;
}
