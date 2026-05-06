const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_KEYS = [
  "blockedDomains", "triggerMode", "timeWindows",
  "dailyLimitEnabled", "dailyLimitSeconds", "resetHour", "enabled",
];
const DEFAULT_DOMAINS = ["youtube.com", "youtu.be"];
const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MSG_SETTINGS_CHANGED = "SETTINGS_CHANGED";
const MSG_REGISTER_DOMAIN  = "REGISTER_DOMAIN";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentSettings = null;
let currentTimestamps = {};
let currentBlockState = { isBlocked: false };
let pendingTimeWindows = []; // local edit buffer
let pendingDomains     = []; // local edit buffer

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  const params = new URLSearchParams(location.search);
  const isOnboarding = params.get("onboarding") === "true";

  const data = await chrome.storage.local.get([
    "settings", "settingCommitTimestamps", "blockState", "onboarding",
  ]);

  currentSettings   = data.settings   || getDefaultSettings();
  currentTimestamps = data.settingCommitTimestamps || {};
  currentBlockState = data.blockState || { isBlocked: false };

  const onboarding = data.onboarding || { completed: false };

  if (isOnboarding && !onboarding.completed) {
    showOnboarding();
  }

  pendingTimeWindows = JSON.parse(JSON.stringify(currentSettings.timeWindows || []));
  pendingDomains     = [...(currentSettings.blockedDomains || DEFAULT_DOMAINS)];

  renderAll();
  bindEvents();

  // Live update if another tab changes storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.blockState) {
      currentBlockState = changes.blockState.newValue || { isBlocked: false };
      applyLockState();
    }
    if (changes.settingCommitTimestamps) {
      currentTimestamps = changes.settingCommitTimestamps.newValue || {};
      applyLockState();
    }
  });
}

function getDefaultSettings() {
  return {
    blockedDomains: [...DEFAULT_DOMAINS],
    triggerMode: "OR",
    timeWindows: [],
    dailyLimitEnabled: false,
    dailyLimitSeconds: 3600,
    resetHour: 0,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll() {
  const s = currentSettings;

  document.getElementById("toggle-enabled").checked = s.enabled !== false;

  renderDomainList();
  renderTimeWindows();

  document.getElementById("limit-enabled").checked = !!s.dailyLimitEnabled;
  document.getElementById("limit-input-row").style.display =
    s.dailyLimitEnabled ? "" : "none";

  const totalSec = s.dailyLimitSeconds || 3600;
  document.getElementById("limit-hours").value   = Math.floor(totalSec / 3600);
  document.getElementById("limit-minutes").value = Math.floor((totalSec % 3600) / 60);

  const triggerMode = s.triggerMode || "OR";
  document.getElementById("mode-or").checked  = triggerMode === "OR";
  document.getElementById("mode-and").checked = triggerMode === "AND";

  applyLockState();
}

function renderDomainList() {
  const list = document.getElementById("domain-list");
  list.innerHTML = "";

  for (const domain of pendingDomains) {
    const isDefault = DEFAULT_DOMAINS.includes(domain);
    const item = document.createElement("div");
    item.className = "domain-item" + (isDefault ? " default" : "");

    const nameEl = document.createElement("span");
    nameEl.className = "domain-name";
    nameEl.textContent = domain;
    item.appendChild(nameEl);

    if (isDefault) {
      const tag = document.createElement("span");
      tag.className = "default-tag";
      tag.textContent = "기본";
      item.appendChild(tag);
    } else {
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-remove";
      removeBtn.title = "삭제";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => removeDomain(domain));
      item.appendChild(removeBtn);
    }

    list.appendChild(item);
  }
}

function renderTimeWindows() {
  const list = document.getElementById("tw-list");
  list.innerHTML = "";

  for (const tw of pendingTimeWindows) {
    list.appendChild(buildTWElement(tw));
  }
}

function buildTWElement(tw) {
  const item = document.createElement("div");
  item.className = "tw-item";
  item.dataset.twId = tw.id;

  // Day chips
  const daysRow = document.createElement("div");
  daysRow.className = "tw-days";
  for (let d = 0; d < 7; d++) {
    const chip = document.createElement("span");
    chip.className = "day-chip" + (tw.days.includes(d) ? " selected" : "");
    chip.textContent = DAY_LABELS[d];
    chip.dataset.day = d;
    chip.addEventListener("click", () => {
      if (chip.getAttribute("aria-disabled") === "true") return;
      toggleTWDay(tw.id, d);
    });
    daysRow.appendChild(chip);
  }
  item.appendChild(daysRow);

  // Time inputs
  const timesRow = document.createElement("div");
  timesRow.className = "tw-times";

  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.value = `${String(tw.startHH).padStart(2,"0")}:${String(tw.startMM).padStart(2,"0")}`;
  startInput.addEventListener("change", (e) => updateTWTime(tw.id, "start", e.target.value));
  timesRow.appendChild(startInput);

  const sep = document.createElement("span");
  sep.textContent = "~";
  timesRow.appendChild(sep);

  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.value = `${String(tw.endHH).padStart(2,"0")}:${String(tw.endMM).padStart(2,"0")}`;
  endInput.addEventListener("change", (e) => updateTWTime(tw.id, "end", e.target.value));
  timesRow.appendChild(endInput);

  const midnight = tw.endHH * 60 + tw.endMM < tw.startHH * 60 + tw.startMM;
  if (midnight) {
    const note = document.createElement("span");
    note.style.fontSize = "11px";
    note.style.color = "#888";
    note.textContent = "(자정 넘김)";
    timesRow.appendChild(note);
  }

  item.appendChild(timesRow);

  // Remove button
  const footer = document.createElement("div");
  footer.className = "tw-footer";
  const removeBtn = document.createElement("button");
  removeBtn.className = "btn btn-danger";
  removeBtn.style.fontSize = "11px";
  removeBtn.style.padding = "3px 10px";
  removeBtn.textContent = "삭제";
  removeBtn.addEventListener("click", () => removeTW(tw.id));
  footer.appendChild(removeBtn);
  item.appendChild(footer);

  return item;
}

// ---------------------------------------------------------------------------
// Lock state
// ---------------------------------------------------------------------------

function applyLockState() {
  const isBlocked = currentBlockState?.isBlocked;
  const banner = document.getElementById("lock-banner");

  if (isBlocked) {
    banner.textContent = "🔒 차단이 활성화된 동안 설정을 변경할 수 없습니다.";
    banner.classList.add("visible");
    setAllInputsDisabled(true);
    return;
  }

  banner.classList.remove("visible");

  const now = Date.now();
  for (const key of COOLDOWN_KEYS) {
    const ts = currentTimestamps[key] || 0;
    const lockedUntil = ts + COOLDOWN_MS;
    const locked = lockedUntil > now;
    setKeyLocked(key, locked, locked ? lockedUntil : null);
  }
}

function setAllInputsDisabled(disabled) {
  document.querySelectorAll("input, select, button.btn, button.btn-remove, .day-chip").forEach((el) => {
    if (el.id === "onboarding-activate") return;
    if (disabled) {
      el.disabled = true;
      if (el.classList.contains("day-chip")) el.setAttribute("aria-disabled", "true");
    } else {
      el.disabled = false;
      if (el.classList.contains("day-chip")) el.removeAttribute("aria-disabled");
    }
  });
}

function getLockHintContainer(el) {
  return (
    el.closest(".field-row") ||
    el.closest(".toggle-row") ||
    el.closest(".add-row") ||
    el.closest(".radio-group")
  );
}

function setDisabledOnElement(el, locked) {
  if (el.matches("input, select, textarea, button")) {
    el.disabled = locked;
  } else {
    el.querySelectorAll("input, select, textarea, button").forEach((c) => {
      c.disabled = locked;
    });
  }
  if (el.classList.contains("day-chip")) {
    if (locked) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
  }
  el.querySelectorAll(".day-chip").forEach((chip) => {
    if (locked) chip.setAttribute("aria-disabled", "true");
    else chip.removeAttribute("aria-disabled");
  });
}

function setKeyLocked(key, locked, unlockAt) {
  document.querySelectorAll(`.lock-hint[data-lock-for="${key}"]`).forEach((h) => h.remove());

  const els = document.querySelectorAll(`[data-setting-key="${key}"]`);
  els.forEach((el) => setDisabledOnElement(el, locked));

  if (!locked || !unlockAt || els.length === 0) return;

  const hint = document.createElement("div");
  hint.className = "lock-hint";
  hint.dataset.lockFor = key;
  hint.textContent = `🔒 ${new Date(unlockAt).toLocaleString("ko")} 이후 수정 가능`;

  const anchor = getLockHintContainer(els[0]);
  if (anchor) {
    anchor.appendChild(hint);
  } else {
    els[els.length - 1].insertAdjacentElement("afterend", hint);
  }
}

// ---------------------------------------------------------------------------
// Domain mutations
// ---------------------------------------------------------------------------

function removeDomain(domain) {
  pendingDomains = pendingDomains.filter((d) => d !== domain);
  renderDomainList();
}

async function addDomain() {
  const input = document.getElementById("new-domain");
  const domain = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (!domain) return;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    showError("올바른 도메인 형식이 아닙니다. 예: netflix.com");
    return;
  }
  if (pendingDomains.includes(domain)) {
    showError("이미 목록에 있는 도메인입니다.");
    return;
  }

  // Request optional host permission
  const granted = await chrome.permissions.request({
    origins: [`*://*.${domain}/*`, `*://${domain}/*`],
  });

  if (!granted) {
    showError("권한이 허용되지 않았습니다. 도메인을 추가하려면 권한 승인이 필요합니다.");
    return;
  }

  pendingDomains.push(domain);
  input.value = "";
  renderDomainList();

  // Register content script in SW immediately
  chrome.runtime.sendMessage({ type: MSG_REGISTER_DOMAIN, domain }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Time window mutations
// ---------------------------------------------------------------------------

function addTimeWindow() {
  const id = `tw_${Date.now()}`;
  pendingTimeWindows.push({
    id,
    days: [1, 2, 3, 4, 5],
    startHH: 22, startMM: 0,
    endHH: 7,    endMM: 0,
  });
  renderTimeWindows();
}

function removeTW(id) {
  pendingTimeWindows = pendingTimeWindows.filter((tw) => tw.id !== id);
  renderTimeWindows();
}

function toggleTWDay(id, day) {
  const tw = pendingTimeWindows.find((t) => t.id === id);
  if (!tw) return;
  if (tw.days.includes(day)) {
    tw.days = tw.days.filter((d) => d !== day);
  } else {
    tw.days.push(day);
    tw.days.sort();
  }
  renderTimeWindows();
}

function updateTWTime(id, which, value) {
  const tw = pendingTimeWindows.find((t) => t.id === id);
  if (!tw) return;
  const [hh, mm] = value.split(":").map(Number);
  if (which === "start") { tw.startHH = hh; tw.startMM = mm; }
  else                   { tw.endHH   = hh; tw.endMM   = mm; }

  // Auto-add next day for midnight-spanning windows
  if (tw.endHH * 60 + tw.endMM < tw.startHH * 60 + tw.startMM) {
    for (const d of [...tw.days]) {
      const next = (d + 1) % 7;
      if (!tw.days.includes(next)) tw.days.push(next);
    }
    tw.days.sort();
  }

  renderTimeWindows();
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function saveSettings() {
  const isBlocked = currentBlockState?.isBlocked;
  if (isBlocked) {
    showError("차단이 활성화된 동안 설정을 변경할 수 없습니다.");
    return;
  }

  const newSettings = readFormFields();
  const now = Date.now();
  const errors = [];
  const newTimestamps = { ...currentTimestamps };

  // Per-key cooldown check
  for (const key of COOLDOWN_KEYS) {
    const oldVal = JSON.stringify(currentSettings[key]);
    const newVal = JSON.stringify(newSettings[key]);
    if (oldVal === newVal) continue; // unchanged

    const ts = currentTimestamps[key] || 0;
    const lockedUntil = ts + COOLDOWN_MS;
    if (lockedUntil > now) {
      errors.push(`"${key}" 항목은 ${new Date(lockedUntil).toLocaleString("ko")} 이후 수정 가능합니다.`);
    } else {
      newTimestamps[key] = now;
    }
  }

  if (errors.length > 0) {
    showError(errors.join("\n"));
    return;
  }

  await chrome.storage.local.set({
    settings: newSettings,
    settingCommitTimestamps: newTimestamps,
  });

  currentSettings   = newSettings;
  currentTimestamps = newTimestamps;

  chrome.runtime.sendMessage({ type: MSG_SETTINGS_CHANGED }).catch(() => {});
  showSuccess("설정이 저장되었습니다.");
  renderAll();
}

function readFormFields() {
  const enabled = document.getElementById("toggle-enabled").checked;
  const triggerMode = document.getElementById("mode-or").checked ? "OR" : "AND";
  const dailyLimitEnabled = document.getElementById("limit-enabled").checked;
  const hours   = parseInt(document.getElementById("limit-hours").value, 10)   || 0;
  const minutes = parseInt(document.getElementById("limit-minutes").value, 10) || 0;
  const dailyLimitSeconds = hours * 3600 + minutes * 60 || 3600;

  return {
    blockedDomains: [...pendingDomains],
    triggerMode,
    timeWindows: JSON.parse(JSON.stringify(pendingTimeWindows)),
    dailyLimitEnabled,
    dailyLimitSeconds,
    resetHour: currentSettings?.resetHour ?? 0,
    enabled,
  };
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function showOnboarding() {
  document.getElementById("onboarding-overlay").style.display = "";
}

async function activateOnboarding() {
  const agreed = document.getElementById("onboarding-agree").checked;
  if (!agreed) return;

  await chrome.storage.local.set({
    onboarding: { completed: true, agreedAt: Date.now() },
  });

  document.getElementById("onboarding-overlay").style.display = "none";
  showSuccess("도파민 멈춰!가 활성화되었습니다. 규칙을 설정하고 저장하세요.");
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById("btn-save").addEventListener("click", saveSettings);
  document.getElementById("btn-add-domain").addEventListener("click", addDomain);
  document.getElementById("new-domain").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDomain();
  });
  document.getElementById("btn-add-tw").addEventListener("click", addTimeWindow);

  document.getElementById("limit-enabled").addEventListener("change", (e) => {
    document.getElementById("limit-input-row").style.display = e.target.checked ? "" : "none";
  });

  document.getElementById("onboarding-agree").addEventListener("change", (e) => {
    document.getElementById("onboarding-activate").disabled = !e.target.checked;
  });
  document.getElementById("onboarding-activate").addEventListener("click", activateOnboarding);
}

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------

let successTimer = null;
let errorTimer   = null;

function showSuccess(msg) {
  const el = document.getElementById("msg-success");
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(successTimer);
  successTimer = setTimeout(() => el.classList.remove("visible"), 4000);

  document.getElementById("msg-error").classList.remove("visible");
}

function showError(msg) {
  const el = document.getElementById("msg-error");
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => el.classList.remove("visible"), 6000);

  document.getElementById("msg-success").classList.remove("visible");
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
