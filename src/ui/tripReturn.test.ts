import { describe, expect, it } from "vitest";
import { readTripReturn } from "./tripReturn";

// Local times, as the form's inputs give them, so the tests hold in any time zone.
const arriveBy = new Date(2026, 11, 1, 9, 0);

const getBackAt = (text: string, at = arriveBy) => readTripReturn({ mode: "getBackAt", getBackAt: text, stayFor: "" }, at);
const stayFor = (text: string) => readTripReturn({ mode: "stayFor", getBackAt: "", stayFor: text }, arriveBy);

describe("the Trip form's return", () => {
  it("is none when the traveller gives no return", () => {
    expect(readTripReturn({ mode: "none", getBackAt: "18:00", stayFor: "2h" }, arriveBy)).toBeNull();
  });

  describe("Get back at", () => {
    it("leaves the Destination at that time on the arrival's day", () => {
      expect(getBackAt("18:30")).toEqual({ getBackAt: new Date(2026, 11, 1, 18, 30) });
    });

    it("moves to the next day when it isn't after the arrival", () => {
      const lateArrival = new Date(2026, 11, 1, 22, 0);
      expect(getBackAt("07:30", lateArrival)).toEqual({ getBackAt: new Date(2026, 11, 2, 7, 30) });
      expect(getBackAt("22:00", lateArrival)).toEqual({ getBackAt: new Date(2026, 11, 2, 22, 0) });
    });

    it("is invalid while the time can't be read", () => {
      expect(getBackAt("")).toBe("invalid");
      expect(getBackAt("6pm")).toBe("invalid");
    });
  });

  describe("Stay for", () => {
    it.each([
      ["2h30", 150],
      ["2 h 30 min", 150],
      ["2h", 120],
      ["1.5h", 90],
      ["1,5 hours", 90],
      ["2:30", 150],
      ["90 min", 90],
      ["90m", 90],
      ["90", 90],
    ])("reads %j as a stay of %i min", (text, minutes) => {
      expect(stayFor(text)).toEqual({ stayForS: minutes * 60 });
    });

    it.each(["", "0", "0h", "abc", "2:75", "h", "-1h"])("is invalid for %j", (text) => {
      expect(stayFor(text)).toBe("invalid");
    });
  });
});
