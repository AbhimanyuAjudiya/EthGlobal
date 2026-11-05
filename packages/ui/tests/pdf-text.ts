import { inflateSync } from 'node:zlib';

/**
 * Minimal text extraction for Chromium (Skia) PDFs: uncompressed object table, FlateDecode streams,
 * fonts with ToUnicode CMaps (Type0 and the Type3 faces Skia emits for variable fonts). Enough to prove the
 * PINs are real text in the PDF, not pixels. Not a general PDF parser.
 */
interface PdfObject {
  dict: string;
  stream?: Buffer;
}

function objects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const out = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = m[2] ?? '';
    const at = body.indexOf('stream');
    if (at === -1) {
      out.set(Number(m[1]), { dict: body });
      continue;
    }
    const dict = body.slice(0, at);
    const start = (m.index ?? 0) + m[0].indexOf(body) + at + 'stream'.length;
    const dataStart = text[start] === '\r' ? start + 2 : start + 1;
    const end = text.indexOf('endstream', dataStart);
    let raw = pdf.subarray(dataStart, end);
    if (dict.includes('FlateDecode')) {
      try {
        raw = inflateSync(raw);
      } catch {
        raw = Buffer.alloc(0);
      }
    }
    out.set(Number(m[1]), { dict, stream: raw });
  }
  return out;
}

interface CMap {
  bytes: number;
  map: Map<number, string>;
}

const utf16 = (hex: string) => {
  let s = '';
  for (let i = 0; i < hex.length; i += 4)
    s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return s;
};

function parseCMap(src: string): CMap {
  const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(src);
  const bytes = space?.[1] ? space[1].length / 2 : 1;
  const map = new Map<number, string>();
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(p[1] ?? '0', 16), utf16(p[2] ?? ''));
    }
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of (block[1] ?? '').matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
    )) {
      const lo = parseInt(p[1] ?? '0', 16);
      const hi = parseInt(p[2] ?? '0', 16);
      const base = parseInt(p[3] ?? '0', 16);
      for (let c = lo; c <= hi; c += 1) map.set(c, String.fromCharCode(base + c - lo));
    }
  }
  return { bytes, map };
}

/** All text drawn in the PDF, one string per text object (BT … ET). */
export function pdfText(pdf: Buffer): string[] {
  const objs = objects(pdf);
  const cmapOf = new Map<number, CMap>();
  for (const [num, obj] of objs) {
    const ref = /\/ToUnicode\s+(\d+) 0 R/.exec(obj.dict);
    const cmap = ref ? objs.get(Number(ref[1]))?.stream : undefined;
    if (cmap) cmapOf.set(num, parseCMap(cmap.toString('latin1')));
  }
  const fontByName = new Map<string, CMap>();
  for (const obj of objs.values()) {
    for (const dict of obj.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
      for (const p of (dict[1] ?? '').matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)) {
        const cmap = cmapOf.get(Number(p[2]));
        if (cmap && p[1]) fontByName.set(p[1], cmap);
      }
    }
  }
  const runs: string[] = [];
  for (const obj of objs.values()) {
    const content = obj.stream?.toString('latin1') ?? '';
    if (!/\bTf\b/.test(content)) continue;
    let font: CMap | undefined;
    let run = '';
    const ops = /\/([\w.+-]+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f]*)>|\bET\b/g;
    for (let m = ops.exec(content); m; m = ops.exec(content)) {
      if (m[1]) font = fontByName.get(m[1]);
      else if (m[2] !== undefined && font) {
        const width = font.bytes * 2;
        for (let i = 0; i < m[2].length; i += width) {
          run += font.map.get(parseInt(m[2].slice(i, i + width), 16)) ?? '';
        }
      } else if (m[0] === 'ET') {
        if (run) runs.push(run);
        run = '';
      }
    }
    if (run) runs.push(run);
  }
  return runs;
}

/** Page objects in the PDF (`/Type /Page`, not `/Pages`). */
export const pdfPageCount = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
