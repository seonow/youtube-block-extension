const COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Cached state from last renderAll — used by the 1s interval for smooth counters
let cachedBlockState  = { isBlocked: false, blockedBy: [] };
let cachedSettings    = {};
let cachedTimestamps  = {};
let lastStorageSession = 0;
let lastStorageTotal   = 0;
let localSessionExtra  = 0;
let localTotalExtra    = 0;

function fmt(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${sec}초`;
  return `${sec}초`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

async function renderAll() {
  const data = await chrome.storage.local.get([
    "blockState",
    "dailyUsage",
    "settings",
    "settingCommitTimestamps",
  ]);

  const blockState  = data.blockState  || { isBlocked: false, blockedBy: [] };
  const dailyUsage  = data.dailyUsage  || { totalSeconds: 0, sessionSeconds: 0 };
  const settings    = data.settings    || {};
  const timestamps  = data.settingCommitTimestamps || {};

  // Sync local extras when storage updates
  lastStorageSession = dailyUsage.sessionSeconds || 0;
  lastStorageTotal   = dailyUsage.totalSeconds   || 0;
  localSessionExtra  = 0;
  localTotalExtra    = 0;
  cachedBlockState   = blockState;
  cachedSettings     = settings;
  cachedTimestamps   = timestamps;

  applyRender(blockState, dailyUsage, settings, timestamps);
}

function applyRender(blockState, dailyUsage, settings, timestamps) {
  const isBlocked   = blockState.isBlocked;
  const isEnabled   = settings.enabled !== false;

  // Status badge
  const badge = document.getElementById("status-badge");
  if (!isEnabled) {
    badge.textContent = "비활성";
    badge.className = "status-badge disabled";
  } else if (isBlocked) {
    badge.textContent = "차단됨";
    badge.className = "status-badge blocked";
  } else {
    badge.textContent = "활성";
    badge.className = "status-badge active";
  }

  // Usage counters
  const totalSec   = lastStorageTotal + localTotalExtra;
  const sessionSec = lastStorageSession + localSessionExtra;
  const limitSec   = settings.dailyLimitEnabled ? (settings.dailyLimitSeconds || 0) : null;
  const remaining  = limitSec != null ? Math.max(0, limitSec - totalSec) : null;

  document.getElementById("daily-total").textContent  = fmt(totalSec);
  document.getElementById("session-time").textContent = fmt(sessionSec);

  const limitEl = document.getElementById("daily-limit");
  if (limitSec != null) {
    limitEl.textContent = fmt(limitSec);
  } else {
    limitEl.textContent = "설정 안 됨";
  }

  const remainEl = document.getElementById("remaining");
  if (remaining != null) {
    remainEl.textContent = fmt(remaining);
    const pct = clamp((totalSec / limitSec) * 100, 0, 100);
    const fill = document.getElementById("progress-fill");
    fill.style.width = `${pct}%`;
    if (pct >= 100) {
      remainEl.className = "stat-value danger";
      fill.className = "progress-fill danger";
    } else if (pct >= 75) {
      remainEl.className = "stat-value warn";
      fill.className = "progress-fill warn";
    } else {
      remainEl.className = "stat-value";
      fill.className = "progress-fill";
    }
  } else {
    remainEl.textContent = "—";
    document.getElementById("progress-fill").style.width = "0%";
  }

  // Block reason
  const reasonEl = document.getElementById("block-reason");
  if (isBlocked && blockState.blockedBy?.length) {
    const labels = { timeWindow: "시간대 차단", dailyLimit: "한도 초과" };
    reasonEl.textContent = blockState.blockedBy.map((r) => labels[r] || r).join(" + ");
    reasonEl.style.display = "";
  } else {
    reasonEl.style.display = "none";
  }

  // Settings lock info
  const lockEl = document.getElementById("lock-info");
  const now = Date.now();
  const lockedEntries = Object.entries(timestamps)
    .filter(([, ts]) => ts > 0 && ts + COOLDOWN_MS > now);

  if (isBlocked) {
    lockEl.textContent = "차단 중 — 설정 변경 불가";
  } else if (lockedEntries.length > 0) {
    const latest = Math.max(...lockedEntries.map(([, ts]) => ts));
    const unlockAt = new Date(latest + COOLDOWN_MS);
    lockEl.textContent = `잠금 해제: ${unlockAt.toLocaleString("ko")}`;
  } else {
    lockEl.textContent = "설정 변경 가능";
  }
}

// Real-time: update local counters every second — only when on a blocked domain
setInterval(async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || "";
  const domains = cachedSettings.blockedDomains || ["youtube.com", "youtu.be"];
  const onBlockedSite = domains.some((d) => url.includes(d));

  if (onBlockedSite && !cachedBlockState.isBlocked) {
    localSessionExtra += 1;
    localTotalExtra   += 1;
  }
  applyRender(cachedBlockState, {}, cachedSettings, cachedTimestamps);
}, 1000);

// Full re-render whenever storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") renderAll();
});

// Initial load
renderAll();

document.getElementById("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
