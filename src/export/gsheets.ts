/**
 * Optional live sync to a Google Sheet.
 *
 * CSV/TSV export already gives you a file to import. This pushes the same table
 * straight into a sheet instead, so a scheduled run keeps one document current
 * rather than leaving a trail of downloads.
 *
 * Auth is a Google Cloud **service account** — no browser consent flow, which
 * is what makes unattended scheduled runs possible. Setup is in the README;
 * the short version is: create a service account, download its JSON key, and
 * share your sheet with the account's email address as an Editor.
 *
 * Implemented directly against the REST API with a self-signed JWT, so the
 * project keeps its zero-dependency footprint.
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { log } from "../core/logger.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function loadCredentials(path?: string): ServiceAccount | null {
  const file = path || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file) {
    log.error("no service-account key given.");
    log.plain("  Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, or pass --key-file.");
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) {
      log.error(`${file} is not a service-account key (missing client_email / private_key)`);
      return null;
    }
    return parsed;
  } catch (err) {
    log.error(`could not read ${file}: ${(err as Error).message}`);
    return null;
  }
}

/** Exchange a signed JWT for an access token. */
async function getAccessToken(creds: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  let signature: string;
  try {
    // Keys pasted into .env often carry literal \n; restore real newlines.
    const pem = creds.private_key.replace(/\\n/g, "\n");
    signature = base64url(signer.sign(pem));
  } catch (err) {
    log.error(`could not sign the token: ${(err as Error).message}`);
    return null;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    log.error(`token request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function api(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown | null> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    log.error(`Sheets API ${res.status} on ${path}: ${text}`);
    if (res.status === 403) {
      log.warn("Share the sheet with the service account's client_email as an Editor.");
    }
    return null;
  }
  return res.json();
}

/** Create the tab if it is missing. */
async function ensureTab(token: string, spreadsheetId: string, title: string): Promise<boolean> {
  const meta = (await api(token, spreadsheetId)) as
    | { sheets?: { properties?: { title?: string } }[] }
    | null;
  if (!meta) return false;

  const exists = meta.sheets?.some((s) => s.properties?.title === title);
  if (exists) return true;

  const created = await api(token, `${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: { requests: [{ addSheet: { properties: { title } } }] },
  });
  if (created) log.info(`created tab "${title}"`);
  return !!created;
}

export interface SyncOptions {
  spreadsheetId: string;
  tab?: string;
  keyFile?: string;
  headers: string[];
  rows: string[][];
}

export async function syncToSheet(opts: SyncOptions): Promise<boolean> {
  const creds = loadCredentials(opts.keyFile);
  if (!creds) return false;

  const token = await getAccessToken(creds);
  if (!token) return false;

  const tab = opts.tab || "PE Jobs";
  if (!(await ensureTab(token, opts.spreadsheetId, tab))) return false;

  // Wipe the tab first so removed rows do not linger below the new data.
  const cleared = await api(token, `${opts.spreadsheetId}/values/${encodeURIComponent(tab)}:clear`, {
    method: "POST",
    body: {},
  });
  if (!cleared) return false;

  const values = [opts.headers, ...opts.rows];
  const written = await api(
    token,
    `${opts.spreadsheetId}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
    { method: "PUT", body: { values } },
  );
  if (!written) return false;

  // Freeze and bold the header row so the sheet is usable straight away.
  const meta = (await api(token, opts.spreadsheetId)) as
    | { sheets?: { properties?: { title?: string; sheetId?: number } }[] }
    | null;
  const sheetId = meta?.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;

  if (sheetId != null) {
    await api(token, `${opts.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
        ],
      },
    });
  }

  log.ok(
    `synced ${opts.rows.length} rows × ${opts.headers.length} cols to "${tab}" — ` +
      `https://docs.google.com/spreadsheets/d/${opts.spreadsheetId}`,
  );
  return true;
}
