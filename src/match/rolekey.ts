/**
 * Is this the same job, worded differently?
 *
 * The scrape merges duplicates only when the school and the title match
 * exactly, so one opening shows up several times as boards word it their own
 * way: "Secondary PE Teacher", "Secondary Physical Education (PE) Teacher" and
 * "Secondary Physical Education Teacher" were three rows for PBISS. That is
 * noise in the list and the alerts, and a risk of sending two letters for one
 * job.
 *
 * Two roles at the same school are the same job when everything that makes an
 * opening a different opening agrees:
 *   - the kind of post (teacher, head of department, director, coordinator,
 *     coach, support),
 *   - the sport, if one is named (a golf coach is not a football coach),
 *   - whether it is cover (a maternity cover is not the permanent post),
 *   - who it is for (a female-only post is not an open one),
 *   - the phase, where both name one (primary is not secondary).
 * Dates, school names, contract wording and word order do not matter.
 *
 * It errs towards keeping roles apart. A wrong merge hides a real opening; a
 * missed merge only leaves a duplicate on the list.
 */

export type PostKind = "head" | "director" | "coordinator" | "lead" | "coach" | "support" | "teacher";
export type Phase = "early" | "primary" | "secondary" | "any";
export type Audience = "female" | "male" | "open";

export interface RoleSig {
  kind: PostKind;
  sport: string;
  cover: boolean;
  audience: Audience;
  phase: Phase;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9()/&+.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TEACHES = /\b(?:teacher|tutor|instructor|educator|professor)\b/;
const LEAD_SUBJECT = /\b(?:head|director|coordinator|co-ordinator|lead|leader|manager)\s+of\s+(?:pe|p\.e\.|physical|sports?|games|athletics|health|department|dept|faculty|academic|performance)\b/;

function kindOf(t: string): PostKind {
  // "PE Teacher - Head of Primary" is a teacher post at a school whose head of
  // primary is named; a leadership kind needs the subject to be the one led.
  const teaches = TEACHES.test(t);
  // "Lead PE Teacher" and "Senior Games Coach" are a step above the plain
  // post, and merging them with it hid a real, different opening.
  if (/\b(?:lead|senior|principal|chief)\s+(?:\S+\s+){0,3}?(?:teacher|coach|instructor)\b/.test(t)) return "lead";
  if (/\b(?:head of (?:pe|p\.e\.|physical|sports?|games|athletics|health|department|dept|faculty|academic|performance)|hod|chair of)\b/.test(t) || /^head\b/.test(t)) {
    if (!teaches || LEAD_SUBJECT.test(t)) return "head";
  }
  if (/\bdirector\b/.test(t) && (!teaches || LEAD_SUBJECT.test(t))) return "director";
  if (/\bco-?ordinator\b/.test(t) && !teaches) return "coordinator";
  if (/\b(?:lead|leader|manager|second in|2nd in|deputy)\b/.test(t) && !teaches && !/\bassistant\b/.test(t)) return "lead";
  if (/\b(?:assistant|aide|teaching assistant|learning support|technician|lifeguard|\bta\b)\b/.test(t) && !teaches) return "support";
  if (/\bcoach\b/.test(t) && !teaches) return "coach";
  return "teacher";
}

const SPORTS: [string, RegExp][] = [
  ["swimming", /\b(?:swim\w*|aquatics?|water\s*polo|lifeguard)\b/],
  ["football", /\b(?:football|soccer)\b/],
  ["basketball", /\bbasketball\b/],
  ["golf", /\bgolf\b/],
  ["gymnastics", /\b(?:gymnastics?|trampolin\w*)\b/],
  ["rugby", /\brugby\b/],
  ["cricket", /\bcricket\b/],
  ["tennis", /\btennis\b/],
  ["volleyball", /\bvolleyball\b/],
  ["badminton", /\bbadminton\b/],
  ["hockey", /\bhockey\b/],
  ["athletics", /\b(?:athletics|track and field)\b/],
  ["netball", /\bnetball\b/],
  ["dance", /\bdance\b/],
  ["martial", /\b(?:martial|karate|judo|taekwondo|boxing)\b/],
  ["fitness", /\b(?:fitness|strength|conditioning|gym)\b/],
  ["skiing", /\b(?:ski|skiing|snowboard\w*)\b/],
];

function sportOf(t: string): string {
  for (const [name, re] of SPORTS) if (re.test(t)) return name;
  return "pe";
}

// Early years are their own phase: an Early Years PE post is not a Primary one.
// Several of these boards are Spanish and Portuguese, so those words count too —
// "Educação Infantil" and "Fund I" were once merged as the same job.
const EARLY = /\b(?:early years|eyfs|foundation stage|kindergarten|pre-?school|nursery|reception|infantil|infantile|preescolar|maternelle|educacion inicial|ensino infantil)\b/;
const PRIMARY = /\b(?:primary|elementary|prep|junior|lower school|ks1|ks2|primaria|primaire|fund(?:amental)? i|ensino fundamental i|educacion basica)\b/;
const SECONDARY = /\b(?:secondary|high school|middle school|senior school|upper school|sixth form|ks3|ks4|ks5|igcse|a-?levels?|year (?:7|8|9|10|11|12|13)|grades? (?:6|7|8|9|10|11|12)|secundaria|secondaire|fund(?:amental)? ii|ensino medio|ensino fundamental ii|bachillerato|medio)\b/;

function phaseOf(t: string): Phase {
  const found = ([["early", EARLY], ["primary", PRIMARY], ["secondary", SECONDARY]] as const).filter(([, re]) => re.test(t));
  // Naming two or more ("Primary & Secondary") names none: it fits any opening.
  return found.length === 1 ? found[0]![0] : "any";
}

function audienceOf(t: string): Audience {
  if (/\b(?:female|women'?s?|ladies|girls'?)\b|\(f\)/.test(t)) return "female";
  if (/\b(?:male|men'?s|boys'?)\b|\(m\)/.test(t.replace(/\bfemale\b/g, ""))) return "male";
  return "open";
}

export function roleSig(title: string): RoleSig {
  const t = norm(title);
  return {
    kind: kindOf(t),
    sport: sportOf(t),
    cover: /\b(?:maternity|cover|supply|temporary|temp|interim|sabbatical|parental leave)\b/.test(t),
    audience: audienceOf(t),
    phase: phaseOf(t),
  };
}

/** The same opening, however it was worded? */
export function sameRole(a: RoleSig, b: RoleSig): boolean {
  return (
    a.kind === b.kind &&
    a.sport === b.sport &&
    a.cover === b.cover &&
    a.audience === b.audience &&
    (a.phase === b.phase || a.phase === "any" || b.phase === "any")
  );
}

export function sameRoleTitle(a: string, b: string): boolean {
  return sameRole(roleSig(a), roleSig(b));
}

// ---------------------------------------------------------------------------

/** How much a record knows, so the fullest one represents the group. */
const richness = (r: { description?: string | null; deadline_at?: string | null; application_url?: string | null; my_status?: string | null }): number =>
  (r.my_status ? 1000 : 0) + (r.description?.length ?? 0) / 100 + (r.deadline_at ? 3 : 0) + (r.application_url ? 2 : 0);

export interface Collapsible {
  id: string;
  source: string;
  title: string;
  school_key: string | null;
  first_seen_at?: string;
  description?: string | null;
  deadline_at?: string | null;
  application_url?: string | null;
  my_status?: string | null;
}

/**
 * One row per real opening. The fullest record of each group is kept, with the
 * other boards it was found on listed in `also_on`; roles with no school key
 * cannot be compared and are left alone.
 */
export type Collapsed<T> = T & { also_on?: string; merged_ids: string[] };

export function collapseRoles<T extends Collapsible>(rows: T[], label: (source: string) => string = (s) => s): Collapsed<T>[] {
  const bySchool = new Map<string, T[]>();
  const loose: T[] = [];
  for (const r of rows) {
    if (!r.school_key) loose.push(r);
    else bySchool.set(r.school_key, [...(bySchool.get(r.school_key) ?? []), r]);
  }

  const out: Collapsed<T>[] = loose.map((r) => ({ ...r, merged_ids: [r.id] }));
  for (const group of bySchool.values()) {
    const ranked = [...group].sort(
      (a, b) => richness(b) - richness(a) || (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? ""),
    );
    const clusters: { sig: RoleSig; rows: T[] }[] = [];
    for (const r of ranked) {
      const sig = roleSig(r.title);
      const home = clusters.find((c) => sameRole(c.sig, sig));
      if (home) home.rows.push(r);
      else clusters.push({ sig, rows: [r] });
    }
    for (const c of clusters) {
      const [winner, ...rest] = c.rows;
      const others = [...new Set(rest.map((r) => label(r.source)).filter((s) => s !== label(winner!.source)))];
      const merged_ids = c.rows.map((r) => r.id);
      out.push(others.length ? { ...winner!, also_on: others.join(", "), merged_ids } : { ...winner!, merged_ids });
    }
  }
  return out;
}
