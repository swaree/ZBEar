import { localTimeOf, type Weekday } from "./localTime";

/** When something is open, or applies: OSM `opening_hours`, read. */
export interface OpeningHours {
  /** Whether it is open at a moment given in milliseconds since the epoch, on a day that isn't a public holiday. */
  isOpen: (at: number) => boolean;
  /** The hours name public holidays ("PH off"), and with no holiday calendar `isOpen` can't tell them. */
  differsOnHolidays: boolean;
}

const WEEKDAY_NAMES: Record<string, Weekday> = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6, Su: 7 };
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const DAY_RANGE = `${DAY}(?:-${DAY})?`;
const TIME_RANGE = String.raw`\d{2}:\d{2}-\d{2}:\d{2}`;
const RULE = new RegExp(String.raw`^(?:(${DAY_RANGE}(?:,${DAY_RANGE})*)\s+)?(off|closed|${TIME_RANGE}(?:\s*,\s*${TIME_RANGE})*)$`);

/** Minutes since local midnight, [from, to); `to` past 1440 runs on into the next day. */
type Span = [from: number, to: number];

/**
 * A subset of the OSM `opening_hours` syntax, in local Europe/Madrid time: "24/7", and `;`-separated rules
 * of optional weekday ranges ("Mo-Fr", "Sa,Su") and time ranges ("08:00-13:30,16:00-20:00", or "off"),
 * where a later rule replaces an earlier one's times on the days it names, and a range ending at or
 * before its start runs past midnight. Public-holiday rules ("PH off") are left out of `isOpen` and
 * flagged instead: ZBEar has no holiday calendar (ADR-0003). Anything else (months, seasons, comments)
 * is unknown: null.
 */
export function parseOpeningHours(value: string | undefined): OpeningHours | null {
  if (value == null) return null;
  const spans = new Map<Weekday, Span[]>();
  let differsOnHolidays = false;
  for (const raw of value.split(";")) {
    const rule = raw.trim().replace(/\s+/g, " ");
    if (rule === "") continue;
    if (rule.startsWith("PH")) {
      differsOnHolidays = true;
      continue;
    }
    if (rule === "24/7") {
      for (const day of ALL_DAYS) spans.set(day, [[0, 1440]]);
      continue;
    }
    const match = rule.match(RULE);
    if (!match) return null;
    const days = match[1] ? daysOf(match[1]) : ALL_DAYS;
    const times = match[2] === "off" || match[2] === "closed" ? [] : match[2]!.split(",").map((range) => spanOf(range.trim()));
    if (times.some((span) => span == null)) return null;
    for (const day of days) spans.set(day, times as Span[]);
  }
  if (spans.size === 0) return null;
  const isWithin = (day: Weekday, minute: number) => (spans.get(day) ?? []).some(([from, to]) => from <= minute && minute < to);
  const isOpen = (at: number) => {
    const { weekday, minuteOfDay } = localTimeOf(at);
    const dayBefore = (((weekday + 5) % 7) + 1) as Weekday;
    return isWithin(weekday, minuteOfDay) || isWithin(dayBefore, minuteOfDay + 1440);
  };
  return { isOpen, differsOnHolidays };
}

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** "Mo-Fr,Su" as the weekdays it names; a range may wrap round the week ("Sa-Mo"). */
function daysOf(selector: string): Weekday[] {
  const days = new Set<Weekday>();
  for (const range of selector.split(",")) {
    const [first, last = first] = range.split("-").map((name) => WEEKDAY_NAMES[name]!);
    for (let day = first!; ; day = ((day % 7) + 1) as Weekday) {
      days.add(day);
      if (day === last) break;
    }
  }
  return [...days];
}

/** "08:00-20:00" as minutes since midnight; null when a time is out of range. */
function spanOf(range: string): Span | null {
  const [from, to] = range.split("-").map((time) => {
    const [h, m] = time.split(":").map(Number);
    return h! <= 24 && m! < 60 ? h! * 60 + m! : NaN;
  });
  if (Number.isNaN(from) || Number.isNaN(to) || from! >= 1440) return null;
  return [from!, to! <= from! ? to! + 1440 : to!];
}
