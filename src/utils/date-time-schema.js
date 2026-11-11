import { z } from 'zod';

// Existing clients may omit seconds or use basic ISO offsets (+0200).
// Normalize only for validation so parsed request values stay unchanged.
export function dateTimeSchema({ offset = false } = {}) {
  const seconds = z.iso.datetime({ offset });
  const minutes = z.iso.datetime({ offset, precision: -1 });
  return z.string().refine(value => {
    const candidate = offset ? value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : value;
    return seconds.safeParse(candidate).success || minutes.safeParse(candidate).success;
  }, { error: 'Invalid datetime' }).meta({ format: 'date-time' });
}
