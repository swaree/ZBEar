import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

describe("formatDuration", () => {
  it.each([
    [75 * 60, "1h15"],
    [65 * 60, "1h05"],
    [120 * 60, "2h"],
    [45 * 60, "45 min"],
    [0, "0 min"],
    // To the nearest minute.
    [59 * 60 + 40, "1h"],
    [74 * 60 + 29, "1h14"],
    [26 * 3600 + 30 * 60, "26h30"],
  ])("writes %i s as %j", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
