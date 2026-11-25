/**
 * Utilidades para escanear menciones de texto dentro de notas Markdown sin tocar
 * zonas donde un enlace corrompería el contenido: frontmatter YAML, bloques de código,
 * código en línea, matemáticas, comentarios, URLs, etiquetas, HTML, etc.
 */

export interface LineContext {
  inFrontmatter: boolean;
  /** Bloque de código, bloque de matemáticas o comentario multilínea. */
  inProtectedBlock: boolean;
  /** Definición de referencia / nota al pie: `[id]: url`. */
  isDefinition: boolean;
}

const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^\s*(`{3,}|~{3,})\s*$/;
const DEFINITION_RE = /^\s*\[\^?[^\]]+\]:\s/;

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let idx = text.indexOf(token);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(token, idx + token.length);
  }
  return count;
}

/** Clasifica cada línea de la nota según los bloques protegidos que la contienen. */
export function analyzeLines(lines: string[]): LineContext[] {
  const result: LineContext[] = new Array(lines.length);

  // Frontmatter YAML: solo válido si empieza en la primera línea
  let frontmatterEnd = -1;
  if (lines.length > 0 && lines[0].replace(/^\uFEFF/, '').trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '---' || trimmed === '...') {
        frontmatterEnd = i;
        break;
      }
    }
  }

  let fence: { char: string; len: number } | null = null;
  let inMath = false;
  let inPercentComment = false;
  let inHtmlComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ctx: LineContext = {
      inFrontmatter: frontmatterEnd !== -1 && i <= frontmatterEnd,
      inProtectedBlock: false,
      isDefinition: false,
    };

    if (ctx.inFrontmatter) {
      result[i] = ctx;
      continue;
    }

    if (fence) {
      ctx.inProtectedBlock = true;
      const close = FENCE_CLOSE_RE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence = null;
      }
      result[i] = ctx;
      continue;
    }

    const open = FENCE_OPEN_RE.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], len: open[1].length };
      ctx.inProtectedBlock = true;
      result[i] = ctx;
      continue;
    }

    if (inMath) {
      ctx.inProtectedBlock = true;
      if (countOccurrences(line, '$$') % 2 === 1) inMath = false;
      result[i] = ctx;
      continue;
    }
    if (inPercentComment) {
      ctx.inProtectedBlock = true;
      if (countOccurrences(line, '%%') % 2 === 1) inPercentComment = false;
      result[i] = ctx;
      continue;
    }
    if (inHtmlComment) {
      ctx.inProtectedBlock = true;
      if (line.includes('-->')) inHtmlComment = false;
      result[i] = ctx;
      continue;
    }

    if (countOccurrences(line, '$$') % 2 === 1) {
      inMath = true;
      ctx.inProtectedBlock = true;
    } else if (countOccurrences(line, '%%') % 2 === 1) {
      inPercentComment = true;
      ctx.inProtectedBlock = true;
    } else {
      const openIdx = line.lastIndexOf('<!--');
      if (openIdx !== -1 && line.indexOf('-->', openIdx) === -1) {
        inHtmlComment = true;
        ctx.inProtectedBlock = true;
      }
    }

    ctx.isDefinition = DEFINITION_RE.test(line);
    result[i] = ctx;
  }

  return result;
}

function collectRanges(line: string, re: RegExp, out: Array<[number, number]>): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
}

/** Rangos de código en línea (`code`, ``code``). */
export function findInlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  collectRanges(line, /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)/g, ranges);
  return ranges;
}

/**
 * Rangos de una línea en los que NO se debe convertir una mención en enlace:
 * código en línea, URLs/correos, autoenlaces y etiquetas HTML, matemáticas en línea,
 * etiquetas #tag, comentarios %%..%%, referencias a notas al pie e IDs de bloque.
 */
export function findProtectedInlineRanges(line: string): Array<[number, number]> {
  const ranges = findInlineCodeRanges(line);
  collectRanges(
    line,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b[\w.+-]+@[\w-]+\.[\w.-]+/gi,
    ranges
  );
  collectRanges(line, /<[^<>\n]+>/g, ranges);
  collectRanges(line, /(?<!\\)\$(?!\s)[^$\n]*?(?<!\s)\$/g, ranges);
  collectRanges(line, /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_/-]+/gu, ranges);
  collectRanges(line, /%%[\s\S]*?%%/g, ranges);
  collectRanges(line, /\[\^[^\]]+\]/g, ranges);
  collectRanges(line, /\s\^[\w-]+\s*$/g, ranges);
  return ranges;
}

export function isRangeOverlapping(
  start: number,
  end: number,
  ranges: Array<[number, number]>
): boolean {
  for (const [rs, re] of ranges) {
    if (start < re && end > rs) return true;
  }
  return false;
}
