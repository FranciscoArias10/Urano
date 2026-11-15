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
