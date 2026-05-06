/**
 * Pure block-state evaluation — no chrome APIs, fully unit-testable.
 */

export function evaluateBlockState(settings, dailyUsage, now) {
  if (!settings.enabled) return { isBlocked: false, blockedBy: [] };

  const timeBlocked = isInTimeWindow(settings.timeWindows, now);
  const limitBlocked =
    settings.dailyLimitEnabled &&
    dailyUsage.totalSeconds >= settings.dailyLimitSeconds;

  if (settings.triggerMode === "AND") {
    const isBlocked = timeBlocked && limitBlocked;
    return {
      isBlocked,
      blockedBy: isBlocked ? ["timeWindow", "dailyLimit"] : [],
    };
  }

  // OR (default)
  const blockedBy = [
    ...(timeBlocked  ? ["timeWindow"]  : []),
    ...(limitBlocked ? ["dailyLimit"]  : []),
  ];
  return { isBlocked: blockedBy.length > 0, blockedBy };
}

/**
 * Returns true if `now` falls inside any configured time window.
 * Windows where endHH:endMM < startHH:startMM span midnight.
 *
 * Midnight-spanning example: days=[0,1] start=23:00 end=07:00
 *   Sunday  23:00 → Monday 07:00 is blocked, but BOTH days must be listed.
 *   The options page auto-adds the next day when end < start.
 */
export function isInTimeWindow(timeWindows, now) {
  const day  = now.getDay();
  const nowM = now.getHours() * 60 + now.getMinutes();

  for (const tw of timeWindows) {
    if (!tw.days.includes(day)) continue;

    const startM = tw.startHH * 60 + tw.startMM;
    const endM   = tw.endHH   * 60 + tw.endMM;

    if (startM === endM) continue; // degenerate window — skip

    if (startM < endM) {
      // Same-day window e.g. 09:00–18:00
      if (nowM >= startM && nowM < endM) return true;
    } else {
      // Midnight-spanning e.g. 23:00–07:00
      if (nowM >= startM || nowM < endM) return true;
    }
  }
  return false;
}

/** Returns local "YYYY-MM-DD" string using Swedish locale (ISO date format). */
export function localDateKey(now) {
  return now.toLocaleDateString("sv"); // e.g. "2026-05-06"
}
