// Content script — self-contained (no ESM imports, content scripts can't use them)

const MSG_REPORT_USAGE = "REPORT_USAGE";
const MSG_GET_STATE    = "GET_STATE";
const FLUSH_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

let trackingTimer = null;
let pendingSeconds = 0;

function isVisible() {
  return document.visibilityState === "visible";
}

function startTracking() {
  if (trackingTimer !== null) return;
  trackingTimer = setInterval(() => {
    if (!isVisible()) return;
    pendingSeconds += FLUSH_INTERVAL_MS / 1000;
    flush();
  }, FLUSH_INTERVAL_MS);
}

function stopTracking() {
  if (trackingTimer !== null) {
    clearInterval(trackingTimer);
    trackingTimer = null;
  }
  flush(); // flush whatever accumulated
}

function flush() {
  if (pendingSeconds <= 0) return;
  const toSend = pendingSeconds;
  pendingSeconds = 0;
  chrome.runtime.sendMessage({ type: MSG_REPORT_USAGE, seconds: toSend }).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (isVisible()) {
    startTracking();
  } else {
    stopTracking();
  }
});

window.addEventListener("beforeunload", stopTracking);

// ---------------------------------------------------------------------------
// Overlay (palette matches options.css / blocked.html)
// ---------------------------------------------------------------------------

const BLOCK_THEME = {
  bg: "#F7F8F3",
  text: "#1F2937",
  muted: "#6B7280",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  accentDark: "#166534",
  shadow: "0 1px 3px rgba(0,0,0,0.06)",
};

let overlayEl = null;
let overlayActive = false;
let overlayBuilding = false;

const OVERLAY_TODO_ITEMS = [
  "물 한 잔 마시기",
  "작업 로그 3줄 작성하기",
  "10분 산책하기",
  "보고 싶은 영상은 메모장에 링크만 저장하기",
];

function getBlockCopy(blockedBy) {
  const hasDaily = blockedBy.includes("dailyLimit");
  const hasWindow = blockedBy.includes("timeWindow");

  if (hasDaily && !hasWindow) {
    return {
      title: "오늘 한도를 모두 사용했습니다.",
      footer: "영상은 내일 다시 확인하세요.",
    };
  }
  if (hasWindow && !hasDaily) {
    return {
      title: "지금은 차단 시간대입니다.",
      footer: "차단 시간이 끝나면 다시 이용할 수 있습니다.",
    };
  }
  if (hasDaily && hasWindow) {
    return {
      title: "오늘 한도를 모두 사용했거나, 차단 시간대입니다.",
      footer: "조건이 풀리면 다시 이용할 수 있습니다.",
    };
  }
  return {
    title: "이 사이트는 현재 차단되어 있습니다.",
    footer: "차단이 해제되면 다시 이용할 수 있습니다.",
  };
}

async function showOverlay(blockedBy) {
  if (overlayEl || overlayBuilding) return;
  overlayBuilding = true;

  try {
    overlayActive = true;

    const bb = blockedBy || [];
  const copy = getBlockCopy(bb);

  let countdownText = "";
  if (bb.length === 1 && bb[0] === "dailyLimit") {
    try {
      const data = await chrome.storage.local.get(["settings"]);
      const resetHour = data.settings?.resetHour ?? 0;
      const now = new Date();
      const resetToday = new Date(now);
      resetToday.setHours(resetHour, 0, 0, 0);
      if (resetToday <= now) resetToday.setDate(resetToday.getDate() + 1);
      countdownText = `해제 시각: ${resetToday.toLocaleTimeString("ko", { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      /* ignore */
    }
  }

  overlayEl = document.createElement("div");
  overlayEl.setAttribute("id", "focus-guard-overlay");

  const style = overlayEl.style;
  style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    `background:${BLOCK_THEME.bg}`,
    `color:${BLOCK_THEME.text}`,
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "text-align:center",
    "padding:2rem 1.5rem",
    "gap:1.25rem",
    "font-size:14px",
    "line-height:1.5",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
  ].join(";");

  const icon = document.createElement("div");
  icon.style.fontSize = "3.25rem";
  icon.style.lineHeight = "1";
  icon.textContent = "🚫";

  const heading = document.createElement("h1");
  heading.style.cssText =
    `font-size:1.5rem;font-weight:700;color:${BLOCK_THEME.text};margin:0;line-height:1.35;max-width:min(92vw,28rem);letter-spacing:-0.02em`;
  heading.textContent = copy.title;

  const todoWrap = document.createElement("div");
  todoWrap.style.cssText = [
    "text-align:left",
    "max-width:min(92vw,28rem)",
    "width:100%",
    `background:${BLOCK_THEME.surface}`,
    "border-radius:10px",
    "padding:1.15rem 1.25rem 1.15rem 1.5rem",
    `border:1px solid ${BLOCK_THEME.border}`,
    `box-shadow:${BLOCK_THEME.shadow}`,
    "box-sizing:border-box",
  ].join(";");

  const todoHeading = document.createElement("p");
  todoHeading.style.cssText =
    `font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BLOCK_THEME.muted};margin:0 0 0.65rem 0`;
  todoHeading.textContent = "지금 할 일:";

  const ol = document.createElement("ol");
  ol.style.cssText =
    `margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.45rem;font-size:13px;line-height:1.45;color:${BLOCK_THEME.text}`;

  for (const line of OVERLAY_TODO_ITEMS) {
    const li = document.createElement("li");
    li.textContent = line;
    ol.appendChild(li);
  }

  todoWrap.appendChild(todoHeading);
  todoWrap.appendChild(ol);

  const footer = document.createElement("p");
  footer.style.cssText =
    `font-size:1rem;font-weight:600;color:${BLOCK_THEME.accentDark};margin:0;line-height:1.45;max-width:min(92vw,28rem)`;
  footer.textContent = copy.footer;

  const countdown = document.createElement("p");
  countdown.style.cssText =
    `font-size:13px;color:${BLOCK_THEME.muted};margin:0;font-variant-numeric:tabular-nums`;
  countdown.textContent = countdownText;

  const hint = document.createElement("p");
  hint.style.cssText =
    `font-size:12px;color:${BLOCK_THEME.muted};max-width:min(92vw,28rem);line-height:1.6;margin:0;border-top:1px solid ${BLOCK_THEME.border};padding-top:1rem;margin-top:0.25rem;white-space:pre-line`;
  hint.textContent =
    "이 화면은 설계 의도에 따라 해제 버튼이 없습니다.\n차단 조건이 해제되면 자동으로 복구됩니다.";

  overlayEl.appendChild(icon);
  overlayEl.appendChild(heading);
  overlayEl.appendChild(todoWrap);
  overlayEl.appendChild(footer);
  if (countdownText) overlayEl.appendChild(countdown);
  overlayEl.appendChild(hint);

  document.documentElement.appendChild(overlayEl);
  document.body.style.overflow = "hidden";
  } catch {
    overlayActive = false;
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    document.body.style.overflow = "";
  } finally {
    overlayBuilding = false;
  }
}

function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  overlayActive = false;
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------------------
// Block state check
// ---------------------------------------------------------------------------

async function checkBlockState() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: MSG_GET_STATE });
  } catch {
    return;
  }

  const isBlocked = resp?.blockState?.isBlocked ?? false;

  if (isBlocked && !overlayActive) {
    stopTracking();
    await showOverlay(resp.blockState.blockedBy);
  } else if (!isBlocked && overlayActive) {
    removeOverlay();
    if (isVisible()) startTracking();
  }
}

// ---------------------------------------------------------------------------
// YouTube SPA navigation detection
// ---------------------------------------------------------------------------

let lastUrl = location.href;

function onUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    checkBlockState();
  }
}

// MutationObserver is the most reliable way to detect SPA navigation on YouTube
const navObserver = new MutationObserver(onUrlChange);

function attachNavObserver() {
  if (document.body) {
    navObserver.observe(document.body, { subtree: true, childList: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      navObserver.observe(document.body, { subtree: true, childList: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Storage change listener (real-time unblock/block)
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.blockState) return;

  const newState = changes.blockState.newValue;
  if (!newState) return;

  if (newState.isBlocked && !overlayActive) {
    stopTracking();
    void showOverlay(newState.blockedBy);
  } else if (!newState.isBlocked && overlayActive) {
    removeOverlay();
    if (isVisible()) startTracking();
  }
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

checkBlockState();
attachNavObserver();

if (isVisible()) {
  startTracking();
}
