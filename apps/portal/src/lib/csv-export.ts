/**
 * The data export as spreadsheets: one CSV per kind of record, bundled in a .zip.
 *
 * Built in the browser from the same JSON export, so the two never disagree. The zip is
 * stored rather than compressed: CSVs of one person's study history are small, and a
 * stored zip is a few dozen lines with no library.
 */

type Row = Record<string, unknown>;

/** One cell: text as is, numbers and booleans as written, anything nested as JSON. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV, with every column any row has, in the order they first appear. */
export function toCsv(rows: Row[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
  const lines = [columns.map(cell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** "plannedBlocks" -> "planned-blocks.csv". */
const fileName = (key: string) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.csv`;

/**
 * The JSON export as named CSVs. Lists become a file each; the single records (profile,
 * rest days) become a one-row file.
 */
export function exportToCsvFiles(data: Record<string, unknown>): Array<{ name: string; text: string }> {
  const files: Array<{ name: string; text: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'exportedAt') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) files.push({ name: fileName(key), text: toCsv(value as Row[]) });
    } else if (value && typeof value === 'object') {
      files.push({ name: fileName(key === 'user' ? 'profile' : key), text: toCsv([value as Row]) });
    }
  }
  return files;
}

/* ---------- a stored (uncompressed) zip ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time, which is what zip headers hold. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipFiles(files: Array<{ name: string; text: string }>, at = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(at);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    // A byte-order mark so Excel reads accented names and emoji as UTF-8.
    const body = enc.encode(String.fromCharCode(0xfeff) + f.text);
    const crc = crc32(body);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, body.length, true);
    dir.setUint16(28, name.length, true);
    // Extra, comment, disk, attributes: all zero.
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + body.length;
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], {
    type: 'application/zip',
  });
}
