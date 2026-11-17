import { DateTime } from "luxon";

import { regionTimezone } from "../regional-settings.js";

// Recurring challenges follow the business's local calendar, not UTC. Weeks
// start on Monday (ISO). Both progress updates and refund reconciliation use
// these helpers so a window means the same thing everywhere.
const RECURRENCE_UNITS = Object.freeze({ daily: "day", weekly: "week", monthly: "month" });
const DEFAULT_TIMEZONE = regionTimezone({});

export function isWindowedRecurrence(recurrence) {
  return Object.hasOwn(RECURRENCE_UNITS, recurrence);
}

export function challengeTimezone(business = {}) {
  return regionTimezone(business || {});
}

export function recurrenceWindowStart(date, recurrence, timezone = DEFAULT_TIMEZONE) {
  const unit = isWindowedRecurrence(recurrence) ? RECURRENCE_UNITS[recurrence] : null;
  if (!unit || date == null) return null;
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return null;
  const local = DateTime.fromJSDate(at, { zone: timezone || DEFAULT_TIMEZONE });
  if (!local.isValid) return null;
  return local.startOf(unit).toJSDate();
}

export function recurrenceWindowEnd(start, recurrence, timezone = DEFAULT_TIMEZONE) {
  const unit = isWindowedRecurrence(recurrence) ? RECURRENCE_UNITS[recurrence] : null;
  if (!unit || !start) return null;
  const local = DateTime.fromJSDate(new Date(start), { zone: timezone || DEFAULT_TIMEZONE });
  if (!local.isValid) return null;
  return local.plus({ [unit]: 1 }).toJSDate();
}

export function hasRecurringWindowElapsed(previousAt, recurrence, now = new Date(), timezone = DEFAULT_TIMEZONE) {
  if (!previousAt || !recurrence) return true;
  const previousWindow = recurrenceWindowStart(previousAt, recurrence, timezone);
  const currentWindow = recurrenceWindowStart(now, recurrence, timezone);
  if (!previousWindow || !currentWindow) return true;
  return currentWindow.getTime() > previousWindow.getTime();
}

// A completed row belongs to the window of its completion; unfinished
// progress to the window in which it was last written.
export function challengeProgressWrittenAt(progress) {
  if (progress?.completed) return progress.completed_at || progress.updated_at || progress.last_reset_at || null;
  return progress?.updated_at || progress?.last_reset_at || progress?.completed_at || null;
}
