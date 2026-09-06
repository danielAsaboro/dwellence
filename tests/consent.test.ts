import { describe, expect, it } from "vitest";
import { requireConsents } from "../src/lib/consent";

describe("specific consent gates", () => {
  it("allows an action only when every named consent is present", () => {
    expect(() =>
      requireConsents({ location: true, measurement: true }, [
        "location",
        "measurement",
      ]),
    ).not.toThrow();
  });

  it("names every missing consent without treating another consent as equivalent", () => {
    expect(() =>
      requireConsents(
        { location: true, measurement: false, retention: false },
        ["location", "measurement", "retention"],
      ),
    ).toThrow("measurement and retention");
  });
});
