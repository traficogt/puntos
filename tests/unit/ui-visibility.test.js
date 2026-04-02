import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { setHidden } from "../../public/lib.js";

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    toggle(value, force) {
      if (force === undefined) {
        if (values.has(value)) values.delete(value);
        else values.add(value);
        return values.has(value);
      }
      if (force) values.add(value);
      else values.delete(value);
      return values.has(value);
    },
    contains(value) {
      return values.has(value);
    }
  };
}

function makeElement(initialClasses = []) {
  const attrs = new Map();
  return {
    hidden: false,
    classList: makeClassList(initialClasses),
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    }
  };
}

describe("ui visibility helper", () => {
  it("hides elements by syncing hidden state, class, and aria metadata", () => {
    const el = /** @type {any} */ (makeElement());

    setHidden(el, true);

    assert.equal(el.hidden, true);
    assert.equal(el.classList.contains("is-hidden"), true);
    assert.equal(el.getAttribute("aria-hidden"), "true");
  });

  it("reveals elements that started with the is-hidden class", () => {
    const el = /** @type {any} */ (makeElement(["is-hidden"]));
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");

    setHidden(el, false);

    assert.equal(el.hidden, false);
    assert.equal(el.classList.contains("is-hidden"), false);
    assert.equal(el.getAttribute("aria-hidden"), null);
  });

  it("application entrypoints expose the premium app shell markers", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const admin = fs.readFileSync(new URL("../../public/admin-dashboard.html", import.meta.url), "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const customer = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");

    assert.match(admin, /<body class="app-shell page-admin">/);
    assert.match(admin, /class="nav app-topbar"/);
    assert.match(customer, /<body class="app-shell page-customer">/);
    assert.match(customer, /class="nav app-topbar"/);
  });
});
