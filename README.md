# International School PE Job Scraper

Finds **Physical Education / Head of Sport / HOD PE** roles at international schools across
TES Jobs, Teach Away and Teacher Horizons, works out which school is behind each advert, then
digs up the things you actually need before applying — curriculum, school size, package, and the
email address a PE application should go to.

Output is a Google-Sheets-ready table whose columns you tick.

```
npm run scrape               # find vacancies
npm run enrich               # profile the schools
npm run export               # write the sheet
```

No `npm install` required to run it — the only dependencies are TypeScript types, used for
editor support and `npm run typecheck`.

---

## Requirements

- **Node 22.6 or newer.** The code is TypeScript run directly through Node's built-in type
  stripping, and the database is Node's built-in `node:sqlite`. There is no build step and no
  native module to compile.

---

## Quick start

```bash
npm run scrape               # ~3 min: all three boards, full detail pages
npm run enrich               # ~10 min: visits each school's website
npm run export               # writes CSV + an HTML report to data/out/
```

Then open `data/out/pe-jobs-<date>.html` to review, or import the `.csv` into Google Sheets
(**File → Import → Upload**).

Or do all three at once:

```bash
npm run run-all
```

---

## What each stage does

### 1. `scrape` — find the vacancies

| Board | How it is read | Notes |
|---|---|---|
| **TES Jobs** | Public JSON API behind the jobs board, `International` filter | Strongest source. ~700 international vacancies scanned per run |
| **Teach Away** | Job records embedded in the board page, `phys-ed` filter + sitemap sweep | Carries school profile, curriculum, salary, benefits and the recruitment email |
| **Teacher Horizons** | Public "latest vacancies" feed | Limited by design — see [below](#a-note-on-teacher-horizons) |

By default the scraper also opens each matching TES vacancy page, which yields the school's
website, its country, the address applications go to, and any job-pack PDFs — none of which the
search API returns. It costs about a minute and roughly triples the usable data. Pass
`--shallow` to skip it.

Seven search passes run against TES: the Physical Education subject filter, plus keyword passes
for *head of sport*, *director of sport*, *head of physical education*, *sports coordinator*,
*athletic director* and *games teacher*. Sport leadership roles are often filed under Senior
Leadership rather than PE, and the keyword passes are what catch them.

### 2. `enrich` — profile the school

For each school found, this visits its website and follows a prioritised trail —
careers/vacancies pages first, then contact, about, staff and PE pages — and opens any
recruitment PDFs it finds. From that it extracts the student roll, PE team size, curriculum,
school phase, package terms and every email address, then picks the best one for applications.

PDFs are parsed in-process (no external tool), because the careers address is very often printed
only inside the job pack.

### 3. `export` — write the sheet

Writes the ticked columns as CSV (for import), TSV (to paste directly), JSON, and a sortable,
filterable HTML report. In the HTML report, leadership roles — Director of Sport, Head of
Department, 2nd in Department — are highlighted, with a **leadership roles only** toggle.

---

## Choosing your columns

```bash
npm run fields                                   # show the tick list
npm run fields -- --enable website,all_emails    # turn columns on
npm run fields -- --disable description          # turn them off
```

Ticks live in `config/fields.json`; the column order in that file is the column order in the
sheet. Ticked by default:

| Column | Where it comes from |
|---|---|
| Country, City | Board data, resolved against the country list |
| School Name | Board data |
| Curriculum | Board tags, else the school website or advert |
| PE Team (teachers) | School website / job pack — an estimate |
| Students in School | School website / job pack |
| School Type | Grade levels, else the website (Primary / Secondary / Primary + Secondary / University) |
| Approx. Salary (PE expat) | Averaged across that school's adverts, grouped by currency |
| Package & Career Growth | Board benefits + housing/flights/insurance/CPD/progression terms found in text |
| School Email | Best general inbox |
| Career Email | Best recruitment/HR address, including ones found inside PDFs |
| Job Title, Role Level, Still Available?, Job Link, Deadline, Source | The vacancy |

Two further columns are worth knowing about: `all_emails` shows every address found with its
classification, which is the fastest way to sanity-check a wrong pick, and `careers_page` links
straight to the school's vacancies page.

### How full each column actually gets

Some of this data simply is not published, and the scraper leaves a cell blank rather than
guessing. Measured over a real run of 71 schools:

| Column | Filled | Why |
|---|---|---|
| Country, Website, School Type | 85–99% | Reliable from board data |
| **Career Email** | **86%** | The column that matters most, and it holds up |
| City, Curriculum, Package | 75–80% | Usually stated somewhere |
| School Email | 55% | Many schools publish only one address, which becomes the career email |
| Students in School | 39% | Only where the school states a roll |
| Approx. Salary | 39% | Most international schools advertise "competitive" and no figure |
| Careers Page | 35% | Not every school has a dedicated vacancies page |
| **PE Team (teachers)** | **4%** | Schools almost never publish this — see below |

**PE team size is the honest weak spot.** Schools essentially never write "our PE department has
six teachers", so the only route is counting PE roles on a staff directory — which many schools
do not publish at all, and which is a proxy rather than a headcount. An earlier version inferred
it from job adverts and was wrong: an advert for a PE role repeats "PE Teacher" several times,
and counting those reported the advert's own title as the size of the department. That is now
blocked, which is why the number is small but trustworthy. Treat a filled cell as a hint and
verify before relying on it.

---

## Keeping it up to date

Every run re-checks which vacancies are still listed and updates the **Still Available?**
column: `Open` → `Possibly filled` (missing from one run) → `Closed` (missing again, or past its
deadline). Nothing is deleted, so the sheet keeps its history.

Two ways to run it repeatedly:

```bash
npm run watch -- --every 24h          # in-process loop, runs while the terminal is open
npm run schedule -- --daily 07:00     # real OS task, runs whether you are logged in or not
npm run schedule -- --weekly MON --at 07:00
npm run schedule -- --list            # show it
npm run schedule -- --remove          # delete it
```

On Windows, `schedule` registers a Task Scheduler entry and usually needs an **Administrator**
terminal; on macOS/Linux it writes a cron entry. `watch` needs no permissions at all. Scheduled
runs log to `data/scheduled.log`.

---

## Targeting countries and cities

```bash
npm run locations                            # show the list (104 countries)
npm run locations -- --on AE,QA,SG           # tick these
npm run locations -- --only AE               # tick only this one
npm run locations -- --region "Middle East"  # tick a whole region
npm run locations -- --list --cities         # show the city list for each
npm run locations -- --clear                 # start over
```

Ticks live in `config/locations.json`. The city lists also fill in a country when a board only
reported a city — that is how a vacancy listed as "Lo Barnechea" ends up filed under Chile.

To filter a single run without changing the ticks:

```bash
npm run scrape -- --countries "United Arab Emirates,Qatar"
npm run export -- --cities Dubai,Doha
```

---

## Directory mode — schools regardless of vacancies

The long-term view: the leading international schools in the countries you care about, whether
or not they are advertising a PE role today, enriched into the same columns.

```bash
npm run locations -- --on AE,QA          # pick your countries
npm run directory -- --top 30            # top 30 per country
npm run directory -- --cities Dubai      # or narrow to one city
npm run directory -- --list-only         # rank without crawling each site
npm run export -- --schools              # one row per school
```

**On "top 30":** there is no official global ranking of international schools, so this does not
pretend to be one. Schools are ordered by a transparent *prominence score* built from directory
metadata — accreditation body (CIS, IB, NEASC, WASC, MSA, COBIS, BSO…), recognised-institution
status, current hiring activity, whether the school publishes a website and how complete its
profile is. The reasons behind each score are stored with the school. Treat it as a shortlist
heuristic, not a league table, and re-order by the columns that matter to you.

Coverage comes from the Teach Away school directory, which lists schools by country.

---

## Google Sheets sync (optional)

Instead of re-importing a CSV each time, a scheduled run can update one sheet in place.

1. In Google Cloud, create a **service account** and download its JSON key.
2. Enable the **Google Sheets API** for that project.
3. Share your sheet with the service account's `client_email`, as **Editor**.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
npm run export -- --sheet-id 1AbC...xyz
npm run export -- --sheet-id 1AbC...xyz --sheet-tab "PE Jobs" --schools
```

The tab is cleared and rewritten each time, so deleted rows do not linger, and the header row is
frozen and bolded. Set `GOOGLE_SHEET_ID` to avoid passing `--sheet-id` every run.

### Settings via `.env`

A `.env` file in the project root is read automatically, which is the easiest way to give
scheduled runs the same settings as interactive ones:

```ini
GOOGLE_SHEET_ID=1AbC...xyz
GOOGLE_APPLICATION_CREDENTIALS=C:\keys\sheets-key.json
# SCRAPPER_MIN_GAP_MS=1200
# TH_AUTHENTICATED=1
# TH_COOKIE=...
```

It is git-ignored, so credentials stay local.

---

## A note on Teacher Horizons

Teacher Horizons is the thinnest of the three sources, and it is worth being clear about why
rather than having it look broken.

Its site is a JavaScript app that renders nothing server-side, and its full job search sits
behind `/th/api/jobs`, which requires a signed-in session **and** is explicitly disallowed by the
site's own `robots.txt` (along with `/jobs/*`). The scraper respects that.

What it does use is `/th/api/v1/jobs` — the public feed powering the site's own "latest
vacancies" widget, which is outside the disallowed paths and needs no login. It returns roughly
the 20 newest postings and ignores pagination, so a single run finds only a handful of PE roles.
Because the database keeps everything it has ever seen, **running daily accumulates real coverage
over time**; a one-off run will not.

The feed also omits the school name entirely — Teacher Horizons withholds it until you log in, by
design — so those rows cannot be enriched with school details.

If you have a Teacher Horizons account and want the full search, you can supply your own session:

```bash
export TH_AUTHENTICATED=1
export TH_COOKIE="<your session cookie>"
```

This is off by default and never enabled implicitly. It reads the site as you, using your own
account, rather than as an anonymous crawler.

---

## How it behaves as a crawler

- **robots.txt is parsed and obeyed** for every request, including wildcard rules, `$` anchors,
  longest-match precedence and `Crawl-delay`. If robots.txt cannot be read at all, that origin is
  skipped rather than crawled.
- **Rate limited** to one request per origin at a time, with a minimum gap (1.2 s by default) and
  any longer `Crawl-delay` honoured.
- **Cached on disk** for 6 hours, so re-running costs almost nothing and does not re-hit the
  sites.
- **Bounded**: a school crawl stops at 8 pages, 3 PDFs and a wall-clock budget, so one slow or
  dead website cannot stall a run.

Tunable via `SCRAPPER_MIN_GAP_MS`, `SCRAPPER_TTL_MS`, `SCRAPPER_UA`, `SCRAPPER_CACHE_DIR`,
`SCRAPPER_DB`.

---

## How roles are matched

A vacancy is scored 0–100 for how clearly it is PE-linked, and placed on a seniority ladder:
Director of Sport → Head of Department → 2nd in Department → Coordinator → Teacher → Coach →
Support. Because your focus is leadership, seniority dominates the ranking and the PE score
breaks ties.

The matching is deliberately careful about look-alikes. "Teacher of Physics", "Physical Science",
"Physiotherapist", "Head of Special Educational Needs" and "Pension Administrator" are all
rejected, while "Physics **and PE** Teacher" is kept — a veto only wins when no genuine PE term
is present. Titles score at full weight and body text at a quarter, so a long advert that happens
to mention "sport" cannot outrank a title that says "Head of PE".

The vocabulary lives in `src/match/taxonomy.ts` as plain data and is easy to extend. `test/`
covers 29 real titles that must match and 16 look-alikes that must not:

```bash
npm test
```

Raise or lower the bar with `--threshold 55` (default 40).

---

## Useful exports

```bash
npm run export -- --seniority director_of_sport,head_of_department   # leadership only
npm run export -- --status any                                       # include closed roles
npm run export -- --since 2026-09-01                                 # only new finds
npm run export -- --countries "United Arab Emirates" --min-score 55
npm run export -- --format tsv                                       # paste straight into Sheets
```

---

## Layout

```
config/
  fields.json       which columns the sheet gets
  locations.json    which countries/cities to target
src/
  cli.ts            commands
  pipeline.ts       scrape / enrich / directory / export
  sources/          one file per job board
  match/            PE vocabulary and scoring
  enrich/           website crawl, PDF reading, email ranking, fact extraction
  export/           column registry, CSV/TSV/JSON/HTML, Google Sheets
  store/db.ts       SQLite: history, lifecycle, school cache
data/               database, cache and output (git-ignored)
```

Everything lands in `data/`: `jobs.db` (the database), `cache/` (HTTP cache, safe to delete) and
`out/` (the exports).

---

## Things worth knowing

- **PE team size is an estimate, and usually blank.** Where a school states it ("a team of six PE
  teachers") it is accurate; otherwise it is counted from PE roles on a staff directory page,
  which is a proxy. It is never inferred from a job advert. The stored confidence reflects this,
  and provenance — source and the exact sentence — is kept for every enriched value.
- **Student counts come from marketing copy.** Group-wide totals ("9,000 students across our 11
  schools"), boarding-house capacities ("each accommodating up to 70 students") and dates
  ("since 2011 students have…") are all rejected, because each of them produced a wrong number
  in testing. Anything that survives is a stated roll, but spot-check outliers anyway.
- **Salary is indicative.** Many international schools do not publish figures; where they do, the
  number is averaged across that school's adverts, grouped by currency and period so that
  monthly AED is never averaged against annual GBP.
- **The career email is a best guess, ranked.** An address the board itself nominates as the
  application contact wins outright, then `recruitment@`/`careers@`, then `hr@`, then anything
  found on a careers page or in a job pack. Enable the `all_emails` column to see the runners-up.
