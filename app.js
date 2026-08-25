const DAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];
const PERIODS = [
  { id: "morning", label: "早上", symbol: "☀" },
  { id: "noon", label: "中午", symbol: "◐" },
  { id: "afternoon", label: "下午", symbol: "◒" },
  { id: "evening", label: "晚上", symbol: "☾" },
];
const STORAGE_KEY = "zhaoshanghan-checkin-diary/v1";
const TOTAL_CELLS = DAY_NAMES.length * PERIODS.length;

const elements = {
  weekHead: document.querySelector("#week-head"),
  checkinBody: document.querySelector("#checkin-body"),
  weekRange: document.querySelector("#week-range"),
  completedCount: document.querySelector("#completed-count"),
  progressBar: document.querySelector("#progress-bar"),
  progressText: document.querySelector("#progress-text"),
  previousWeek: document.querySelector("#previous-week"),
  nextWeek: document.querySelector("#next-week"),
  currentWeek: document.querySelector("#current-week"),
  clearWeek: document.querySelector("#clear-week"),
  toast: document.querySelector("#toast"),
};

let displayedWeek = getMonday(new Date());
let toastTimer;

function atMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getMonday(date) {
  const value = atMidnight(date);
  const shift = value.getDay() === 0 ? -6 : 1 - value.getDay();
  value.setDate(value.getDate() + shift);
  return value;
}

function addDays(date, count) {
  const value = new Date(date);
  value.setDate(value.getDate() + count);
  return value;
}

function toKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRange(startDate) {
  const endDate = addDays(startDate, 6);
  const start = `${String(startDate.getMonth() + 1).padStart(2, "0")}.${String(startDate.getDate()).padStart(2, "0")}`;
  const end = `${String(endDate.getMonth() + 1).padStart(2, "0")}.${String(endDate.getDate()).padStart(2, "0")}`;
  return `${start} — ${end}`;
}

function isSameDay(left, right) {
  return toKey(left) === toKey(right);
}

function getAllEntries() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const entries = saved ? JSON.parse(saved) : {};
    return entries && typeof entries === "object" ? entries : {};
  } catch {
    return {};
  }
}

function saveAllEntries(entries) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    showToast("无法保存到此设备，请检查浏览器设置");
    return false;
  }
}

function getWeekEntries() {
  return getAllEntries()[toKey(displayedWeek)] || {};
}

function render() {
  const entries = getWeekEntries();
  const today = atMidnight(new Date());
  elements.weekRange.textContent = formatRange(displayedWeek);
  elements.currentWeek.setAttribute("aria-label", `回到本周；当前查看 ${formatRange(displayedWeek)}`);

  elements.weekHead.innerHTML = `
    <tr>
      <th scope="col" class="corner-cell">星期</th>
      ${DAY_NAMES.map((name, index) => {
        const date = addDays(displayedWeek, index);
        const todayClass = isSameDay(date, today) ? " is-today" : "";
        return `<th scope="col" class="weekday${todayClass}"><span class="weekday-name">${name}</span><span class="weekday-date">${date.getMonth() + 1}/${date.getDate()}</span></th>`;
      }).join("")}
    </tr>
  `;

  elements.checkinBody.innerHTML = PERIODS.map((period) => {
    const cells = DAY_NAMES.map((name, dayIndex) => {
      const date = addDays(displayedWeek, dayIndex);
      const cellKey = `${period.id}-${dayIndex}`;
      const checked = Boolean(entries[cellKey]);
      const state = checked ? " is-checked" : "";
      const action = checked ? "撤销打卡" : "打卡";
      const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日 星期${name}`;
      return `
        <td>
          <button
            class="checkin-cell${state}"
            type="button"
            data-period="${period.id}"
            data-cell-key="${cellKey}"
            aria-pressed="${checked}"
            aria-label="${dateLabel} ${period.label}${action}"
            title="${dateLabel} ${period.label}${action}"
          ><span class="check-mark" aria-hidden="true">✓</span></button>
        </td>`;
    }).join("");
    return `<tr><th scope="row" class="row-label" style="--period-color: var(--${period.id === "morning" ? "sunrise" : period.id})" data-symbol="${period.symbol}">${period.label}</th>${cells}</tr>`;
  }).join("");

  elements.checkinBody.querySelectorAll(".checkin-cell").forEach((cell) => {
    cell.addEventListener("click", toggleCell);
  });

  updateSummary(entries);
}

function updateSummary(entries) {
  const count = Object.values(entries).filter(Boolean).length;
  const percentage = Math.round((count / TOTAL_CELLS) * 100);
  elements.completedCount.textContent = String(count);
  elements.progressBar.style.width = `${percentage}%`;
  elements.progressText.textContent = `${percentage}%`;
}

function toggleCell(event) {
  const button = event.currentTarget;
  const cellKey = button.dataset.cellKey;
  const entries = getAllEntries();
  const weekKey = toKey(displayedWeek);
  const weekEntries = { ...(entries[weekKey] || {}) };
  const isChecked = Boolean(weekEntries[cellKey]);

  if (isChecked) {
    delete weekEntries[cellKey];
  } else {
    weekEntries[cellKey] = true;
  }

  entries[weekKey] = weekEntries;
  if (!saveAllEntries(entries)) return;

  button.classList.toggle("is-checked", !isChecked);
  button.setAttribute("aria-pressed", String(!isChecked));
  const oldLabel = button.getAttribute("aria-label") || "";
  const newAction = isChecked ? "打卡" : "撤销打卡";
  button.setAttribute("aria-label", oldLabel.replace(/(打卡|撤销打卡)$/, newAction));
  button.setAttribute("title", (button.getAttribute("title") || "").replace(/(打卡|撤销打卡)$/, newAction));
  updateSummary(weekEntries);
  showToast(isChecked ? "这枚印章已撤销" : "到岗印已盖好");
}

function shiftWeek(offset) {
  displayedWeek = addDays(displayedWeek, offset * 7);
  render();
}

function resetCurrentWeek() {
  const count = Object.values(getWeekEntries()).filter(Boolean).length;
  if (!count) {
    showToast("这一周还没有打卡记录");
    return;
  }

  if (!window.confirm(`确定清空 ${formatRange(displayedWeek)} 的 ${count} 枚打卡印吗？`)) return;
  const entries = getAllEntries();
  delete entries[toKey(displayedWeek)];
  if (!saveAllEntries(entries)) return;
  render();
  showToast("这一周已清空");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 1800);
}

elements.previousWeek.addEventListener("click", () => shiftWeek(-1));
elements.nextWeek.addEventListener("click", () => shiftWeek(1));
elements.currentWeek.addEventListener("click", () => {
  displayedWeek = getMonday(new Date());
  render();
  showToast("已回到本周");
});
elements.clearWeek.addEventListener("click", resetCurrentWeek);

render();
