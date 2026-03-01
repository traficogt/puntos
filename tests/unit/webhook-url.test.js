import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWebhookTarget, validateWebhookUrl } from "../../src/utils/webhook-url.js";

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
