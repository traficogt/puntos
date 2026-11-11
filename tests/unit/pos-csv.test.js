import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePosCsv, normalizePosCsv } from "../../src/app/services/pos/csv.js";

const columns = { saleId: "Venta", customerPhone: "Telefono", amountQ: "Total", status: "Estado" };
const header = "Venta,Telefono,Total,Estado";
const normalize = (data, options = {}) => normalizePosCsv({
  csv: `${header}\n${data}`, source: "Caja 01", columns, ...options
});
const isBadRequest = (error) => error.name === "HttpError" && error.statusCode === 400;

describe("POS CSV parser", () => {
  it("preserves zero prefixes and strings while handling a BOM and CRLF", () => {
    assert.deepEqual(parsePosCsv(`\uFEFF${header}\r\n0007,00123456,12.50,paid\r\n`), {
      headers: ["Venta", "Telefono", "Total", "Estado"],
      rows: [{ row: 2, values: ["0007", "00123456", "12.50", "paid"] }]
    });
  });

  it("handles semicolons, quoted delimiters, escaped quotes and multiline cells", () => {
    const out = parsePosCsv('Venta;Telefono;Total;Nota\r\n001;01234567;12,50;"Hola; ""amigo""\r\nsegundo"\r\n002;12345678;0;fin');
    assert.deepEqual(out.headers, ["Venta", "Telefono", "Total", "Nota"]);
    assert.deepEqual(out.rows, [
      { row: 2, values: ["001", "01234567", "12,50", 'Hola; "amigo"\r\nsegundo'] },
      { row: 4, values: ["002", "12345678", "0", "fin"] }
    ]);
  });

  it("ignores blank lines but preserves field spaces and physical row numbers", () => {
    assert.deepEqual(parsePosCsv('\n  \r\nVenta,Nota\n\n001, hola \n \n002,""').rows, [
      { row: 5, values: ["001", " hola "] },
      { row: 7, values: ["002", ""] }
    ]);
  });

  it("detects delimiters without counting quoted header punctuation", () => {
    assert.deepEqual(parsePosCsv('"Venta, ID";"Telefono; movil"\n001;01234567').headers,
      ["Venta, ID", "Telefono; movil"]);
  });

  it("preserves empty fields instead of dropping incomplete records", () => {
    assert.deepEqual(parsePosCsv("a,b,c\n,,\n1,2,").rows, [
      { row: 2, values: ["", "", ""] }, { row: 3, values: ["1", "2", ""] }
    ]);
  });

  for (const csv of ["a,b\n1", "a,b\n1,2,3", 'a,b\n1,"open', 'a,b\n1,no"quote', 'a,b\n1,"closed"junk']) {
    it(`rejects malformed records without truncating: ${JSON.stringify(csv)}`, () => {
      assert.throws(() => parsePosCsv(csv), isBadRequest);
    });
  }

  for (const csv of ["", "\uFEFF\n ", "a,a\n1,2", "a, a \n1,2", "a,\n1,2", "a,b;c\n1,2;3"]) {
    it(`rejects missing, duplicate or ambiguous headers: ${JSON.stringify(csv)}`, () => {
      assert.throws(() => parsePosCsv(csv), isBadRequest);
    });
  }

  it("accepts 100 rows and rejects a 101st instead of importing a prefix", () => {
    const records = Array.from({ length: 100 }, (_, index) => `${index},value`).join("\n");
    assert.equal(parsePosCsv(`a,b\n${records}`).rows.length, 100);
    assert.throws(() => parsePosCsv(`a,b\n${records}\n101,value`), isBadRequest);
  });

  it("bounds UTF-8 byte size and rejects non-string input", () => {
    assert.throws(() => parsePosCsv(`a\n${"é".repeat(102400)}`), isBadRequest);
    for (const csv of [null, undefined, {}, 123]) assert.throws(() => parsePosCsv(csv), isBadRequest);
  });
});

describe("POS CSV normalization", () => {
  it("returns only headers and empty results for an unmapped inspection", () => {
    assert.deepEqual(normalizePosCsv({ csv: `${header}\n001,12345678,10,paid` }), {
      headers: ["Venta", "Telefono", "Total", "Estado"], sales: [], issues: []
    });
  });

  it("creates the shared normalized sale and preserves ID and phone zero prefixes", () => {
    assert.deepEqual(normalize("0007,00123456,12.50,PaId"), {
      headers: ["Venta", "Telefono", "Total", "Estado"],
      sales: [{ row: 2, saleId: "0007", source: "Caja 01", customerPhone: "50200123456", amountQ: 12.5, currency: "GTQ", visits: 1, items: 0 }],
      issues: []
    });
  });

  it("normalizes formatted phones and accepts exact paid statuses case insensitively", () => {
    const out = normalize(["paid", "completed", "PAGADO", " pagada "].map((status, i) => `${i},+502 (1234)-5678,0,${status}`).join("\n"));
    assert.equal(out.sales.length, 4);
    assert.deepEqual(out.issues, []);
    assert.ok(out.sales.every(sale => sale.customerPhone === "50212345678" && sale.amountQ === 0));
  });

  it("ignores unpaid, refunds, cancellations, unknown and missing statuses even with assumePaid", () => {
    const statuses = ["unpaid", "refunded", "refund", "cancelled", "pending", "partially_paid", "paid refund", "", "1", "true"];
    const out = normalize(statuses.map((status, i) => `${i},12345678,10,${status}`).join("\n"), { assumePaid: true });
    assert.deepEqual(out.sales, []);
    assert.equal(out.issues.length, statuses.length);
    assert.ok(out.issues.every(issue => issue.code === "UNPAID_STATUS" && issue.status === "ignored" && issue.message));
    assert.equal(out.issues[0].row, 2);
    assert.equal(out.issues[0].saleId, "0");
  });

  it("requires an explicit boolean assumePaid when a status column is not mapped", () => {
    const withoutStatus = { saleId: "Venta", customerPhone: "Telefono", amountQ: "Total" };
    for (const assumePaid of [undefined, false, "true", 1]) {
      assert.throws(() => normalize("001,12345678,10,paid", { columns: withoutStatus, assumePaid }), isBadRequest);
    }
    assert.equal(normalize("001,12345678,10,", { columns: withoutStatus, assumePaid: true }).sales.length, 1);
  });

  it("rejects invalid supplied mappings instead of returning a misleading empty preview", () => {
    for (const mapping of [null, {}, [], { ...columns, saleId: "Missing" }, { ...columns, amountQ: "Venta" }, { ...columns, items: "Missing" }]) {
      assert.throws(() => normalize("001,12345678,10,paid", { columns: mapping }), isBadRequest);
    }
  });

  it("accepts decimal commas only in semicolon files and converts cents without truncation", () => {
    const decimal = normalize("", { csv: "Venta;Telefono;Total;Estado\n001;12345678;12,50;paid\n002;12345678;0.29;paid" });
    assert.deepEqual(decimal.sales.map(sale => sale.amountQ), [12.5, 0.29]);
    const cents = normalize("001,12345678,1250,paid\n002,12345678,29,paid", { amountUnit: "minor" });
    assert.deepEqual(cents.sales.map(sale => sale.amountQ), [12.5, 0.29]);
  });

  for (const value of ["", "-1", "-0", "+10", "NaN", "Infinity", "1e3", "0x10", "1,000", "1.000", "1,234.56", "1.234,56", "12,50", "Q10", "10Q", "1 000", "10.999", "9007199254740992"]) {
    it(`rejects invalid or ambiguous major amounts: ${JSON.stringify(value)}`, () => {
      const out = normalize(`001,12345678,"${value}",paid`);
      assert.deepEqual(out.sales, []);
      assert.equal(out.issues[0].code, "INVALID_AMOUNT");
      assert.equal(out.issues[0].status, "error");
    });
  }

  it("rejects fractional minor units and unsupported unit names", () => {
    const out = normalize("001,12345678,1250.5,paid", { amountUnit: "minor" });
    assert.equal(out.issues[0].code, "INVALID_AMOUNT");
    assert.throws(() => normalize("001,12345678,10,paid", { amountUnit: "cents" }), isBadRequest);
  });

  it("rejects ambiguous semicolon-file amounts instead of guessing separators", () => {
    for (const amount of ["1,000", "1.000", "1.234,56", "1,234.56"]) {
      const out = normalize("", { csv: `Venta;Telefono;Total;Estado\n001;12345678;${amount};paid` });
      assert.equal(out.issues[0].code, "INVALID_AMOUNT");
    }
  });

  it("returns row errors for missing IDs, anonymous sales, malformed phones and long IDs", () => {
    const rows = [",12345678,10,paid", "002,,10,paid", "003,phone12345678,10,paid", "004,123,10,paid", `${"a".repeat(201)},12345678,10,paid`];
    const out = normalize(rows.join("\n"));
    assert.deepEqual(out.sales, []);
    assert.deepEqual(out.issues.map(issue => issue.code), ["INVALID_SALE_ID", "INVALID_CUSTOMER_PHONE", "INVALID_CUSTOMER_PHONE", "INVALID_CUSTOMER_PHONE", "INVALID_SALE_ID"]);
    assert.deepEqual(out.issues.map(issue => issue.row), [2, 3, 4, 5, 6]);
    assert.ok(out.issues.every(issue => issue.status === "error" && issue.message));
  });

  it("rejects every occurrence of duplicate IDs, including whitespace variants", () => {
    const out = normalize("001,12345678,10,paid\n002,12345678,20,paid\n 001 ,12345678,99,paid");
    assert.deepEqual(out.sales.map(sale => sale.saleId), ["002"]);
    assert.deepEqual(out.issues.map(({ row, saleId, code, status }) => ({ row, saleId, code, status })), [
      { row: 2, saleId: "001", code: "DUPLICATE_SALE_ID", status: "error" },
      { row: 4, saleId: "001", code: "DUPLICATE_SALE_ID", status: "error" }
    ]);
  });

  it("requires a bounded readable source and preserves a stable trimmed name", () => {
    for (const source of [undefined, "", " ", "a".repeat(61), "a\nb", "../Caja", {}, 123]) {
      assert.throws(() => normalize("001,12345678,10,paid", { source }), isBadRequest);
    }
    assert.equal(normalize("001,12345678,10,paid", { source: "  Cafetería: caja-01  " }).sales[0].source, "Cafetería: caja-01");
  });

  it("validates optional item counts as nonnegative safe integers", () => {
    const out = normalize("", {
      csv: `${header},Articulos\n001,12345678,10,paid,2\n002,12345678,10,paid,-1\n003,12345678,10,paid,1.5\n004,12345678,10,paid,\n005,12345678,10,paid,9007199254740992`,
      columns: { ...columns, items: "Articulos" }
    });
    assert.equal(out.sales[0].items, 2);
    assert.equal(out.sales.length, 1);
    assert.ok(out.issues.every(issue => issue.code === "INVALID_ITEMS" && issue.status === "error"));
    assert.equal(out.issues.length, 4);
  });
});
