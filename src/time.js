function getFormatter(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function getLocalParts(date, timezone) {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(date, timezone) {
  const parts = getLocalParts(date, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getLocalMonthKey(date, timezone) {
  const parts = getLocalParts(date, timezone);
  return `${parts.year}-${pad(parts.month)}`;
}

function getWeekdayIndex(weekday) {
  const indices = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return indices[weekday];
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function getWeekStartDateKey(date, timezone) {
  const parts = getLocalParts(date, timezone);
  const dateKey = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const weekdayIndex = getWeekdayIndex(parts.weekday);
  return shiftDateKey(dateKey, -weekdayIndex);
}

function getLocalWeekKey(date, timezone) {
  return getWeekStartDateKey(date, timezone);
}

function formatMoney(amount) {
  return `${Number(amount).toFixed(2)} ريال`;
}

module.exports = {
  formatMoney,
  getLocalDateKey,
  getLocalMonthKey,
  getLocalWeekKey,
  getWeekStartDateKey,
  shiftDateKey
};
