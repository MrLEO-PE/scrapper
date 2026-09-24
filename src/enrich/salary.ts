/**
 * Reading pay out of prose.
 *
 * Only 6 of 85 open roles publish a structured figure, so the numbers that
 * exist are mostly buried in advert text, job packs and the salary scales some
 * schools attach as PDFs. This finds those.
 *
 * Every figure carries where it came from and what it is, because "AED 15,000"
 * means nothing without knowing whether it is monthly or annual, one school's
 * advert or an average of several. A salary you cannot source is not worth
 * putting in a spreadsheet you will make decisions from.
 */

import type { Salary } from "../core/types.ts";

/** Where a figure came from, strongest evidence first. */
export type SalaryBasis =
  | "advert"        // this vacancy's own structured field
  | "advert-text"   // a figure written in this vacancy's text
  | "job-pack"      // a figure in an attached job description or pay scale
  | "school-site"   // a figure on the school's own website
  | "school-avg"    // averaged across this school's adverts
  | "benchmark"     // what comparable roles in this country advertise
  | "country-benchmark" // published average for the country, self-reported
  | "text-only";    // words such as "competitive", no figure at all

export interface SourcedSalary extends Salary {
  basis: SalaryBasis;
  /** How many separate figures stand behind this. */
  samples?: number;
  /** How many distinct schools, when it is an average or a benchmark. */
  schools?: number;
  /** The sentence it was read from, or a description of the calculation. */
  evidence?: string;
}

const CURRENCY: Record<string, string> = {
  "aed": "AED", "dhs": "AED", "dirham": "AED",
  "usd": "USD", "us$": "USD", "$": "USD",
  "gbp": "GBP", "£": "GBP",
  "eur": "EUR", "€": "EUR",
  "sgd": "SGD", "qar": "QAR", "sar": "SAR", "omr": "OMR", "kwd": "KWD", "bhd": "BHD",
  "thb": "THB", "baht": "THB",
  "myr": "MYR", "rm": "MYR",
  "cny": "CNY", "rmb": "CNY", "¥": "CNY",
  "hkd": "HKD", "jpy": "JPY", "krw": "KRW", "inr": "INR", "chf": "CHF",
  "vnd": "VND", "idr": "IDR", "php": "PHP", "brl": "BRL", "mxn": "MXN", "zar": "ZAR",
};

const CURRENCY_TOKEN = Object.keys(CURRENCY)
  .sort((a, b) => b.length - a.length)
  .map((c) => c.replace(/[$£€¥.]/g, "\\$&"))
  .join("|");

/** A number with optional thousands separators, e.g. 15,000 or 3.301 or 55000. */
const NUMBER = "\\d{1,3}(?:[.,\\s]\\d{3})+|\\d{4,7}";

const PERIOD_WORDS =
  /\b(?:per\s+month|monthly|a\s+month|pcm|per\s+annum|annually|per\s+year|a\s+year|p\.?a\.?|yearly|per\s+week|weekly|per\s+day|daily|per\s+hour|hourly)\b/i;

function periodOf(text: string): string | undefined {
  const m = PERIOD_WORDS.exec(text);
  if (!m) return undefined;
  const w = m[0].toLowerCase();
  if (/month|pcm/.test(w)) return "MONTHLY";
  if (/annum|year|p\.?a\.?/.test(w)) return "ANNUALLY";
  if (/week/.test(w)) return "WEEKLY";
  if (/day|daily/.test(w)) return "DAILY";
  if (/hour/.test(w)) return "HOURLY";
  return undefined;
}

/**
 * Parse a number written with either separator convention.
 * "3.301" is three thousand in much of Europe; "3,301" is in the UK.
 */
function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s]/g, "");
  // A single separator followed by exactly 3 digits is a thousands separator.
  const normalised = /^[\d]{1,3}([.,]\d{3})+$/.test(cleaned)
    ? cleaned.replace(/[.,]/g, "")
    : cleaned.replace(/,/g, "");
  const n = Number.parseInt(normalised, 10);
  return Number.isFinite(n) ? n : null;
}

/** Figures outside these bounds are page furniture, not pay. */
function plausible(value: number, period?: string): boolean {
  if (period === "MONTHLY") return value >= 500 && value <= 200_000;
  if (period === "ANNUALLY") return value >= 8_000 && value <= 1_500_000;
  if (period === "WEEKLY") return value >= 100 && value <= 20_000;
  if (period === "DAILY") return value >= 50 && value <= 5_000;
  if (period === "HOURLY") return value >= 5 && value <= 500;
  // No period stated: accept a wide band and leave the period blank.
  return value >= 500 && value <= 1_500_000;
}

/** Phrases near a number that mean it is not pay. */
const NOT_PAY =
  /\b(?:students?|pupils?|square\s*(?:metres|meters|feet)|sq\s?m|population|founded|established|since|telephone|phone|fax|postal|zip|room|capacity|hours?\s+of|km|miles|visitors?|followers?)\b/i;

/**
 * Find pay figures in a block of text.
 *
 * Ranges are preferred over single numbers, because a range is almost always a
 * salary whereas a lone number could be anything.
 */
export function extractSalaryFromText(text: string, basis: SalaryBasis): SourcedSalary | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ");

  const cur = `(?:${CURRENCY_TOKEN})`;
  const patterns: { re: RegExp; range: boolean }[] = [
    // "AED 15,000 - 18,000 per month" / "£30,000 to £45,000"
    { re: new RegExp(`(${cur})\\s?(${NUMBER})\\s*(?:-|–|—|to|up to)\\s*(?:${cur})?\\s?(${NUMBER})`, "i"), range: true },
    // "15,000 - 18,000 AED"
    { re: new RegExp(`(${NUMBER})\\s*(?:-|–|—|to)\\s*(${NUMBER})\\s?(${cur})`, "i"), range: true },
    // "a salary of AED 15,000 per month"
    { re: new RegExp(`(?:salary|salaries|pay|package|remuneration|scale)[^.]{0,40}?(${cur})\\s?(${NUMBER})`, "i"), range: false },
    // "AED 15,000 per month"
    { re: new RegExp(`(${cur})\\s?(${NUMBER})\\s*(?:per\\s+month|per\\s+annum|monthly|annually|pcm|p\\.?a\\.?)`, "i"), range: false },
  ];

  for (const { re, range } of patterns) {
    const m = re.exec(flat);
    if (!m) continue;

    // Look either side for the period and for signs this is not pay at all.
    const window = flat.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70);
    if (NOT_PAY.test(window)) continue;
    const period = periodOf(window);

    let currency: string | undefined;
    let lo: number | null = null;
    let hi: number | null = null;

    if (range) {
      // Currency may lead (pattern 1) or trail (pattern 2).
      const lead = CURRENCY[(m[1] ?? "").toLowerCase()];
      if (lead) {
        currency = lead;
        lo = toNumber(m[2] ?? "");
        hi = toNumber(m[3] ?? "");
      } else {
        currency = CURRENCY[(m[3] ?? "").toLowerCase()];
        lo = toNumber(m[1] ?? "");
        hi = toNumber(m[2] ?? "");
      }
    } else {
      currency = CURRENCY[(m[1] ?? "").toLowerCase()];
      lo = toNumber(m[2] ?? "");
    }

    if (lo == null || !plausible(lo, period)) continue;
    if (hi != null && (!plausible(hi, period) || hi < lo)) hi = null;

    return {
      min: lo,
      ...(hi != null ? { max: hi } : {}),
      ...(currency ? { currency } : {}),
      ...(period ? { period } : {}),
      basis,
      samples: 1,
      evidence: window.trim().slice(0, 160),
    };
  }
  return null;
}

/**
 * A benchmark needs this many *distinct schools*, not adverts.
 *
 * One school posting three PE roles at the same rate is one data point, not
 * three. Counting adverts would make a single employer look like a market.
 */
export const MIN_SCHOOLS_FOR_BENCHMARK = 3;

export interface BenchmarkInput {
  schoolKey: string;
  salary: Salary;
}

/**
 * What comparable roles advertise in one country.
 *
 * Returns nothing unless enough distinct schools publish a figure in the same
 * currency and period — comparing AED-per-month against GBP-per-year would be
 * arithmetic on nonsense.
 */
export function benchmark(entries: BenchmarkInput[]): SourcedSalary | null {
  // Group by currency + period; only like can be compared with like.
  const groups = new Map<string, BenchmarkInput[]>();
  for (const e of entries) {
    if (e.salary.min == null && e.salary.max == null) continue;
    const key = `${e.salary.currency ?? "?"}|${e.salary.period ?? "?"}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  let best: { key: string; rows: BenchmarkInput[]; schools: number } | null = null;
  for (const [key, rows] of groups) {
    const schools = new Set(rows.map((r) => r.schoolKey)).size;
    if (schools < MIN_SCHOOLS_FOR_BENCHMARK) continue;

    // A group publishing one scale across its schools is one data point, not
    // three: BASIS Shenzhen, Guangzhou and Bilingual all advertise exactly
    // USD 55,000-65,000. Identical figures cannot evidence a market rate.
    const distinctFigures = new Set(rows.map((r) => `${r.salary.min ?? ""}-${r.salary.max ?? ""}`)).size;
    if (distinctFigures < 2) continue;

    if (!best || schools > best.schools) best = { key, rows, schools };
  }
  if (!best) return null;

  const [currency, period] = best.key.split("|");
  const mins = best.rows.map((r) => r.salary.min).filter((n): n is number => n != null);
  const maxs = best.rows.map((r) => r.salary.max ?? r.salary.min).filter((n): n is number => n != null);
  const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);

  return {
    ...(mins.length ? { min: avg(mins) } : {}),
    ...(maxs.length ? { max: avg(maxs) } : {}),
    ...(currency && currency !== "?" ? { currency } : {}),
    ...(period && period !== "?" ? { period } : {}),
    basis: "benchmark",
    samples: best.rows.length,
    schools: best.schools,
    evidence: `mean of advertised figures from ${best.schools} schools`,
  };
}

/** How the basis reads in the sheet. */
export const BASIS_LABEL: Record<SalaryBasis, string> = {
  advert: "this advert",
  "advert-text": "stated in the advert",
  "job-pack": "from the job pack",
  "school-site": "from the school's site",
  "school-avg": "average of this school's adverts",
  benchmark: "benchmark for comparable roles",
  // Names the country, not the school, because that is what it measures.
  "country-benchmark": "country average, self-reported by teachers",
  "text-only": "no figure published",
};

/**
 * Describe a figure precisely enough to judge it.
 * e.g. "average of this school's adverts (3 adverts)".
 */
export function describeBasis(s: SourcedSalary | null | undefined): string {
  if (!s) return "";
  const label = BASIS_LABEL[s.basis] ?? s.basis;
  const bits: string[] = [];
  if (s.samples && s.samples > 1) bits.push(`${s.samples} adverts`);
  if (s.schools && s.schools > 1) bits.push(`${s.schools} schools`);
  return bits.length ? `${label} (${bits.join(", ")})` : label;
}
