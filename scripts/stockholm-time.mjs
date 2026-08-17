export const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";

function getOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === "timeZoneName")?.value;
  const match = timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    throw new Error(`Could not determine ${timeZone} offset for ${date.toISOString()}`);
  }

  const [, sign, hours, minutes = "0"] = match;
  const offset = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -offset : offset;
}

export function localDateTimeToUtcIso(
  value,
  timeZone = STOCKHOLM_TIME_ZONE,
) {
  if (!value) return null;

  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) {
    return new Date(value).toISOString();
  }

  const [datePart, timePart = "00:00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timePart.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstOffset = getOffsetMinutes(utcGuess, timeZone);
  const firstDate = new Date(utcGuess.getTime() - firstOffset * 60 * 1000);
  const secondOffset = getOffsetMinutes(firstDate, timeZone);

  if (secondOffset === firstOffset) return firstDate.toISOString();

  return new Date(utcGuess.getTime() - secondOffset * 60 * 1000).toISOString();
}

export function nextStockholmMidnightUtcIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);

  const localParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: STOCKHOLM_TIME_ZONE,
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const nextDate = new Date(
    Date.UTC(
      Number(localParts.year),
      Number(localParts.month) - 1,
      Number(localParts.day) + 1,
    ),
  )
    .toISOString()
    .slice(0, 10);

  return localDateTimeToUtcIso(`${nextDate}T00:00:00`);
}
