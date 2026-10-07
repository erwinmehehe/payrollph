type SplitLimits = {
  maxAmountCents?: number | null;
  maxRows?: number | null;
};

export function splitRowsByBankLimits<T>(
  rows: T[],
  amountCents: (row: T) => number,
  limits: SplitLimits,
) {
  const maxAmountCents =
    limits.maxAmountCents && limits.maxAmountCents > 0
      ? Math.trunc(limits.maxAmountCents)
      : null;
  const maxRows =
    limits.maxRows && limits.maxRows > 0
      ? Math.trunc(limits.maxRows)
      : null;

  if (!maxAmountCents && !maxRows) return rows.length ? [rows] : [];

  const parts: T[][] = [];
  let current: T[] = [];
  let currentAmount = 0;

  for (const row of rows) {
    const rowAmount = Math.trunc(amountCents(row));
    if (!Number.isSafeInteger(rowAmount) || rowAmount < 0) {
      throw new Error("Bank file splitting requires non-negative integer centavo amounts.");
    }
    if (maxAmountCents && rowAmount > maxAmountCents) {
      throw new Error(
        `A single employee payout of PHP ${(rowAmount / 100).toFixed(2)} exceeds the configured maximum amount per bank file of PHP ${(maxAmountCents / 100).toFixed(2)}. Increase the bank limit or use another payout path; PayrollPH will not split one employee across files.`,
      );
    }

    const rowLimitReached = Boolean(maxRows && current.length >= maxRows);
    const amountLimitReached = Boolean(
      maxAmountCents
      && current.length > 0
      && currentAmount + rowAmount > maxAmountCents
    );

    if (rowLimitReached || amountLimitReached) {
      parts.push(current);
      current = [];
      currentAmount = 0;
    }

    current.push(row);
    currentAmount += rowAmount;
  }

  if (current.length > 0) parts.push(current);
  return parts;
}

export function bankPartFilename(filename: string, part: number, total: number) {
  if (total <= 1) return filename;
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.slice(lastDot) : "";
  return `${stem}-part-${String(part).padStart(3, "0")}-of-${String(total).padStart(3, "0")}${ext}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

export function createStoredZip(files: Array<{ name: string; body: string | Buffer }>) {
  if (files.length === 0) throw new Error("Cannot create an empty bank-file archive.");

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localDirectory.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localDirectory, centralDirectory, end]);
}
