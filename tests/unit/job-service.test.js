import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { enqueueJobWithDeps } = await import("../../src/app/services/job-service.js");

describe("job-service enqueue", () => {
  it("persists the job before pushing a Redis pointer", async () => {
    const created = [];
    const pushes = [];
    const job = await enqueueJobWithDeps(
      {
        jobRepo: {
          create: async (payload) => {
            created.push(payload);
            return {
              ...payload,
              status: "QUEUED",
              created_at: "2026-03-07T00:00:00.000Z"
            };
          }
        },
        redisClient: {
          lPush: async (key, value) => {
            pushes.push({ key, value });
          }
        },
        logger: { warn: () => {}, info: () => {} }
      },
      {
        businessId: "biz-1",
        jobType: "analytics.calculate",
        payload: { trigger: "manual" }
      }
    );

    assert.equal(created.length, 1);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].key, "pf:jobs:queue");
    assert.deepEqual(JSON.parse(pushes[0].value), { id: job.id });
    assert.equal(job.status, "QUEUED");
  });

  it("leaves the durable DB job queued when Redis enqueue fails", async () => {
    const warnings = [];
    const job = await enqueueJobWithDeps(
      {
        jobRepo: {
          create: async (payload) => ({
            ...payload,
            status: "QUEUED",
            created_at: "2026-03-07T00:00:00.000Z"
          })
        },
        redisClient: {
          lPush: async () => {
            throw new Error("redis down");
          }
        },
        logger: {
          info: () => {},
          warn: (entry, message) => warnings.push({ entry, message })
        }
      },
      {
        businessId: "biz-2",
        jobType: "lifecycle.run",
        payload: { trigger: "manual" }
      }
    );

    assert.equal(job.status, "QUEUED");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /redis enqueue failed/i);
  });
});
