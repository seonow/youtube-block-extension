import {
  ALARM_TICK,
  MSG_REPORT_USAGE,
  MSG_GET_STATE,
  MSG_SETTINGS_CHANGED,
  MSG_REGISTER_DOMAIN,
  COOLDOWN_MS,
  COOLDOWN_KEYS,
  DEFAULT_SETTINGS,
  DEFAULT_SETTING_COMMIT_TIMESTAMPS,
  DYNAMIC_RULE_ID_START,
  STATIC_RULESET_ID,
} from "./shared/constants.js";

import {
  evaluateBlockState,
  localDateKey,
} from "./shared/block_logic.js";

// ---------------------------------------------------------------------------
// Install / Startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await initStorage();
  await ensureAlarm();
  await evaluateAndApply();

  if (reason === "install") {
    const { onboarding } = await chrome.storage.local.get("onboarding");
    if (!onboarding?.completed) {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html?onboarding=true") });
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await evaluateAndApply();
});

// ---------------------------------------------------------------------------
// Alarm
// ---------------------------------------------------------------------------

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_TICK);
  if (!existing) {
    chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_TICK) {
    await checkMidnightReset();
    await evaluateAndApply();
  }
});

// ---------------------------------------------------------------------------
// Storage initialisation
// ---------------------------------------------------------------------------

async function initStorage() {
  const existing = await chrome.storage.local.get([
    "settings",
    "settingCommitTimestamps",
    "dailyUsage",
    "blockState",
    "onboarding",
  ]);

  const defaults = {};

  if (!existing.settings) {
    defaults.settings = { ...DEFAULT_SETTINGS };
  }
  if (!existing.settingCommitTimestamps) {
    defaults.settingCommitTimestamps = { ...DEFAULT_SETTING_COMMIT_TIMESTAMPS };
  }
  if (!existing.dailyUsage) {
    defaults.dailyUsage = {
      dateKey: localDateKey(new Date()),
      totalSeconds: 0,
      sessionSeconds: 0,
    };
  }
  if (!existing.blockState) {
    defaults.blockState = { isBlocked: false, blockedBy: [], evaluatedAt: 0 };
  }
  if (!existing.onboarding) {
    defaults.onboarding = { completed: false, agreedAt: 0 };
  }

  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }
}

// ---------------------------------------------------------------------------
// Midnight reset
// ---------------------------------------------------------------------------

async function checkMidnightReset() {
  const { dailyUsage } = await chrome.storage.local.get("dailyUsage");
  const todayKey = localDateKey(new Date());
  if (dailyUsage.dateKey !== todayKey) {
    await chrome.storage.local.set({
      dailyUsage: { dateKey: todayKey, totalSeconds: 0, sessionSeconds: 0 },
    });
  }
}

// ---------------------------------------------------------------------------
// Block state evaluation
// ---------------------------------------------------------------------------

async function evaluateAndApply() {
  const { settings, dailyUsage } = await chrome.storage.local.get([
    "settings",
    "dailyUsage",
  ]);

  const result = evaluateBlockState(settings, dailyUsage, new Date());

  const blockState = {
    isBlocked: result.isBlocked,
    blockedBy: result.blockedBy,
    evaluatedAt: Date.now(),
  };

  await chrome.storage.local.set({ blockState });
  await applyDNRBlock(result.isBlocked, settings);
  updateBadge(result.isBlocked);
}

function updateBadge(isBlocked) {
  if (isBlocked) {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// ---------------------------------------------------------------------------
// DNR management
// ---------------------------------------------------------------------------

async function applyDNRBlock(isBlocked, settings) {
  // Toggle static ruleset for default domains
  try {
    if (isBlocked) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [STATIC_RULESET_ID],
        disableRulesetIds: [],
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: [STATIC_RULESET_ID],
      });
    }
  } catch (e) {
    // Ruleset may already be in target state — ignore
  }

  // Dynamic rules for user-added domains
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const oldIds = existing
    .filter((r) => r.id >= DYNAMIC_RULE_ID_START)
    .map((r) => r.id);

  if (!isBlocked) {
    if (oldIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: oldIds,
      });
    }
    return;
  }

  const defaultDomains = new Set(["youtube.com", "youtu.be"]);
  const userDomains = (settings.blockedDomains || []).filter(
    (d) => !defaultDomains.has(d)
  );

  const addRules = userDomains.map((domain, i) =>
    buildRedirectRule(DYNAMIC_RULE_ID_START + i, domain)
  );

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules,
  });
}

function buildRedirectRule(id, domain) {
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html" },
    },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: ["main_frame"],
    },
  };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG_REPORT_USAGE) {
    handleUsageReport(msg.seconds).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === MSG_GET_STATE) {
    getStateForPopup().then(sendResponse);
    return true;
  }

  if (msg.type === MSG_SETTINGS_CHANGED) {
    evaluateAndApply().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === MSG_REGISTER_DOMAIN) {
    registerUserDomain(msg.domain).then(sendResponse);
    return true;
  }
});

async function handleUsageReport(seconds) {
  if (!seconds || seconds <= 0) return;

  const { dailyUsage } = await chrome.storage.local.get("dailyUsage");
  const updated = {
    ...dailyUsage,
    totalSeconds: dailyUsage.totalSeconds + seconds,
    sessionSeconds: dailyUsage.sessionSeconds + seconds,
  };
  await chrome.storage.local.set({ dailyUsage: updated });

  // Re-evaluate immediately — may have just crossed the daily limit
  await evaluateAndApply();
}

async function getStateForPopup() {
  const data = await chrome.storage.local.get([
    "blockState",
    "dailyUsage",
    "settings",
    "settingCommitTimestamps",
  ]);
  return data;
}

async function registerUserDomain(domain) {
  const scriptId = `cs_${domain.replace(/\./g, "_")}`;

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    if (existing.some((s) => s.id === scriptId)) return { ok: true };

    await chrome.scripting.registerContentScripts([
      {
        id: scriptId,
        matches: [`*://*.${domain}/*`, `*://${domain}/*`],
        js: ["content_script.js"],
        runAt: "document_start",
        allFrames: false,
      },
    ]);
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  await evaluateAndApply();
  return { ok: true };
}
