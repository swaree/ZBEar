import { localTimeOf, wholeMinutesWithin } from "./localTime";
import { parseOpeningHours, type OpeningHours } from "./openingHours";
import type { LeaveParkingByRemark, ParkingCandidate, ParkingConditionName, ParkingConflict, ParkingKind, Remark } from "./types";

/** The default time to find a space, until the user sets one: quick in a car park, slower on the street. */
export const DEFAULT_TIME_TO_FIND_SPACE_S: Record<ParkingKind, number> = {
  "car-park": 3 * 60,
  "park-and-ride": 3 * 60,
  street: 10 * 60,
};

/** The car's stay at a Parking Candidate, in milliseconds since the epoch: from arriving to driving away. */
export interface Stay {
  from: number;
  until: number;
  /**
   * With no return, when the car drives away is unknown: it stays at least until `until` (the traveller
   * reaching the Destination), and the maximum stay and opening hours give a time to leave by instead.
   */
  openEnded?: boolean;
}

/** What the Parking Conditions are judged on: a Parking Candidate's conditions and kind. */
type ParkingPlace = Pick<ParkingCandidate, "conditions" | "kind">;

/** OSM `access` values that let anyone park. */
const OPEN_ACCESS = new Set(["yes", "public", "permissive", "destination"]);

/** How far ahead an open-ended stay looks for the parking to run out: a week, plus a day of slack. */
const OPEN_ENDED_LOOKAHEAD_MS = 8 * 86_400_000;

/**
 * How a Parking Candidate's known Parking Conditions conflict with a stay there, and the Remarks that
 * the parking earns: "unverified" when any condition that could conflict is unknown, and with an
 * open-ended stay, when to leave by.
 */
export function judgeParking(place: ParkingPlace, stay: Stay): { conflicts: ParkingConflict[]; remarks: Remark[] } {
  const conflicts: ParkingConflict[] = [];
  const unknown: ParkingConditionName[] = [];
  const leaveBy: { at: number; because: LeaveParkingByRemark["because"] }[] = [];
  const lookahead: Stay = { from: stay.from, until: stay.from + OPEN_ENDED_LOOKAHEAD_MS };

  const maxStays = maxStaysOf(place);
  if (!maxStays || maxStays.unsure) unknown.push("max-stay");
  for (const maxStay of maxStays?.limits ?? []) {
    if (maxStayRunsOutAt(maxStay, stay) != null) {
      conflicts.push({ kind: "max-stay-exceeded", maxStayS: maxStay.limitS });
    } else if (stay.openEnded) {
      const at = maxStayRunsOutAt(maxStay, lookahead);
      if (at != null) leaveBy.push({ at, because: "max-stay" });
    }
  }

  const access = place.conditions.access?.trim().toLowerCase();
  if (access === "residents") conflicts.push({ kind: "resident-only" });
  else if (!access || !OPEN_ACCESS.has(access)) unknown.push("access");

  const openingHours = openingHoursOf(place);
  if (!openingHours || openingHours.differsOnHolidays) unknown.push("opening-hours");
  if (openingHours) {
    const closedFrom = firstClosedMoment(openingHours, stay);
    if (closedFrom != null) conflicts.push({ kind: "closed-during-stay", closedFrom: new Date(closedFrom) });
    else if (stay.openEnded) {
      const at = firstClosedMoment(openingHours, lookahead);
      if (at != null) leaveBy.push({ at, because: "closing" });
    }
  }

  const remarks: Remark[] = [];
  if (unknown.length > 0) remarks.push({ kind: "parking-conditions-unverified", unknown });
  const first = leaveBy.sort((a, b) => a.at - b.at)[0];
  if (first) remarks.push({ kind: "leave-parking-by", leaveBy: new Date(first.at), because: first.because });
  return { conflicts, remarks };
}

/** Street parking never closes; a car park's hours are unknown until given. */
function openingHoursOf({ conditions, kind }: ParkingPlace): OpeningHours | null {
  if (kind === "street" && conditions.openingHours == null) return ALWAYS;
  return parseOpeningHours(conditions.openingHours);
}

const ALWAYS: OpeningHours = { isOpen: () => true, differsOnHolidays: false };

/**
 * The first moment of the stay when the hours don't hold: its start, or a whole minute before it ends.
 * Opening hours start and end on whole minutes of local time, so that is exact.
 */
function firstClosedMoment(hours: OpeningHours, stay: Stay): number | null {
  if (hours === ALWAYS) return null;
  for (const at of [stay.from, ...wholeMinutesWithin(stay.from, stay.until)]) {
    if (!hours.isOpen(at)) return at;
  }
  return null;
}

const DURATION_UNITS_S: Record<string, number> = {
  min: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hour: 3600,
  hours: 3600,
  day: 86_400,
  days: 86_400,
};

/** A maximum stay: how long the car may stay, counted only during the hours it applies. */
interface MaxStay {
  limitS: number;
  hours: OpeningHours;
}

/**
 * The limits a Parking Candidate's maximum stays set: none when there is no limit; null when unknown.
 * `unsure` when one is known but the other can't be read, or depends on public holidays.
 */
function maxStaysOf({ conditions }: ParkingPlace): { limits: MaxStay[]; unsure: boolean } | null {
  const always = conditions.maxStay == null ? undefined : limitOf(conditions.maxStay, ALWAYS);
  const conditional = conditions.maxStayConditional == null ? undefined : conditionalLimitOf(conditions.maxStayConditional);
  if (always === undefined && conditional === undefined) return null;
  const limits = [always, conditional].filter((limit): limit is MaxStay => limit != null && limit !== "none");
  const unsure = always === null || conditional === null || (conditional !== "none" && !!conditional?.hours.differsOnHolidays);
  return { limits, unsure };
}

/** An OSM `maxstay` duration, e.g. "2 hours", or "none" for "no" or "unlimited": null when unknown. */
function limitOf(value: string, hours: OpeningHours): MaxStay | "none" | null {
  const text = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (text === "no" || text === "unlimited") return "none";
  const match = text.match(/^(\d+(?:\.\d+)?) ?([a-z]+)$/);
  const unitS = match && DURATION_UNITS_S[match[2]!];
  return unitS ? { limitS: Number(match[1]) * unitS, hours } : null;
}

/** An OSM `maxstay:conditional` value of one condition, e.g. "2 hours @ (Mo-Fr 08:00-20:00)": null when unknown. */
function conditionalLimitOf(value: string): MaxStay | "none" | null {
  const match = value.trim().match(/^(.+?)\s*@\s*\((.+)\)$/);
  const hours = match && parseOpeningHours(match[2]);
  return hours ? limitOf(match[1]!, hours) : null;
}

/**
 * When the car outstays the maximum stay: the first moment it has been parked longer than the limit
 * during the hours the limit applies, counted afresh each day. Null when it never does during the stay.
 */
function maxStayRunsOutAt({ limitS, hours }: MaxStay, { from, until }: Stay): number | null {
  const limitMs = limitS * 1000;
  if (hours === ALWAYS) return until - from > limitMs ? from + limitMs : null;
  let day = localTimeOf(from).weekday;
  let countedMs = 0;
  // Each step from one moment to the next is regulated, or not, as at its start.
  const moments = [from, ...wholeMinutesWithin(from, until), until];
  for (let i = 0; i + 1 < moments.length; i++) {
    const at = moments[i]!;
    const today = localTimeOf(at).weekday;
    if (today !== day) [day, countedMs] = [today, 0];
    if (!hours.isOpen(at)) continue;
    const stepMs = moments[i + 1]! - at;
    if (countedMs + stepMs > limitMs) return at + (limitMs - countedMs);
    countedMs += stepMs;
  }
  return null;
}
