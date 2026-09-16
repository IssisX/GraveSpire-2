import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { designOutput, wrapIntoBox } from "./atmosphere.ts";

describe("bounded atmospheric presentation", () => {
  it("wraps drifting dust into a finite camera-centred field", () => {
    assert.equal(wrapIntoBox(19, 0, 22), -3);
    assert.equal(wrapIntoBox(-19, 0, 22), 3);
    assert.ok(Math.abs(wrapIntoBox(251.4, 246, 22) - 251.4) <= 11);
  });

  it("keeps a lamp's healthy output when the electrical bus later sags", () => {
    const healthy = designOutput(14, 32);
    assert.equal(healthy, 32);
    assert.equal(designOutput(healthy, 7), 32);
  });
});
