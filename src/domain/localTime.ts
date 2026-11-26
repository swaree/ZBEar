/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A moment in local Europe/Madrid time: its ISO weekday and its minutes since local midnight. */
export interface LocalTime {
  weekday: Weekday;
  minuteOfDay: number;
}

export const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const MADRID_WALL_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Europe/Madrid's offset from UTC, in ms, by UTC hour. It changes only on whole UTC hours (01:00 UTC on
 * the last Sundays of March and October), so one lookup per hour is exact, and minute-by-minute scans of
 * a stay stay cheap.
 */
const offsetsByHour = new Map<number, number>();

function madridOffsetMs(at: number): number {
  const hour = Math.floor(at / HOUR_MS);
  const known = offsetsByHour.get(hour);
  if (known != null) return known;
  const parts = Object.fromEntries(MADRID_WALL_CLOCK.formatToParts(hour * HOUR_MS).map((p) => [p.type, p.value]));
  const wallClock = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = wallClock - hour * HOUR_MS;
  if (offsetsByHour.size > 100_000) offsetsByHour.clear();
  offsetsByHour.set(hour, offset);
  return offset;
}

/** The local Europe/Madrid time of a moment given in milliseconds since the epoch. */
export function localTimeOf(at: number): LocalTime {
  const local = new Date(at + madridOffsetMs(at));
  return {
    weekday: (local.getUTCDay() || 7) as Weekday,
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** "HH:MM" ("24:00" for the end of the day) as minutes since local midnight. */
export function minuteOfDayOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/**
 * The whole minutes strictly between `from` and `until` (both in milliseconds since the epoch). Local times
 * change on whole minutes (Europe/Madrid is a whole number of hours off UTC), so checking a span at its
 * start and at these minutes checks every local time in it.
 */
export function* wholeMinutesWithin(from: number, until: number): Generator<number> {
  for (let at = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS; at < until; at += MINUTE_MS) yield at;
}
