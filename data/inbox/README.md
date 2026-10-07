# Drop job-alert emails here

Save alert messages as `.eml` files in this folder. The next `npm run scrape`
reads them, classifies the roles like any other source, and merges them into
the sheet.

This folder is the only way some of the best listings reach you. Search
Associates, ISS EDUrecruit, TIE Online and Schrole keep their vacancies behind
a paid login, and scraping a members' area is both fragile and against their
terms. What all of them do is **email you matching roles** — that is the
sanctioned feed, so the scraper reads the email instead of the site.

The same applies to boards that cannot be read for technical reasons:
TopTutorJob sits behind Cloudflare, Eteach renders in the browser, LinkedIn and
Indeed forbid automated access. Their alert emails work perfectly.

## Getting the files here

**By hand.** Any mail client can save a message as `.eml`. In Gmail: open the
message, then ⋮ → *Download message*. Drop it in this folder.

**Automatically (recommended).** `tools/gmail-alerts-to-repo.gs` is a short Google
Apps Script that runs inside your Gmail: every 30 minutes it files each message
carrying the `job-alerts` label into this folder, through the GitHub API. The
scheduled scrape then reads it with no help from you. Setup is in the comment at
the top of that file (a Gmail filter, a one-repo GitHub token, one click). Only
the sender, subject, date and body are sent, with tracking and unsubscribe links
stripped, and your own address never leaves Gmail.

Messages older than 30 days are ignored: an alert is news, and a role that has
left the recent alerts stops being shown as open.

## Worth subscribing to

Free, and relevant to the countries in `config/directory.json`:

| Service | Why |
| --- | --- |
| **Search Associates** | The main international-school fair network. Roles often appear here weeks before anywhere public |
| **ISS EDUrecruit** | Same category, different member schools |
| **TIE Online** | Cheap, broad, and posts plenty of Asia-Pacific PE roles |
| **Schrole** | Now owned by Tes, so it overlaps TES — subscribe last |
| **Ajarn** | Thailand's main teaching board. Not scrapeable, emails fine |
| **Vietnam Teaching Jobs** | As the name says |
| **GaijinPot** | Japan |
| **SeekTeachers**, **Edvectus** | Agencies covering the whole region |
| **TES** and **Teach Away** alerts | Already scraped, but the email arrives sooner |

Set each alert to *Physical Education*, *PE*, *Sport* or *Head of PE*, and
restrict it to your countries where the service allows. The classifier filters
again on arrival, so a broad alert costs nothing but disk.

## What the parser handles

Real mail generators, not idealised examples: multipart bodies,
quoted-printable and base64 encoding, RFC 2047 encoded-word subjects. It
recognises the sender so every row says which service it came from, and it
ignores unsubscribe and tracking links.

Files are never deleted. Once a role is in the database it is deduplicated
against every other source, so re-reading the same alert is harmless.
