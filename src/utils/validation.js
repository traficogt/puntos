import { ZodError } from "zod";

export function validate(schema, data) {
  try {
    return { ok: true, data: schema.parse(data) };
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, error: e.flatten() };
    }
    return { ok: false, error: { message: "Invalid input" } };
  }
}
