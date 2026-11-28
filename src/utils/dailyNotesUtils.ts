export const DAILY_NOTE_PRESET_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD-MM-YYYY',
  'DD/MM/YYYY',
  'MMM D, YYYY',
] as const;

export type DailyNotePresetFormat = (typeof DAILY_NOTE_PRESET_FORMATS)[number];

interface CalendarLocaleTables {
  monthsFull: readonly string[];
  monthsShort: readonly string[];
  weekdaysFull: readonly string[];
  weekdaysShort: readonly string[];
}

export const CALENDAR_TABLES: Record<'es' | 'en', CalendarLocaleTables> = {
  es: {
    monthsFull: [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ],
    monthsShort: [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ],
    weekdaysFull: [
      'domingo',
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
    ],
    weekdaysShort: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  },
  en: {
    monthsFull: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    weekdaysFull: [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
};

export function resolveCalendarLocale(locale?: string): 'es' | 'en' {
  return locale && locale.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function getDayOfYear(date: Date): number {
  const startUtc = Date.UTC(date.getFullYear(), 0, 1);
  const currentUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((currentUtc - startUtc) / 86_400_000) + 1;
}

const MOMENT_FORMAT_TOKEN_RE =
  /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g;

/**
 * Formats a Date using Moment.js tokens (including `[literal]` escaped segments),
 * matching Obsidian's Daily Notes formatting behavior in `es` and `en`.
 */
export function formatDailyNoteDate(
  date: Date,
  formatStr?: string,
  locale?: string
): string {
  const fmt = formatStr && formatStr.trim() ? formatStr : 'YYYY-MM-DD';
  const lang = resolveCalendarLocale(locale);
  const table = CALENDAR_TABLES[lang];

  const year = date.getFullYear();
  const monthIdx = date.getMonth();
  const month = monthIdx + 1;
  const day = date.getDate();
  const weekday = date.getDay();
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const dayOfYear = getDayOfYear(date);

  return fmt.replace(MOMENT_FORMAT_TOKEN_RE, (token, escaped?: string) => {
    if (escaped !== undefined) return escaped;
    switch (token) {
      case 'YYYY':
        return String(year).padStart(4, '0');
      case 'YY':
        return String(year).slice(-2).padStart(2, '0');
      case 'MMMM':
        return table.monthsFull[monthIdx];
      case 'MMM':
        return table.monthsShort[monthIdx];
      case 'MM':
        return String(month).padStart(2, '0');
      case 'M':
        return String(month);
      case 'DDDD':
        return String(dayOfYear).padStart(3, '0');
      case 'DDD':
        return String(dayOfYear);
      case 'DD':
        return String(day).padStart(2, '0');
      case 'D':
        return String(day);
      case 'dddd':
        return table.weekdaysFull[weekday];
      case 'ddd':
        return table.weekdaysShort[weekday];
      case 'HH':
        return String(hours24).padStart(2, '0');
      case 'H':
        return String(hours24);
      case 'hh':
        return String(hours12).padStart(2, '0');
      case 'h':
        return String(hours12);
      case 'mm':
        return String(minutes).padStart(2, '0');
      case 'm':
        return String(minutes);
      case 'ss':
        return String(seconds).padStart(2, '0');
      case 's':
        return String(seconds);
      case 'A':
        return hours24 >= 12 ? 'PM' : 'AM';
      case 'a':
        return hours24 >= 12 ? 'pm' : 'am';
      default:
        return token;
    }
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLocaleAlternation(lists: readonly (readonly string[])[]): string {
  const unique = Array.from(new Set(lists.flat())).sort((a, b) => b.length - a.length);
  return unique.map(escapeRegex).join('|');
}

/**
 * Parses a daily note relative path (without `.md`) back to a midnight `Date`
 * according to the configured Moment-style format. Returns `null` if it does not match.
 */
export function parseDailyNoteDate(
  relativeNotePathWithoutExt: string,
  formatStr?: string
): Date | null {
  const fmt = (formatStr && formatStr.trim() ? formatStr : 'YYYY-MM-DD').replace(/^\/+|\/+$/g, '');
  const normalizedTarget = relativeNotePathWithoutExt.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedTarget) return null;

  const monthsFullAlt = buildLocaleAlternation([CALENDAR_TABLES.es.monthsFull, CALENDAR_TABLES.en.monthsFull]);
  const monthsShortAlt = buildLocaleAlternation([CALENDAR_TABLES.es.monthsShort, CALENDAR_TABLES.en.monthsShort]);
  const weekdaysFullAlt = buildLocaleAlternation([CALENDAR_TABLES.es.weekdaysFull, CALENDAR_TABLES.en.weekdaysFull]);
  const weekdaysShortAlt = buildLocaleAlternation([CALENDAR_TABLES.es.weekdaysShort, CALENDAR_TABLES.en.weekdaysShort]);

  const tokenHandlers: Array<{ token: string; value: string }> = [];
  let pattern = '^';
  let lastIdx = 0;

  MOMENT_FORMAT_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MOMENT_FORMAT_TOKEN_RE.exec(fmt)) !== null) {
    if (m.index > lastIdx) {
      pattern += escapeRegex(fmt.slice(lastIdx, m.index));
    }
    const token = m[0];
    const escaped = m[1];
    if (escaped !== undefined) {
      pattern += escapeRegex(escaped);
    } else {
      switch (token) {
        case 'YYYY':
          pattern += '(\\d{4})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'YY':
          pattern += '(\\d{2})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'MMMM':
          pattern += `(${monthsFullAlt})`;
          tokenHandlers.push({ token, value: '' });
          break;
        case 'MMM':
          pattern += `(${monthsShortAlt})`;
          tokenHandlers.push({ token, value: '' });
          break;
        case 'MM':
          pattern += '(\\d{2})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'M':
          pattern += '(\\d{1,2})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'DDDD':
          pattern += '(\\d{3})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'DDD':
          pattern += '(\\d{1,3})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'DD':
          pattern += '(\\d{2})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'D':
          pattern += '(\\d{1,2})';
          tokenHandlers.push({ token, value: '' });
          break;
        case 'dddd':
          pattern += `(?:${weekdaysFullAlt})`;
          break;
        case 'ddd':
          pattern += `(?:${weekdaysShortAlt})`;
          break;
        case 'HH':
        case 'hh':
        case 'mm':
        case 'ss':
          pattern += '\\d{2}';
          break;
        case 'H':
        case 'h':
        case 'm':
        case 's':
          pattern += '\\d{1,2}';
          break;
        case 'A':
        case 'a':
          pattern += '(?:AM|PM|am|pm)';
          break;
        default:
          pattern += escapeRegex(token);
      }
    }
    lastIdx = m.index + token.length;
  }
  if (lastIdx < fmt.length) {
    pattern += escapeRegex(fmt.slice(lastIdx));
  }
  pattern += '$';

  const regex = new RegExp(pattern, 'i');
  const match = regex.exec(normalizedTarget);
  if (!match) return null;

  let year: number | null = null;
  let monthIdx: number | null = null;
  let day: number | null = null;
  let dayOfYear: number | null = null;

  const findMonthIndex = (raw: string, full: boolean): number => {
    const lower = raw.toLowerCase();
    for (const lang of ['es', 'en'] as const) {
      const arr = full ? CALENDAR_TABLES[lang].monthsFull : CALENDAR_TABLES[lang].monthsShort;
      const idx = arr.findIndex((name) => name.toLowerCase() === lower);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  for (let i = 0; i < tokenHandlers.length; i++) {
    const raw = match[i + 1];
    const tok = tokenHandlers[i].token;
    if (tok === 'YYYY') {
      year = Number(raw);
    } else if (tok === 'YY') {
      year = 2000 + Number(raw);
    } else if (tok === 'MM' || tok === 'M') {
      monthIdx = Number(raw) - 1;
    } else if (tok === 'MMMM') {
      const idx = findMonthIndex(raw, true);
      if (idx >= 0) monthIdx = idx;
    } else if (tok === 'MMM') {
      const idx = findMonthIndex(raw, false);
      if (idx >= 0) monthIdx = idx;
    } else if (tok === 'DD' || tok === 'D') {
      day = Number(raw);
    } else if (tok === 'DDDD' || tok === 'DDD') {
      dayOfYear = Number(raw);
    }
  }

  const now = new Date();
  const resolvedYear = year ?? now.getFullYear();

  if (dayOfYear !== null && monthIdx === null && day === null) {
    const candidate = new Date(resolvedYear, 0, dayOfYear);
    if (candidate.getFullYear() !== resolvedYear) return null;
    candidate.setHours(0, 0, 0, 0);
    return candidate;
  }

  if (monthIdx === null || monthIdx < 0 || monthIdx > 11 || day === null || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(resolvedYear, monthIdx, day);
  if (
    parsed.getFullYear() !== resolvedYear ||
    parsed.getMonth() !== monthIdx ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/**
 * Replaces Obsidian/Urano daily-note template placeholders:
 * `{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}`, and `{{time:FORMAT}}`.
 */
export function applyDailyNoteTemplateVariables(
  templateContent: string,
  date: Date,
  title: string,
  locale?: string,
  defaultDateFormat = 'YYYY-MM-DD',
  defaultTimeFormat = 'HH:mm'
): string {
  if (!templateContent) return '';
  return templateContent.replace(
    /\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/gi,
    (_full, rawKey: string, rawFmt?: string) => {
      const key = rawKey.toLowerCase();
      if (key === 'title') {
        return title;
      }
      if (key === 'date') {
        return formatDailyNoteDate(date, rawFmt ? rawFmt.trim() : defaultDateFormat, locale);
      }
      if (key === 'time') {
        return formatDailyNoteDate(date, rawFmt ? rawFmt.trim() : defaultTimeFormat, locale);
      }
      return _full;
    }
  );
}
