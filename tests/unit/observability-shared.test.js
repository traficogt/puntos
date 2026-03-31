import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serviceInfo } from "../../src/app/routes/observability-shared.js";

describe("observability shared info", () => {
  it("includes stable release metadata keys", () => {
    const info = serviceInfo();
    assert.equal(info.service, "PuntosFieles");
    assert.ok(typeof info.version === "string" && info.version.length > 0);
    assert.ok(Object.hasOwn(info, "build_sha"));
    assert.ok(Object.hasOwn(info, "build_timestamp"));
  });
});
