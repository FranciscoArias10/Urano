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

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((current.getTime() - start.getTime()) / 86_400_000) + 1;
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
