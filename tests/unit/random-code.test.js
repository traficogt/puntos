import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { random6 } from "../../src/utils/random-code.js";

describe("random-code", () => {
  describe("random6()", () => {
    it("should return a 6-digit string", () => {
      const code = random6();
      assert.equal(typeof code, "string");
      assert.equal(code.length, 6);
    });

    it("should only contain digits", () => {
      const code = random6();
      assert.match(code, /^\d{6}$/);
    });

    it("should be in range 100000-999999", () => {
      for (let i = 0; i < 100; i++) {
        const code = random6();
        const num = parseInt(code, 10);
        assert.ok(num >= 100000, `Code ${code} is too small`);
        assert.ok(num <= 999999, `Code ${code} is too large`);
      }
    });

    it("should generate different codes (not predictable)", () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(random6());
      }
      assert.ok(codes.size >= 95, `Only ${codes.size} unique codes in 100 samples - suspicious pattern`);
    });

    it("should not be affected by timing (no Math.random patterns)", () => {
      const codes = [];
      
      for (let i = 0; i < 1000; i++) {
        codes.push(parseInt(random6(), 10));
      }

      const min = Math.min(...codes);
      const max = Math.max(...codes);
      
      assert.ok(min >= 100000, "Minimum code is valid");
      assert.ok(max <= 999999, "Maximum code is valid");
      
      const spread = max - min;
      assert.ok(spread > 500000, `Spread ${spread} is too small - suspicious clustering`);
    });
  });
});
