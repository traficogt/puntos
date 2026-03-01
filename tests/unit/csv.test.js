import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCSV } from "../../src/utils/csv.js";

describe("csv (Formula Injection Protection)", () => {
  describe("Formula character sanitization", () => {
    it("should prefix cells starting with = to prevent formula injection", () => {
      const rows = [{ name: "=SUM(A1:A10)", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      // Should prefix with single quote
      assert.match(csv, /'=SUM\(A1:A10\)/);
      assert.ok(!csv.includes("\n=SUM"), "Formula should not start line");
    });

    it("should prefix cells starting with + to prevent formula injection", () => {
      const rows = [{ name: "+1234", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'\+1234/);
    });

    it("should prefix cells starting with - to prevent formula injection", () => {
      const rows = [{ name: "-1234", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'-1234/);
    });

    it("should prefix cells starting with @ to prevent formula injection", () => {
      const rows = [{ name: "@SUM(1,2)", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'@SUM\(1,2\)/);
    });

    it("should handle whitespace before formula characters", () => {
      const rows = [{ name: " =FORMULA()", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      // Should still be prefixed
      assert.match(csv, /' =FORMULA\(\)/);
    });

    it("should handle tab before formula characters", () => {
      const rows = [{ name: "\t=FORMULA()", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'\t=FORMULA\(\)/);
    });

    it("should handle null bytes before formula characters", () => {
      const rows = [{ name: "\u0000=FORMULA()", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'.*=FORMULA\(\)/);
    });
  });

  describe("Safe values", () => {
    it("should not prefix normal text", () => {
      const rows = [{ name: "John Doe", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.ok(!csv.includes("'John Doe"), "Normal text should not be prefixed");
      assert.match(csv, /John Doe/);
    });

    it("should not prefix numbers", () => {
      const rows = [{ name: "123", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.ok(!csv.includes("'123"), "Numbers not starting with + or - should not be prefixed");
    });

    it("should handle formula characters in middle of text", () => {
      const rows = [{ name: "Total = 100", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.ok(!csv.includes("'Total"), "= in middle should be fine");
      assert.match(csv, /Total = 100/);
    });

    it("should handle email addresses with @", () => {
      const rows = [{ name: "John", email: "john@example.com" }];
      const csv = toCSV(rows, ["name", "email"]);
      
      assert.ok(!csv.includes("'john@example.com"), "@ in middle of email is safe");
    });
  });

  describe("Real-world attack payloads", () => {
    it("should neutralize DDE attack", () => {
      const rows = [{ name: "=cmd|'/c calc.exe'!A1", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'=cmd/);
      assert.ok(!csv.includes("\n=cmd"), "DDE payload should be neutralized");
    });

    it("should neutralize HYPERLINK attack", () => {
      const rows = [{ name: "=HYPERLINK(\"http://evil.com\",\"Click Me\")", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'=HYPERLINK/);
    });

    it("should neutralize external reference", () => {
      const rows = [{ name: "=IMPORTXML(\"http://evil.com/attack.xml\")", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'=IMPORTXML/);
    });

    it("should handle multiple dangerous cells", () => {
      const rows = [
        { name: "=SUM(A1:A10)", value: "+1000", calc: "-500", ref: "@A1" }
      ];
      const csv = toCSV(rows, ["name", "value", "calc", "ref"]);
      
      assert.match(csv, /'=SUM/);
      assert.match(csv, /'\+1000/);
      assert.match(csv, /'-500/);
      assert.match(csv, /'@A1/);
    });
  });

  describe("Edge cases", () => {
    it("should handle null values", () => {
      const rows = [{ name: null, phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      // Should not crash
      assert.ok(csv.includes("12345"));
    });

    it("should handle undefined values", () => {
      const rows = [{ name: undefined, phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      // Should not crash
      assert.ok(csv.includes("12345"));
    });

    it("should handle empty string", () => {
      const rows = [{ name: "", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.ok(csv.includes("12345"));
    });

    it("should handle arrays of rows", () => {
      const rows = [
        { name: "=EVIL1", phone: "111" },
        { name: "Safe", phone: "222" },
        { name: "=EVIL2", phone: "333" }
      ];
      const csv = toCSV(rows, ["name", "phone"]);
      
      assert.match(csv, /'=EVIL1/);
      assert.match(csv, /'=EVIL2/);
      assert.ok(csv.includes("Safe"));
    });

    it("should preserve other CSV features", () => {
      const rows = [{ name: "Doe, John", phone: "12345" }];
      const csv = toCSV(rows, ["name", "phone"]);
      
      // Should properly quote fields with commas
      assert.match(csv, /"Doe, John"/);
    });
  });

  describe("Multiple fields", () => {
    it("should sanitize all specified columns", () => {
      const rows = [
        {
          name: "=EVIL",
          email: "+user@evil.com",
          notes: "-malicious",
          ref: "@A1"
        }
      ];
      const csv = toCSV(rows, ["name", "email", "notes", "ref"]);
      
      assert.match(csv, /'=EVIL/);
      assert.match(csv, /'\+user@evil.com/);
      assert.match(csv, /'-malicious/);
      assert.match(csv, /'@A1/);
    });

    it("should only sanitize requested columns", () => {
      const rows = [
        {
          name: "=EVIL",
          email: "safe@example.com",
          ignored: "=IGNORED"
        }
      ];
      
      // Only export name and email
      const csv = toCSV(rows, ["name", "email"]);
      
      assert.match(csv, /'=EVIL/);
      assert.ok(csv.includes("safe@example.com"));
      assert.ok(!csv.includes("IGNORED"), "Ignored column should not be in CSV");
    });
  });
});
