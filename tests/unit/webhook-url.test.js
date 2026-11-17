import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPublicUnicastAddress, resolveWebhookTarget, validateWebhookUrl } from "../../src/utils/webhook-url.js";

const publicLookup = async () => [{ address: "93.184.216.34" }];
const privateLookup = async () => [{ address: "127.0.0.1" }];
const failingLookup = async () => { throw new Error("lookup failed"); };

describe("webhook-url (SSRF Protection)", () => {
  describe("HTTPS enforcement", () => {
    it("should reject HTTP URLs when requireHttps=true", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("http://example.com/webhook", { requireHttps: true }),
        { message: /https/ }
      );
    });

    it("should allow HTTP URLs when requireHttps=false", async () => {
      const url = await validateWebhookUrl("http://example.com/webhook", { requireHttps: false, lookup: publicLookup });
      assert.equal(url.protocol, "http:");
    });

    it("should allow HTTPS URLs when requireHttps=true", async () => {
      const url = await validateWebhookUrl("https://example.com/webhook", { requireHttps: true, lookup: publicLookup });
      assert.equal(url.protocol, "https:");
    });
  });

  describe("Invalid URLs", () => {
    it("should reject malformed URLs", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("not a url", { requireHttps: false }),
        { message: /Invalid URL/ }
      );
    });

    it("should reject URLs with credentials", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://user:pass@example.com/webhook", { requireHttps: true }),
        { message: /credentials/ }
      );
    });

    it("should reject URLs without host", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https:///webhook", { requireHttps: true }),
        { message: /(Invalid host|DNS lookup failed)/ }
      );
    });
  });

  describe("Localhost blocking", () => {
    it("should reject 'localhost' hostname", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://localhost/webhook", { requireHttps: true }),
        { message: /not allowed/ }
      );
    });

    it("should reject 127.0.0.1", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://127.0.0.1/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject 127.0.0.2", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://127.0.0.2/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject ::1 (IPv6 localhost)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://[::1]/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });
  });

  describe("Private IP blocking (RFC1918)", () => {
    it("should reject 10.0.0.0/8 range", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://10.0.0.1/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject 172.16.0.0/12 range", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://172.16.0.1/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject 192.168.0.0/16 range", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://192.168.1.1/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject 169.254.0.0/16 (link-local)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://169.254.169.254/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject 100.64.0.0/10 (CGNAT)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://100.64.0.1/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject 0.0.0.0/8", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://0.0.0.0/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });
  });

  describe("Private IPv6 blocking", () => {
    it("should reject fc00::/7 (unique local)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://[fc00::1]/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject fd00::/8 (unique local)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://[fd00::1]/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject fe80::/10 (link-local)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://[fe80::1]/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should reject :: (unspecified)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://[::]/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });
  });

  describe("Allowlist functionality", () => {
    it("should allow URLs matching allowlist", async () => {
      const url = await validateWebhookUrl(
        "https://api.example.com/webhook",
        { requireHttps: true, allowlist: ["example.com"], lookup: publicLookup }
      );
      assert.equal(url.hostname, "api.example.com");
    });

    it("should allow subdomain when parent domain is in allowlist", async () => {
      const url = await validateWebhookUrl(
        "https://deep.sub.example.com/webhook",
        { requireHttps: true, allowlist: ["example.com"], lookup: publicLookup }
      );
      assert.equal(url.hostname, "deep.sub.example.com");
    });

    it("should reject URLs not in allowlist", async () => {
      await assert.rejects(
        async () => validateWebhookUrl(
          "https://evil.com/webhook",
          { requireHttps: true, allowlist: ["example.com"], lookup: publicLookup }
        ),
        { message: /not in allowlist/ }
      );
    });

    it("should allow any URL when allowlist is empty", async () => {
      const url = await validateWebhookUrl(
        "https://example.com/webhook",
        { requireHttps: true, allowlist: [], lookup: publicLookup }
      );
      assert.equal(url.hostname, "example.com");
    });

    it("should be case-insensitive for allowlist", async () => {
      const url = await validateWebhookUrl(
        "https://API.EXAMPLE.COM/webhook",
        { requireHttps: true, allowlist: ["example.com"], lookup: publicLookup }
      );
      assert.equal(url.hostname.toLowerCase(), "api.example.com");
    });
  });

  describe("DNS resolution attack prevention", () => {
    it("should return a pinned public IP for later outbound requests", async () => {
      const target = await resolveWebhookTarget(
        "https://example.com/webhook",
        { requireHttps: true, lookup: publicLookup }
      );

      assert.equal(target.url.hostname, "example.com");
      assert.equal(target.resolvedAddress, "93.184.216.34");
      assert.equal(target.resolvedFamily, 4);
    });

    it("should reject domains that resolve to private IPs", async () => {
      // Note: This test requires actual DNS resolution
      // localhost should resolve to 127.0.0.1 and be blocked
      await assert.rejects(
        async () => validateWebhookUrl(
          "https://localhost.localdomain/webhook",
          { requireHttps: true, lookup: privateLookup }
        ),
        { message: /(DNS lookup failed|not allowed|Private IPs)/ }
      );
    });

    it("should handle DNS lookup failures gracefully", async () => {
      await assert.rejects(
        async () => validateWebhookUrl(
          "https://this-domain-definitely-does-not-exist-12345.com/webhook",
          { requireHttps: true, lookup: failingLookup }
        ),
        { message: /DNS lookup failed/ }
      );
    });
  });

  describe("Edge cases", () => {
    it("should handle URLs with ports", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://127.0.0.1:8080/webhook", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should handle URLs with query parameters", async () => {
      const url = await validateWebhookUrl(
        "https://example.com/webhook?key=value",
        { requireHttps: true, lookup: publicLookup }
      );
      assert.equal(url.search, "?key=value");
    });

    it("should handle URLs with paths", async () => {
      const url = await validateWebhookUrl(
        "https://example.com/api/v1/webhook",
        { requireHttps: true, lookup: publicLookup }
      );
      assert.equal(url.pathname, "/api/v1/webhook");
    });

    it("should handle URLs with fragments", async () => {
      const url = await validateWebhookUrl(
        "https://example.com/webhook#section",
        { requireHttps: true, lookup: publicLookup }
      );
      assert.equal(url.hash, "#section");
    });
  });

  describe("Real-world attack scenarios", () => {
    it("should prevent cloud metadata service access (AWS)", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://169.254.169.254/latest/meta-data/", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should prevent internal service access", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://192.168.1.1/admin", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });

    it("should prevent localhost on custom port", async () => {
      await assert.rejects(
        async () => validateWebhookUrl("https://127.0.0.1:6379/", { requireHttps: true }),
        { message: /Private IPs/ }
      );
    });
  });
});

describe("webhook-url only allows global unicast destinations", () => {
  const blocked = [
    // IPv4 special-purpose ranges
    "0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.254",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.10", "192.88.99.1",
    "192.168.0.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1",
    "239.255.255.250", "240.0.0.1", "255.255.255.255",
    // IPv4 carried inside IPv6: mapped, compatible, NAT64 and 6to4 forms
    "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "::ffff:10.1.2.3", "::127.0.0.1", "::7f00:1", "::a01:203", "64:ff9b::7f00:1", "64:ff9b::169.254.169.254",
    "64:ff9b:1::a01:203", "2002:7f00:1::1", "2002:a9fe:a9fe::1", "::ffff:0:7f00:1",
    // IPv6 special-purpose ranges
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "fe80::1%eth0", "fec0::1", "feff::1",
    "ff02::1", "ff05::1:3", "100::1", "2001::1", "2001:2::1", "2001:10::1", "2001:db8::1", "3fff::1",
    // Not addresses
    "", "localhost", "example.com", "127.1"
  ];
  const allowed = [
    "1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1",
    "192.0.1.1", "198.17.255.255", "198.20.0.1", "223.255.255.255",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:80b::200e",
    "::ffff:93.184.216.34", "64:ff9b::93.184.216.34", "2002:5db8:d822::1"
  ];
  for (const ip of blocked) it(`blocks ${JSON.stringify(ip)}`, () => assert.equal(isPublicUnicastAddress(ip), false));
  for (const ip of allowed) it(`allows ${ip}`, () => assert.equal(isPublicUnicastAddress(ip), true));

  for (const host of ["[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]", "[::127.0.0.1]", "[64:ff9b::7f00:1]", "[fec0::1]", "[ff02::1]", "[2002:7f00:1::1]", "0x7f000001", "2130706433", "127.1", "224.0.0.1", "198.18.0.1"]) {
    it(`rejects the URL host ${host}`, async () => {
      await assert.rejects(validateWebhookUrl(`https://${host}/hook`, { requireHttps: true }), { message: /Private IPs/ });
    });
  }

  for (const address of ["::ffff:10.1.2.3", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "fec0::1", "ff02::1", "224.0.0.251", "198.18.0.5"]) {
    it(`rejects a hostname whose DNS answer is ${address}`, async () => {
      const lookup = async () => [{ address: "93.184.216.34", family: 4 }, { address, family: address.includes(":") ? 6 : 4 }];
      await assert.rejects(validateWebhookUrl("https://hooks.example.com/hook", { lookup }), { message: /Private IPs/ });
    });
  }

  it("pins an IPv4-mapped public answer to its IPv4 address", async () => {
    const target = await resolveWebhookTarget("https://hooks.example.com/hook", { lookup: async () => [{ address: "::ffff:93.184.216.34", family: 6 }] });
    assert.deepEqual([target.resolvedAddress, target.resolvedFamily], ["93.184.216.34", 4]);
  });

  it("pins a public IPv6 literal", async () => {
    const target = await resolveWebhookTarget("https://[2606:4700:4700::1111]/hook");
    assert.deepEqual([target.resolvedAddress, target.resolvedFamily], ["2606:4700:4700::1111", 6]);
  });
});

