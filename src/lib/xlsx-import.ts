import { inflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

const decoder = new TextDecoder("utf-8");

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset]) |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findEocd(bytes: Uint8Array) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) return offset;
  }
  throw new Error("The Excel file is not a valid XLSX archive.");
}

function readZip(bytes: Uint8Array) {
  const eocd = findEocd(bytes);
  const entryCount = u16(bytes, eocd + 10);
  const centralOffset = u32(bytes, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) {
      throw new Error("The Excel ZIP directory is corrupt.");
    }
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  function read(name: string) {
    const entry = entries.get(name);
    if (!entry) return null;
    const offset = entry.localOffset;
    if (u32(bytes, offset) !== 0x04034b50) {
      throw new Error(`Excel ZIP entry "${name}" has an invalid local header.`);
    }
    const nameLength = u16(bytes, offset + 26);
    const extraLength = u16(bytes, offset + 28);
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return new Uint8Array(compressed);
    if (entry.method === 8) {
      const inflated = inflateRawSync(Buffer.from(compressed));
      if (entry.uncompressedSize && inflated.length !== entry.uncompressedSize) {
        throw new Error(`Excel ZIP entry "${name}" did not decompress to the expected size.`);
      }
      return new Uint8Array(inflated);
    }
    throw new Error(`Excel compression method ${entry.method} is not supported.`);
  }

  return { read, names: [...entries.keys()] };
}

function xmlText(bytes: Uint8Array | null) {
  return bytes ? decoder.decode(bytes) : "";
}

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

function textTags(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function parseSharedStrings(xml: string) {
  if (!xml) return [] as string[];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)]
    .map((match) => textTags(match[1]));
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function looksLikeDateFormat(format: string) {
  const cleaned = format
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase();
  return /[ymdhis]/.test(cleaned);
}

function parseDateStyles(xml: string) {
  if (!xml) return new Set<number>();
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b([^>]*)\/?\s*>/g)) {
    const id = Number(attr(match[1], "numFmtId"));
    const format = attr(match[1], "formatCode");
    if (Number.isInteger(id) && format) custom.set(id, format);
  }

  const section = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const dateStyles = new Set<number>();
  let styleIndex = 0;
  for (const match of section.matchAll(/<xf\b([^>]*)\/?\s*>/g)) {
    const formatId = Number(attr(match[1], "numFmtId"));
    if (BUILTIN_DATE_FORMATS.has(formatId) || looksLikeDateFormat(custom.get(formatId) ?? "")) {
      dateStyles.add(styleIndex);
    }
    styleIndex += 1;
  }
  return dateStyles;
}

function excelSerialToIso(serial: number) {
  if (!Number.isFinite(serial)) return null;
  let days = Math.floor(serial);
  if (days >= 60) days -= 1;
  const millis = Date.UTC(1899, 11, 31) + days * 86_400_000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sheetToCsv(xml: string, sharedStrings: string[], dateStyles: Set<number>) {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1];
    const values: string[] = [];

    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attr(attrs, "r");
      const type = attr(attrs, "t");
      const style = Number(attr(attrs, "s"));
      const index = ref ? columnIndex(ref) : values.length;
      const raw = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      let value = raw;

      if (type === "s") value = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textTags(body);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (type === "d") value = raw.slice(0, 10);
      else if (Number.isInteger(style) && dateStyles.has(style) && raw) {
        value = excelSerialToIso(Number(raw)) ?? raw;
      }

      values[index] = value;
    }

    rows.push(values);
  }

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows
    .map((row) => Array.from({ length: width }, (_unused, index) => csvCell(row[index] ?? "")).join(","))
    .join("\n");
}

function worksheetPath(zip: ReturnType<typeof readZip>) {
  const workbook = xmlText(zip.read("xl/workbook.xml"));
  const firstRelationship = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = xmlText(zip.read("xl/_rels/workbook.xml.rels"));

  if (firstRelationship && rels) {
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
      if (attr(match[1], "Id") !== firstRelationship) continue;
      const target = attr(match[1], "Target").replace(/^\/+/, "");
      if (target.startsWith("xl/")) return target;
      return `xl/${target.replace(/^\.\//, "")}`;
    }
  }

  if (zip.names.includes("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const fallback = zip.names.find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!fallback) throw new Error("The Excel workbook has no readable worksheet.");
  return fallback;
}

export function xlsxToCsv(input: Uint8Array) {
  const zip = readZip(input);
  const sheetPath = worksheetPath(zip);
  const worksheet = xmlText(zip.read(sheetPath));
  if (!worksheet) throw new Error("The first Excel worksheet could not be read.");

  const sharedStrings = parseSharedStrings(xmlText(zip.read("xl/sharedStrings.xml")));
  const dateStyles = parseDateStyles(xmlText(zip.read("xl/styles.xml")));
  const csv = sheetToCsv(worksheet, sharedStrings, dateStyles);

  if (!csv.trim()) throw new Error("The first Excel worksheet is empty.");
  return csv;
}
