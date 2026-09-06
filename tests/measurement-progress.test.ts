import { describe, expect, it } from "vitest";
import { measurementProgressText } from "../src/lib/measurement-progress";

describe("honest measurement progress", () => {
  it("reports elapsed time without fabricating a completion percentage", () => {
    expect(measurementProgressText(3_200)).toBe(
      "Connectivity measurement running — 3 seconds elapsed.",
    );
    expect(measurementProgressText(3_200)).not.toContain("%");
  });
});
