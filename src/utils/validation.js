import { ZodError, flattenError } from "zod";

/**
 * Parses `data` with a zod schema, returning a result object instead of throwing.
 *
 * The schema's output is left `any`: routes read `v.data.<field>` and spread it
 * into service calls whose JSDoc still infers `note?: null` / `mfaCode?: undefined`
 * from default values, so a precise `@template T` here would fail those call
 * sites (customer-routes.js:156, staff-routes.js:81/321/342, order-routes.js:86)
 * until the services annotate their parameters. The result union keeps the
 * inferred shape callers rely on (`v.error` readable without narrowing).
 * @param {import("zod").ZodType<any>} schema
 * @param {unknown} data
 */
export function validate(schema, data) {
  try {
    return { ok: true, data: schema.parse(data) };
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, error: flattenError(e) };
    }
    return { ok: false, error: { message: "Invalid input" } };
  }
}
