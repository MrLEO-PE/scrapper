/**
 * Minimal PDF text extraction, built on node:zlib.
 *
 * School job packs and prospectuses are frequently PDFs, and the careers email
 * is often only in there. A full PDF library would be overkill: we only need
 * enough text to run an email regex over, and every digitally-generated PDF
 * stores its text in content streams as `(literal) Tj` or `[(a)(b)] TJ`
 * operators, usually FlateDecode-compressed.
 *
 * Not handled, by design: scanned//image PDFs (no text layer at all) and the
 * rarer LZW/ASCII85 filters. Those return whatever plain text is recoverable,
 * which is normally nothing — the caller treats an empty result as "no data"
 * rather than an error.
 */

import { inflateSync, inflateRawSync, unzipSync } from "node:zlib";
import { log } from "../core/logger.ts";

/** Decompress a Flate stream, tolerating the several ways PDFs get this wrong. */
function inflate(buf: Buffer): Buffer | null {
  for (const fn of [unzipSync, inflateSync, inflateRawSync]) {
    try {
      return fn(buf);
    } catch {
      /* try the next variant */
    }
  }
  // Some writers pad with whitespace before the zlib header.
  const start = buf.findIndex((b) => b === 0x78);
  if (start > 0 && start < 16) {
    try {
      return inflateSync(buf.subarray(start));
    } catch {
      /* give up on this stream */
    }
  }
  return null;
}

/** Decode a PDF literal string body, resolving escapes and octal codes. */
function decodeLiteral(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = s[++i];
    if (next === undefined) break;
    switch (next) {
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "b": case "f": out += " "; break;
      case "(": out += "("; break;
      case ")": out += ")"; break;
      case "\\": out += "\\"; break;
      case "\n": break; // line continuation
      default:
        if (next >= "0" && next <= "7") {
          let oct = next;
          while (oct.length < 3 && s[i + 1] !== undefined && s[i + 1]! >= "0" && s[i + 1]! <= "7") {
            oct += s[++i]!;
          }
          out += String.fromCharCode(Number.parseInt(oct, 8));
        } else {
          out += next;
        }
    }
  }
  return out;
}

/** Decode a hex string `<48656C6C6F>`, including UTF-16BE text. */
function decodeHex(body: string): string {
  const hex = body.replace(/[^0-9a-fA-F]/g, "");
  const bytes = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
  // UTF-16BE is marked by a BOM; otherwise treat as Latin-1.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return bytes.subarray(2).swap16().toString("utf16le");
  }
  return bytes.toString("latin1");
}

/** Pull readable text out of one decoded content stream. */
function textFromContentStream(content: string): string {
  let out = "";
  // Literal strings: (…) with escaped parens.
  const literal = /\((?:\\.|[^\\()])*\)/gs;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(content))) {
    out += decodeLiteral(m[0].slice(1, -1));
    out += " ";
  }
  // Hex strings: <…>, excluding dictionary delimiters <<…>>.
  const hex = /<([0-9a-fA-F\s]{4,})>/g;
  while ((m = hex.exec(content))) {
    if (content[m.index - 1] === "<" || content[m.index + m[0].length] === ">") continue;
    out += decodeHex(m[1]!) + " ";
  }
  return out;
}

/**
 * Extract as much text as we can from a PDF buffer.
 * Returns "" when the document has no recoverable text layer.
 */
export function pdfToText(buf: Buffer, maxChars = 400_000): string {
  if (!buf?.length) return "";
  // Quick sanity check on the header.
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    log.debug("pdf: not a PDF (bad header)");
    return "";
  }

  const latin = buf.toString("latin1");
  const pieces: string[] = [];
  let total = 0;

  // Walk every `stream … endstream` span.
  const STREAM = "stream";
  const ENDSTREAM = "endstream";
  let cursor = 0;

  while (total < maxChars) {
    const sIdx = latin.indexOf(STREAM, cursor);
    if (sIdx === -1) break;
    const eIdx = latin.indexOf(ENDSTREAM, sIdx);
    if (eIdx === -1) break;

    // The dictionary immediately before the stream tells us the filter.
    const dictStart = latin.lastIndexOf("<<", sIdx);
    const dict = dictStart === -1 ? "" : latin.slice(dictStart, sIdx);

    // Skip the EOL that must follow the `stream` keyword.
    let dataStart = sIdx + STREAM.length;
    if (latin[dataStart] === "\r") dataStart++;
    if (latin[dataStart] === "\n") dataStart++;

    const raw = buf.subarray(dataStart, eIdx);
    cursor = eIdx + ENDSTREAM.length;

    // Images and fonts carry no useful text; skip them cheaply.
    if (/\/Subtype\s*\/Image|\/FontFile|\/Type\s*\/XObject\s*\/Subtype\s*\/Image/.test(dict)) continue;

    let content: string | null = null;
    if (/\/FlateDecode/.test(dict)) {
      const out = inflate(raw);
      if (out) content = out.toString("latin1");
    } else if (!/\/(?:DCT|JPX|CCITT|RunLength|LZW|ASCII85)Decode/.test(dict)) {
      content = raw.toString("latin1");
    }
    if (!content) continue;

    const text = textFromContentStream(content);
    if (text.trim()) {
      pieces.push(text);
      total += text.length;
    }
  }

  // Some PDFs store metadata/text uncompressed outside streams; sweep those too.
  if (total === 0) {
    const fallback = textFromContentStream(latin);
    if (fallback.trim()) pieces.push(fallback);
  }

  return pieces
    .join(" ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}
