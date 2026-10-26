(() => {
  "use strict";

  const STORAGE_KEY = "zhaoshanghan-checkin-diary/ledger-v1";
  const MEALS = ["b", "l", "d"];
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  const weekHead = document.querySelector("#week-head");
  const checkinBody = document.querySelector("#checkin-body");
  const dialog = document.querySelector("#ledger-dialog");
  const inputs = [...dialog.querySelectorAll("input[data-meal]")];
  const dayTotalEl = document.querySelector("#ledger-day-total");
  const monthTotalEl = document.querySelector("#ledger-month-total");
  const yearTotalEl = document.querySelector("#ledger-year-total");

  let data = load();
  let activeKey = "";

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: keep in memory */
    }
  }

  const round = (n) => Math.round(n * 100) / 100;
  const amount = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const daySum = (entry) => round(MEALS.reduce((sum, meal) => sum + amount(entry && entry[meal]), 0));
  const sumPrefix = (prefix) =>
    round(Object.keys(data).reduce((sum, key) => (key.startsWith(prefix) ? sum + daySum(data[key]) : sum), 0));

  function renderTotals() {
    const [year, month] = activeKey.split("-");
    document.querySelector("#ledger-month-kicker").textContent = `${Number(month)}月合计`;
    document.querySelector("#ledger-year-kicker").textContent = `${year}年合计`;
    dayTotalEl.textContent = daySum(data[activeKey]);
    monthTotalEl.textContent = sumPrefix(`${year}-${month}-`);
    yearTotalEl.textContent = sumPrefix(`${year}-`);
  }

  const ledgerFoot = document.querySelector("#ledger-foot");

  function formatMoney(n) {
    return n ? String(n) : "";
  }

  // Shows each visible day's spending under the check-in table, plus week / month / year totals.
  function renderSummary() {
    const dates = [...checkinBody.querySelectorAll("tr:first-child [data-date]")].map((b) => b.dataset.date);
    if (dates.length !== 7) return;
    const sums = dates.map((key) => daySum(data[key]));
    ledgerFoot.innerHTML = `<tr><th scope="row" class="ledger-foot-label">花费</th>${sums
      .map((n) => `<td class="ledger-foot-cell">${formatMoney(n)}</td>`)
      .join("")}</tr>`;
    // The week belongs to the month/year of its Thursday (ISO rule), so a split week has one clear answer.
    const [y, m] = dates[3].split("-");
    document.querySelector("#strip-week").textContent = round(sums.reduce((a, b) => a + b, 0));
    document.querySelector("#strip-month-label").textContent = `${Number(m)}月花费`;
    document.querySelector("#strip-year-label").textContent = `${y}年花费`;
    document.querySelector("#strip-month").textContent = sumPrefix(`${y}-${m}-`);
    document.querySelector("#strip-year").textContent = sumPrefix(`${y}-`);
  }

  new MutationObserver(renderSummary).observe(checkinBody, { childList: true });
  renderSummary();

  const monthGrid = document.querySelector("#month-grid");
  const yearGrid = document.querySelector("#year-grid");
  const setText = (selector, value) => {
    document.querySelector(selector).textContent = value;
  };
  const spendDays = (prefix) =>
    Object.keys(data).filter((key) => key.startsWith(prefix) && daySum(data[key]) > 0).length;

  function renderMonthSpend() {
    const cells = [...monthGrid.querySelectorAll("[data-calendar-date]")];
    if (!cells.length) return;
    cells.forEach((cell) => {
      const total = daySum(data[cell.dataset.calendarDate]);
      cell.querySelector(".calendar-day-spend")?.remove();
      if (total) cell.insertAdjacentHTML("beforeend", `<span class="calendar-day-spend">${total}</span>`);
    });
    const [y, m] = cells[0].dataset.calendarDate.split("-");
    setText("#month-spend-label", `${Number(m)}月一共花费`);
    setText("#month-spend", sumPrefix(`${y}-${m}-`));
    setText("#month-spend-days", spendDays(`${y}-${m}-`));
  }

  function renderYearSpend() {
    const cards = [...yearGrid.querySelectorAll("[data-calendar-month]")];
    if (!cards.length) return;
    const year = (/^(\d{4})年/.exec(cards[0].getAttribute("aria-label")) || [])[1];
    if (!year) return;
    cards.forEach((card) => {
      const total = sumPrefix(`${year}-${String(Number(card.dataset.calendarMonth) + 1).padStart(2, "0")}-`);
      card.querySelector(".year-month-spend")?.remove();
      card.insertAdjacentHTML("beforeend", `<span class="year-month-spend">${total ? `${total} 元` : ""}</span>`);
    });
    setText("#year-spend-label", `${year}年一共花费`);
    setText("#year-spend", sumPrefix(`${year}-`));
    setText("#year-spend-days", spendDays(`${year}-`));
  }

  new MutationObserver(renderMonthSpend).observe(monthGrid, { childList: true });
  new MutationObserver(renderYearSpend).observe(yearGrid, { childList: true });
  renderMonthSpend();
  renderYearSpend();

  function openLedger(key) {
    activeKey = key;
    const [y, m, d] = key.split("-").map(Number);
    document.querySelector("#ledger-title").textContent = `${m}月${d}日`;
    document.querySelector("#ledger-weekday").textContent = `${y}年 · 星期${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`;
    const entry = data[key] || {};
    inputs.forEach((input) => {
      input.value = amount(entry[input.dataset.meal]) > 0 ? entry[input.dataset.meal] : "";
    });
    renderTotals();
    if (!dialog.open) dialog.showModal();
  }

  function dateForColumn(index) {
    const button = checkinBody.querySelector(`tr:first-child td:nth-child(${index + 2}) [data-date]`);
    return button ? button.dataset.date : "";
  }

  function headerIndex(th) {
    return [...th.parentElement.children].indexOf(th) - 1;
  }

  weekHead.addEventListener("click", (event) => {
    const th = event.target.closest("th.weekday");
    if (!th) return;
    const key = dateForColumn(headerIndex(th));
    if (key) openLedger(key);
  });

  weekHead.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const th = event.target.closest("th.weekday");
    if (!th) return;
    event.preventDefault();
    th.click();
  });

  // The header is re-rendered on every navigation; keep it keyboard- and screen-reader-friendly.
  function decorateHeaders() {
    weekHead.querySelectorAll("th.weekday").forEach((th) => {
      th.dataset.ledger = "";
      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.title = "点这里记账";
    });
  }
  new MutationObserver(decorateHeaders).observe(weekHead, { childList: true });
  decorateHeaders();

  dialog.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !activeKey) return;
    const entry = data[activeKey] || {};
    // A bare 0 (or an empty field) is "nothing spent": don't store it.
    if (input.value === "" || amount(input.value) === 0) delete entry[input.dataset.meal];
    else entry[input.dataset.meal] = input.value;
    if (Object.keys(entry).length) data[activeKey] = entry;
    else delete data[activeKey];
    save();
    renderTotals();
    renderSummary();
  });

  // Select the old amount on focus so typing replaces it instead of appending to it.
  inputs.forEach((input) => input.addEventListener("focus", () => input.select()));

  document.querySelector("#ledger-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
})();
