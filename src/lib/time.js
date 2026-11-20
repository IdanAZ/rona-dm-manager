const TZ = 'Asia/Jerusalem';
const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const WEEKDAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function jerusalemParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_SHORT[map.weekday] ?? 0,
    dateStr: `${map.year}-${map.month}-${map.day}`,
  };
}

function jerusalemDateStr(date = new Date()) {
  return jerusalemParts(date).dateStr;
}

function weekStartSundayJerusalem(date = new Date()) {
  const p = jerusalemParts(date);
  const base = new Date(`${p.dateStr}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - p.weekday);
  return jerusalemDateStr(base);
}

function parseMediaDate(value) {
  if (!value) return null;
  const s = String(value);
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}${/[Z+-]/.test(s) ? '' : 'Z'}`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

function isSundayNineJerusalem(date = new Date()) {
  const p = jerusalemParts(date);
  return p.weekday === 0 && p.hour === 9;
}

module.exports = {
  TZ,
  WEEKDAYS_HE,
  jerusalemParts,
  jerusalemDateStr,
  weekStartSundayJerusalem,
  parseMediaDate,
  isSundayNineJerusalem,
};
