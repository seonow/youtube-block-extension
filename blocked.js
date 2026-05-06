async function render() {
  let blockState, settings;
  try {
    const data = await chrome.storage.local.get(["blockState", "settings"]);
    blockState = data.blockState;
    settings   = data.settings;
  } catch {
    return;
  }

  if (!blockState?.isBlocked) {
    goBack();
    return;
  }

  applyBlockCopy(blockState.blockedBy || []);

  updateCountdown(blockState, settings);
}

function applyBlockCopy(blockedBy) {
  const titleEl = document.getElementById("block-title");
  const footerEl = document.getElementById("block-footer");
  if (!titleEl || !footerEl) return;

  const hasDaily = blockedBy.includes("dailyLimit");
  const hasWindow = blockedBy.includes("timeWindow");

  if (hasDaily && !hasWindow) {
    titleEl.textContent = "오늘 한도를 모두 사용했습니다.";
    footerEl.textContent = "영상은 내일 다시 확인하세요.";
  } else if (hasWindow && !hasDaily) {
    titleEl.textContent = "지금은 차단 시간대입니다.";
    footerEl.textContent = "차단 시간이 끝나면 다시 이용할 수 있습니다.";
  } else if (hasDaily && hasWindow) {
    titleEl.textContent = "오늘 한도를 모두 사용했거나, 차단 시간대입니다.";
    footerEl.textContent = "조건이 풀리면 다시 이용할 수 있습니다.";
  } else {
    titleEl.textContent = "이 사이트는 현재 차단되어 있습니다.";
    footerEl.textContent = "차단이 해제되면 다시 이용할 수 있습니다.";
  }
}

function updateCountdown(blockState, settings) {
  const el = document.getElementById("unblock-countdown");
  if (!el) return;

  // If blocked only by dailyLimit, show reset time
  const blockedBy = blockState.blockedBy || [];
  if (blockedBy.length === 1 && blockedBy[0] === "dailyLimit") {
    const resetHour = settings?.resetHour ?? 0;
    const now = new Date();
    const resetToday = new Date(now);
    resetToday.setHours(resetHour, 0, 0, 0);
    if (resetToday <= now) resetToday.setDate(resetToday.getDate() + 1);
    el.textContent = `해제 시각: ${resetToday.toLocaleTimeString("ko", { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    el.textContent = "";
  }
}

function goBack() {
  if (history.length > 1) {
    history.back();
  } else {
    // No history — navigate to browser new tab
    window.location.href = "about:newtab";
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.blockState) {
    const newState = changes.blockState.newValue;
    if (!newState?.isBlocked) {
      goBack();
    } else {
      render();
    }
  }
});

render();
