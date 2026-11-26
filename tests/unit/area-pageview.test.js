import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed application asset under test.
const source = await readFile(new URL("../../public/area-pageview.js", import.meta.url), "utf8");

function requests(
  area,
  path = "/negocio/?checkout=private#private",
  privacy = {},
  host = "app.puntosfieles.com",
) {
  const calls = [];
  runInNewContext(source, {
    document: {
      currentScript: { getAttribute: () => area },
      referrer: "https://example.org/private",
      title: "Private",
    },
    navigator: privacy,
    localStorage: { getItem: () => null },
    location: new URL(path, `https://${host}`),
    URLSearchParams,
    fetch: (url, options) => {
      calls.push({ url, options });
      return Promise.resolve();
    },
  });
  return calls;
}

test("application analytics sends a fixed area without a user, URL parameters, referrer or credentials", () => {
  const [{ url, options }] = requests("owner");
  assert.equal(url, "https://privatrack.com/api/send");
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(options.body), {
    type: "event",
    payload: {
      website: "e2ed248a-786d-472f-a3b6-333c949602e6",
      hostname: "app.puntosfieles.com",
      url: "/negocio/",
    },
  });
  assert.equal(
    JSON.parse(requests("enrollment", "/registro/private-slug")[0].options.body).payload.url,
    "/registro/",
  );
  assert.equal(requests("user-generated").length, 0);
  assert.equal(requests("owner", "/negocio/", { globalPrivacyControl: true }).length, 0);
  assert.equal(requests("owner", "/negocio/", { doNotTrack: "1" }).length, 0);
  assert.equal(requests("owner", "/demostracion/").length, 0);
  assert.equal(requests("owner", "/negocio/?demo=1").length, 0);
  assert.equal(requests("team", "/equipo/", {}, "localhost").length, 0);
});
