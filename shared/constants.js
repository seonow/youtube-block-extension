export const ALARM_TICK = "focus_guard_tick";

export const MSG_REPORT_USAGE    = "REPORT_USAGE";
export const MSG_GET_STATE       = "GET_STATE";
export const MSG_SETTINGS_CHANGED = "SETTINGS_CHANGED";
export const MSG_REGISTER_DOMAIN = "REGISTER_DOMAIN";

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const COOLDOWN_KEYS = [
  "blockedDomains",
  "triggerMode",
  "timeWindows",
  "dailyLimitEnabled",
  "dailyLimitSeconds",
  "resetHour",
  "enabled",
];

export const DEFAULT_SETTINGS = {
  blockedDomains: ["youtube.com", "youtu.be"],
  triggerMode: "OR",
  timeWindows: [],
  dailyLimitEnabled: false,
  dailyLimitSeconds: 3600,
  resetHour: 0,
  enabled: true,
};

export const DEFAULT_SETTING_COMMIT_TIMESTAMPS = {
  blockedDomains: 0,
  triggerMode: 0,
  timeWindows: 0,
  dailyLimitEnabled: 0,
  dailyLimitSeconds: 0,
  resetHour: 0,
  enabled: 0,
};

export const DYNAMIC_RULE_ID_START = 1000;
export const STATIC_RULESET_ID = "default_rules";
