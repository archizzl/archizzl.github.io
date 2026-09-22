// Extract a recording date from an audio file. Returns a JS Date, or null if
// nothing usable was found (caller falls back to file.lastModified).
//
// Supports:
//   - MP3: ID3v2 TDRC (2.4), TYER + TDAT (2.3)
//   - WAV: RIFF LIST/INFO ICRD chunk
//   - M4A / MP4: moov/udta/meta/ilst/©day atom
//
// Everything is parsed from the file's own bytes — no external metadata
// libraries — so unusual tags or exotic containers may not be recognized.

export async function extractRecordingDate(file: File): Promise<Date | null> {
  // Only read a modest header slice; date metadata always sits near the top.
  const HEAD_BYTES = 512 * 1024;
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  if (head.length < 4) return null;

  const sig4 = String.fromCharCode(head[0], head[1], head[2], head[3]);

  if (sig4 === "ID3") return parseId3(head);
  if (sig4 === "RIFF") return parseRiff(head);
  if (looksLikeMp4(head)) return parseMp4(head);

  return null;
}

// ------------------------- ID3v2 (MP3) -------------------------

function parseId3(buf: Uint8Array): Date | null {
  if (buf.length < 10) return null;
  const majorVer = buf[3];
  const flags = buf[5];
  const size = syncsafeSize(buf, 6);
  const extendedHeader = (flags & 0x40) !== 0;
  let pos = 10;
  if (extendedHeader && pos < buf.length) {
    const extSize = majorVer === 4 ? syncsafeSize(buf, pos) : readUint32BE(buf, pos);
    pos += extSize;
  }
  const end = Math.min(buf.length, 10 + size);
  let year: string | null = null;
  let dateMMDD: string | null = null;
  let tdrc: string | null = null;
  while (pos + 10 <= end) {
    const frameId = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = majorVer === 4 ? syncsafeSize(buf, pos + 4) : readUint32BE(buf, pos + 4);
    if (frameSize === 0 || pos + 10 + frameSize > buf.length) break;
    const bodyStart = pos + 10;
    if (frameId === "TDRC" || frameId === "TYER" || frameId === "TDAT") {
      const text = readTextFrame(buf, bodyStart, frameSize);
      if (frameId === "TDRC") tdrc = text;
      else if (frameId === "TYER") year = text;
      else if (frameId === "TDAT") dateMMDD = text; // DDMM
    }
    pos += 10 + frameSize;
  }

  if (tdrc) return parseISOish(tdrc);
  if (year && year.length >= 4) {
    const y = parseInt(year.slice(0, 4), 10);
    if (Number.isFinite(y)) {
      let m = 1, d = 1;
      if (dateMMDD && dateMMDD.length >= 4) {
        d = parseInt(dateMMDD.slice(0, 2), 10) || 1;
        m = parseInt(dateMMDD.slice(2, 4), 10) || 1;
      }
      return new Date(y, m - 1, d);
    }
  }
  return null;
}

function syncsafeSize(buf: Uint8Array, off: number): number {
  return ((buf[off] & 0x7f) << 21) |
         ((buf[off + 1] & 0x7f) << 14) |
         ((buf[off + 2] & 0x7f) << 7) |
         (buf[off + 3] & 0x7f);
}

function readUint32BE(buf: Uint8Array, off: number): number {
  return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
}

function readTextFrame(buf: Uint8Array, off: number, size: number): string {
  if (size < 1) return "";
  const encoding = buf[off];
  const bytes = buf.subarray(off + 1, off + size);
  try {
    if (encoding === 0) return new TextDecoder("iso-8859-1").decode(bytes).replace(/\0.*$/, "").trim();
    if (encoding === 1 || encoding === 2) return new TextDecoder("utf-16").decode(bytes).replace(/\0.*$/, "").trim();
    if (encoding === 3) return new TextDecoder("utf-8").decode(bytes).replace(/\0.*$/, "").trim();
  } catch { /* fall through */ }
  return new TextDecoder("utf-8").decode(bytes).replace(/\0.*$/, "").trim();
}

// ------------------------- WAV (RIFF LIST INFO) -------------------------

function parseRiff(buf: Uint8Array): Date | null {
  if (buf.length < 12) return null;
  const kind = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  if (kind !== "WAVE") return null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    const size = readUint32LE(buf, pos + 4);
    if (size <= 0 || pos + 8 + size > buf.length) break;
    if (id === "LIST") {
      const listType = String.fromCharCode(buf[pos + 8], buf[pos + 9], buf[pos + 10], buf[pos + 11]);
      if (listType === "INFO") {
        const listEnd = pos + 8 + size;
        let q = pos + 12;
        while (q + 8 <= listEnd) {
          const sub = String.fromCharCode(buf[q], buf[q + 1], buf[q + 2], buf[q + 3]);
          const subSize = readUint32LE(buf, q + 4);
          if (subSize <= 0 || q + 8 + subSize > listEnd) break;
          if (sub === "ICRD") {
            const text = new TextDecoder("iso-8859-1")
              .decode(buf.subarray(q + 8, q + 8 + subSize))
              .replace(/\0.*$/, "").trim();
            const d = parseISOish(text);
            if (d) return d;
          }
          q += 8 + subSize + (subSize & 1); // pad to even
        }
      }
    } else if (id === "bext") {
      // BWF: OriginationDate at offset 320, 10 bytes ASCII "YYYY-MM-DD" or "YYYY:MM:DD".
      const bodyStart = pos + 8;
      if (bodyStart + 330 <= pos + 8 + size) {
        const raw = new TextDecoder("iso-8859-1")
          .decode(buf.subarray(bodyStart + 320, bodyStart + 330))
          .trim();
        const d = parseISOish(raw);
        if (d) return d;
      }
    }
    pos += 8 + size + (size & 1);
  }
  return null;
}

function readUint32LE(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
}

// ------------------------- MP4 / M4A -------------------------

function looksLikeMp4(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  const type = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
  return type === "ftyp";
}

function parseMp4(buf: Uint8Array): Date | null {
  // Walk atoms looking for moov/udta/meta/ilst/©day (or udta/©day).
  const path = findAtomPath(buf, 0, buf.length,
    ["moov", "udta", "meta", "ilst", "©day"]);
  if (path) return decodeIlstDate(buf, path.start, path.end);
  const path2 = findAtomPath(buf, 0, buf.length,
    ["moov", "udta", "©day"]);
  if (path2) return decodeIlstDate(buf, path2.start, path2.end);
  return null;
}

// Find the innermost atom by walking down a name path. Returns the body range
// (excluding the 8-byte header) of the last named atom, or null.
function findAtomPath(
  buf: Uint8Array, start: number, end: number, names: string[],
): { start: number; end: number } | null {
  let pos = start;
  const target = names[0];
  const rest = names.slice(1);
  while (pos + 8 <= end) {
    let size = readUint32BE(buf, pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    let bodyStart = pos + 8;
    if (size === 1) {
      if (pos + 16 > end) return null;
      const hi = readUint32BE(buf, pos + 8);
      const lo = readUint32BE(buf, pos + 12);
      size = hi * 0x100000000 + lo;
      bodyStart = pos + 16;
    }
    if (size < 8 || pos + size > end) return null;
    if (type === target) {
      // Special: `meta` atom has 4 extra flag bytes before its children.
      const childStart = type === "meta" ? bodyStart + 4 : bodyStart;
      if (rest.length === 0) return { start: bodyStart, end: pos + size };
      const nested = findAtomPath(buf, childStart, pos + size, rest);
      if (nested) return nested;
    }
    pos += size;
  }
  return null;
}

// An `©day` atom holds a child `data` atom: type/flags then UTF-8 text.
function decodeIlstDate(buf: Uint8Array, start: number, end: number): Date | null {
  let pos = start;
  while (pos + 8 <= end) {
    const size = readUint32BE(buf, pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    if (type === "data" && size >= 16 && pos + size <= end) {
      const text = new TextDecoder("utf-8")
        .decode(buf.subarray(pos + 16, pos + size))
        .replace(/\0.*$/, "").trim();
      return parseISOish(text);
    }
    if (size < 8) break;
    pos += size;
  }
  return null;
}

// ------------------------- Date parsing -------------------------

// Handles ISO-ish forms: "2026-03-05", "2026:03:05", "2026-03-05T12:34:56",
// "2026", "20260305". Not locale-guessing — we only trust unambiguous shapes.
function parseISOish(text: string): Date | null {
  if (!text) return null;
  const s = text.replace(/[:/]/g, "-").replace(/T/, " ").trim();
  const m1 = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m1) {
    const y = +m1[1], mo = +m1[2], d = +m1[3];
    if (y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(y, mo - 1, d);
  }
  const m2 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m2) {
    const y = +m2[1], mo = +m2[2], d = +m2[3];
    if (y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(y, mo - 1, d);
  }
  const m3 = /^(\d{4})$/.exec(s);
  if (m3) return new Date(+m3[1], 0, 1);
  return null;
}

export function formatMMDDYYYY(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}
