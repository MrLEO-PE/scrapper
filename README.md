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

Then:

```bash
npm run report               # opens the newest HTML report in your browser
```

The report is a single self-contained file, so it opens straight from disk — **no web server or
Live Server extension needed**. You can also double-click `data/out/pe-jobs-<date>.html`, or in
VS Code right-click it and choose *Reveal in File Explorer* then open it.

For the spreadsheet, import the `.csv` into Google Sheets (**File → Import → Upload**), or paste
the `.tsv` straight into a tab.

Or do all three at once:

```bash
npm run run-all
```

---

## What each stage does

### 1. `scrape` — find the vacancies

| Source | How it is read | Notes |
|---|---|---|
| **TES Jobs** | Public JSON API behind the jobs board, `International` filter | Strongest source. ~700 international vacancies scanned per run |
| **Teach Away** | Job records embedded in the board page, `phys-ed` filter + sitemap sweep | Carries school profile, curriculum, salary, benefits and the recruitment email |
| **Teacher Horizons** | Public "latest vacancies" feed | Limited by design — see [below](#a-note-on-teacher-horizons) |
| **Nord Anglia Education** | Group careers site (SAP SuccessFactors) | ~195 vacancies across 80+ schools |
| **Inspired Education** | Group careers site (SAP SuccessFactors) | ~270 vacancies across Europe, LatAm, Africa, Asia |
| **School careers pages** | Target schools checked directly | They often post before the boards — see [below](#your-target-schools) |
| **Email alerts** | `.eml` files you drop in `data/inbox/` | How the paid services reach the sheet — see [below](#paid-services-via-email-alerts) |
| **European Chamber China** | Single server-rendered board | Mostly commercial, but China international schools post occasionally |

The last two are *employers* rather than boards, which matters: roles appear on a group's own
careers site that never reach an aggregator, and the school is named directly. Both run on
SuccessFactors, so one parser serves both — adding another group that uses it is a single entry
in `SUCCESSFACTORS_SITES` in [`src/sources/successfactors.ts`](src/sources/successfactors.ts).

Limit a run to particular sources with
`--sources tes,teachaway,nordanglia,inspired,teacherhorizons`.

By default the scraper also opens each matching TES vacancy page, which yields the school's
website, its country, the address applications go to, and any job-pack PDFs — none of which the
search API returns. It costs about a minute and roughly triples the usable data. Pass
`--shallow` to skip it.

Fourteen search passes run against TES: the Physical Education subject filter, plus keyword passes
for *head of sport*, *director of sport*, *head of physical education*, *sports coordinator*,
*athletic director*, *games teacher*, and seven more added after checking what these countries
actually carry — *physical and health education* (the IB name, filed under a different subject),
*head of PE*, *PE teacher*, *swimming teacher*, *sports coach*, *outdoor education* and *strength
and conditioning*. Sport leadership roles are often filed under Senior
Leadership rather than PE, and the keyword passes are what catch them.

#### Your target schools

Schools often advertise on their own site before a board picks the role up, so a shortlist is
checked directly. They live in [`config/schools.json`](config/schools.json) — only the website is
required, because the careers page is found automatically:

```json
{ "name": "Bangkok Patana School", "website": "https://www.patana.ac.th",
  "country": "Thailand", "city": "Bangkok", "on": true }
```

Set `careers` explicitly only when auto-discovery picks the wrong page; some schools bury it
(SSIS uses `/community/teaching-in-ssis/join-us/`). Set `"on": false` to skip a school without
deleting it.

This is best-effort by design. Careers pages vary enormously: some list roles inline, some link
a PDF job description, and some embed an applicant-tracking widget that renders in the browser
and is therefore invisible here. Where the landing page only shows category headings — "Teaching
Vacancies", "Faculty Vacancies" — up to three of those are followed. Schools already inside Nord
Anglia or Inspired are covered by the group sources, so listing them again is redundant.

#### Paid services, via email alerts

Search Associates, ISS EDUrecruit, TIE Online and Schrole keep their listings behind a login, and
scraping a members' area you pay for is both fragile and against their terms. What they all do is
**email you matching vacancies** — that is the sanctioned feed, so the scraper reads the email
instead.

Drop the alert messages into `data/inbox/` as `.eml` files and they are parsed, classified and
merged with everything else. Any mail client can save a message as `.eml` (in Gmail: open the
message → ⋮ → *Download message*). To automate it, set a Gmail filter on the alert senders that
applies a label, then have any IMAP-capable client sync that label into `data/inbox/`.

The parser handles what real mail generators produce — multipart bodies, quoted-printable,
base64, encoded-word subjects — and recognises the sender so each row says which service it came
from. Unsubscribe and tracking links are ignored.

Two notes on that list. **Schrole is now owned by Tes**, and its vacancies largely appear on TES,
which is already scraped — so it mostly duplicates what you have. **International School
Community**'s value is its salary data for ~1,850 schools, which is a cross-check for offers
rather than a job feed; there is no automated import for it.

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
| Website | The school's own site — the tool you use to finish the Prepared Email, since every missing detail lives there |
| Facebook / Instagram | The school's social page. For a school with no website this is the only route left — **you** open it; the scraper never reads it (see below) |
| Students in School | School website / job pack |
| School Type | Grade levels, else the website (Primary / Secondary / Primary + Secondary / University) |
| Approx. Salary (PE expat) | Averaged across that school's adverts, grouped by currency |
| Open PE Role? / Open Role Link / Deadline | Whether the school is advertising right now, and the vacancy behind it. A school earns its place in the list on its own merits — this column is *when to act*, not *why it is listed* |
| Package & Career Growth | Board benefits + housing/flights/insurance/CPD/progression terms found in text |
| Package Score | 0–100, weighted by what each benefit is worth to an expat — see [the ranking](#how-the-ranking-works). Blank means not yet known, not poor |
| Accreditation | CIS, IB, NEASC, WASC, MSA, COBIS, BSO… |
| Rank in Country / Rank Basis | Position in its country's top schools, and what that position actually rests on |
| School Email | Best general inbox |
| **Best Contact** / Contact Type | The single best route to the school, whatever it turns out to be: careers address, else HR, else the general inbox, else any address found, else the phone, else the Facebook page — and what each one is, because a switchboard is not a careers desk |
| Career Email | Best recruitment/HR address — the one the school nominated for job notifications, or one found on its site or inside a job-pack PDF |
| Phone | Switchboard number the directory publishes. The route left when there is no email and no website |
| Job Title, Role Level, Still Available?, Job Link, Deadline, Source | The vacancy |
| Days Left | Days until the deadline — sort by it to see what is urgent |
| Form to Fill? / Form Link | Whether applying needs an application form, and where it is |

### Which countries you see

`config/directory.json` is the single list of countries you care about, and **every view holds to
it** — the schools list and the live vacancies alike.

Scraping still covers every board in full, so narrowing the list hides nothing permanently: add a
country and the next build shows its roles, with no re-scrape. Widen a single export with
`--all-countries`.

A vacancy whose country the board did not state is kept rather than hidden. A school with no
country can wait for the next directory run; a vacancy has a deadline, and hiding it to tidy a list
is the one outcome here that actually costs something.

### Why widening the net means more APIs, not more careers pages

The school-careers source was pointed at 165 schools instead of 45 — every school in the configured
countries that has a known website, best-ranked first. It returned **six** PE roles.

The reason is not the target list and not robots.txt (8 refusals out of 165). It is that a school's
careers page increasingly loads its vacancy list client-side, from an applicant-tracking widget.
Concordia Shanghai's page is 233 KB with 69 links and **not one of them is a job** — the roles
arrive by JavaScript after the page does, and there is no browser here to run it. Fourteen known
careers pages were checked directly: all fourteen reachable, all role-shaped in their wording, and
almost none with an extractable list.

So the leverage is in APIs. Adding **International Schools Partnership** — one group, recruiting
through Workday's JSON endpoint — found seven in-scope PE roles that nothing else was seeing,
against six from 165 hand-crawled sites. Groups worth adding next, in rough order of value:
Harrow International, Wellington College China, Maple Leaf, BASIS China, and the country boards
ajarn.com (Thailand) and vietnamteachingjobs.com.

### Finding the websites that gate everything

The crawl finds the careers email, the package, the head's name and the PE facts, and it cannot
start without an address. Teach Away leaves it blank for most of its directory, so
`npm run find-websites` fills the gap, writing to `config/school-websites.json` where every entry
can be inspected and a wrong one deleted by hand.

Three routes, cheapest first: the domain of an address already held, a guess from the school's name
against the domains schools in that country use, and — if a key is set — a web search.

```bash
npm run find-websites -- --dry-run     # show what it would write
npm run find-websites                  # write config/school-websites.json
```

**The optional search key.** Guessing resolved 53 schools; the remaining 304 either have no
distinctive name or ignore their country's domain convention, and only a search engine reaches
those. Brave's free tier is 2,000 queries a month, which clears the backlog several times over:

```bash
export SCRAPPER_SEARCH_KEY=your-brave-api-key
```

Without it, search is skipped and the other two routes still run. Every search result is verified
exactly as a guess is — a first result is a strong hint, not proof.

**Why verification matters more than reach.** A wrong address produces a confident careers email,
package and pay figure for a different school, and nothing downstream looks any less certain than
the truth. Three rules stop that:

- A nationality or place name is not distinctive enough to guess from. *Canadian International
  School of Singapore* resolved to `canadian.edu.sg`, which is Canadian Education College.
- A host several schools resolve to identifies none of them. Five *EF English First* branches all
  reached `english.com`, which is Pearson Languages.
- A real school site uses many schoolish words often, not one word repeatedly. `basis.com` is an
  advertising platform whose product is called Basis Academy.

### Schools with no website

Plenty of smaller schools have no website but do run a Facebook or Instagram page, and that page
usually carries the head's name, the sports facilities and often a contact address — exactly what
the Prepared Email needs.

The scraper records the link and never opens it. [Meta's Automated Data Collection
Terms](https://www.facebook.com/legal/automated_data_collection_terms) prohibit automated
collection from Facebook and Instagram without express written permission, and LinkedIn says the
same. You opening a public page in your browser is an entirely different thing, and that is the
division of labour here: the tool finds the link, you do the reading.

The refusal is enforced by hostname in the crawler, not by trusting where a URL came from — a
school whose only presence is a Facebook page has that link stored where a website would normally
go, so the guard has to hold there too. Links are collected from advert text and from school site
footers, and can be added by hand in `config/school-websites.json` with `social` in place of `url`.

Share buttons, login walls and post permalinks are ignored; only paths that look like an account
are kept, and tracking query strings are stripped so one page is one link.

### One school, one row

A school arrives from two directions — a vacancy on a board and a country listing in the directory
— and the two rarely agree on the name or even the country. Writing both would split the evidence:
the vacancy row holds the salary, the directory row holds the accreditation, and neither can be
ranked on what is actually known about the school. So a write that matches an existing school
**updates it** instead of adding a second row.

Two records are the same school when they share a name (once generic words like *School*,
*International* and *Academy* are dropped) and either agree on the country or leave it blank, or
when their websites settle a disagreement. One school written two ways on its own domain —
*United World College of South East Asia* and *UWC South East Asia* — also merges.

Matching is deliberately conservative, because a missed merge is visible and fixable while a wrong
merge silently fuses two real schools:

- *Lincoln School* in Nepal and *Lincoln School* in Costa Rica stay apart — same name, different
  countries, no shared website.
- Thirteen BASIS schools publishing on one applicant-tracking domain stay apart: a domain serving
  a crowd identifies nothing.
- Records naming different cities stay apart, so campuses are never fused.

```bash
npm run dedupe -- --dry-run     # show what would merge, write nothing
npm run dedupe                  # merge, then re-rank
```

Merging only ever fills gaps — a value is taken from the row being removed only where the row
being kept has none — so it combines evidence and cannot lose it.

## Tracking what you have applied to

The sheet tells you what exists. This tells you where **you** stand with it — which turns a list
into a pipeline, and lets the scraper answer the question that actually matters each morning:
*what will I lose if I do nothing today?*

```bash
npm run track                                   # pipeline + what closes soon
npm run track -- applied "head of sports kdu"   # mark one
npm run track -- interview "athletic director dalian"
npm run track -- skip "volleyball coach" --note "too junior"
```

Statuses: `interested`, `applied`, `interview`, `offer`, `rejected`, `skip`.

Roles are picked by typing part of the title or school, because job ids are unreadable. **An
ambiguous phrase never guesses** — it lists the matches and asks you to add a word or pass
`--pick 2`. Marking the wrong role "applied" would silently cost you a real application.

With nothing tracked, `npm run track` still earns its place by listing everything closing inside
a week that you have not dealt with.

Two things follow from marking a role:

- **A scrape never touches it.** Your status survives every future run, including the one that
  closes the vacancy. It is the only data in the database you own rather than collect.
- **Alerts go quiet about it.** Applying or skipping removes a role from the daily email, so the
  alert stays about things that still need you. `interested` deliberately does not — you have
  noticed it, not dealt with it.

The **My Status** column carries this into the sheet and the site.

### "Prepared Email" — a draft you can actually send

A personalised application email, about 180 words, following the structure in
[`config/profile.json`](config/profile.json) — which holds your own words, your site and the
paragraph about what you bring. Edit that file and every future email changes.

**Nothing in it is invented.** Three details have to come from the school's own website:

| Detail | Example |
|---|---|
| Principal | `Mr Ian Thurston` |
| A real fact about the school | `is accredited by the Council of International Schools` |
| A real fact about their PE/sport | `the swimming pool` |

If any of the three is missing, the cell says so instead of writing around it:

```
NEEDS: principal name, PE/sport fact — check the school's website and fill in by hand
```

That is deliberate. A confidently wrong Principal's name, or praise for a pool the school does
not have, ends an application — so a blank is the safer answer. The **Principal** column shows
the name on its own, so you can fill the rest in yourself.

The paragraph about what you bring is matched to what their PE page mentions: a pool selects the
swimming variant, a fitness suite the bleep-test one. Add or edit variants in `profile.json`.

**Expect roughly one complete email in ten.** Most school sites do not name their Head on a page
the crawler can reach, and a "hook" has to be specific enough to be worth saying. On a sample of
20 schools it found 8 principals, 5 school facts and 5 PE facts — with all three lining up once.
The rest tell you which single detail to look up, which is a couple of minutes rather than a
blank page.

Getting this strict took several passes against real sites. Early versions confidently returned
`Hillview International School`, `Principal's Perspective`, `Deepa Hitange Coordinators` and
`Holly Gibbs It` as people's names. Each is now a test case.

### Salary — and why the column is mostly empty

Start with the number that matters: **of 85 open PE roles, 6 publish a figure.** 23 say
"competitive" or similar, and 56 say nothing about pay at all. That is the sector, not a gap in
the scraper — international schools negotiate rather than advertise.

Figures are looked for in four places, strongest evidence first: the board's own salary field,
the advert text, any attached job pack or published pay scale, and the school's website. The
**Salary Basis** column then says which of those a number came from, because "AED 15,000" is
useless without knowing whether it is monthly or annual, one advert or an average:

| Basis | Meaning |
|---|---|
| `this advert` | The vacancy's own published figure |
| `stated in the advert` | A figure written in the advert text |
| `from the job pack` | A figure in an attached pack or pay scale |
| `from the school's site` | Published on the school's own pages |
| `average of this school's adverts` | Averaged, with the count shown |
| `benchmark for comparable roles` | What other schools in that country advertise |
| `no figure published` | Words only — "competitive", "negotiable" |

**A benchmark is only offered when it can carry weight.** It needs at least three *distinct
schools* advertising in the same currency and period, and their figures must actually differ.
That second rule exists because of a real case in this data: BASIS Shenzhen, Guangzhou and
Bilingual all advertise exactly USD 55,000–65,000. Three schools, one group pay scale — that is
one data point dressed as three, and averaging it would invent a market rate that nobody quoted.

**What is not used.** Reddit and similar forums were considered and ruled out, not overlooked:
Reddit's `robots.txt` is a blanket `Disallow: /`, its Public Content Policy restricts reuse, and
the endpoint returns HTTP 403 to anonymous requests. Forum figures are also unattributable — a
comment cannot be cited back to a school the way a published pay scale can. If you want that
signal, International School Community's salary database is the honest route, and it is a
paid human lookup rather than something to automate.

### "PE Roles Seen" and "Turnover" — does anyone stay?

A school that keeps re-advertising the same PE post is telling you something. Because every run
commits the database, the scraper accumulates that history by itself:

| Column | What it is |
|---|---|
| **PE Roles Seen** | How many separate PE vacancies this school has advertised since the scraper started watching |
| **Turnover** | Low / Moderate / High, from how often it advertises |

Postings are counted per vacancy, not per advert, so the same role appearing on TES and Teach
Away counts once.

**Turnover stays blank for the first six months, deliberately.** On a database a fortnight old,
three postings looks alarming and means nothing — a school may simply have opened a new campus.
The rating is based on postings per year once there is enough history: roughly 3+ a year reads as
High, 1.5–3 as Moderate, below that as Low. It is a prompt to look closer at a school, not a
measurement — a large all-through school legitimately hires more PE staff than a small primary.

### "Form to Fill?" — what the values mean

Schools ask for applications in different ways, and the difference is worth knowing before you
start, because one of them is work you must do in advance:

| Value | Meaning |
|---|---|
| **Yes — PDF** / **Yes — Word** | A document to download, complete and send back. **Form Link** has it |
| **Yes — online** | A web form — the board's own apply flow, a Google Form, Quick Apply |
| **No** | No form was mentioned. **Not a guarantee there isn't one** — only that nothing said so |

Evidence is taken in order of reliability: a document attached to the advert, then a form link on
the careers page, then the advert's wording. A "Recruitment Pack" or "Candidate Brochure" is
reading material, not a form, and is excluded — those names are common and would otherwise
produce a false yes on most adverts.

On the current data 6 of 85 roles ask for a form, all of them online. Downloadable forms are
rarer on the big boards, which run their own apply flow; they turn up more often on a school's
own careers page.

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
| **PE Team (teachers)** | **1%** | Schools almost never publish this — **unticked by default**, see below |

**PE team size is unticked**, because at 3 schools in 521 a column is just a column of blanks.
`Website` takes its place in the default sheet: it is the tool you use to finish the Prepared
Email, since the principal's name, the school fact and the PE fact all live there. Re-tick it with
`npm run fields -- --enable pe_team_size` if you want it back.

**PE team size is the honest weak spot.** Schools essentially never write "our PE department has
six teachers", so the only route is counting PE roles on a staff directory — which many schools
do not publish at all, and which is a proxy rather than a headcount. An earlier version inferred
it from job adverts and was wrong: an advert for a PE role repeats "PE Teacher" several times,
and counting those reported the advert's own title as the size of the department. That is now
blocked, which is why the number is small but trustworthy. Treat a filled cell as a hint and
verify before relying on it.

---

## Running it from GitHub (no terminal)

The repository ships a GitHub Actions workflow that runs the whole pipeline in the cloud and
publishes the results as a small website. Once set up, checking for new PE roles is opening a
bookmark, and running a fresh scrape is one button.

### One-time setup

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: `GitHub Actions`.**
   This step is the one that matters. If it is left on *Deploy from a branch*, GitHub renders
   `README.md` as the site — so you end up looking at this page instead of your vacancies.
3. **Settings → Actions → General → Workflow permissions: `Read and write permissions`.**
   Without this the run cannot commit the database back, and the history is lost each time.
4. **Actions → Scrape PE jobs → Run workflow.** Nothing is published until a run has finished;
   the workflow builds the site, so there is no site before the first run.

That is all. The workflow needs no secrets to work.

> **Seeing this README at your Pages URL?** Pages is still set to *Deploy from a branch*. Change
> it to *GitHub Actions* (step 2) and run the workflow once.

### Can I start a scrape from the website itself?

Not directly, and it is worth knowing why: GitHub Pages serves static files only — there is no
server behind it to run anything. Triggering a run from the page itself would mean putting a
GitHub token in the page, where anyone could read it.

So the published pages carry a green **▶ Run a new scrape** button that takes you to the
workflow, and you press **Run workflow** there. Two clicks, no credentials exposed. The daily
schedule means you rarely need it.

### Two actions

| Workflow | What it does | When |
|---|---|---|
| **Scrape PE jobs** | Live vacancies, enrichment, alerts | Daily, 06:00 UTC |
| **Scrape top schools** | The standing school directory — package and salary research | Weekly, Sunday 03:00 UTC |

They share one database, so a concurrency group stops them running at the same time.

### Using it

- **Run it now:** the **Actions** tab → *Scrape PE jobs* → **Run workflow**. You can narrow it to
  certain sources, cap how many schools get enriched, or tick *shallow* for a quick pass.
- **Automatically:** it already runs every morning at 06:00 UTC. Change or remove the `cron` line
  in [`.github/workflows/scrape.yml`](.github/workflows/scrape.yml).
- **Read the results:** your Pages URL, `https://<your-username>.github.io/<repo>/`, with three
  views and the CSVs:

  | Page | What it is |
  |---|---|
  | `index.html` | Open PE vacancies, leadership highlighted, sortable and filterable |
  | `schools.html` | One row per school with curriculum, size, package and the careers email |
  | `closed.html` | Roles no longer listed, kept for reference |
  | `pe-jobs.csv` / `schools.csv` | The same tables, ready for Google Sheets |

It works on a phone, which is the point — the report is one self-contained file per page.

### Getting told, instead of remembering to look

A published page only helps if you open it, and a Head of Sport can appear and close inside a
week. So each run opens a GitHub issue listing anything worth acting on:

- **every leadership role** — Director of Sport, Head of Department, 2nd in Department;
- **anything closing within 7 days**;
- strong PE matches that are neither.

GitHub emails you when an issue is opened, so that is the notification — no mail server, no
secrets, and it reaches your phone. Close the issue once you have read it.

Each vacancy is stamped once alerted, so tomorrow's run reports what is genuinely new rather than
the same roles every morning. To see the current picture on demand:

```bash
npm run alerts                      # what deserves attention right now
npm run alerts -- --all             # including ones already alerted
```

On the site itself, rows carry a red **soon** badge when the deadline is within a week and a
green **new** badge when first seen in the last two days — though the **new** badge hides itself
when nearly everything is new, since a badge on every row says nothing. Sort by **Days Left** to
put the urgent ones on top.

### How history survives

Each run commits `data/jobs.db` back to the repository. That is what lets the **Still Available?**
column mean anything, and what lets thin sources like Teacher Horizons accumulate coverage over
time. Everything else (the HTTP cache, generated exports) stays out of git.

### Optional: write straight to a Google Sheet

Add two repository secrets and each run updates your sheet as well:

| Secret | Value |
|---|---|
| `GOOGLE_SHEET_ID` | The id from the sheet's URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The whole service-account key file, pasted in |

The step is skipped when they are absent, so nothing breaks if you never set them.

### Worth knowing

- GitHub disables scheduled workflows in a repository with no activity for 60 days. A single
  manual run re-enables them.
- Scheduled runs are queued, so 06:00 UTC is a "not before", not a promise.
- Pages on a **private** repository needs a paid GitHub plan. On a public repository it is free —
  but then your shortlist and the schools' contact emails are public too. A private repo, or
  keeping the site local with `npm run site`, avoids that.

To build the same folder locally:

```bash
npm run site        # writes site/ — open site/index.html
```

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

## The standing school directory

The second of the two actions. Where the job scrape answers "what is open today?", this one
answers "which schools are worth a PE job at all?" — collected whether or not they are hiring,
and profiled for package, salary and the careers contact.

Quotas live in [`config/directory.json`](config/directory.json), one line per country:

```json
{ "name": "China",   "top": 200 },
{ "name": "Türkiye", "top": 10, "cities": ["Istanbul"], "slug": "turkey" }
```

`top` is a **ceiling, not a promise** — whatever the directory lists is taken, up to that number.
The current configuration asks for 775 schools across 59 countries and finds **495**, because
availability varies enormously:

| | asked | found |
|---|---|---|
| China | 200 | 200 |
| Thailand | 40 | 35 |
| Malaysia | 30 | 19 |
| Laos | 5 | 1 |
| Bhutan | 10 | 2 |
| Most small island nations | 5 | 0 |

That is not a failure. Laos genuinely has one international school in this directory, and Fiji,
Samoa, Tonga and Vanuatu have none listed at all — which is itself worth knowing before you plan
a move there.

`slug` exists because the directory does not always spell a country the way we do: Türkiye is
filed under `turkey`, Micronesia under its full formal name. Without those overrides both
returned nothing.

### Why it runs in batches

Collecting the list is cheap — one request per country. **Profiling is not**: each school means
visiting its website, so 495 schools would run for hours. Each run therefore profiles the next
slice (120 by default) and the picture fills in over a few weeks. Schools behind a live vacancy
are always profiled first; a role you could apply to today outranks a survey.

```bash
npm run directory -- --list-only          # collect and rank, visit nothing
npm run directory -- --countries "Qatar,Oman" --top 20
npm run enrich -- --limit 120             # profile the next batch
npm run export -- --schools               # one row per school
```

## Directory mode — schools regardless of vacancies

The long-term view: the leading international schools in the countries you care about, whether
or not they are advertising a PE role today, enriched into the same columns.

```bash
npm run locations -- --on AE,QA          # pick your countries
npm run directory -- --top 30            # top 30 per country
npm run directory -- --cities Dubai      # or narrow to one city
npm run directory -- --list-only         # rank without crawling each site
npm run rank                             # re-rank after an enrich run
npm run export -- --schools              # one row per school, best first
```

### How the ranking works

There is no official global ranking of international schools, so this does not pretend to be one.
It ranks on the thing you actually care about: **what you would be paid and given.**

Each school's package is scored 0–100 by what each benefit is worth to an expat teacher, not by
how many are listed — housing (30) and dependant school places (25) count for far more than a
transport allowance (3), so a school offering "bonus + transport" never outranks one offering
accommodation and free places for your children. Where a country has two or more schools quoting
salary in the same currency and period, the figure refines the order but does not decide it: a
headline salary with no housing attached is usually the worse offer. Salaries are never compared
across currencies, because converting without a rate would be inventing data.

The **Rank Basis** column says what each position actually rests on:

| Basis | Meaning |
| --- | --- |
| `package + salary` | Both established from the school's own material. |
| `package` | Package established; no comparable salary figure in that country. |
| `accreditation only` | **Not profiled yet.** Position is a proxy from accreditation (CIS, IB, NEASC, WASC, MSA, COBIS, BSO…), recognised-institution status, whether it is all-through, and how complete its profile is. It says nothing about pay. |

### Why salary cannot rank schools, and what does

Per-school salary is not public data for international schools. A sweep of job packs, school
websites, salary aggregators and teacher forums produced figures for **9 of 521 schools**. The one
systematic source, [internationalteachersalary.com](https://www.internationalteachersalary.com/countries),
turns out to publish *country* aggregates from anonymous teacher submissions, not school records.

So the sheet carries the country average, which is genuinely knowable, and labels it as such:

| Column | What it is |
| --- | --- |
| Approx. Salary | The school's own figure where one exists, otherwise `~USD 60,000/year` — the country average |
| Salary Basis | Which of the two it is, and for an average, how many teachers reported it |
| Salary Range (country) | The low-to-high spread, because Thailand averaging $44k across $17k–$92k tells you the average says little about any one school |

A figure standing on fewer than five reports is withheld rather than shown. Bangladesh sits at
$88,000 on a single submission, which would have been the most eye-catching wrong number in the
sheet.

**The country average is identical for every school in that country, so it cannot rank them
against each other.** That is arithmetic, not a limitation to be worked around: ranking is
within-country, and a constant cancels out. Within a country the order therefore rests on what
genuinely varies school by school — the package terms, and accreditation where no package is known
yet. Salary refines the order only in the rare case where two schools in one country both publish a
real figure in the same currency.

Two deliberate choices are worth knowing. A package score below 25 is treated as unknown rather
than poor — finding the word "bonus" is not evidence of a good package, and letting it outrank an
accredited school we simply have not read yet would reward being easy to crawl. And hiring
activity is not scored at all: a school posting thirteen roles at once may be a school people keep
leaving. The count is still recorded, and the **Turnover** column reads it over time, where
repetition actually means something.

Ranking runs *after* enrichment, because a school's package is not known until its site has been
read. Until then its rank is provisional and the basis column says so. Run `npm run enrich` to
convert `accreditation only` rows into real ones.

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

## Sources assessed and not added

Each of these was probed rather than assumed, and left out for a stated reason. Worth recording
so they are not re-attempted.

| Source | Why not |
|---|---|
| **Most school careers pages** | The page loads, but the vacancy list does not — it is rendered client-side by an ATS widget. Concordia Shanghai serves 69 anchors and not one is a role. See below |
| **Harrow International** | Recruits through TIC Recruitment, whose robots.txt cannot be fetched, so it is not crawled |
| **Dulwich College International, Wellington College China** | Careers pages are JavaScript shells: 21 KB and 150 KB respectively, zero role links in the HTML |
| **SABIS** | 14 KB shell, no roles server-rendered |
| **Randstad / Teachanywhere** | Its international teaching section returns *no results at all*; the PE jobs it does list are UK domestic. Teachanywhere.com redirects to Randstad — one source, not two |
| **TopTutorJob** | Behind Cloudflare bot protection (HTTP 403, "Just a moment…"). That is an access control, and working around it is not something this tool does |
| **FOBISIA on Eteach** | The fair page states "The event has now ended" and lists nothing. Eteach's own job search is a 2.7 KB JavaScript shell, so it needs a real browser |
| **Cognita** | Cornerstone ATS, rendered client-side — would need Apify or Playwright |
| **Dulwich College International** | No job links in `/careers`, and `/careers/search` is disallowed by robots.txt |
| **Workable** | A hosting platform rather than a board; only useful per named employer |
| **Monster Thailand, spill.org** | Aggregators — the underlying posting is better read at its source |
| **APLi / Search Associates vacancy pages** | Behind membership; use the email alerts instead |
| **LinkedIn, Indeed** | Both actively block automated access and forbid it in their terms. Email alerts only |

Adding a JavaScript-rendered source would mean a headless browser, which is the one dependency
this project avoids. If you want Cognita or Eteach badly enough, that is the trade to make.

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

One look-alike is worth calling out because it is not obvious: **"PE" is also the state code for
Pernambuco in Brazil**, written "Recife/PE". Brazilian school groups advertise nurses, teaching
assistants and music teachers with that suffix, and all of them matched before a veto was added.
A genuine "Professor de Educação Física - Recife/PE" still matches, because a real subject term
outweighs the veto. Spanish and Portuguese subject names are recognised, since the school groups
run Iberian and Latin American schools.

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
