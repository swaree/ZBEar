import type { TripReturn } from "../domain/types";

/** How the Trip form gives the return: not at all, Get back at a time of day, or Stay for a while. */
export type ReturnMode = "none" | "getBackAt" | "stayFor";

/** The return fields of the Trip form, as typed. */
export interface ReturnForm {
  mode: ReturnMode;
  /** "HH:MM", from a time input. */
  getBackAt: string;
  /** A stay such as "2h30", "2 h 30 min", "1.5h", "2:30", "90 min" or "90" (minutes). */
  stayFor: string;
}

/**
 * The Trip's return as the form gives it: null for none, or "invalid" while it can't be read.
 * Get back at is a time of day on the arrival's day, or on the next day when it isn't after the arrival.
 */
export function readTripReturn(form: ReturnForm, arriveBy: Date): TripReturn | null | "invalid" {
  if (form.mode === "none") return null;
  if (form.mode === "stayFor") {
    const stayForS = parseStay(form.stayFor);
    return stayForS == null ? "invalid" : { stayForS };
  }
  const m = form.getBackAt.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "invalid";
  const getBackAt = new Date(arriveBy);
  getBackAt.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (getBackAt <= arriveBy) getBackAt.setDate(getBackAt.getDate() + 1);
  return { getBackAt };
}

/** A stay in seconds; null if unreadable or zero. */
function parseStay(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  let hours = 0;
  let mins = 0;
  const clockLike = t.match(/^(\d+):([0-5]\d)$/);
  if (clockLike) {
    hours = Number(clockLike[1]);
    mins = Number(clockLike[2]);
  } else {
    const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*(?:m|mins?|minutes?)?)?$/);
    if (!m || (m[1] == null && m[2] == null)) return null;
    hours = Number(m[1] ?? 0);
    mins = Number(m[2] ?? 0);
  }
  const s = Math.round((hours * 60 + mins) * 60);
  return s > 0 ? s : null;
}
