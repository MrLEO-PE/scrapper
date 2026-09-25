/**
 * What a package is actually worth to an expat teacher.
 *
 * "Competitive salary plus benefits" hides enormous variation: housing and
 * dependant school places can each be worth more than a year's pay rise, while
 * a transport allowance is rounding. Ranking schools on the *number* of
 * benefits listed would put a school offering bonus + transport above one
 * offering housing + free places for your children.
 *
 * So each term is weighted by roughly what it is worth, and the weights are
 * stated here rather than buried, because reasonable people would argue about
 * them and you should be able to change them.
 */

export interface PackageValue {
  /** 0..100 — share of the maximum realistic package value. */
  score: number;
  /** The terms that counted, best first. */
  counted: string[];
  /** Terms that carry most of the score, for the explanation column. */
  headline: string[];
}

/**
 * Weights are relative annual value to a teacher moving abroad, not a currency
 * amount. Housing dominates because it usually does.
 */
const WEIGHTS: { term: RegExp; weight: number; label: string }[] = [
  { term: /housing|accommodation/i, weight: 30, label: "Housing" },
  { term: /dependant|dependent|school places|tuition/i, weight: 25, label: "Dependant school places" },
  { term: /tax[\s-]?free/i, weight: 20, label: "Tax-free" },
  { term: /flight|airfare/i, weight: 12, label: "Flights" },
  { term: /medical|health insurance|healthcare/i, weight: 12, label: "Medical insurance" },
  { term: /gratuity|end[\s-]of[\s-]service|severance/i, weight: 8, label: "End-of-service gratuity" },
  { term: /relocation|shipping|settling/i, weight: 6, label: "Relocation" },
  { term: /pension|provident/i, weight: 6, label: "Pension" },
  { term: /utilities|electricity|water/i, weight: 3, label: "Utilities" },
  { term: /transport|car allowance/i, weight: 3, label: "Transport" },
  { term: /visa|work permit/i, weight: 2, label: "Visa" },
  { term: /bonus|retention/i, weight: 3, label: "Bonus" },
  // Not cash, but they are why a good school is worth staying at.
  { term: /professional development|CPD|PD budget/i, weight: 5, label: "Professional development" },
  { term: /career (?:progression|development|growth)|leadership pathway|promotion/i, weight: 5, label: "Career progression" },
];

/**
 * The realistic ceiling. Nobody offers every line, so scoring against the raw
 * sum of weights would compress every real school into the bottom third.
 */
const REALISTIC_MAX = 110;

/**
 * Below this, a package score is not evidence of a good package — it is a
 * school that happened to mention a bonus. Ranking such a school above a
 * strong one we simply have not profiled yet would reward being easy to crawl
 * rather than being good to work at.
 */
const SUBSTANTIVE = 25;

export function scorePackage(terms: string[] | null | undefined): PackageValue {
  if (!terms?.length) return { score: 0, counted: [], headline: [] };

  const text = terms.join(" | ");
  const hits: { label: string; weight: number }[] = [];

  for (const w of WEIGHTS) {
    if (w.term.test(text)) hits.push({ label: w.label, weight: w.weight });
  }
  if (!hits.length) return { score: 0, counted: [], headline: [] };

  hits.sort((a, b) => b.weight - a.weight);
  const total = hits.reduce((sum, h) => sum + h.weight, 0);

  return {
    score: Math.min(100, Math.round((total / REALISTIC_MAX) * 100)),
    counted: hits.map((h) => h.label),
    // Anything worth 10+ is a headline item; a transport allowance is not.
    headline: hits.filter((h) => h.weight >= 10).map((h) => h.label),
  };
}

/** What the rank was actually decided on — never leave that implicit. */
export type RankBasis = "package" | "package+salary" | "fees" | "fees+package" | "accreditation";

export const RANK_BASIS_LABEL: Record<RankBasis, string> = {
  package: "package",
  "package+salary": "package + salary",
  fees: "tuition fees (pay proxy)",
  "fees+package": "fees + package",
  accreditation: "accreditation only",
};

/**
 * How much of the ranking tuition fees carry when both are known.
 *
 * Fees are not salary, and nothing here pretends otherwise. They are the only
 * per-school money signal that exists: a country salary benchmark is identical
 * for every school in that country and so cannot order them at all, while a
 * school charging three times its neighbour is not paying its teachers the
 * same. Weighted slightly above the package because it is available for far
 * more schools and is harder to overstate — a school cannot quietly inflate
 * its published fees the way an advert can list "professional development" as
 * a benefit.
 */
const FEE_WEIGHT = 0.55;

export interface RankInput {
  schoolKey: string;
  /** Only used to break ties, so the sheet does not reshuffle between runs. */
  name?: string;
  packageTerms: string[] | null;
  /** Comparable only within one country, where the currency is usually shared. */
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
  /** Fallback when nothing about the package is known yet. */
  accreditationScore: number;
  /** Yearly tuition, compared only against schools in the same country. */
  feeHigh?: number | null;
  feeCurrency?: string | null;
}

export interface RankedSchool {
  schoolKey: string;
  rank: number;
  score: number;
  packageScore: number;
  basis: RankBasis;
}

/**
 * Rank one country's schools on what a teacher would actually get.
 *
 * Salary is compared only inside a country, where the currency is normally the
 * same — converting across currencies without rates would be guesswork. A
 * school with no package data yet falls back to accreditation, and says so,
 * rather than being ranked last as though its package were bad.
 */
export function rankByValue(schools: RankInput[]): RankedSchool[] {
  // Salary is only usable when enough schools here quote the same currency and
  // period to make a comparison mean anything.
  const salaried = schools.filter(
    (s) => (s.salaryMin != null || s.salaryMax != null) && s.salaryCurrency && s.salaryPeriod,
  );
  const byUnit = new Map<string, RankInput[]>();
  for (const s of salaried) {
    const key = `${s.salaryCurrency}|${s.salaryPeriod}`;
    byUnit.set(key, [...(byUnit.get(key) ?? []), s]);
  }
  const comparable = [...byUnit.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const useSalary = comparable.length >= 2;

  const figures = comparable.map((s) => s.salaryMax ?? s.salaryMin ?? 0);
  const lo = Math.min(...figures);
  const hi = Math.max(...figures);
  const inComparable = new Set(comparable.map((s) => s.schoolKey));

  /*
   * Fees, scored against the other schools in this country.
   *
   * Only one currency is compared, for the same reason salary is: converting
   * without a rate would be inventing the answer. Within a country the fee
   * currency is effectively always the same, so this rarely bites.
   */
  const feeRows = schools.filter((s) => s.feeHigh != null && s.feeHigh > 0);
  const feeUnit = new Map<string, RankInput[]>();
  for (const s of feeRows) feeUnit.set(s.feeCurrency ?? "?", [...(feeUnit.get(s.feeCurrency ?? "?") ?? []), s]);
  const feeGroup = [...feeUnit.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const feeFigures = feeGroup.map((s) => s.feeHigh!);
  const feeLo = Math.min(...feeFigures);
  const feeHi = Math.max(...feeFigures);
  const feeUsable = feeGroup.length >= 2 && feeHi > feeLo;
  const feeKeys = new Set(feeGroup.map((s) => s.schoolKey));

  const feeScoreOf = (s: RankInput): number | null =>
    feeUsable && feeKeys.has(s.schoolKey) ? ((s.feeHigh! - feeLo) / (feeHi - feeLo)) * 100 : null;

  const scored = schools.map((s) => {
    const pkg = scorePackage(s.packageTerms);
    const fee = feeScoreOf(s);
    let score: number;
    let basis: RankBasis;

    // Fees first when they are known: they are per-school, published, and the
    // closest thing to an answer on what a school pays.
    if (fee != null) {
      if (pkg.score >= SUBSTANTIVE) {
        score = fee * FEE_WEIGHT + pkg.score * (1 - FEE_WEIGHT);
        basis = "fees+package";
      } else {
        score = fee;
        basis = "fees";
      }
      return { schoolKey: s.schoolKey, name: s.name ?? s.schoolKey, score, packageScore: pkg.score, basis };
    }

    if (pkg.score >= SUBSTANTIVE) {
      score = pkg.score;
      basis = "package";

      if (useSalary && inComparable.has(s.schoolKey) && hi > lo) {
        const figure = s.salaryMax ?? s.salaryMin ?? lo;
        const relative = ((figure - lo) / (hi - lo)) * 100;
        // Package leads: it is known for far more schools, and a headline
        // salary with no housing is often the worse offer.
        score = pkg.score * 0.65 + relative * 0.35;
        basis = "package+salary";
      }
    } else {
      // Either nothing is known about the package, or all we found was a
      // passing mention. Accreditation keeps a good school in its country's
      // top rather than dropping it for missing data — and the basis says so,
      // so nobody reads the position as a claim about pay.
      score = s.accreditationScore;
      basis = "accreditation";
    }

    return { schoolKey: s.schoolKey, name: s.name ?? s.schoolKey, score, packageScore: pkg.score, basis };
  });

  // Schools with real package evidence rank above those judged on proxy alone.
  // Ties fall back to the name so the order is the same on every run — a sheet
  // that reshuffles overnight is one nobody trusts.
  scored.sort((a, b) => {
    const known = Number(b.basis !== "accreditation") - Number(a.basis !== "accreditation");
    return known || b.score - a.score || a.name.localeCompare(b.name);
  });

  return scored.map(({ name: _name, ...s }, i) => ({ ...s, rank: i + 1, score: Math.round(s.score) }));
}
