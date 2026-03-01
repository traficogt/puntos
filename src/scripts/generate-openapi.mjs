#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { awardPointsSchema, staffLoginSchema } from "../utils/schemas.js";

const require = createRequire(import.meta.url);
const pkg = require(path.join(process.cwd(), "package.json"));

/** @type {(schema: import("zod").ZodTypeAny, name?: string) => any} */
const toJsonSchema = /** @type {any} */ (zodToJsonSchema);

const requestCodeSchema = z.object({
  phone: z.string().min(6),
  name: z.string().max(120).optional()
});

const verifyJoinCodeSchema = z.object({
  phone: z.string().min(6),
  code: z.string().min(4).max(10),
  name: z.string().max(120).optional(),
  referralCode: z.string().length(6).optional()
});

const schemas = {
  StaffLoginRequest: staffLoginSchema,
  AwardPointsRequest: awardPointsSchema,
  RequestJoinCodeRequest: requestCodeSchema,
  VerifyJoinCodeRequest: verifyJoinCodeSchema,
  BusinessPublicResponse: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    category: z.string().nullable().optional(),
    program_type: z.enum(["SPEND", "VISIT", "ITEM"])
  }),
  CustomerProfileResponse: z.object({
    ok: z.literal(true),
    business: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string()
    }),
    customer: z.object({
      id: z.string(),
      phone: z.string(),
      name: z.string().nullable(),
      points: z.number(),
      pending_points: z.number(),
      lifetime_points: z.number(),
      created_at: z.string(),
      last_visit_at: z.string().nullable()
    })
  }),
  ReferralCodeResponse: z.object({
    ok: z.literal(true),
    referral_code: z.string()
  }),
  TierInfoResponse: z.object({
    ok: z.literal(true),
    tier: z.record(z.any())
  })
};

const components = {};
for (const [name, schema] of Object.entries(schemas)) {
  components[name] = toJsonSchema(/** @type {import("zod").ZodTypeAny} */ (schema), name);
}

const paths = {
  "/api/v1/health": {
    get: {
      summary: "Service health probe",
      responses: {
        "200": { description: "Service healthy" },
        "503": { description: "Service unhealthy" }
      }
    }
  },
  "/api/v1/ready": {
    get: {
      summary: "Readiness probe",
      responses: {
        "200": { description: "Ready for traffic" },
        "503": { description: "Not ready" }
      }
    }
  },
  "/api/v1/live": {
    get: {
      summary: "Liveness probe",
      responses: {
        "200": { description: "Process is alive" }
      }
    }
  },
  "/api/v1/info": {
    get: {
      summary: "Service metadata",
      responses: {
        "200": { description: "Version and runtime info" }
      }
    }
  },
  "/api/v1/staff/login": {
    post: {
      summary: "Staff login",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/StaffLoginRequest" } }
        }
      },
      responses: {
        "200": { description: "Authenticated; cookie pf_staff is set" },
        "400": { description: "Validation error" },
        "401": { description: "Invalid credentials" }
      }
    }
  },
  "/api/v1/staff/me": {
    get: {
      summary: "Current staff session",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Current staff session" },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/staff/award": {
    post: {
      summary: "Award points to a customer",
      security: [{ staffAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/AwardPointsRequest" } }
        }
      },
      responses: {
        "200": { description: "Points awarded" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Permission denied" }
      }
    }
  },
  "/api/v1/public/business/{slug}": {
    get: {
      summary: "Get a business public profile by slug",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" }
        }
      ],
      responses: {
        "200": {
          description: "Business public profile",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/BusinessPublicResponse" } }
          }
        },
        "404": { description: "Business not found" }
      }
    }
  },
  "/api/v1/public/business/{slug}/join/request-code": {
    post: {
      summary: "Request a customer join verification code",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/RequestJoinCodeRequest" } }
        }
      },
      responses: {
        "200": { description: "Verification code requested" },
        "400": { description: "Validation error" },
        "404": { description: "Business not found" },
        "429": { description: "Rate limited" }
      }
    }
  },
  "/api/v1/public/business/{slug}/join/verify": {
    post: {
      summary: "Verify a join code and create/login the customer",
      parameters: [
        {
          in: "path",
          name: "slug",
          required: true,
          schema: { type: "string" }
        }
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/VerifyJoinCodeRequest" } }
        }
      },
      responses: {
        "200": { description: "Customer authenticated; cookie pf_customer is set" },
        "400": { description: "Validation error" },
        "404": { description: "Business not found" },
        "429": { description: "Rate limited" }
      }
    }
  },
  "/api/v1/public/customer/qr.svg": {
    get: {
      summary: "Get a short-lived customer QR as SVG",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "SVG QR image with X-QR-Exp, X-QR-JTI, and X-QR-Token headers",
          content: {
            "image/svg+xml": {
              schema: { type: "string" }
            }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/me": {
    get: {
      summary: "Get the current customer profile",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "Current customer profile",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CustomerProfileResponse" } }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/referral-code": {
    get: {
      summary: "Get or create the current customer's referral code",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "Referral code",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ReferralCodeResponse" } }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/customer/tier": {
    get: {
      summary: "Get the current customer's tier information",
      security: [{ customerAuth: [] }],
      responses: {
        "200": {
          description: "Tier info",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/TierInfoResponse" } }
          }
        },
        "401": { description: "Not authenticated" }
      }
    }
  },
  "/api/v1/admin/tiers": {
    get: {
      summary: "List business tiers",
      security: [{ staffAuth: [] }],
      responses: {
        "200": { description: "Tier list" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role required" }
      }
    },
    post: {
      summary: "Create a business tier",
      security: [{ staffAuth: [] }],
      responses: {
        "201": { description: "Tier created" },
        "400": { description: "Validation error" },
        "401": { description: "Not authenticated" },
        "403": { description: "Owner role required" }
      }
    }
  }
};

const doc = {
  openapi: "3.0.3",
  info: {
    title: "PuntosFieles API",
    version: pkg.version,
    description: "Route-accurate OpenAPI document for the versioned /api/v1 surface."
  },
  servers: [{ url: "https://api.puntos.local" }],
  paths,
  components: {
    securitySchemes: {
      staffAuth: { type: "apiKey", in: "cookie", name: "pf_staff" },
      customerAuth: { type: "apiKey", in: "cookie", name: "pf_customer" }
    },
    schemas: components
  }
};

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (!value.length) return '""';
    if (/^[A-Za-z0-9._/-]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function toYaml(value, indent = 0) {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${space}[]`;
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (!entries.length) return `${space}- {}`;
          const [firstKey, firstValue] = entries[0];
          const firstScalar = firstValue === null || typeof firstValue !== "object";
          if (firstScalar) {
            const rest = entries.slice(1)
              .map(([key, nested]) => `${" ".repeat(indent + 2)}${key}:${
                nested && typeof nested === "object" ? `\n${toYaml(nested, indent + 4)}` : ` ${yamlScalar(nested)}`
              }`)
              .join("\n");
            return `${space}- ${firstKey}: ${yamlScalar(firstValue)}${rest ? `\n${rest}` : ""}`;
          }
          return `${space}- ${firstKey}:\n${toYaml(firstValue, indent + 4)}${
            entries.slice(1).length
              ? `\n${entries.slice(1).map(([key, nested]) => `${" ".repeat(indent + 2)}${key}:${
                nested && typeof nested === "object" ? `\n${toYaml(nested, indent + 4)}` : ` ${yamlScalar(nested)}`
              }`).join("\n")}`
              : ""
          }`;
        }
        return `${space}- ${yamlScalar(item)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return `${space}{}`;
    return entries
      .map(([key, nested]) => `${space}${key}:${
        nested && typeof nested === "object" ? `\n${toYaml(nested, indent + 2)}` : ` ${yamlScalar(nested)}`
      }`)
      .join("\n");
  }
  return `${space}${yamlScalar(value)}`;
}

const docsDir = path.join(process.cwd(), "docs");
const jsonPath = path.join(docsDir, "openapi.json");
const yamlPath = path.join(docsDir, "openapi.yaml");
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
fs.writeFileSync(yamlPath, `${toYaml(doc)}\n`);
console.log(`OpenAPI spec written to ${jsonPath} and ${yamlPath}`);
