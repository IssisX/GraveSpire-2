import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGait, gaitOffset, stepGait } from "./gait.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

describe("first-person gait", () => {
  it("advances phase from distance traveled and emits a foot at a stride crossing", () => {
    const g = createGait();
    let feet = 0;
    for (let i = 0; i < 90; i++) {
      stepGait(
        g,
        1 / 60,
        { speed: 2.4, grounded: true, crouch: false, sprint: false, forwardAccel: 0, yawRate: 0, landed: 0 },
        DEFAULT_SETTINGS,
      );
      if (g.foot) feet++;
    }
    assert.ok(g.phase > 0.5);
    assert.ok(feet >= 1);
  });

  it("zeros presentation amplitude under reduced motion", () => {
    const g = createGait();
    for (let i = 0; i < 30; i++) {
      stepGait(
        g,
        1 / 60,
        { speed: 3.2, grounded: true, crouch: false, sprint: true, forwardAccel: 1, yawRate: 0.4, landed: 0.4 },
        { ...DEFAULT_SETTINGS, reducedMotion: true, shake: 1 },
      );
    }
    const off = gaitOffset(g, { ...DEFAULT_SETTINGS, reducedMotion: true, shake: 1 });
    assert.ok(Math.abs(off.y) < 0.01);
    assert.ok(Math.abs(off.roll) < 0.05);
  });
});
