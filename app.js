(() => {
  "use strict";

  const DAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];
  const PERIODS = [
    { id: "morning", label: "早上", symbol: "☀" },
    { id: "noon", label: "中午", symbol: "◐" },
    { id: "afternoon", label: "下午", symbol: "◒" },
    { id: "evening", label: "晚上", symbol: "☾" },
  ];
  const PERIOD_IDS = new Set(PERIODS.map((period) => period.id));
  const TOTAL_CELLS = DAY_NAMES.length * PERIODS.length;
  const STORAGE_KEY = "zhaoshanghan-checkin-diary/v3";
  const LEGACY_STORAGE_KEY = "zhaoshanghan-checkin-diary/v1";
  const AUTH_STORAGE_KEY = "zhaoshanghan-checkin-diary/github-auth-v1";
  const CELL_KEY_PATTERN = /^(\d{4}-\d{2}-\d{2})\/(morning|noon|afternoon|evening)$/;
  const GITHUB_API_VERSION = "2026-03-10";
  const configuredSync = window.CHECKIN_SYNC_CONFIG || {};
  const syncConfig = {
    owner: configuredSync.owner || "",
    repository: configuredSync.repository || "",
    repositoryId: String(configuredSync.repositoryId || ""),
    branch: configuredSync.branch || "main",
    path: configuredSync.path || "data/checkins.json",
  };

  const elements = {
    weekHead: document.querySelector("#week-head"),
    checkinBody: document.querySelector("#checkin-body"),
    periodLabel: document.querySelector("#period-label"),
    periodHint: document.querySelector("#period-hint"),
    previousPeriod: document.querySelector("#previous-period"),
    nextPeriod: document.querySelector("#next-period"),
    currentPeriod: document.querySelector("#current-period"),
    completedCount: document.querySelector("#completed-count"),
    progressBar: document.querySelector("#progress-bar"),
    progressText: document.querySelector("#progress-text"),
    clearWeek: document.querySelector("#clear-week"),
    toast: document.querySelector("#toast"),
    tabs: [...document.querySelectorAll(".view-tab")],
    weekView: document.querySelector("#week-view"),
    monthView: document.querySelector("#month-view"),
    yearView: document.querySelector("#year-view"),
    monthCompletedCount: document.querySelector("#month-completed-count"),
    monthDaysCount: document.querySelector("#month-days-count"),
    monthGrid: document.querySelector("#month-grid"),
    yearCompletedCount: document.querySelector("#year-completed-count"),
    yearDaysCount: document.querySelector("#year-days-count"),
    yearGrid: document.querySelector("#year-grid"),
    syncChip: document.querySelector("#sync-chip"),
    syncChipText: document.querySelector("#sync-chip-text"),
    syncFooterText: document.querySelector("#sync-footer-text"),
    syncNow: document.querySelector("#sync-now"),
    connectGithub: document.querySelector("#connect-github"),
    githubDialog: document.querySelector("#github-dialog"),
    closeGithubDialog: document.querySelector("#close-github-dialog"),
    githubDialogCopy: document.querySelector("#github-dialog-copy"),
    githubToken: document.querySelector("#github-token"),
    cancelGithubConnect: document.querySelector("#cancel-github-connect"),
    confirmGithubConnect: document.querySelector("#confirm-github-connect"),
    githubDialogStatus: document.querySelector("#github-dialog-status"),
  };

  let toastTimer;
  const state = {
    activeDate: atMidnight(new Date()),
    view: "week",
    viewTransition: "",
    data: loadCheckinData(),
    auth: loadAuth(),
    syncStatus: "local",
    mutationVersion: 0,
    syncQueue: Promise.resolve(),
  };

  function atMidnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, count) {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    value.setDate(value.getDate() + count);
    return value;
  }

  function getMonday(date) {
    const value = atMidnight(date);
    const shift = value.getDay() === 0 ? -6 : 1 - value.getDay();
    return addDays(value, shift);
  }

  function toKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return toKey(date) === value ? date : null;
  }

  function toCellKey(date, periodId) {
    return `${toKey(date)}/${periodId}`;
  }

  function isSameDay(left, right) {
    return toKey(left) === toKey(right);
  }

  function formatRange(startDate) {
    const endDate = addDays(startDate, 6);
    const start = `${String(startDate.getMonth() + 1).padStart(2, "0")}.${String(startDate.getDate()).padStart(2, "0")}`;
    const end = `${String(endDate.getMonth() + 1).padStart(2, "0")}.${String(endDate.getDate()).padStart(2, "0")}`;
    return `${start} — ${end}`;
  }

  function formatDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function timestampValue(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function validTimestamp(value) {
    return timestampValue(value) ? value : new Date(0).toISOString();
  }

  function createEmptyData() {
    return { schemaVersion: 1, updatedAt: "", cells: {} };
  }

  function normaliseCell(value) {
    if (!isPlainObject(value) || typeof value.checked !== "boolean") return null;
    return { checked: value.checked, updatedAt: validTimestamp(value.updatedAt) };
  }

  function normaliseData(value) {
    const data = createEmptyData();
    if (!isPlainObject(value)) return data;

    data.updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
    if (!isPlainObject(value.cells)) return data;

    Object.entries(value.cells).forEach(([key, cell]) => {
      const match = CELL_KEY_PATTERN.exec(key);
      if (!match || !PERIOD_IDS.has(match[2]) || !dateFromKey(match[1])) return;
      const normalised = normaliseCell(cell);
      if (normalised) data.cells[key] = normalised;
    });
    return data;
  }

  function cloneData(data) {
    return {
      schemaVersion: 1,
      updatedAt: data.updatedAt || "",
      cells: Object.fromEntries(
        Object.entries(data.cells || {}).map(([key, cell]) => [key, { ...cell }]),
      ),
    };
  }

  function readStoredJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeStoredJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function migrateLegacyData() {
    const legacy = readStoredJson(LEGACY_STORAGE_KEY);
    if (!isPlainObject(legacy)) return null;

    const data = createEmptyData();
    const migratedAt = new Date().toISOString();

    Object.entries(legacy).forEach(([weekKey, weekEntries]) => {
      const weekStart = dateFromKey(weekKey);
      if (!weekStart || !isPlainObject(weekEntries)) return;

      Object.entries(weekEntries).forEach(([legacyCellKey, checked]) => {
        const match = /^(morning|noon|afternoon|evening)-(\d)$/.exec(legacyCellKey);
        if (!match || !checked || Number(match[2]) > 6) return;
        const date = addDays(weekStart, Number(match[2]));
        data.cells[toCellKey(date, match[1])] = { checked: true, updatedAt: migratedAt };
      });
    });

    if (Object.keys(data.cells).length) data.updatedAt = migratedAt;
    return data;
  }

  function loadCheckinData() {
    const current = readStoredJson(STORAGE_KEY);
    if (current) return normaliseData(current);

    const migrated = migrateLegacyData();
    if (migrated) {
      writeStoredJson(STORAGE_KEY, migrated);
      return migrated;
    }
    return createEmptyData();
  }

  function persistData() {
    if (writeStoredJson(STORAGE_KEY, state.data)) return true;
    showToast("无法保存到此设备，请检查浏览器设置");
    return false;
  }

  function loadAuth() {
    const auth = readStoredJson(AUTH_STORAGE_KEY);
    if (!isPlainObject(auth) || typeof auth.token !== "string" || !auth.token) return null;
    return {
      token: auth.token,
      login: typeof auth.login === "string" ? auth.login : "",
      connectedAt: typeof auth.connectedAt === "string" ? auth.connectedAt : "",
      expiresAt: typeof auth.expiresAt === "string" ? auth.expiresAt : "",
    };
  }

  function persistAuth() {
    if (state.auth) writeStoredJson(AUTH_STORAGE_KEY, state.auth);
  }

  function getCell(date, periodId) {
    return state.data.cells[toCellKey(date, periodId)] || null;
  }

  function isChecked(date, periodId) {
    return getCell(date, periodId)?.checked === true;
  }

  function checkedCount(startDate, endDate) {
    let count = 0;
    for (let date = atMidnight(startDate); date <= endDate; date = addDays(date, 1)) {
      PERIODS.forEach((period) => {
        if (isChecked(date, period.id)) count += 1;
      });
    }
    return count;
  }

  function checkedDaysCount(startDate, endDate) {
    let count = 0;
    for (let date = atMidnight(startDate); date <= endDate; date = addDays(date, 1)) {
      if (PERIODS.some((period) => isChecked(date, period.id))) count += 1;
    }
    return count;
  }

  function getWeekStart() {
    return getMonday(state.activeDate);
  }

  function getMonthBounds() {
    const year = state.activeDate.getFullYear();
    const month = state.activeDate.getMonth();
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month, daysInMonth(year, month)),
    };
  }

  function getYearBounds() {
    const year = state.activeDate.getFullYear();
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
  }

  function getToolbarCopy() {
    if (state.view === "month") {
      return {
        label: `${state.activeDate.getFullYear()} 年 ${state.activeDate.getMonth() + 1} 月`,
        hint: "点这里回到本月",
        previous: "查看上个月",
        next: "查看下个月",
        current: "回到本月",
      };
    }
    if (state.view === "year") {
      return {
        label: `${state.activeDate.getFullYear()} 年`,
        hint: "点这里回到今年",
        previous: "查看上一年",
        next: "查看下一年",
        current: "回到今年",
      };
    }
    return {
      label: formatRange(getWeekStart()),
      hint: "点这里回到本周",
      previous: "查看上一周",
      next: "查看下一周",
      current: "回到本周",
    };
  }

  function renderToolbar() {
    const copy = getToolbarCopy();
    elements.periodLabel.textContent = copy.label;
    elements.periodHint.textContent = copy.hint;
    elements.previousPeriod.setAttribute("aria-label", copy.previous);
    elements.nextPeriod.setAttribute("aria-label", copy.next);
    elements.currentPeriod.setAttribute("aria-label", copy.current);
  }

  function renderTabs() {
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    elements.weekView.hidden = state.view !== "week";
    elements.monthView.hidden = state.view !== "month";
    elements.yearView.hidden = state.view !== "year";
    elements.clearWeek.hidden = state.view !== "week";

    const activePanel = state.view === "week" ? elements.weekView : state.view === "month" ? elements.monthView : elements.yearView;
    activePanel.classList.remove("view-zoom-in", "view-zoom-out");
    if (state.viewTransition) {
      activePanel.classList.add(state.viewTransition);
      activePanel.addEventListener("animationend", () => {
        activePanel.classList.remove("view-zoom-in", "view-zoom-out");
      }, { once: true });
    }
  }

  function renderWeek() {
    const weekStart = getWeekStart();
    const today = atMidnight(new Date());
    const entriesCount = checkedCount(weekStart, addDays(weekStart, 6));
    const percentage = Math.round((entriesCount / TOTAL_CELLS) * 100);

    elements.weekHead.innerHTML = `
      <tr>
        <th scope="col" class="corner-cell">星期</th>
        ${DAY_NAMES.map((name, index) => {
          const date = addDays(weekStart, index);
          const todayClass = isSameDay(date, today) ? " is-today" : "";
          return `<th scope="col" class="weekday${todayClass}"><span class="weekday-name">${name}</span><span class="weekday-date">${date.getMonth() + 1}/${date.getDate()}</span></th>`;
        }).join("")}
      </tr>
    `;

    elements.checkinBody.innerHTML = PERIODS.map((period) => {
      const cells = DAY_NAMES.map((name, dayIndex) => {
        const date = addDays(weekStart, dayIndex);
        const checked = isChecked(date, period.id);
        const cellKey = toCellKey(date, period.id);
        const stateClass = checked ? " is-checked" : "";
        const action = checked ? "撤销打卡" : "打卡";
        const dateLabel = `${formatDate(date)} 星期${name}`;
        return `
          <td>
            <button class="checkin-cell${stateClass}" type="button" data-date="${toKey(date)}" data-period="${period.id}" data-cell-id="${cellKey}" aria-pressed="${checked}" aria-label="${dateLabel} ${period.label}${action}" title="${dateLabel} ${period.label}${action}">
              <span class="check-mark" aria-hidden="true"><span class="seal-surname">赵</span><span class="seal-caption">尚涵大王</span></span>
            </button>
          </td>`;
      }).join("");
      const colorName = period.id === "morning" ? "sunrise" : period.id;
      return `<tr><th scope="row" class="row-label" style="--period-color: var(--${colorName})" data-symbol="${period.symbol}">${period.label}</th>${cells}</tr>`;
    }).join("");

    elements.checkinBody.querySelectorAll(".checkin-cell").forEach((cell) => {
      cell.addEventListener("click", handleCellToggle);
    });
    elements.completedCount.textContent = String(entriesCount);
    elements.progressBar.style.width = `${percentage}%`;
    elements.progressText.textContent = `${percentage}%`;
  }

  function renderMonth() {
    const { start, end } = getMonthBounds();
    const firstOffset = (start.getDay() + 6) % 7;
    const totalSlots = Math.ceil((firstOffset + end.getDate()) / 7) * 7;
    const today = atMidnight(new Date());
    const completed = checkedCount(start, end);
    const days = checkedDaysCount(start, end);
    const cells = [];

    for (let slot = 0; slot < totalSlots; slot += 1) {
      const dayNumber = slot - firstOffset + 1;
      if (dayNumber < 1 || dayNumber > end.getDate()) {
        cells.push('<span class="month-blank" aria-hidden="true"></span>');
        continue;
      }
      const date = new Date(start.getFullYear(), start.getMonth(), dayNumber);
      const dayCount = PERIODS.filter((period) => isChecked(date, period.id)).length;
      const level = Math.min(dayCount, PERIODS.length);
      const classes = ["calendar-day", `has-${level}`];
      if (isSameDay(date, today)) classes.push("is-today");
      if (isSameDay(date, state.activeDate)) classes.push("is-selected");
      const seal = dayCount ? '<span class="calendar-day-seal" aria-hidden="true">赵</span>' : "";
      const count = dayCount ? `<span class="calendar-day-count">${dayCount}/4</span>` : "";
      cells.push(`<button class="${classes.join(" ")}" type="button" data-calendar-date="${toKey(date)}" aria-label="${formatDate(date)}，${dayCount} 枚打卡印；查看这一周"><span class="calendar-day-number">${dayNumber}</span>${seal}${count}</button>`);
    }

    elements.monthCompletedCount.textContent = String(completed);
    elements.monthDaysCount.textContent = String(days);
    elements.monthGrid.innerHTML = cells.join("");
    elements.monthGrid.querySelectorAll("[data-calendar-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const date = dateFromKey(cell.dataset.calendarDate);
        if (!date) return;
        state.activeDate = date;
        state.view = "week";
        render();
        showToast(`已打开 ${formatDate(date)} 所在周`);
      });
    });
  }

  function renderYear() {
    const { start, end } = getYearBounds();
    const year = start.getFullYear();
    const completed = checkedCount(start, end);
    const days = checkedDaysCount(start, end);

    elements.yearCompletedCount.textContent = String(completed);
    elements.yearDaysCount.textContent = String(days);
    elements.yearGrid.innerHTML = Array.from({ length: 12 }, (_, monthIndex) => {
      const monthStart = new Date(year, monthIndex, 1);
      const monthEnd = new Date(year, monthIndex, daysInMonth(year, monthIndex));
      const monthCount = checkedCount(monthStart, monthEnd);
      const monthDays = checkedDaysCount(monthStart, monthEnd);
      const classes = ["year-month-card"];
      if (monthCount) classes.push("has-checkins");
      if (state.activeDate.getMonth() === monthIndex) classes.push("is-selected");
      const dots = Array.from({ length: monthEnd.getDate() }, (_, dayOffset) => {
        const date = addDays(monthStart, dayOffset);
        const value = PERIODS.filter((period) => isChecked(date, period.id)).length;
        return `<span class="mini-day has-${value}" aria-hidden="true"></span>`;
      }).join("");
      return `<button class="${classes.join(" ")}" type="button" data-calendar-month="${monthIndex}" aria-label="${year}年${monthIndex + 1}月，${monthCount} 枚打卡印，${monthDays} 天有打卡；查看本月"><span class="year-month-heading"><b>${monthIndex + 1} 月</b><small>${monthCount ? `${monthCount} 印` : "未用印"}</small></span><span class="mini-calendar">${dots}</span></button>`;
    }).join("");

    elements.yearGrid.querySelectorAll("[data-calendar-month]").forEach((card) => {
      card.addEventListener("click", () => {
        state.activeDate = new Date(year, Number(card.dataset.calendarMonth), 1);
        state.view = "month";
        render();
      });
    });
  }

  function render() {
    renderToolbar();
    renderTabs();
    renderWeek();
    renderMonth();
    renderYear();
    updateSyncUi();
  }

  function setView(view) {
    if (!["week", "month", "year"].includes(view)) return;
    if (view === state.view) return;
    const viewOrder = ["week", "month", "year"];
    state.viewTransition = viewOrder.indexOf(view) > viewOrder.indexOf(state.view) ? "view-zoom-out" : "view-zoom-in";
    state.view = view;
    render();
    state.viewTransition = "";
  }

  function toggleCell(date, periodId) {
    const cellKey = toCellKey(date, periodId);
    const checked = isChecked(date, periodId);
    const now = new Date().toISOString();
    state.data.cells[cellKey] = { checked: !checked, updatedAt: now };
    state.data.updatedAt = now;
    state.mutationVersion += 1;
    if (!persistData()) return;

    render();
    showToast(checked ? "这枚印章已撤销" : "到岗印已盖好");
    queueSync(true);
  }

  function handleCellToggle(event) {
    const date = dateFromKey(event.currentTarget.dataset.date);
    const periodId = event.currentTarget.dataset.period;
    if (!date || !PERIOD_IDS.has(periodId)) return;
    toggleCell(date, periodId);
  }

  function resetCurrentWeek() {
    const today = atMidnight(new Date());
    if (state.view === "week") state.activeDate = today;
    if (state.view === "month") state.activeDate = new Date(today.getFullYear(), today.getMonth(), 1);
    if (state.view === "year") state.activeDate = new Date(today.getFullYear(), 0, 1);
    render();
    showToast(state.view === "week" ? "已回到本周" : state.view === "month" ? "已回到本月" : "已回到今年");
  }

  function shiftPeriod(direction) {
    if (state.view === "week") {
      state.activeDate = addDays(state.activeDate, direction * 7);
    } else if (state.view === "month") {
      state.activeDate = new Date(state.activeDate.getFullYear(), state.activeDate.getMonth() + direction, 1);
    } else {
      state.activeDate = new Date(state.activeDate.getFullYear() + direction, 0, 1);
    }
    render();
  }

  function clearVisibleWeek() {
    const weekStart = getWeekStart();
    const weekEnd = addDays(weekStart, 6);
    const count = checkedCount(weekStart, weekEnd);
    if (!count) {
      showToast("这一周还没有打卡记录");
      return;
    }
    if (!window.confirm(`确定清空 ${formatRange(weekStart)} 的 ${count} 枚打卡印吗？`)) return;

    const now = new Date().toISOString();
    for (let date = weekStart; date <= weekEnd; date = addDays(date, 1)) {
      PERIODS.forEach((period) => {
        if (isChecked(date, period.id)) {
          state.data.cells[toCellKey(date, period.id)] = { checked: false, updatedAt: now };
        }
      });
    }
    state.data.updatedAt = now;
    state.mutationVersion += 1;
    if (!persistData()) return;
    render();
    showToast("这一周已清空");
    queueSync(true);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2200);
  }

  function hasSyncConfiguration() {
    return Boolean(syncConfig.owner && syncConfig.repository && syncConfig.path);
  }

  function updateSyncUi() {
    const configured = hasSyncConfiguration();
    const connected = Boolean(state.auth?.token);
    let text = "本机草稿";
    let footer = "已自动保存在这台设备；连接 GitHub 后可跨设备同步。";
    let statusClass = "is-local";

    if (!configured) {
      footer = "已自动保存在这台设备；GitHub 公开同步正在准备中。";
    } else if (state.syncStatus === "reading") {
      text = "正在读取";
      footer = "正在读取 GitHub 公开仓库里的打卡记录。";
      statusClass = "is-syncing";
    } else if (state.syncStatus === "remote") {
      text = "已读取 GitHub";
      footer = "已读取 GitHub 公开仓库；连接 GitHub 后可以从这台设备继续打卡并上传。";
      statusClass = "is-synced";
    } else if (state.syncStatus === "syncing") {
      text = "正在同步";
      footer = "正在合并并保存到 GitHub 公开仓库。";
      statusClass = "is-syncing";
    } else if (state.syncStatus === "synced") {
      text = "GitHub 已同步";
      footer = "已同步到 GitHub 公开仓库；连接过的设备可查看同一份打卡记录。";
      statusClass = "is-synced";
    } else if (state.syncStatus === "error" || state.syncStatus === "needs-auth") {
      text = "待重新同步";
      footer = state.syncStatus === "needs-auth" ? "GitHub 令牌不可用；重新连接后会继续合并并保存。" : "无法连接 GitHub；打卡仍已保存在这台设备。";
      statusClass = "is-error";
    }

    elements.syncChip.className = `sync-chip ${statusClass}`;
    elements.syncChipText.textContent = text;
    elements.syncFooterText.textContent = footer;
    elements.syncNow.hidden = !configured || !connected;
    elements.connectGithub.textContent = connected ? "更换 GitHub 令牌" : "连接 GitHub";
    elements.connectGithub.disabled = false;
  }

  function mergeData(left, right) {
    const local = normaliseData(left);
    const remote = normaliseData(right);
    const merged = createEmptyData();
    const keys = new Set([...Object.keys(local.cells), ...Object.keys(remote.cells)]);

    keys.forEach((key) => {
      const localCell = local.cells[key];
      const remoteCell = remote.cells[key];
      if (!localCell) merged.cells[key] = remoteCell;
      else if (!remoteCell) merged.cells[key] = localCell;
      else merged.cells[key] = timestampValue(localCell.updatedAt) >= timestampValue(remoteCell.updatedAt) ? localCell : remoteCell;
    });

    const lastCellTime = Math.max(0, ...Object.values(merged.cells).map((cell) => timestampValue(cell.updatedAt)));
    const sourceTime = Math.max(timestampValue(local.updatedAt), timestampValue(remote.updatedAt));
    const finalTime = Math.max(lastCellTime, sourceTime);
    merged.updatedAt = finalTime ? new Date(finalTime).toISOString() : "";
    return merged;
  }

  function dataEqual(left, right) {
    const one = normaliseData(left);
    const two = normaliseData(right);
    const oneKeys = Object.keys(one.cells).sort();
    const twoKeys = Object.keys(two.cells).sort();
    if (oneKeys.length !== twoKeys.length) return false;
    for (let index = 0; index < oneKeys.length; index += 1) {
      const key = oneKeys[index];
      if (key !== twoKeys[index]) return false;
      const a = one.cells[key];
      const b = two.cells[key];
      if (a.checked !== b.checked || a.updatedAt !== b.updatedAt) return false;
    }
    return true;
  }

  function contentUrl() {
    const path = syncConfig.path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(syncConfig.owner)}/${encodeURIComponent(syncConfig.repository)}/contents/${path}`;
  }

  async function parseResponse(response) {
    const body = await response.text();
    try {
      return body ? JSON.parse(body) : {};
    } catch {
      return Object.fromEntries(new URLSearchParams(body));
    }
  }

  async function githubRequest(url, options = {}, token = state.auth?.token) {
    const { requireAuth, headers: requestHeaders, ...requestOptions } = options;
    if (requireAuth && !token) {
      const error = new Error("GitHub 尚未连接");
      error.status = 401;
      throw error;
    }
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(requestHeaders || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, {
      ...requestOptions,
      headers,
    });
    const body = await parseResponse(response);
    if (!response.ok) {
      const error = new Error(body.message || `GitHub 请求失败（${response.status}）`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function decodeBase64Json(content) {
    const binary = window.atob(String(content || "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function encodeBase64Json(data) {
    const bytes = new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return window.btoa(binary);
  }

  async function fetchRemoteData() {
    try {
      const payload = await githubRequest(`${contentUrl()}?ref=${encodeURIComponent(syncConfig.branch)}`);
      return { data: normaliseData(decodeBase64Json(payload.content)), sha: payload.sha || "" };
    } catch (error) {
      if (error.status === 404) return { data: createEmptyData(), sha: "" };
      throw error;
    }
  }

  async function writeRemoteData(data, sha) {
    if (!state.auth?.token) {
      const error = new Error("GitHub 尚未连接");
      error.status = 401;
      throw error;
    }
    const payload = {
      message: "同步赵尚涵大王的打卡日记",
      content: encodeBase64Json(data),
      branch: syncConfig.branch,
    };
    if (sha) payload.sha = sha;
    return githubRequest(contentUrl(), {
      method: "PUT",
      requireAuth: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function refreshPublicData({ announce = false } = {}) {
    if (!hasSyncConfiguration()) return;
    const versionAtStart = state.mutationVersion;
    state.syncStatus = "reading";
    updateSyncUi();
    try {
      const remote = await fetchRemoteData();
      const merged = mergeData(state.data, remote.data);
      state.data = state.mutationVersion === versionAtStart ? merged : mergeData(state.data, remote.data);
      persistData();
      state.syncStatus = state.auth?.token ? "local" : "remote";
      render();
      if (announce) showToast("已读取 GitHub 打卡记录");
    } catch {
      state.syncStatus = "error";
      updateSyncUi();
      if (announce) showToast("暂时无法读取 GitHub，记录仍在本机");
    }
  }

  async function syncWithGitHub({ announce = false } = {}) {
    if (!hasSyncConfiguration()) return;
    if (!state.auth?.token) {
      await refreshPublicData({ announce });
      return;
    }
    state.syncStatus = "syncing";
    updateSyncUi();
    const versionAtStart = state.mutationVersion;

    try {
      let lastError;
      let merged;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const remote = await fetchRemoteData();
          const snapshot = cloneData(state.data);
          merged = mergeData(snapshot, remote.data);
          if (!dataEqual(merged, remote.data)) await writeRemoteData(merged, remote.sha);
          break;
        } catch (error) {
          lastError = error;
          if (error.status !== 409 || attempt === 1) throw error;
        }
      }
      if (!merged && lastError) throw lastError;

      if (state.mutationVersion !== versionAtStart) {
        state.data = mergeData(state.data, merged);
        persistData();
        state.syncStatus = "syncing";
        updateSyncUi();
        queueSync(false);
        return;
      }

      state.data = merged;
      persistData();
      state.syncStatus = "synced";
      render();
      if (announce) showToast("已保存到 GitHub");
    } catch (error) {
      state.syncStatus = error.status === 401 || error.status === 403 ? "needs-auth" : "error";
      updateSyncUi();
      if (announce || state.syncStatus === "needs-auth") {
        showToast(state.syncStatus === "needs-auth" ? "GitHub 令牌不可用，请重新连接" : "暂时无法同步，记录仍在本机");
      }
    }
  }

  function queueSync(announce) {
    if (!hasSyncConfiguration()) return;
    if (!state.auth?.token) {
      state.syncStatus = "local";
      updateSyncUi();
      if (announce) showToast("已保存到这台设备；连接 GitHub 后即可上传");
      return;
    }
    state.syncQueue = state.syncQueue
      .then(() => syncWithGitHub({ announce }))
      .catch(() => undefined);
  }

  function beginGitHubConnection() {
    if (!hasSyncConfiguration()) {
      showToast("GitHub 同步正在配置中，请稍后刷新页面");
      return;
    }
    elements.githubDialogCopy.textContent = "创建一枚只准进入这一个公开仓库的细粒度令牌，再把它交给这台设备。";
    elements.githubToken.value = "";
    elements.githubDialogStatus.textContent = "令牌只保存在这台设备，不会写进公开仓库。";
    if (!elements.githubDialog.open) elements.githubDialog.showModal();
    elements.githubToken.focus();
  }

  async function connectWithGitHubToken() {
    const token = elements.githubToken.value.trim();
    if (token.length < 20) {
      elements.githubDialogStatus.textContent = "请粘贴完整的细粒度 GitHub 令牌。";
      return;
    }
    const previousAuth = state.auth;
    state.auth = { token, login: "", connectedAt: new Date().toISOString(), expiresAt: "" };
    elements.confirmGithubConnect.disabled = true;
    elements.githubDialogStatus.textContent = "正在验证令牌…";
    try {
      const profile = await githubRequest("https://api.github.com/user", {}, token);
      state.auth.login = profile.login || "";
      persistAuth();
      elements.githubToken.value = "";
      if (elements.githubDialog.open) elements.githubDialog.close();
      state.syncStatus = "local";
      updateSyncUi();
      showToast("GitHub 已连接，正在合并打卡记录");
      queueSync(true);
    } catch (error) {
      state.auth = previousAuth;
      elements.githubDialogStatus.textContent = error.status === 401 ? "GitHub 不接受这枚令牌，请检查后重试。" : "暂时无法验证令牌，请检查网络后重试。";
    } finally {
      elements.confirmGithubConnect.disabled = false;
    }
  }

  function closeGitHubDialog() {
    elements.githubToken.value = "";
    if (elements.githubDialog.open) elements.githubDialog.close();
  }

  function handleTabKeyboard(event) {
    const currentIndex = elements.tabs.indexOf(event.currentTarget);
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % elements.tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + elements.tabs.length) % elements.tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = elements.tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = elements.tabs[nextIndex];
    next.focus();
    setView(next.dataset.view);
  }

  elements.previousPeriod.addEventListener("click", () => shiftPeriod(-1));
  elements.nextPeriod.addEventListener("click", () => shiftPeriod(1));
  elements.currentPeriod.addEventListener("click", resetCurrentWeek);
  elements.clearWeek.addEventListener("click", clearVisibleWeek);
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
    tab.addEventListener("keydown", handleTabKeyboard);
  });
  elements.syncNow.addEventListener("click", () => queueSync(true));
  elements.connectGithub.addEventListener("click", beginGitHubConnection);
  elements.closeGithubDialog.addEventListener("click", closeGitHubDialog);
  elements.cancelGithubConnect.addEventListener("click", closeGitHubDialog);
  elements.confirmGithubConnect.addEventListener("click", connectWithGitHubToken);
  elements.githubToken.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectWithGitHubToken();
  });
  elements.githubDialog.addEventListener("cancel", () => { elements.githubToken.value = ""; });

  render();
  if (hasSyncConfiguration()) {
    if (state.auth?.token) queueSync(false);
    else void refreshPublicData();
  }
})();
