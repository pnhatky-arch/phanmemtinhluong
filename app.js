const STORAGE_KEY = "tinh-luong-cloudflare-v1";
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

const fields = ["baseSalary"];
let state = loadState();
let currentMonth = monthKey(new Date());
let toastTimer;
let currentView = location.hash === "#nhan-vien" ? "employees" : location.hash === "#phieu-luong" ? "payslips" : ["#cai-dat", "#huong-dan"].includes(location.hash) ? "settings" : "overview";
let selectionModeAll = false;
let selectedEmployeeIds = new Set();
let pendingEmployeeAction = null;
let pendingIosExport = null;
let showPayrollPeriod = localStorage.getItem("tinh-luong-show-period") !== "0";
let managementMonthByEmployee = JSON.parse(localStorage.getItem("tinh-luong-management-months") || "{}");
let editingEmployeeMonth = currentMonth;
let entryEmployeeMonth = currentMonth;
let payslipEmployeeId = "";
let payslipMonth = currentMonth;
const MANAGEMENT_COLUMNS_KEY = "tinh-luong-management-columns-v1";
const MANAGEMENT_COLUMNS = ["advance", "leave", "bonus", "overtime", "salary", "deduction"];
const MANAGEMENT_COLUMN_LABELS = { advance: "Ứng lương", leave: "Ngày nghỉ", bonus: "Thưởng", overtime: "Tăng ca", salary: "Mức lương", deduction: "Tiền nghỉ & trừ khác" };
function loadManagementColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(MANAGEMENT_COLUMNS_KEY) || "null");
    const order = Array.isArray(saved?.order) ? saved.order.filter((key) => MANAGEMENT_COLUMNS.includes(key)) : MANAGEMENT_COLUMNS.slice();
    MANAGEMENT_COLUMNS.forEach((key) => { if (!order.includes(key)) order.push(key); });
    const hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter((key) => MANAGEMENT_COLUMNS.includes(key)) : [];
    return { order, hidden };
  } catch { return { order: MANAGEMENT_COLUMNS.slice(), hidden: [] }; }
}
let managementColumns = loadManagementColumns();
function saveManagementColumns() { localStorage.setItem(MANAGEMENT_COLUMNS_KEY, JSON.stringify(managementColumns)); }
function visibleManagementColumns() { return managementColumns.order.filter((key) => !managementColumns.hidden.includes(key)); }
function managementColumnValue(key, employee, result) {
  if (key === "advance") return { value: money.format(result.advance), className: "negative", entryType: "advance" };
  if (key === "leave") return { value: `${result.leaveDays} ngày`, className: "", entryType: "leave" };
  if (key === "bonus") return { value: money.format(result.bonus), className: "positive", entryType: "bonus" };
  if (key === "overtime") return { value: money.format(Number(employee.overtime) || 0), className: "positive", entryType: "" };
  if (key === "salary") return { value: money.format(result.payableBase), className: "", entryType: "" };
  return { value: money.format(result.leaveDeduction + (Number(employee.otherDeduction) || 0)), className: "negative", entryType: "" };
}
function renderManagementColumnControls(key) {
  return `<button type="button" class="column-hide" data-column-hide="${key}" aria-label="Ẩn ô ${MANAGEMENT_COLUMN_LABELS[key]}">×</button>`;
}
function renderHiddenManagementColumns() {
  const box = $("#hiddenManagementColumnsList");
  if (!box) return;
  if (!managementColumns.hidden.length) { box.innerHTML = `<div class="hidden-columns-empty">Chưa có ô nào bị ẩn.</div>`; return; }
  box.innerHTML = managementColumns.hidden.map((key) => `<div class="hidden-column-item"><span><b>${MANAGEMENT_COLUMN_LABELS[key]}:</b><small>Đang ẩn khỏi Quản lý nhân viên</small></span><button type="button" class="button ghost" data-column-restore="${key}">Phục hồi</button></div>`).join("");
}
function applyManagementColumnLayout() {
  document.documentElement.style.setProperty("--management-column-count", String(Math.max(1, visibleManagementColumns().length)));
  const head = $("#employeeTableHead");
  if (head) head.innerHTML = `<span>Nhân viên & thanh toán</span>${visibleManagementColumns().map((key) => `<span data-column-key="${key}">${MANAGEMENT_COLUMN_LABELS[key]}</span>`).join("")}`;
  renderHiddenManagementColumns();
}
function moveManagementColumn(key, direction) {
  const index = managementColumns.order.indexOf(key), next = index + direction;
  if (index < 0 || next < 0 || next >= managementColumns.order.length) return;
  [managementColumns.order[index], managementColumns.order[next]] = [managementColumns.order[next], managementColumns.order[index]];
  saveManagementColumns(); render();
}
function hideManagementColumn(key) {
  if (!MANAGEMENT_COLUMNS.includes(key) || managementColumns.hidden.includes(key)) return;
  if (!window.confirm(`Ẩn ô “${MANAGEMENT_COLUMN_LABELS[key]}” khỏi Quản lý nhân viên?\n\nDữ liệu đã lưu của ô này vẫn được giữ nguyên và có thể phục hồi trong Cài đặt hệ thống.`)) return;
  managementColumns.hidden.push(key); saveManagementColumns(); render(); showToast(`Đã ẩn ô ${MANAGEMENT_COLUMN_LABELS[key]}`);
}
function restoreManagementColumn(key) {
  if (!managementColumns.hidden.includes(key)) return;
  managementColumns.hidden = managementColumns.hidden.filter((item) => item !== key); saveManagementColumns(); render(); showToast(`Đã phục hồi ô ${MANAGEMENT_COLUMN_LABELS[key]}`);
}

let managementDrag = null;
let managementDragBound = false;
function bindManagementColumnDrag() {
  const list = $("#employeeList");
  if (!list || managementDragBound) return;
  managementDragBound = true;

  let pressTimer = null;
  let pressCell = null;
  let pressPointerId = null;
  let pressStartX = 0;
  let pressStartY = 0;
  let suppressClickUntil = 0;
  let ghost = null;
  let indicator = null;
  let dragTargets = [];
  let dragKey = null;
  let dragPointerId = null;
  let dragMoved = false;
  let dropKey = null;
  let dropBefore = true;
  let raf = 0;
  let lastX = 0;
  let lastY = 0;

  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressCell = null;
    pressPointerId = null;
  };

  const removeDragUI = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ghost?.remove();
    indicator?.remove();
    ghost = null;
    indicator = null;
    dragTargets = [];
    document.body.classList.remove("column-drag-mode");
    document.documentElement.classList.remove("column-drag-active");
  };

  const abortDrag = () => {
    const source = pressCell;
    source?.classList.remove("column-drag-source");
    removeDragUI();
    managementDrag = null;
    dragPointerId = null;
    dragKey = null;
    dropKey = null;
    clearPress();
  };

  const getTargets = (sourceCell) => {
    const row = sourceCell?.closest(".employee-row");
    if (!row) return [];
    return [...row.querySelectorAll(":scope > .cell[data-column-key]")].map((cell) => ({
      cell,
      key: cell.dataset.columnKey
    }));
  };

  const updateTargets = () => {
    dragTargets = dragTargets.map((item) => ({ ...item, rect: item.cell.getBoundingClientRect() }));
  };

  const createDragUI = (cell, event) => {
    const rect = cell.getBoundingClientRect();
    ghost = cell.cloneNode(true);
    ghost.classList.remove("column-drag-source", "column-dragging");
    ghost.classList.add("column-drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.transform = "translate3d(0,0,0)";
    document.body.appendChild(ghost);

    indicator = document.createElement("div");
    indicator.className = "column-drop-indicator";
    document.body.appendChild(indicator);

    cell.classList.add("column-drag-source");
    document.body.classList.add("column-drag-mode");
    document.documentElement.classList.add("column-drag-active");
    dragTargets = getTargets(cell);
    updateTargets();
    dragKey = cell.dataset.columnKey;
    dragPointerId = event.pointerId;
    dragMoved = false;
    dropKey = dragKey;
    dropBefore = true;
    lastX = event.clientX;
    lastY = event.clientY;
    // Do not use setPointerCapture on iOS Safari; it can strand the pointerup event.
    updateDragPosition();
  };

  const updateDragPosition = () => {
    raf = 0;
    if (!managementDrag || !ghost || !indicator) return;
    const x = lastX;
    const y = lastY;
    ghost.style.transform = `translate3d(${x - pressStartX}px, ${y - pressStartY}px, 0)`;

    const candidates = dragTargets.filter((item) => item.key !== dragKey && item.cell?.isConnected);
    if (!candidates.length) return;
    const rowGroups = [];
    for (const item of candidates) {
      const r = item.cell.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      let group = rowGroups.find((g) => Math.abs(g.cy - cy) <= Math.max(8, r.height * 0.12));
      if (!group) { group = { cy, items: [] }; rowGroups.push(group); }
      group.items.push({ ...item, rect: r, cx: r.left + r.width / 2 });
    }
    rowGroups.sort((a,b) => Math.abs(a.cy-y) - Math.abs(b.cy-y));
    const row = rowGroups[0];
    row.items.sort((a,b)=>a.rect.left-b.rect.left);
    let target = row.items[0];
    let best = Infinity;
    for (const item of row.items) {
      const dx = Math.abs(x - item.cx);
      if (dx < best) { best = dx; target = item; }
    }
    dropKey = target.key;
    dropBefore = x < target.cx;
    indicator.style.left = `${Math.round(dropBefore ? target.rect.left - 2 : target.rect.right - 2)}px`;
    indicator.style.top = `${Math.round(target.rect.top + 8)}px`;
    indicator.style.height = `${Math.max(32, Math.round(target.rect.height - 16))}px`;
  };

  const scheduleDragPosition = (event) => {
    lastX = event.clientX;
    lastY = event.clientY;
    if (!raf) raf = requestAnimationFrame(updateDragPosition);
  };

  const finishDrag = (cancel = false) => {
    if (!managementDrag) { clearPress(); return; }
    const key = dragKey;
    const source = pressCell;
    const targetKey = dropKey;
    const before = dropBefore;
    const moved = dragMoved;
    source?.classList.remove("column-drag-source");
    removeDragUI();
    managementDrag = null;
    dragPointerId = null;
    dragKey = null;
    clearPress();

    let didChange = false;
    if (!cancel && key && targetKey && key !== targetKey) {
      const visible = visibleManagementColumns();
      const from = visible.indexOf(key);
      let to = visible.indexOf(targetKey);
      if (from >= 0 && to >= 0) {
        visible.splice(from, 1);
        if (from < to) to--;
        const at = Math.max(0, Math.min(to + (before ? 0 : 1), visible.length));
        visible.splice(at, 0, key);
        const nextOrder = [];
        let vi = 0;
        for (const item of managementColumns.order) {
          if (managementColumns.hidden.includes(item)) nextOrder.push(item);
          else nextOrder.push(visible[vi++]);
        }
        didChange = nextOrder.join("|") !== managementColumns.order.join("|");
        if (didChange) {
          managementColumns.order = nextOrder;
          saveManagementColumns();
          render();
          showToast(`Đã đổi vị trí ô ${MANAGEMENT_COLUMN_LABELS[key]}`);
        }
      }
    }
    if (moved || didChange) suppressClickUntil = Date.now() + 500;
  };

  const beginDrag = (event) => {
    if (managementDrag || !pressCell || !pressCell.isConnected || pressPointerId !== event.pointerId) return;
    managementDrag = { pointerId: pressPointerId };
    suppressClickUntil = Date.now() + 1000;
    createDragUI(pressCell, event);
    event.preventDefault?.();
  };

  list.addEventListener("pointerdown", (event) => {
    if (managementDrag) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const cell = event.target.closest(".employee-row .cell[data-column-key]");
    if (!cell || !list.contains(cell) || event.target.closest("button,a,input,select,textarea")) return;
    clearPress();
    pressCell = cell;
    pressPointerId = event.pointerId;
    pressStartX = event.clientX;
    pressStartY = event.clientY;
    pressTimer = setTimeout(() => beginDrag({ pointerId: pressPointerId, clientX: pressStartX, clientY: pressStartY, preventDefault: () => {} }), 300);
  }, { passive: true });

  document.addEventListener("pointermove", (event) => {
    if (!managementDrag) {
      // iPhone/iPad fingers naturally move a little while holding.
      // Do NOT cancel the 300ms long-press just because of small movement.
      // The press is canceled only by pointerup/pointercancel below.
      return;
    }
    if (event.pointerId !== dragPointerId) return;
    dragMoved = true;
    scheduleDragPosition(event);
  }, { passive: true });

  const endPointer = (event) => {
    if (managementDrag && event.pointerId === dragPointerId) finishDrag(false);
    else if (event.pointerId === pressPointerId) clearPress();
  };
  document.addEventListener("pointerup", endPointer, { passive: true });
  document.addEventListener("pointercancel", (event) => {
    if (managementDrag && event.pointerId === dragPointerId) finishDrag(true);
    else if (event.pointerId === pressPointerId) clearPress();
  }, { passive: true });
  window.addEventListener("blur", () => abortDrag());
  document.addEventListener("visibilitychange", () => { if (document.hidden) abortDrag(); });

  list.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

let iosDateTarget = null;
let iosDisplayDate = new Date();

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function renderIosCalendar() {
  const year = iosDisplayDate.getFullYear();
  const month = iosDisplayDate.getMonth();
  const selected = parseIsoDate(iosDateTarget?.value) || new Date();
  $("#iosPickerTitle").textContent = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(iosDisplayDate);
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const buttons = [];
  for (let i = 0; i < firstDay; i += 1) buttons.push('<span></span>');
  for (let day = 1; day <= days; day += 1) {
    const value = isoDate(new Date(year, month, day));
    const isSelected = value === isoDate(selected);
    buttons.push(`<button type="button" data-ios-date="${value}" class="${isSelected ? "selected" : ""}">${day}</button>`);
  }
  $("#iosCalendarDays").innerHTML = buttons.join("");
}

function showIosDatePicker(input) {
  iosDateTarget = input;
  iosDisplayDate = parseIsoDate(input.value) || new Date();
  renderIosCalendar();
  $("#iosDatePicker").showModal();
}

function setupIosDatePickers(root = document) {
  root.querySelectorAll('input[type="date"]').forEach((input) => {
    if (input.dataset.iosDateReady) return;
    input.dataset.iosDateReady = "true";
    input.type = "text";
    input.readOnly = true;
    input.classList.add("ios-date-input");
    input.addEventListener("click", () => showIosDatePicker(input));
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const switchingToDark = theme !== "dark";
  $("#themeIcon").textContent = switchingToDark ? "☾" : "☀";
  $("#themeToggle").setAttribute("aria-label", switchingToDark ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng");
  localStorage.setItem("tinh-luong-theme", theme);
}

function applyBrandVisibility(visible) {
  const showBrand = visible !== false;
  document.querySelector(".topbar")?.classList.toggle("system-brand-hidden", !showBrand);
  const control = $("#showAppBrand");
  if (control) control.checked = showBrand;
  localStorage.setItem("tinh-luong-show-brand", showBrand ? "1" : "0");
}

function applyCreditVisibility(visible) {
  const showCredit = visible !== false;
  document.querySelector(".app-credit")?.classList.toggle("system-credit-hidden", !showCredit);
  const control = $("#showAppCredit");
  if (control) control.checked = showCredit;
  localStorage.setItem("tinh-luong-show-credit", showCredit ? "1" : "0");
}

function applyPeriodVisibility(visible) {
  showPayrollPeriod = visible !== false;
  const periodBar = document.querySelector(".period-bar");
  if (periodBar) periodBar.hidden = currentView === "settings" || !showPayrollPeriod;
  const control = $("#showPayrollPeriod");
  if (control) control.checked = showPayrollPeriod;
  localStorage.setItem("tinh-luong-show-period", showPayrollPeriod ? "1" : "0");
}

async function clearAppCachesAndReload() {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("app_update");
  cleanUrl.hash = currentView === "employees" ? "nhan-vien" : currentView === "settings" ? "cai-dat" : "tong-quan";

  // Không chờ các API này trước khi chuyển trang: Safari/iOS đôi khi treo
  // ở getRegistrations()/caches khi ứng dụng đang chạy như PWA.
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    }
  } catch {}
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    }
  } catch {}
  try { sessionStorage.clear(); } catch {}

  // Bỏ dấu cache-bust khỏi thanh địa chỉ sau khi đã dọn cache.
  try { window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash); } catch {}
}

function handleAppUpdateBoot() {
  if (!new URLSearchParams(window.location.search).has("app_update")) return;
  // Chạy dọn cache ở nền, không chặn việc hiển thị ứng dụng.
  clearAppCachesAndReload();
}

function updateSoftware() {
  const button = $("#updateSoftware");
  if (!button || button.disabled) return;
  const confirmed = window.confirm("Cập nhật phần mềm sẽ tải lại phiên bản mới và dọn bộ nhớ đệm cũ. Dữ liệu nhân viên, kỳ lương và lương đã lưu vẫn được giữ nguyên. Tiếp tục?");
  if (!confirmed) return;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.querySelector("b")?.replaceChildren(document.createTextNode("Đang cập nhật…"));

  // Điều hướng NGAY LẬP TỨC. Đây là điểm quan trọng cho iOS/PWA:
  // không await Service Worker/Cache API trước khi chuyển trang.
  const url = new URL(window.location.href);
  url.searchParams.set("app_update", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  url.hash = currentView === "employees" ? "nhan-vien" : currentView === "payslips" ? "phieu-luong" : currentView === "settings" ? "cai-dat" : "tong-quan";
  window.location.href = url.toString();
}

function inlinePeriodContext() {
  if (showPayrollPeriod) return "";
  const today = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  return `<span class="inline-period-context">Tháng lương ${today} • ${daysInPayrollMonth()} Ngày</span>`;
}

function setView(view, updateHash = true) {
  currentView = ["overview", "employees", "payslips", "settings"].includes(view) ? view : "overview";
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === currentView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  document.querySelectorAll("[data-view-section]").forEach((section) => {
    section.hidden = section.dataset.viewSection !== currentView;
  });
  if (currentView === "settings") document.querySelectorAll(".ios-setting-group[open]").forEach((group) => group.removeAttribute("open"));
  $(".period-bar").hidden = currentView === "settings" || !showPayrollPeriod;
  $("#addEmployeeHeader").hidden = currentView !== "employees";
  const pageCopy = {
    overview: ["Tổng quan lương", ""],
    employees: ["Quản lý nhân viên", ""],
    payslips: ["Phiếu lương", "Chọn nhân viên để xem và xuất Phiếu lương."],
    settings: ["Cài đặt", "Các nhóm cài đặt được thu gọn mặc định."],
  };
  $("#pageHeading").textContent = pageCopy[currentView][0];
  $("#pageDescription").textContent = pageCopy[currentView][1];
  $("#pageDescription").hidden = !pageCopy[currentView][1];
  if (updateHash) history.replaceState(null, "", currentView === "employees" ? "#nhan-vien" : currentView === "payslips" ? "#phieu-luong" : currentView === "settings" ? "#cai-dat" : "#tong-quan");
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed?.periods) return { periods: {}, salaryArchives: {} };
    if (!parsed.salaryArchives || typeof parsed.salaryArchives !== "object") parsed.salaryArchives = {};
    Object.values(parsed.periods).forEach((list) => (list || []).forEach((employee) => {
      if (!employee.payrollMethod) employee.payrollMethod = "month-start";
      if (!employee.payrollCustomStartDate) employee.payrollCustomStartDate = "";
      if (!employee.payrollEndMode) employee.payrollEndMode = "full-period";
      if (!employee.employmentEnd) employee.employmentEnd = "";
    }));
    return parsed;
  } catch {
    return { periods: {} };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return monthKey(new Date(year, month - 2, 1));
}

function daysInPayrollMonth() {
  const [year, month] = currentMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function bonusEntries(employee) {
  if (Array.isArray(employee.bonuses)) return employee.bonuses;
  return employee.bonus > 0 ? [{ id: newId(), reason: "Thưởng", amount: employee.bonus }] : [];
}

function advanceEntries(employee) {
  if (Array.isArray(employee.advances)) return employee.advances;
  return employee.advance > 0 ? [{ id: newId(), date: "", amount: employee.advance }] : [];
}

function leaveEntries(employee) {
  if (Array.isArray(employee.leaves)) return employee.leaves;
  return employee.leaveDays > 0 ? [{ id: newId(), date: "", days: employee.leaveDays }] : [];
}

function defaultEmployees() {
  const start = "2020-01-01";
  return [
    { id: newId(), name: "Nhân viên A", position: "Tài xế", baseSalary: 12000000, employmentStart: start, citizenId: "", driverLicense: "", bonuses: [{ id: newId(), reason: "Thưởng tăng ca", amount: 200000, date: todayKey() }], advances: [{ id: newId(), reason: "Ứng lương đợt 1", date: todayKey(), amount: 3000000 }], leaves: [{ id: newId(), reason: "Nghỉ việc riêng", date: todayKey(), days: 2 }], otherDeduction: 0, salaryPaid: false, salaryPaidAt: "", note: "", archived: false },
    { id: newId(), name: "Nhân viên B", position: "Phụ", baseSalary: 10000000, employmentStart: start, citizenId: "", driverLicense: "", bonuses: [{ id: newId(), reason: "Thưởng tăng ca", amount: 100000, date: todayKey() }], advances: [{ id: newId(), reason: "Ứng lương đợt 1", date: todayKey(), amount: 5000000 }], leaves: [{ id: newId(), reason: "Nghỉ việc riêng", date: todayKey(), days: 3 }], otherDeduction: 0, salaryPaid: false, salaryPaidAt: "", note: "", archived: false },
    { id: newId(), name: "Nhân viên C", position: "Phụ", baseSalary: 8000000, employmentStart: start, citizenId: "", driverLicense: "", bonuses: [], advances: [{ id: newId(), reason: "Ứng lương đợt 1", date: todayKey(), amount: 500000 }], leaves: [{ id: newId(), reason: "Nghỉ việc riêng", date: todayKey(), days: 6 }], otherDeduction: 0, salaryPaid: false, salaryPaidAt: "", note: "", archived: false }
  ];
}

function applySampleProfiles() {
  if ((state.sampleProfilesVersion || 0) >= 4) return;
  const list = employees();
  const normalizeName = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi").trim();
  defaultEmployees().forEach((profile) => {
    const shortName = normalizeName(profile.name).replace(/^nhan vien\s+/, "");
    const names = [normalizeName(profile.name), `nhan vien ${shortName}`, shortName];
    const existing = list.find((employee) => names.includes(normalizeName(employee.name)));
    if (existing) Object.assign(existing, { ...profile, id: existing.id });
    else list.push(profile);
  });
  state.sampleProfilesVersion = 4;
  selectionModeAll = true;
  saveState();
}

function ensurePeriodEmployees() {
  if (Array.isArray(state.periods[currentMonth])) return;
  const keys = Object.keys(state.periods).filter((key) => state.periods[key]?.length).sort();
  const sourceKey = keys.filter((key) => key < currentMonth).pop() || keys[0];
  if (sourceKey) {
    state.periods[currentMonth] = state.periods[sourceKey].map((employee) => ({
      ...employee, bonus: 0, advance: 0, leaveDays: 0, otherDeduction: 0, bonuses: [], advances: [], leaves: [], salaryPaid: false, salaryPaidAt: ""
    }));
  } else {
    state.periods[currentMonth] = defaultEmployees();
    selectionModeAll = false;
  }
  state.defaultProfilesAdded = true;
  saveState();
}

function employees() {
  ensurePeriodEmployees();
  return state.periods[currentMonth];
}

function numberValue(id) {
  const value = Number(String($(`#${id}`).value).replace(/[^0-9]/g, ""));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatEntryAmount(value) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatCurrencyInput(input) {
  const digits = String(input.value).replace(/[^0-9]/g, "");
  input.value = digits ? Number(digits).toLocaleString("vi-VN") : "";
}

function newId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `nv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function clampDay(year, monthIndex, day) {
  return Math.min(Math.max(1, Number(day) || 1), daysInMonth(year, monthIndex));
}

function monthDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(clampDay(year, monthIndex, day)).padStart(2, "0")}`;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addPayrollMonths(date, amount, anchorDay) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  return parseIsoDate(monthDate(target.getFullYear(), target.getMonth(), anchorDay));
}

function payrollMethodLabel(employee) {
  const method = employee?.payrollMethod || "month-start";
  return method === "employment-start" ? "Từ ngày vào làm" : method === "custom-start" ? "Từ ngày tùy chọn" : "Từ đầu tháng mới";
}

function payrollAnchorDay(employee) {
  const method = employee?.payrollMethod || "month-start";
  if (method === "employment-start") return Number(employee?.employmentStart?.slice(8, 10)) || 1;
  if (method === "custom-start") return Number(employee?.payrollCustomStartDate?.slice(8, 10)) || 1;
  return 1;
}

function getPayrollPeriod(employee, month = currentMonth) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthIndex = monthNumber - 1;
  const day = payrollAnchorDay(employee);
  let start = parseIsoDate(monthDate(year, monthIndex, day));
  const method = employee?.payrollMethod || "month-start";
  if (method === "employment-start" && employee?.employmentStart) {
    const employment = parseIsoDate(employee.employmentStart);
    if (employment && employment > start) start = employment;
  }

  // Một kỳ lương luôn kết thúc vào ngày liền trước cùng mốc của tháng kế tiếp.
  // Ví dụ: vào làm 12/09 => kỳ 12/09 -> 11/10, không bị cắt ở 30/09.
  const nextStart = addPayrollMonths(start, 1, day);
  const scheduledEnd = new Date(nextStart);
  scheduledEnd.setDate(scheduledEnd.getDate() - 1);

  let end = new Date(scheduledEnd);
  let endedBeforePeriod = false;
  let isPartialEnd = false;
  if ((employee?.payrollEndMode || "full-period") === "termination-date" && employee?.employmentEnd) {
    const employmentEnd = parseIsoDate(employee.employmentEnd);
    if (employmentEnd) {
      if (employmentEnd < start) endedBeforePeriod = true;
      else if (employmentEnd < scheduledEnd) {
        end = employmentEnd;
        isPartialEnd = true;
      }
    }
  }

  return {
    start: isoDate(start),
    end: isoDate(end),
    scheduledEnd: isoDate(scheduledEnd),
    month: month,
    endedBeforePeriod,
    isPartialEnd,
  };
}

function periodContains(period, date) {
  if (!date || period?.endedBeforePeriod) return false;
  return date >= period.start && date <= period.end;
}

function employeeMonth(id, month = currentMonth) {
  ensurePeriodEmployeesFor(month);
  return state.periods[month]?.find((item) => item.id === id) || null;
}

function ensurePeriodEmployeesFor(month) {
  if (Array.isArray(state.periods[month])) return;
  const keys = Object.keys(state.periods).filter((key) => state.periods[key]?.length).sort();
  const sourceKey = keys.filter((key) => key < month).pop() || keys[0];
  if (sourceKey) {
    state.periods[month] = state.periods[sourceKey].map((employee) => ({
      ...employee, bonus: 0, advance: 0, leaveDays: 0, otherDeduction: 0, bonuses: [], advances: [], leaves: [], salaryPaid: false, salaryPaidAt: ""
    }));
  } else state.periods[month] = [];
  saveState();
}

function managementMonth(employee) {
  return managementMonthByEmployee[employee.id] || currentMonth;
}

function setManagementMonth(employeeId, month) {
  managementMonthByEmployee[employeeId] = month;
  localStorage.setItem("tinh-luong-management-months", JSON.stringify(managementMonthByEmployee));
}

function shiftMonth(key, amount) {
  const [year, month] = key.split("-").map(Number);
  return monthKey(new Date(year, month - 1 + amount, 1));
}

function periodEntryFilter(employee, month, type) {
  const period = getPayrollPeriod(employee, month);
  const currentKey = `${month}:${period.start}:${period.end}`;
  return entryCollection(employee, type).filter((entry) => {
    if (entry.periodKey) {
      if (entry.periodKey === currentKey) return true;
      // Tương thích dữ liệu tạo trước khi sửa kỳ lương xuyên tháng:
      // cùng tháng + cùng ngày bắt đầu vẫn thuộc kỳ hiện tại, miễn ngày giao dịch còn nằm trong kỳ mới.
      const [entryMonth, entryStart] = String(entry.periodKey).split(":");
      if (entryMonth === month && entryStart === period.start) return !entry.date || periodContains(period, entry.date);
      return false;
    }
    return !entry.date || periodContains(period, entry.date);
  });
}

function payrollPeriodKey(employee, month) {
  const period = getPayrollPeriod(employee, month);
  return `${month}:${period.start}:${period.end}`;
}

function realCurrentMonth() {
  return monthKey(new Date());
}

function archiveKey(employee, month) {
  return `${employee.id}:${payrollPeriodKey(employee, month)}`;
}

function archiveCompletedPayrolls() {
  const today = todayKey();
  if (!state.salaryArchives || typeof state.salaryArchives !== "object") state.salaryArchives = {};
  let changed = false;
  Object.keys(state.periods || {}).forEach((month) => {
    const list = state.periods[month] || [];
    list.forEach((employee) => {
      const period = getPayrollPeriod(employee, month);
      // Kỳ neo giữa hai tháng chỉ được lưu lịch sử sau khi ngày kết thúc thực tế đã qua.
      if (period.endedBeforePeriod || period.end >= today) return;
      const key = archiveKey(employee, month);
      const alreadyArchived = state.salaryArchives[key] || Object.values(state.salaryArchives).some((archive) => archive?.employeeId === employee.id && archive?.month === month);
      if (alreadyArchived) return;
      const result = calculateLive(employee, month);
      state.salaryArchives[key] = {
        version: 1,
        employeeId: employee.id,
        month,
        period: result.period,
        employee: {
          name: employee.name,
          position: employee.position,
          baseSalary: Number(employee.baseSalary) || 0,
          employmentStart: employee.employmentStart || "",
          payrollMethod: employee.payrollMethod || "month-start",
          payrollCustomStartDate: employee.payrollCustomStartDate || "",
          payrollEndMode: employee.payrollEndMode || "full-period",
          employmentEnd: employee.employmentEnd || "",
          otherDeduction: Number(employee.otherDeduction) || 0,
          note: employee.note || "",
        },
        result: {
          bonus: result.bonus,
          advance: result.advance,
          leaveDays: result.leaveDays,
          salaryDays: result.salaryDays,
          workedDays: result.workedDays,
          payableBase: result.payableBase,
          leaveDeduction: result.leaveDeduction,
          totalDeduction: result.totalDeduction,
          remaining: result.remaining,
        },
        savedAt: new Date().toISOString(),
      };
      changed = true;
    });
  });
  if (changed) saveState();
}

function getSavedPayrollMonths(employeeId = "") {
  const months = new Set();
  Object.values(state.salaryArchives || {}).forEach((archive) => {
    if (!employeeId || archive.employeeId === employeeId) months.add(archive.month);
  });
  Object.keys(state.periods || {}).forEach((month) => {
    if (!employeeId || (state.periods[month] || []).some((employee) => employee.id === employeeId)) months.add(month);
  });
  months.add(currentMonth);
  return [...months].sort().reverse();
}

function savedMonthOptions(employeeId = "", selected = currentMonth) {
  return getSavedPayrollMonths(employeeId).map((month) => {
    const date = parseIsoDate(`${month}-01`);
    const label = date ? new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(date) : month;
    const saved = Object.values(state.salaryArchives || {}).some((archive) => archive.month === month && (!employeeId || archive.employeeId === employeeId));
    return `<option value="${escapeHtml(month)}" ${month === selected ? "selected" : ""}>${escapeHtml(label)}${saved ? " · Đã lưu" : " · Đang tính"}</option>`;
  }).join("");
}

function calculateLive(employee, month = employee?.__payrollMonth || currentMonth) {
  const period = getPayrollPeriod(employee, month);
  const bonus = periodEntryFilter(employee, month, "bonus").reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const advance = periodEntryFilter(employee, month, "advance").reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const leaveDays = periodEntryFilter(employee, month, "leave").reduce((sum, item) => sum + (Number(item.days) || 0), 0);
  const start = parseIsoDate(period.start);
  const end = parseIsoDate(period.end);
  const scheduledEnd = parseIsoDate(period.scheduledEnd || period.end);
  const salaryDays = Math.max(1, Math.round((scheduledEnd - start) / 86400000) + 1);
  const employmentStart = employee?.employmentStart ? parseIsoDate(employee.employmentStart) : null;

  if (period.endedBeforePeriod || !start || !end || (employmentStart && scheduledEnd < employmentStart)) {
    return { bonus: 0, advance: 0, leaveDays: 0, salaryDays, workedDays: 0, payableBase: 0, leaveDeduction: 0, totalDeduction: 0, remaining: 0, period };
  }

  const activeStart = employmentStart && employmentStart > start ? employmentStart : start;
  const workedDays = activeStart <= end ? Math.max(0, Math.round((end - activeStart) / 86400000) + 1) : 0;
  const baseSalary = Number(employee?.baseSalary) || 0;
  const dailySalary = baseSalary / salaryDays;
  const payableBase = dailySalary * workedDays;
  const chargeableLeaveDays = Math.min(Math.max(0, leaveDays), workedDays);
  const leaveDeduction = dailySalary * chargeableLeaveDays;
  const otherDeduction = Number(employee?.otherDeduction) || 0;
  const totalDeduction = advance + otherDeduction + leaveDeduction;
  return { bonus, advance, leaveDays, salaryDays, workedDays, payableBase, leaveDeduction, totalDeduction, remaining: payableBase + bonus - totalDeduction, period };
}

function calculate(employee, month = employee?.__payrollMonth || currentMonth) {
  if (!employee) return calculateLive(employee, month);
  const archive = state.salaryArchives?.[archiveKey(employee, month)]
    || Object.values(state.salaryArchives || {}).find((item) => item?.employeeId === employee.id && item?.month === month);
  if (archive && month < realCurrentMonth()) return { ...archive.result, period: archive.period, archived: true };
  return calculateLive(employee, month);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function avatarContent(employee) {
  const source = employee?.useEmployeePhotoAsAvatar === false ? employee?.avatarImage : employee?.employeePhoto;
  const photo = typeof source === "string" && source.startsWith("data:image/") ? source : "";
  return photo ? `<img src="${escapeHtml(photo)}" alt="" />` : escapeHtml(employee?.name?.trim().charAt(0).toUpperCase() || "N");
}

function organizationLogo() {
  return typeof state.organizationLogo === "string" && state.organizationLogo.startsWith("data:image/") ? state.organizationLogo : "";
}

function renderOrganizationLogoSetting() {
  const logo = organizationLogo();
  const preview = $("#organizationLogoPreview");
  if (preview) preview.src = logo || "./icon.svg";
  const status = $("#organizationLogoStatus");
  if (status) status.textContent = logo ? "Logo này sẽ hiển thị trong Phiếu lương." : "Đang dùng logo mặc định của ứng dụng.";
  const removeButton = $("#removeOrganizationLogo");
  if (removeButton) removeButton.hidden = !logo;
}

function render() {
  archiveCompletedPayrolls();
  applyManagementColumnLayout();
  const query = "";
  const all = employees();
  const savedMonthsHtml = savedMonthOptions("", currentMonth);
  if ($("#overviewSavedMonth")) $("#overviewSavedMonth").innerHTML = savedMonthsHtml;
  if ($("#managementSavedMonth")) $("#managementSavedMonth").innerHTML = savedMonthsHtml;
  // Tổng quan dùng trực tiếp kỳ lương đang chọn ở từng dòng trong Tab Quản lý.
  const overviewAll = all.map((baseEmployee) => {
    const month = managementMonth(baseEmployee);
    const employee = employeeMonth(baseEmployee.id, month) || baseEmployee;
    employee.__payrollMonth = month;
    return employee;
  });
  const selected = selectionModeAll ? overviewAll : overviewAll.filter((employee) => selectedEmployeeIds.has(employee.id));
  const filtered = all.filter((employee) => `${employee.name} ${employee.position}`.toLocaleLowerCase("vi").includes(query));
  const totals = selected.reduce((sum, employee) => {
    const result = calculate(employee);
    sum.base += result.payableBase;
    sum.bonus += result.bonus;
    sum.advance += result.advance;
    sum.leaveDays += result.leaveDays;
    sum.leaveDeduction += result.leaveDeduction;
    sum.otherDeduction += employee.otherDeduction;
    sum.deduction += result.totalDeduction;
    sum.remaining += result.remaining;
    return sum;
  }, { base: 0, bonus: 0, advance: 0, leaveDays: 0, leaveDeduction: 0, otherDeduction: 0, deduction: 0, remaining: 0 });

  $("#payrollDays").textContent = `${daysInPayrollMonth()} ngày`;
  $("#totalBase").textContent = money.format(totals.base);
  $("#totalBonus").textContent = money.format(totals.bonus);
  $("#totalAdvance").textContent = money.format(totals.advance);
  $("#totalLeaveDays").textContent = `${totals.leaveDays} ngày`;
  $("#totalLeaveDeduction").textContent = money.format(totals.leaveDeduction);
  $("#totalOtherDeduction").textContent = money.format(totals.otherDeduction);
  $("#totalDeduction").textContent = money.format(totals.deduction);
  $("#totalRemaining").textContent = money.format(totals.remaining);
  $("#totalRemaining").classList.toggle("negative-value", totals.remaining < 0);
  $("#employeeCount").textContent = `${all.length} nhân viên`;
  $("#employeeCount").textContent = selected.length ? `Nhân viên: ${selected.map((employee) => employee.name || "Chưa đặt tên").join(" · ")}` : "Nhân viên: chưa chọn";
  $("#selectedEmployeeCount").textContent = selectionModeAll ? `Tất cả ${all.length} nhân viên` : `Đã chọn ${selected.length}/${all.length} nhân viên`;
  $("#selectAllEmployees").checked = selectionModeAll;
  $("#selectAllEmployees").indeterminate = !selectionModeAll && selected.length > 0;
  $("#employeeSelection").innerHTML = all.map((employee) => `<label><input type="checkbox" data-employee-id="${employee.id}" ${selectionModeAll || selectedEmployeeIds.has(employee.id) ? "checked" : ""} /> ${escapeHtml(employee.name || "Chưa đặt tên")}</label>`).join("");
  $("#metricRemaining").hidden = totals.remaining === 0;
  $("#metricBase").hidden = totals.base === 0;
  $("#metricBonus").hidden = totals.bonus === 0;
  $("#metricAdvance").hidden = totals.advance === 0;
  $("#metricDeduction").hidden = totals.deduction === 0;
  $("#metricLeaveDays").hidden = totals.leaveDays === 0;
  $("#metricLeaveDeduction").hidden = totals.leaveDeduction === 0;
  $("#metricOtherDeduction").hidden = totals.otherDeduction === 0;
  const paidEmployees = selected.filter((employee) => employee.salaryPaid);
  const unpaidEmployees = selected.filter((employee) => !employee.salaryPaid);
  if (!selected.length) {
    $("#paymentStatusTitle").textContent = "Chưa chọn nhân viên";
    $("#paymentStatusDetails").textContent = "Chọn nhân viên để xem trạng thái lương.";
  } else if (selected.length === 1) {
    const employee = selected[0];
    $("#paymentStatusTitle").textContent = employee.salaryPaid ? "Đã thanh toán" : "Chưa thanh toán";
    $("#paymentStatusDetails").textContent = employee.salaryPaid
      ? `${employee.name}${employee.salaryPaidAt ? ` · ${formatPayrollDate(employee.salaryPaidAt)}` : ""}`
      : `${employee.name} chưa được đánh dấu thanh toán.`;
  } else {
    $("#paymentStatusTitle").textContent = `${paidEmployees.length}/${selected.length} đã thanh toán`;
    const names = (items) => items.length ? items.map((employee) => escapeHtml(employee.name || "Chưa đặt tên")).join(" · ") : "Không có";
    $("#paymentStatusDetails").innerHTML = `<span class="paid-list">Đã thanh toán: ${names(paidEmployees)}</span><span class="pending-list">Chưa thanh toán: ${names(unpaidEmployees)}</span>`;
  }
  $("#selectedEmployeeCountManage").textContent = selectionModeAll ? `Tất cả ${all.length} nhân viên` : `Đã chọn ${selected.length}/${all.length} nhân viên`;
  $("#selectAllEmployeesManage").checked = selectionModeAll;
  $("#selectAllEmployeesManage").indeterminate = !selectionModeAll && selected.length > 0;
  $("#employeeSelectionManage").innerHTML = all.map((employee) => `<label><input type="checkbox" data-manage-employee-id="${employee.id}" ${selectionModeAll || selectedEmployeeIds.has(employee.id) ? "checked" : ""} /> ${escapeHtml(employee.name || "Chưa đặt tên")}</label>`).join("");

  const managementEmployees = filtered.map((baseEmployee) => {
    const month = managementMonth(baseEmployee);
    const employee = employeeMonth(baseEmployee.id, month) || baseEmployee;
    employee.__payrollMonth = month;
    return employee;
  });
  $("#employeeList").innerHTML = managementEmployees.map((employee) => {
    const result = calculate(employee, employee.__payrollMonth);
    const period = result.period;
    const monthLabel = new Intl.DateTimeFormat("vi-VN", { month: "2-digit", year: "numeric" }).format(parseIsoDate(`${employee.__payrollMonth}-01`));
    const method = payrollMethodLabel(employee);
    return `<article class="employee-row" data-id="${employee.id}" data-payroll-month="${employee.__payrollMonth}">
      <div class="employee-person"><span class="avatar ${result.remaining < 0 ? "has-negative-alert" : ""}">${avatarContent(employee)}</span><div class="employee-copy"><div class="employee-name-row"><strong>${escapeHtml(employee.name)}</strong><small class="employee-position-inline">(${escapeHtml(employee.position || "Nhân viên")})</small><button class="inline-action edit-employee" type="button">• Thông tin</button></div><div class="employee-period-controls"><button type="button" class="period-nav" data-period-shift="-1" aria-label="Tháng lương trước">‹</button><span><b>Kỳ lương</b><label class="employee-month-picker"><span>Tháng lương</span><input type="month" data-period-month value="${escapeHtml(employee.__payrollMonth)}" aria-label="Chọn tháng lương cho ${escapeHtml(employee.name)}" /></label><small>${formatPayrollDate(period.start)} → ${formatPayrollDate(period.end)}</small></span><button type="button" class="period-nav" data-period-shift="1" aria-label="Tháng lương sau">›</button></div><div class="employee-row-actions"><button class="payment-status payment-with-balance ${employee.salaryPaid ? "paid" : "pending"}" type="button" data-toggle-payment aria-pressed="${employee.salaryPaid ? "true" : "false"}"><span>${employee.salaryPaid ? "✓ Đã thanh toán" : "Chưa thanh toán"}</span><b class="${result.remaining < 0 ? "is-negative" : ""}">${money.format(result.remaining)}</b></button></div></div></div>
      ${visibleManagementColumns().map((key) => { const item = managementColumnValue(key, employee, result); const click = item.entryType ? ` entry-summary" data-entry-list-type="${item.entryType}" role="button" tabindex="0` : ""; return `<div class="cell${click}" data-column-key="${key}"><div class="cell-main"><span class="${item.className}">${item.value}</span><small>${MANAGEMENT_COLUMN_LABELS[key]}</small></div>${renderManagementColumnControls(key)}</div>`; }).join("")}
    </article>`;
  }).join("");
  bindManagementColumnDrag();

  $("#overviewEmployeeList").innerHTML = overviewAll.map((employee) => {
    const result = calculate(employee, employee.__payrollMonth);
    const periodContext = `<span class="overview-period-context">Kỳ lương: ${escapeHtml(formatPayrollDate(result.period.start))} → ${escapeHtml(formatPayrollDate(result.period.end))}</span>`;
    return `<article class="overview-employee-row" data-id="${employee.id}">
      <span class="employee-person"><span class="avatar ${result.remaining < 0 ? "has-negative-alert" : ""}">${avatarContent(employee)}</span><span class="overview-employee-copy"><span class="overview-name-row"><strong>${escapeHtml(employee.name)}</strong><small class="overview-position-inline">(${escapeHtml(employee.position || "Nhân viên")})</small><button class="payslip-trigger" type="button" data-payslip-id="${employee.id}" aria-label="Xem Phiếu lương của ${escapeHtml(employee.name)}">• Phiếu lương</button>${periodContext}</span><span class="overview-mobile-remaining ${result.remaining < 0 ? "is-negative" : ""}"><b>${money.format(result.remaining)}</b><small>Thực nhận</small></span></span></span>
      <span class="overview-cell"><b>${money.format(employee.baseSalary)}</b><small>Lương</small></span>
      <span class="overview-cell positive"><b>${money.format(result.bonus)}</b><small>Thưởng</small></span>
      <span class="overview-cell negative"><b>${money.format(result.advance)}</b><small>Ứng lương</small></span>
      <span class="overview-cell"><b>${result.leaveDays} ngày</b><small>Nghỉ</small></span>
      <span class="overview-cell negative"><b>${money.format(result.totalDeduction)}</b><small>Khấu trừ</small></span>
      <span class="overview-cell remaining ${result.remaining < 0 ? "is-negative" : ""}"><b>${money.format(result.remaining)}</b><small>Thực nhận</small></span>
      <button class="chevron" type="button" data-payslip-id="${employee.id}" aria-label="Xem Phiếu lương của ${escapeHtml(employee.name)}">›</button>
    </article>`;
  }).join("");
  document.querySelectorAll("#overviewEmployeeList [data-payslip-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const employee = employees().find((item) => item.id === button.dataset.payslipId);
      if (employee) showPayrollDetail(employee, currentMonth);
    });
  });

  const payslipHub = $("#payslipHubList");
  if (payslipHub) {
    payslipHub.innerHTML = overviewAll.length ? overviewAll.map((employee) => {
      const result = calculate(employee, employee.__payrollMonth);
      const statusClass = employee.salaryPaid ? "paid" : "pending";
      const statusText = employee.salaryPaid ? "Đã thanh toán" : "Chưa thanh toán";
      return `<button class="payslip-hub-item" type="button" data-payslip-hub-id="${employee.id}" data-payslip-month="${employee.__payrollMonth}">
        <span class="avatar ${result.remaining < 0 ? "has-negative-alert" : ""}">${avatarContent(employee)}</span>
        <span class="payslip-hub-copy"><strong>${escapeHtml(employee.name || "Chưa đặt tên")}</strong><small>${escapeHtml(employee.position || "Nhân viên")} · ${formatPayrollDate(result.period.start)} → ${formatPayrollDate(result.period.end)}</small><em class="${statusClass}">${statusText}</em></span>
        <span class="payslip-hub-money ${result.remaining < 0 ? "is-negative" : ""}"><b>${money.format(result.remaining)}</b><small>Thực nhận</small></span>
        <span class="payslip-hub-chevron">›</span>
      </button>`;
    }).join("") : `<div class="payslip-hub-empty"><strong>Chưa có nhân viên</strong><small>Thêm nhân viên trong Quản lý để tạo Phiếu lương.</small></div>`;
  }

  $("#emptyState").hidden = all.length !== 0 || query !== "";
  $("#employeeList").hidden = filtered.length === 0;
  $(".employee-table-scroll").hidden = filtered.length === 0;
  $(".overview-table-scroll").hidden = all.length === 0;
  $("#overviewEmpty").hidden = all.length !== 0;
  renderOrganizationLogoSetting();
}

function showDialog(employee = null) {
  $("#employeeForm").reset();
  $("#employeeId").value = employee?.id || "";
  $("#deleteEmployee").hidden = !employee;
  $("#exportEmployeeInfo").hidden = !employee;
  $("#exportEmployeeInfo").dataset.employeeId = employee?.id || "";
  $("#name").value = employee?.name || "";
  $("#position").value = employee?.position || "";
  const startDate = employee?.employmentStart || todayKey();
  $("#employmentStart").value = /^\d{4}-\d{2}$/.test(startDate) ? `${startDate}-01` : startDate;
  $("#citizenId").value = employee?.citizenId || "";
  $("#driverLicense").value = employee?.driverLicense || "";
  const useEmployeePhoto = employee?.useEmployeePhotoAsAvatar !== false;
  document.querySelector(`input[name="avatarSource"][value="${useEmployeePhoto ? "employee" : "custom"}"]`).checked = true;
  $("#avatarImageStatus").textContent = employee?.avatarImage ? "Đã lưu ảnh riêng" : "Chưa có ảnh riêng";
  $("#employeePhotoStatus").textContent = employee?.employeePhoto ? "Đã lưu ảnh" : "Chưa có ảnh";
  $("#citizenIdFrontImageStatus").textContent = employee?.citizenIdFrontImage || employee?.citizenIdImage ? "Đã lưu ảnh" : "Chưa có ảnh";
  $("#citizenIdBackImageStatus").textContent = employee?.citizenIdBackImage ? "Đã lưu ảnh" : "Chưa có ảnh";
  $("#driverLicenseFrontImageStatus").textContent = employee?.driverLicenseFrontImage || employee?.driverLicenseImage ? "Đã lưu ảnh" : "Chưa có ảnh";
  $("#driverLicenseBackImageStatus").textContent = employee?.driverLicenseBackImage ? "Đã lưu ảnh" : "Chưa có ảnh";
  $("#baseSalary").value = employee?.baseSalary || "";
  $("#payrollMethod").value = employee?.payrollMethod || "month-start";
  $("#payrollCustomStartDate").value = employee?.payrollCustomStartDate || employee?.employmentStart || todayKey();
  $("#payrollCustomStartDateWrap").hidden = $("#payrollMethod").value !== "custom-start";
  $("#payrollEndMode").value = employee?.payrollEndMode || "full-period";
  $("#employmentEnd").value = employee?.employmentEnd || "";
  $("#employmentEndWrap").hidden = $("#payrollEndMode").value !== "termination-date";
  editingEmployeeMonth = employee ? (employee.__payrollMonth || editingEmployeeMonth || currentMonth) : currentMonth;
  formatCurrencyInput($("#baseSalary"));
  const employeeDialog = $("#employeeDialog");
  employeeDialog.hidden = false;
  employeeDialog.removeAttribute("hidden");
  setTimeout(() => $("#name").focus(), 50);
}

function addBonusRow(item = {}) {
  $("#bonusRows").insertAdjacentHTML("beforeend", `<div class="repeat-row bonus-row" data-id="${item.id || newId()}">
    <input class="repeat-reason" maxlength="100" placeholder="Lý do thưởng" value="${escapeHtml(item.reason || "")}" />
    <div class="money-input"><input class="repeat-amount" type="number" min="0" step="1000" inputmode="numeric" placeholder="Số tiền" value="${item.amount || ""}" /><b>₫</b></div>
    <button class="remove-row" type="button" aria-label="Xóa khoản thưởng">×</button>
  </div>`);
}

function addAdvanceRow(item = {}) {
  $("#advanceRows").insertAdjacentHTML("beforeend", `<div class="repeat-row advance-row" data-id="${item.id || newId()}">
    <input class="repeat-date" type="date" value="${escapeHtml(item.date || todayKey())}" />
    <div class="money-input"><input class="repeat-amount" type="number" min="0" step="1000" inputmode="numeric" placeholder="Số tiền ứng" value="${item.amount || ""}" /><b>₫</b></div>
    <button class="remove-row" type="button" aria-label="Xóa lần ứng">×</button>
  </div>`);
  setupIosDatePickers($("#advanceRows"));
}

function addLeaveRow(item = {}) {
  $("#leaveRows").insertAdjacentHTML("beforeend", `<div class="repeat-row leave-row" data-id="${item.id || newId()}">
    <input class="repeat-date" type="date" value="${escapeHtml(item.date || todayKey())}" />
    <select class="repeat-days" aria-label="Số ngày nghỉ"><option value="1" ${Number(item.days || 1) === 1 ? "selected" : ""}>1 ngày</option><option value="0.5" ${Number(item.days) === .5 ? "selected" : ""}>Nửa ngày</option></select>
    <button class="remove-row" type="button" aria-label="Xóa ngày nghỉ">×</button>
  </div>`);
  setupIosDatePickers($("#leaveRows"));
}

function showEmploymentDialog(employee) {
  if (!employee) return;
  const start = employee.employmentStart || currentMonth;
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = currentMonth.split("-").map(Number);
  const totalMonths = Math.max(0, (endYear - startYear) * 12 + endMonth - startMonth);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  $("#employmentName").textContent = employee.name || "Nhân viên";
  $("#employmentPeriod").innerHTML = `<strong>Từ tháng ${startMonth}/${startYear} đến tháng ${endMonth}/${endYear}</strong><span>Thời gian làm việc: <b>${years} năm ${months} tháng</b></span>`;
  $("#employmentDialog").showModal();
}

function closeEmploymentDialog() { $("#employmentDialog").close(); }
const entryConfig = {
  bonus: { plural: "Thưởng", add: "Thêm thưởng", edit: "Sửa thưởng", reasonLabel: "Tên khoản thưởng", placeholder: "Ví dụ: Thưởng tăng ca", fallback: "Thưởng" },
  advance: { plural: "Ứng lương", add: "Thêm lần ứng lương", edit: "Sửa lần ứng lương", reasonLabel: "Nội dung ứng lương", placeholder: "Ví dụ: Ứng lương đợt 1", fallback: "Ứng lương" },
  leave: { plural: "Ngày nghỉ", add: "Thêm ngày nghỉ", edit: "Sửa ngày nghỉ", reasonLabel: "Lý do nghỉ", placeholder: "Ví dụ: Nghỉ việc riêng", fallback: "Nghỉ phép" },
};

function entryCollection(employee, type) {
  const key = type === "bonus" ? "bonuses" : type === "advance" ? "advances" : "leaves";
  if (!Array.isArray(employee[key])) {
    employee[key] = type === "bonus" ? bonusEntries(employee) : type === "advance" ? advanceEntries(employee) : leaveEntries(employee);
  }
  return employee[key];
}

function entryDetails(employee, type, month = employee.__payrollMonth || currentMonth) {
  return periodEntryFilter(employee, month, type).map((entry) => ({
    ...entry,
    reason: entry.reason?.trim() || entryConfig[type].fallback,
    date: entry.date || "",
  }));
}

function showEntryList(employee, type) {
  if (!employee || !entryConfig[type]) return;
  const month = employee.__payrollMonth || currentMonth;
  const entries = entryDetails(employee, type, month);
  $("#entryListDialog").dataset.employeeId = employee.id;
  $("#entryListDialog").dataset.type = type;
  $("#entryListDialog").dataset.month = month;
  $("#entryListTitle").textContent = `${entryConfig[type].plural} · ${employee.name}`;
  $("#entryListHint").textContent = entries.length ? `${entries.length} khoản trong kỳ lương đang chọn` : "Chưa có khoản nào trong kỳ lương đang chọn";
  $("#addEntryFromList").textContent = `＋ ${entryConfig[type].add}`;
  $("#entryList").innerHTML = entries.length
    ? entries.map((entry) => {
      const value = type === "leave" ? `${Number(entry.days) || 1} ngày` : money.format(Number(entry.amount) || 0);
      const date = entry.date ? formatPayrollDate(entry.date) : "Chưa có ngày";
      return `<article class="entry-item ${type === "bonus" ? "income" : "deduction"}"><div><strong>${escapeHtml(entry.reason)}</strong><small>${escapeHtml(date)}</small></div><b>${escapeHtml(value)}</b><div class="entry-item-actions"><button class="button ghost" type="button" data-entry-edit="${entry.id}">Sửa</button><button class="button danger" type="button" data-entry-delete="${entry.id}">Xóa</button></div></article>`;
    }).join("")
    : `<div class="entry-empty"><strong>Chưa có ${entryConfig[type].plural.toLocaleLowerCase("vi")}</strong><span>Nhấn “${entryConfig[type].add}” để thêm khoản đầu tiên.</span></div>`;
  $("#entryListDialog").hidden = false;
  $("#entryListDialog").removeAttribute("hidden");
}

function closeEntryList() {
  $("#entryListDialog").hidden = true;
  delete $("#entryListDialog").dataset.employeeId;
  delete $("#entryListDialog").dataset.type;
  delete $("#entryListDialog").dataset.month;
}

function refreshEntryList() {
  const month = $("#entryListDialog").dataset.month || currentMonth;
  const employee = employeeMonth($("#entryListDialog").dataset.employeeId, month);
  if (employee) employee.__payrollMonth = month;
  const type = $("#entryListDialog").dataset.type;
  if (employee && type && !$("#entryListDialog").hidden) showEntryList(employee, type);
}

function showEntryDialog(employee, type, entryId = "") {
  if (!employee) return;
  const month = employee.__payrollMonth || currentMonth;
  const entry = entryId ? periodEntryFilter(employee, month, type).find((item) => item.id === entryId) : null;
  $("#entryForm").reset();
  $("#entryEmployeeId").value = employee.id;
  $("#entryEmployeeMonth").value = month;
  $("#entryType").value = type;
  $("#entryId").value = entry?.id || "";
  $("#entryDate").value = entry?.date || todayKey();
  $("#entryReason").value = entry?.reason || "";
  $("#entryReasonLabel").textContent = entryConfig[type].reasonLabel;
  $("#entryReason").placeholder = entryConfig[type].placeholder;
  $("#entryDialogTitle").textContent = `${entry ? entryConfig[type].edit : entryConfig[type].add} · ${employee.name}`;
  $("#entryReasonWrap").hidden = false;
  $("#entryAmountWrap").hidden = type === "leave";
  $("#entryDaysWrap").hidden = type !== "leave";
  $("#entryAmount").required = type !== "leave";
  $("#entryAmount").value = entry && type !== "leave" ? formatEntryAmount(entry.amount) : "";
  const days = String(entry?.days || 1);
  $("#entryDays").value = days;
  document.querySelectorAll("[data-leave-days]").forEach((button) => button.classList.toggle("active", button.dataset.leaveDays === days));
  $("#entryDialog").showModal();
}

function closeEntryDialog() { $("#entryDialog").close(); }

function submitEntry(event) {
  event.preventDefault();
  const targetMonth = $("#entryEmployeeMonth").value || currentMonth;
  const employee = employeeMonth($("#entryEmployeeId").value, targetMonth);
  const type = $("#entryType").value;
  if (!employee || !type) return;
  const date = $("#entryDate").value || todayKey();
  const entryId = $("#entryId").value;
  const list = entryCollection(employee, type);
  const values = type === "leave"
    ? { reason: $("#entryReason").value.trim() || entryConfig[type].fallback, date, days: Number($("#entryDays").value) || 1 }
    : { reason: $("#entryReason").value.trim() || entryConfig[type].fallback, date, amount: numberValue("entryAmount") };
  const existing = entryId ? list.find((item) => item.id === entryId) : null;
  if (existing) Object.assign(existing, values);
  else list.push({ id: newId(), ...values, periodKey: payrollPeriodKey(employee, targetMonth) });
  if (existing) existing.periodKey = payrollPeriodKey(employee, targetMonth);
  saveState();
  closeEntryDialog();
  render();
  refreshEntryList();
  showToast(existing ? "Đã cập nhật khoản mục" : "Đã thêm khoản mục");
}
function closeDialog() {
  $("#employeeDialog").hidden = true;
}

function payrollRow(label, value, tone = "") {
  return `<div class="salary-row ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function payrollBonusDetails(employee, month, totalBonus = 0) {
  const entries = periodEntryFilter(employee, month, "bonus")
    .map((entry) => ({
      reason: String(entry?.reason || "").trim() || "Thưởng",
      amount: Number(entry?.amount) || 0,
    }))
    .filter((entry) => entry.amount > 0);
  if (entries.length) return entries;
  return Number(totalBonus) > 0 ? [{ reason: "Thưởng", amount: Number(totalBonus) }] : [];
}

function formatPayrollDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return "Chưa cập nhật";
  return match[3] ? `${match[3]}/${match[2]}/${match[1]}` : `Tháng ${Number(match[2])}/${match[1]}`;
}

function showPayrollDetail(employee, month = employee?.__payrollMonth || managementMonth(employee) || currentMonth) {
  if (!employee) return;
  payslipEmployeeId = employee.id;
  payslipMonth = month;
  const payrollEmployee = employeeMonth(employee.id, month) || employee;
  payrollEmployee.__payrollMonth = month;
  const payrollElements = {
    dialog: document.getElementById("payrollDialog"),
    month: document.getElementById("payslipMonth"),
    avatar: document.getElementById("payslipAvatar"),
    name: document.getElementById("payslipName"),
    position: document.getElementById("payslipPosition"),
    payment: document.getElementById("togglePayrollPayment"),
    paymentLabel: document.getElementById("payslipPaymentLabel"),
    profileInfo: document.getElementById("payslipProfileInfo"),
    profilePhotos: document.getElementById("payslipProfilePhotos"),
    income: document.getElementById("payslipIncome"),
    incomeSection: document.getElementById("payslipIncomeSection"),
    deductions: document.getElementById("payslipDeductions"),
    deductionSection: document.getElementById("payslipDeductionSection"),
    remaining: document.getElementById("payslipRemaining"),
    note: document.getElementById("payslipNote"),
    noteWrap: document.getElementById("payslipNoteWrap"),
  };
  if (Object.values(payrollElements).some((element) => !element)) {
    showToast("Phiếu lương chưa được tải đầy đủ, vui lòng tải lại trang");
    return;
  }
  const result = calculate(payrollEmployee, month);
  const [year, monthNumber] = month.split("-");
  payrollElements.month.innerHTML = `<span>Kỳ lương ${escapeHtml(formatPayrollDate(result.period.start))} → ${escapeHtml(formatPayrollDate(result.period.end))}</span><select id="payslipSavedMonth" aria-label="Xem lương theo tháng đã lưu">${savedMonthOptions(employee.id, month)}</select>`;
  payrollElements.avatar.innerHTML = avatarContent(payrollEmployee);
  $("#payslipOrganizationLogo").src = organizationLogo() || "./icon.svg";
  payrollElements.avatar.classList.toggle("has-negative-alert", result.remaining < 0);
  payrollElements.name.textContent = payrollEmployee.name || "Nhân viên";
  payrollElements.position.textContent = payrollEmployee.position || "Nhân viên";
  payrollElements.payment.className = `payment-status payment-with-balance ${payrollEmployee.salaryPaid ? "paid" : "pending"}`;
  payrollElements.paymentLabel.textContent = payrollEmployee.salaryPaid ? "✓ Đã thanh toán" : "Chưa thanh toán";
  payrollElements.payment.dataset.employeeId = payrollEmployee.id;
  payrollElements.payment.dataset.month = month;
  payrollElements.payment.setAttribute("aria-pressed", payrollEmployee.salaryPaid ? "true" : "false");

  const profileItems = [
    ["Kỳ lương", `${formatPayrollDate(result.period.start)} → ${formatPayrollDate(result.period.end)}`],
    ["Mức lương tháng", money.format(payrollEmployee.baseSalary)],
  ];
  if (result.period.isPartialEnd && payrollEmployee.employmentEnd) profileItems.push(["Ngày chốt sớm", formatPayrollDate(payrollEmployee.employmentEnd)]);
  payrollElements.profileInfo.innerHTML = profileItems.map(([label, value]) => `<div class="salary-profile-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("");
  const profilePhotos = [
    ["Ảnh nhân viên", payrollEmployee.employeePhoto],
    ["Căn cước · Mặt trước", payrollEmployee.citizenIdFrontImage || payrollEmployee.citizenIdImage],
    ["Căn cước · Mặt sau", payrollEmployee.citizenIdBackImage],
    ["Bằng lái · Mặt trước", payrollEmployee.driverLicenseFrontImage || payrollEmployee.driverLicenseImage],
    ["Bằng lái · Mặt sau", payrollEmployee.driverLicenseBackImage],
  ].filter(([, source]) => Boolean(source));
  payrollElements.profilePhotos.innerHTML = profilePhotos.map(([label, source]) => `<figure><img src="${escapeHtml(source)}" alt="${escapeHtml(label)}" /><figcaption>${escapeHtml(label)}</figcaption></figure>`).join("");
  payrollElements.profilePhotos.hidden = profilePhotos.length === 0;

  const incomeRows = [];
  if (payrollEmployee.baseSalary > 0) incomeRows.push(payrollRow("Lương tháng", money.format(payrollEmployee.baseSalary)));
  if (result.payableBase > 0 && Math.round(result.payableBase) !== Math.round(payrollEmployee.baseSalary)) {
    const workedDaysDisplay = Number.isFinite(result.workedDays) ? result.workedDays : Math.round((result.payableBase / Math.max(1, Number(payrollEmployee.baseSalary) || 0)) * result.salaryDays);
    incomeRows.push(payrollRow("Số ngày tính lương", `${workedDaysDisplay}/${result.salaryDays} ngày`));
    incomeRows.push(payrollRow("Lương tính trong kỳ", money.format(result.payableBase)));
  }
  const bonusDetails = payrollBonusDetails(payrollEmployee, month, result.bonus);
  bonusDetails.forEach((bonus) => incomeRows.push(payrollRow(bonus.reason, `+ ${money.format(bonus.amount)}`, "income")));
  if (bonusDetails.length > 1) incomeRows.push(payrollRow("Tổng thưởng", `+ ${money.format(result.bonus)}`, "income"));
  payrollElements.income.innerHTML = incomeRows.join("");
  payrollElements.incomeSection.hidden = incomeRows.length === 0;

  const deductionRows = [];
  if (result.advance > 0) deductionRows.push(payrollRow("Ứng lương", `− ${money.format(result.advance)}`, "deduction"));
  if (result.leaveDays > 0) deductionRows.push(payrollRow("Số ngày nghỉ", `${result.leaveDays} ngày`));
  if (result.leaveDeduction > 0) deductionRows.push(payrollRow("Tiền nghỉ bị trừ", `− ${money.format(result.leaveDeduction)}`, "deduction"));
  if (payrollEmployee.otherDeduction > 0) deductionRows.push(payrollRow("Khoản trừ khác", `− ${money.format(payrollEmployee.otherDeduction)}`, "deduction"));
  if (result.totalDeduction > 0) deductionRows.push(payrollRow("Tổng khấu trừ", `− ${money.format(result.totalDeduction)}`, "deduction"));
  payrollElements.deductions.innerHTML = deductionRows.join("");
  payrollElements.deductionSection.hidden = deductionRows.length === 0;
  payrollElements.remaining.textContent = money.format(result.remaining);
  payrollElements.remaining.classList.toggle("is-negative", result.remaining < 0);
  payrollElements.note.textContent = payrollEmployee.note || "";
  payrollElements.noteWrap.hidden = !payrollEmployee.note;

  payrollElements.dialog.dataset.employeeId = employee.id;
  payrollElements.dialog.dataset.month = month;
  payrollElements.dialog.hidden = false;
  payrollElements.dialog.removeAttribute("hidden");
}

function closePayrollDetail() {
  $("#payrollDialog").hidden = true;
}

function toggleSalaryPayment(employeeId, month = currentMonth) {
  const employee = employeeMonth(employeeId, month);
  if (!employee || employee.archived) return;
  employee.salaryPaid = !employee.salaryPaid;
  employee.salaryPaidAt = employee.salaryPaid ? todayKey() : "";
  saveState();
  render();
  if (!$("#payrollDialog").hidden) showPayrollDetail(employee);
  showToast(employee.salaryPaid ? "Đã đánh dấu thanh toán lương" : "Đã chuyển về chưa thanh toán");
}

function formEmployee(previous = {}) {
  return {
    ...previous,
    id: $("#employeeId").value || newId(),
    name: $("#name").value.trim(),
    position: $("#position").value.trim(),
    employmentStart: $("#employmentStart").value || todayKey(),
    payrollMethod: $("#payrollMethod").value || "month-start",
    payrollCustomStartDate: $("#payrollCustomStartDate").value || "",
    payrollEndMode: $("#payrollEndMode").value || "full-period",
    employmentEnd: $("#payrollEndMode").value === "termination-date" ? ($("#employmentEnd").value || "") : "",
    citizenId: $("#citizenId").value.trim(),
    driverLicense: $("#driverLicense").value.trim(),
    useEmployeePhotoAsAvatar: document.querySelector('input[name="avatarSource"]:checked')?.value !== "custom",
    baseSalary: numberValue("baseSalary"),
    bonuses: bonusEntries(previous),
    advances: advanceEntries(previous),
    leaves: leaveEntries(previous),
    otherDeduction: Number(previous.otherDeduction) || 0,
    note: $("#note").value.trim()
  };
}

function readImage(inputId, existingValue = "") {
  const file = $(`#${inputId}`).files[0];
  if (!file) return Promise.resolve(existingValue);
  if (file.size > 1_500_000) {
    showToast("Mỗi ảnh tối đa 1,5 MB để lưu an toàn trên thiết bị");
    return Promise.reject(new Error("Ảnh quá lớn"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function submitEmployee(event) {
  event.preventDefault();
  const employeeId = $("#employeeId").value;
  const targetMonth = editingEmployeeMonth || currentMonth;
  ensurePeriodEmployeesFor(targetMonth);
  const previous = state.periods[targetMonth]?.find((item) => item.id === employeeId);
  const employee = formEmployee(previous);
  if (!employee.name) return;
  if (employee.payrollEndMode === "termination-date") {
    if (!employee.employmentEnd) {
      showToast("Chọn ngày chốt sớm");
      return;
    }
    if (employee.employmentStart && employee.employmentEnd < employee.employmentStart) {
      showToast("Ngày nghỉ không thể trước ngày vào làm");
      return;
    }
  }
  employee.archived = Boolean(previous?.archived);
  try {
    employee.avatarImage = await readImage("avatarImage", previous?.avatarImage);
    employee.employeePhoto = await readImage("employeePhoto", previous?.employeePhoto);
    employee.citizenIdFrontImage = await readImage("citizenIdFrontImage", previous?.citizenIdFrontImage || previous?.citizenIdImage);
    employee.citizenIdBackImage = await readImage("citizenIdBackImage", previous?.citizenIdBackImage);
    employee.driverLicenseFrontImage = await readImage("driverLicenseFrontImage", previous?.driverLicenseFrontImage || previous?.driverLicenseImage);
    employee.driverLicenseBackImage = await readImage("driverLicenseBackImage", previous?.driverLicenseBackImage);
  } catch { return; }  const list = employees();
  const index = list.findIndex((item) => item.id === employee.id);
  if (index >= 0) list[index] = employee;
  else list.push(employee);
  state.periods[targetMonth] = list;
  saveState();
  closeDialog();
  render();
  showToast(index >= 0 ? "Đã cập nhật nhân viên" : "Đã thêm nhân viên");
}

function backupFile() {
  const payload = JSON.stringify({ app: "tinh-luong", version: 1, createdAt: new Date().toISOString(), data: state }, null, 2);
  return new File([payload], `tinh-luong-sao-luu-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
}

function downloadBackup() {
  const file = backupFile();
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Đã tạo file sao lưu");
}

async function shareBackup() {
  const file = backupFile();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: "Sao lưu Quản lý tiền lương", files: [file] });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  downloadBackup();
}

async function importBackup(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const restored = parsed?.app === "tinh-luong" ? parsed.data : parsed;
    if (!restored || typeof restored.periods !== "object" || Array.isArray(restored.periods) || !Object.values(restored.periods).every(Array.isArray)) {
      throw new Error("File sao lưu không hợp lệ");
    }
    if (!confirm("Phục hồi sẽ thay thế toàn bộ dữ liệu hiện tại. Tiếp tục?")) return;
    state = restored;
    saveState();
    selectionModeAll = false;
    selectedEmployeeIds.clear();
    render();
    showToast("Đã phục hồi dữ liệu");
  } catch (error) {
    showToast(error.message || "File sao lưu không hợp lệ");
  } finally {
    input.value = "";
  }
}

function requestResetAllData() {
  pendingEmployeeAction = { type: "reset" };
  $("#confirmActionEyebrow").textContent = "XÓA TRẮNG DỮ LIỆU";
  $("#confirmActionTitle").textContent = "Đưa hệ thống về trạng thái gốc?";
  $("#confirmActionMessage").textContent = "Toàn bộ nhân viên, ảnh hồ sơ, lương và các khoản phát sinh lưu trên thiết bị này sẽ bị xóa. Dữ liệu chưa sao lưu sẽ không thể khôi phục.";
  $("#confirmAction").textContent = "Đồng ý xóa hết";
  $("#confirmAction").className = "button danger";
  $("#confirmActionDialog").showModal();
}

function requestEmployeeAction(type, id = $("#employeeId").value) {
  const employee = employees().find((item) => item.id === id);
  if (!employee) return;
  const isRestore = type === "archive" && employee.archived;
  pendingEmployeeAction = { type, id };
  $("#confirmActionEyebrow").textContent = type === "delete" ? "XÓA NHÂN VIÊN" : isRestore ? "MỞ LẠI NHÂN VIÊN" : "LƯU TRỮ NHÂN VIÊN";
  $("#confirmActionTitle").textContent = type === "delete" ? `Xóa ${employee.name}?` : isRestore ? `Mở lại ${employee.name}?` : `Lưu trữ ${employee.name}?`;
  $("#confirmActionMessage").textContent = type === "delete"
    ? `Bạn sắp xóa toàn bộ dữ liệu của ${employee.name} trong kỳ lương đang chọn. Thao tác này không thể hoàn tác.`
    : isRestore
      ? `Thông tin của ${employee.name} sẽ hoạt động trở lại và có thể tiếp tục cập nhật lương.`
      : `Thông tin của ${employee.name} sẽ được giữ lại, hiển thị mờ và tạm khóa cập nhật khoản lương cho đến khi Mở lại.`;
  $("#confirmAction").textContent = type === "delete" ? "Đồng ý xóa" : isRestore ? "Đồng ý mở lại" : "Đồng ý lưu trữ";
  $("#confirmAction").className = `button ${type === "delete" ? "danger" : "primary"}`;
  $("#confirmActionDialog").showModal();
}

function requestEntryDelete(employee, entryType, entryId) {
  const month = employee.__payrollMonth || currentMonth;
  const entry = periodEntryFilter(employee, month, entryType).find((item) => item.id === entryId);
  if (!entry) return;
  pendingEmployeeAction = { type: "entry-delete", id: employee.id, entryType, entryId, month };
  $("#confirmActionEyebrow").textContent = "XÓA KHOẢN MỤC";
  $("#confirmActionTitle").textContent = `Xóa ${entryConfig[entryType].plural.toLocaleLowerCase("vi")}?`;
  $("#confirmActionMessage").textContent = `Khoản này sẽ bị xóa khỏi kỳ lương đang chọn. Bạn có thể chọn Hủy để giữ lại dữ liệu.`;
  $("#confirmAction").textContent = "Đồng ý xóa";
  $("#confirmAction").className = "button danger";
  $("#confirmActionDialog").showModal();
}

function closeConfirmAction() {
  pendingEmployeeAction = null;
  $("#confirmActionDialog").close();
}

function deleteEmployee() {
  requestEmployeeAction("delete");
}

function toggleArchiveEmployee(id = $("#employeeId").value) {
  requestEmployeeAction("archive", id);
}

function confirmEmployeeAction() {
  const action = pendingEmployeeAction;
  if (!action) return closeConfirmAction();
  if (action.type === "reset") {
    currentMonth = monthKey(new Date());
    state = { periods: { [currentMonth]: [] }, sampleProfilesVersion: 4, defaultProfilesAdded: true };
    $("#payrollMonth").value = `${currentMonth}-01`;
    selectionModeAll = false;
    selectedEmployeeIds.clear();
    closeConfirmAction();
    render();
    saveState();
    showToast("Đã xóa toàn bộ dữ liệu");
    return;
  }
  const actionMonth = action.month || currentMonth;
  const employee = employeeMonth(action.id, actionMonth);
  if (!employee) return closeConfirmAction();
  if (action.type === "entry-delete") {
    const key = action.entryType === "bonus" ? "bonuses" : action.entryType === "advance" ? "advances" : "leaves";
    employee[key] = entryCollection(employee, action.entryType).filter((item) => item.id !== action.entryId);
    saveState();
    closeConfirmAction();
    render();
    showEntryList(employee, action.entryType);
    showToast("Đã xóa khoản mục");
    return;
  }
  if (action.type === "delete") {
    state.periods[currentMonth] = employees().filter((item) => item.id !== employee.id);
    showToast(`Đã xóa ${employee.name}`);
  } else {
    employee.archived = !employee.archived;
    showToast(employee.archived ? `Đã lưu trữ ${employee.name}` : `Đã mở lại ${employee.name}`);
  }
  saveState();
  closeConfirmAction();
  if (!$("#employeeDialog").hidden) closeDialog();
  render();
}

function goToToday() {
  archiveCompletedPayrolls();
  const targetMonth = realCurrentMonth();
  currentMonth = targetMonth;
  const ids = new Set(Object.values(state.periods || {}).flatMap((list) => (list || []).map((employee) => employee.id)));
  ids.forEach((id) => setManagementMonth(id, targetMonth));
  editingEmployeeMonth = targetMonth;
  payslipMonth = targetMonth;
  $("#payrollMonth").value = todayKey();
  selectionModeAll = true;
  selectedEmployeeIds.clear();
  render();
  showToast("Đã trở về kỳ lương hiện tại");
}

function copyPrevious() {
  const sourceMonth = previousMonth(currentMonth);
  const source = state.periods[sourceMonth] || [];
  if (!source.length) {
    showToast("Tháng trước chưa có dữ liệu");
    return;
  }
  if (employees().length && !confirm("Kỳ hiện tại đã có dữ liệu. Bạn muốn thay thế bằng dữ liệu tháng trước?")) return;
  state.periods[currentMonth] = source.map((employee) => ({
    ...employee, id: newId(), bonuses: [], advances: [], leaves: [], otherDeduction: 0, salaryPaid: false, salaryPaidAt: "", note: ""
  }));
  saveState();
  render();
  showToast(`Đã sao chép ${source.length} nhân viên`);
}

let pendingExportView = "overview";
function renderExportOptions() {
  const all = employees();
  $("#exportDialogHint").textContent = "Ảnh sẽ chụp trọn phần từ Kỳ lương đến Công thức tính lương.";
  const employeeButtons = all.map((employee) => `<button class="button ghost" type="button" data-export-employee="${employee.id}">Xuất ${escapeHtml(employee.name || "Nhân viên")}</button>`);
  const fullButton = `<button class="button primary" type="button" data-export-all>Xuất toàn bộ ${all.length} nhân viên</button>`;
  $("#exportOptions").innerHTML = [fullButton, ...employeeButtons].join("");
}

function openExportDialog(view) {
  pendingExportView = view;
  $("#exportDialogTitle").textContent = `Xuất ${view === "overview" ? "Tổng quan lương" : "Quản lý nhân viên"}`;
  renderExportOptions();
  $("#exportDialog").hidden = false;
}

function closeExportDialog() { $("#exportDialog").hidden = true; }

async function saveExportImage(png, filename) {
  const imageFile = new File([png], filename, { type: "image/png" });
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(navigator.userAgent) && !/(Chrome|Chromium|CriOS|Edg|OPR|FxiOS)/i.test(navigator.userAgent);
  if (isIos || isSafari) {
    if (pendingIosExport?.url) URL.revokeObjectURL(pendingIosExport.url);
    const previewSource = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(png);
    });
    pendingIosExport = { file: imageFile, png, filename, url: "", previewSource };
    $("#iosExportTitle").textContent = filename.startsWith("phieu-luong-") ? "Lưu Phiếu lương" : "Lưu thông tin nhân viên";
    $("#iosExportImage").src = previewSource;
    $("#iosExportPreview").hidden = false;
    return;
  }
  downloadImageBlob(png, filename);
}

function downloadImageBlob(png, filename) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(png);
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  showToast("Đã tải ảnh bảng lương");
}

function closeIosExportPreview() {
  $("#iosExportPreview").hidden = true;
  $("#iosExportImage").removeAttribute("src");
  if (pendingIosExport?.url) URL.revokeObjectURL(pendingIosExport.url);
  pendingIosExport = null;
}

async function shareIosExport() {
  if (!pendingIosExport) return;
  const { file, png, filename } = pendingIosExport;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Phiếu lương" });
      closeIosExportPreview();
      showToast("Chọn Lưu ảnh để đưa bảng lương vào Album");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  downloadImageBlob(png, filename);
  closeIosExportPreview();
}

async function canvasToPng(canvas) {
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Không thể tạo ảnh PNG");
  return png;
}

async function captureAndSaveImage(target, filename, prepareClone) {
  await (document.fonts?.ready || Promise.resolve());
  const canvas = await window.html2canvas(target, {
    backgroundColor: getComputedStyle(target).backgroundColor,
    scale: Math.max(2, window.devicePixelRatio || 1),
    useCORS: true,
    logging: false,
    onclone: prepareClone,
  });
  await saveExportImage(await canvasToPng(canvas), filename);
}

async function exportFullPayrollImage(view, employeeIds = null) {
  const all = employees();
  const selected = employeeIds ? all.filter((employee) => employeeIds.includes(employee.id)) : all;
  if (!selected.length) return showToast("Chưa có nhân viên để xuất");
  if (typeof window.html2canvas !== "function") return showToast("Chưa tải được bộ chụp giao diện");

  const previousView = currentView;
  const previousSelectionMode = selectionModeAll;
  const previousSelectedIds = new Set(selectedEmployeeIds);
  const selectedIds = new Set(selected.map((employee) => employee.id));
  const target = document.querySelector(".main-content");

  try {
    selectionModeAll = false;
    selectedEmployeeIds = new Set(selectedIds);
    closeExportDialog();
    setView(view, false);
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 180));
    await (document.fonts?.ready || Promise.resolve());

    const canvas = await window.html2canvas(target, {
      backgroundColor: getComputedStyle(document.querySelector(".finance-app")).backgroundColor,
      scale: Math.max(2, window.devicePixelRatio || 1),
      useCORS: true,
      letterRendering: true,
      windowWidth: 1440,
      windowHeight: Math.max(900, target.scrollHeight),
      logging: false,
      onclone: (documentClone) => {
        documentClone.documentElement.classList.add("export-capture");
        documentClone.querySelectorAll("dialog, .information-modal, .export-sheet").forEach((element) => element.remove());
        documentClone.querySelector(".page-title")?.remove();
        documentClone.querySelector(".main-content > footer")?.remove();
        const exportDate = documentClone.querySelector("#payrollMonth");
        if (exportDate) {
          const sourceStyle = getComputedStyle(document.querySelector("#payrollMonth"));
          const dateValue = documentClone.createElement("div");
          dateValue.className = "export-date-value";
          dateValue.textContent = exportDate.value || `${currentMonth}-01`;
          dateValue.style.cssText = `box-sizing:border-box;display:flex;align-items:center;width:${sourceStyle.width};height:${sourceStyle.height};margin:0;padding:0 14px;border:${sourceStyle.border};border-radius:${sourceStyle.borderRadius};background:${sourceStyle.backgroundColor};color:${sourceStyle.color};font:${sourceStyle.font};font-weight:700;line-height:1;`;
          exportDate.replaceWith(dateValue);
        }
      }
    });
    const filename = `${view === "overview" ? "tong-quan-luong" : "quan-ly-nhan-vien"}-${currentMonth}.png`;
    await saveExportImage(await canvasToPng(canvas), filename);
  } catch {
    showToast("Không thể chụp giao diện, vui lòng thử lại");
  } finally {
    selectionModeAll = previousSelectionMode;
    selectedEmployeeIds = previousSelectedIds;
    setView(previousView, false);
    render();
  }
}

async function exportEmployeeInformation(employeeId) {
  const employee = employees().find((item) => item.id === employeeId);
  const form = $("#employeeForm");
  if (!employee) return showToast("Không tìm thấy nhân viên");
  if (typeof window.html2canvas !== "function") return showToast("Chưa tải được bộ chụp giao diện");
  try {
    const safeName = employee.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "nhan-vien";
    await captureAndSaveImage(form, `thong-tin-${safeName}.png`, (documentClone) => {
        documentClone.querySelector("#employeeForm .dialog-actions")?.remove();
        documentClone.querySelector("#employeeForm #closeDialog")?.remove();
        documentClone.querySelectorAll('#employeeForm input[type="file"], #employeeForm .avatar-source-radio').forEach((control) => control.remove());
        const clonedForm = documentClone.querySelector("#employeeForm");
        if (clonedForm) clonedForm.style.cssText += ";max-height:none!important;height:auto!important;overflow:visible!important;";
    });
  } catch (error) {
    console.error("Xuất thông tin nhân viên thất bại", error);
    showToast("Không thể xuất thông tin, vui lòng thử lại");
  }
}

function payrollExportMoney(value) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))}đ`;
}

function payrollExportDateTime() {
  const now = new Date();
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);
}

function payrollCanvasRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function payrollCanvasWrapText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (consumed < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trim();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function payrollCanvasIcon(ctx, cx, cy, tone, label) {
  ctx.save();
  ctx.fillStyle = `${tone}18`;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tone;
  ctx.font = '800 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);
  ctx.restore();
}

function payrollCanvasCard(ctx, { x, y, width, title, icon, tone, rows }) {
  const headerH = 82;
  const rowH = 62;
  const height = headerH + rows.length * rowH + 18;
  ctx.save();
  ctx.shadowColor = "rgba(30, 64, 175, 0.08)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  payrollCanvasRoundRect(ctx, x, y, width, height, 30);
  ctx.fill();
  ctx.restore();

  payrollCanvasIcon(ctx, x + 55, y + 42, tone, icon);
  ctx.fillStyle = "#0f172a";
  ctx.font = '800 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, x + 100, y + 42);

  const leftX = x + 34;
  const rightX = x + width - 34;
  rows.forEach((row, index) => {
    const top = y + headerH + index * rowH;
    if (index > 0) {
      ctx.strokeStyle = "#e8edf5";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(leftX, top);
      ctx.lineTo(rightX, top);
      ctx.stroke();
    }
    const cy = top + rowH / 2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#64748b";
    ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const labelLines = payrollCanvasWrapText(ctx, row.label, width * 0.47, 2);
    if (labelLines.length === 1) ctx.fillText(labelLines[0], leftX, cy);
    else {
      ctx.font = '500 21px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(labelLines[0], leftX, cy - 12);
      ctx.fillText(labelLines[1], leftX, cy + 13);
    }

    const valueColor = row.color || "#0f172a";
    if (row.badge) {
      ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textWidth = ctx.measureText(row.value).width;
      const badgeW = textWidth + 38;
      const badgeH = 40;
      ctx.fillStyle = row.badgeBg || "#fff1e8";
      payrollCanvasRoundRect(ctx, rightX - badgeW, cy - badgeH / 2, badgeW, badgeH, 20);
      ctx.fill();
      ctx.fillStyle = valueColor;
      ctx.textAlign = "center";
      ctx.fillText(row.value, rightX - badgeW / 2, cy + 1);
    } else {
      ctx.fillStyle = valueColor;
      ctx.font = `${row.bold === false ? "500" : "700"} 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = "right";
      const maxWidth = width * 0.54;
      const lines = payrollCanvasWrapText(ctx, row.value, maxWidth, 2);
      if (lines.length === 1) ctx.fillText(lines[0], rightX, cy);
      else {
        ctx.font = `${row.bold === false ? "500" : "700"} 21px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillText(lines[0], rightX, cy - 12);
        ctx.fillText(lines[1], rightX, cy + 13);
      }
    }
  });
  return y + height;
}

async function buildPayslipExportCanvas(employee, month) {
  const result = calculate(employee, month);
  const bonusDetails = payrollBonusDetails(employee, month, result.bonus);
  const bonusRowsForExport = bonusDetails.map((bonus) => ({ label: bonus.reason, value: `+${payrollExportMoney(bonus.amount)}`, color: "#129447" }));
  if (bonusDetails.length > 1) bonusRowsForExport.push({ label: "Tổng thưởng", value: `+${payrollExportMoney(result.bonus)}`, color: "#129447" });
  const extraBonusRows = Math.max(0, bonusRowsForExport.length - (result.bonus > 0 ? 1 : 0));
  const width = 1080;
  const height = 1920 + extraBonusRows * 62;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Không thể tạo vùng vẽ");

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#f5f9ff");
  background.addColorStop(0.48, "#fbfdff");
  background.addColorStop(1, "#f6fbf8");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Vệt nền kiểu iOS, rất nhẹ để ảnh không bị phẳng lì như tờ Excel tuyệt vọng.
  ctx.save();
  ctx.globalAlpha = 0.22;
  let glow = ctx.createRadialGradient(120, 80, 0, 120, 80, 330);
  glow.addColorStop(0, "#cfe4ff");
  glow.addColorStop(1, "rgba(207,228,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 500, 500);
  glow = ctx.createRadialGradient(930, 1640, 0, 930, 1640, 360);
  glow.addColorStop(0, "#c8f7da");
  glow.addColorStop(1, "rgba(200,247,218,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(540, 1280, 540, 640);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0b1b42";
  ctx.font = '800 52px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText("BẢNG TÍNH LƯƠNG", width / 2, 92);
  ctx.fillStyle = "#718096";
  ctx.font = '500 23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`Kỳ lương ${formatPayrollDate(result.period.start)} – ${formatPayrollDate(result.period.end)}`, width / 2, 137);

  const x = 56;
  const cardW = width - x * 2;
  let y = 188;
  y = payrollCanvasCard(ctx, {
    x, y, width: cardW, title: "Thông tin nhân viên", icon: "NV", tone: "#2878f0",
    rows: [
      { label: "Nhân viên", value: employee.name || "Nhân viên" },
      { label: "Chức vụ", value: employee.position || "Nhân viên", bold: false },
      { label: "Kỳ lương", value: `${formatPayrollDate(result.period.start)} – ${formatPayrollDate(result.period.end)}`, bold: false },
      { label: "Hình thức tính", value: payrollMethodLabel(employee), bold: false },
      { label: "Trạng thái", value: employee.salaryPaid ? "Đã thanh toán" : "Chưa thanh toán", color: employee.salaryPaid ? "#128a55" : "#f16b18", badge: true, badgeBg: employee.salaryPaid ? "#e8f8ef" : "#fff1e8" },
    ],
  }) + 22;

  const baseSalary = Number(employee.baseSalary) || 0;
  const exportWorkedDays = Number.isFinite(result.workedDays)
    ? result.workedDays
    : (baseSalary > 0 ? Math.max(0, Math.min(result.salaryDays, Math.round((result.payableBase / baseSalary) * result.salaryDays))) : 0);
  const workRows = [
    { label: "Tổng ngày trong kỳ", value: `${result.salaryDays} ngày`, bold: false },
    { label: "Số ngày tính lương", value: `${exportWorkedDays}/${result.salaryDays} ngày`, bold: false },
  ];
  if (result.period.isPartialEnd && employee.employmentEnd) workRows.push({ label: "Ngày chốt sớm", value: formatPayrollDate(employee.employmentEnd), bold: false });
  if (employee.note) workRows.push({ label: "Ghi chú", value: employee.note, bold: false });
  y = payrollCanvasCard(ctx, { x, y, width: cardW, title: "Thông tin chấm lương", icon: "L", tone: "#2878f0", rows: workRows }) + 22;

  y = payrollCanvasCard(ctx, {
    x, y, width: cardW, title: "Chi tiết thu nhập", icon: "+", tone: "#18a957",
    rows: [
      { label: "Lương cơ bản", value: payrollExportMoney(employee.baseSalary) },
      { label: "Lương tính trong kỳ", value: payrollExportMoney(result.payableBase) },
      ...bonusRowsForExport,
    ],
  }) + 22;

  y = payrollCanvasCard(ctx, {
    x, y, width: cardW, title: "Các khoản trừ", icon: "−", tone: "#f04455",
    rows: [
      { label: "Ứng lương", value: `−${payrollExportMoney(result.advance)}`, color: "#e32636" },
      { label: "Tiền nghỉ", value: `−${payrollExportMoney(result.leaveDeduction)}`, color: "#e32636" },
      { label: "Khoản trừ khác", value: `−${payrollExportMoney(employee.otherDeduction)}`, color: "#e32636" },
    ],
  }) + 24;

  const totalH = 152;
  const totalGrad = ctx.createLinearGradient(x, y, x + cardW, y + totalH);
  totalGrad.addColorStop(0, "#eafff1");
  totalGrad.addColorStop(1, "#d9fbe5");
  ctx.fillStyle = totalGrad;
  ctx.strokeStyle = "#afe9c5";
  ctx.lineWidth = 2;
  payrollCanvasRoundRect(ctx, x, y, cardW, totalH, 32);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#13a44d";
  payrollCanvasRoundRect(ctx, x + 28, y + 28, 96, 96, 28);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.font = '800 38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("₫", x + 76, y + 77);

  ctx.textAlign = "left";
  ctx.fillStyle = "#17783d";
  ctx.font = '800 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText("THỰC NHẬN", x + 154, y + 53);
  ctx.fillStyle = result.remaining < 0 ? "#d92d3f" : "#07843c";
  ctx.font = '800 54px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(payrollExportMoney(result.remaining), x + 154, y + 102);

  const footerY = Math.min(height - 76, y + totalH + 58);
  ctx.strokeStyle = "#dce4ef";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(100, footerY - 28);
  ctx.lineTo(width - 100, footerY - 28);
  ctx.stroke();
  ctx.fillStyle = "#7b879a";
  ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(`Ngày xuất: ${payrollExportDateTime()}`, width / 2, footerY);
  ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText("Phiếu lương điện tử", width / 2, footerY + 30);
  return canvas;
}

async function exportPayslipInformation(employeeId) {
  const exportMonth = payslipMonth || currentMonth;
  const employee = employeeMonth(employeeId, exportMonth) || employees().find((item) => item.id === employeeId);
  if (!employee) return showToast("Không tìm thấy nhân viên");
  try {
    const safeName = employee.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "nhan-vien";
    const canvas = await buildPayslipExportCanvas(employee, exportMonth);
    await saveExportImage(await canvasToPng(canvas), `phieu-luong-${safeName}-${exportMonth}.png`);
  } catch (error) {
    console.error("Xuất phiếu lương thất bại", error);
    showToast("Không thể xuất phiếu lương, vui lòng thử lại");
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2400);
}

$("#payrollMonth").value = `${currentMonth}-01`;
$("#payrollMonth").addEventListener("change", (event) => { archiveCompletedPayrolls(); currentMonth = event.target.value ? event.target.value.slice(0, 7) : monthKey(new Date()); selectionModeAll = false; selectedEmployeeIds.clear(); render(); });
["#overviewSavedMonth", "#managementSavedMonth"].forEach((selector) => {
  $(selector)?.addEventListener("change", (event) => {
    archiveCompletedPayrolls();
    currentMonth = event.target.value || realCurrentMonth();
    // Tổng quan và Quản lý dùng chung bộ lọc tháng; Quản lý là nguồn dữ liệu.
    employees().forEach((employee) => setManagementMonth(employee.id, currentMonth));
    $("#payrollMonth").value = `${currentMonth}-01`;
    selectionModeAll = false;
    selectedEmployeeIds.clear();
    render();
  });
});
$("#selectAllEmployees").addEventListener("change", (event) => {
  selectionModeAll = event.target.checked;
  selectedEmployeeIds.clear();
  render();
});
$("#selectAllEmployeesManage").addEventListener("change", (event) => {
  selectionModeAll = event.target.checked;
  selectedEmployeeIds.clear();
  render();
});
$("#employeeSelectionManage").addEventListener("pointerup", (event) => {
  const input = event.target.closest("input[data-manage-employee-id]") || event.target.closest("label")?.querySelector("input[data-manage-employee-id]");
  if (!input) return;
  event.preventDefault();
  const id = input.dataset.manageEmployeeId;
  if (selectionModeAll) selectedEmployeeIds = new Set(employees().map((employee) => employee.id));
  selectionModeAll = false;
  if (selectedEmployeeIds.has(id)) selectedEmployeeIds.delete(id);
  else selectedEmployeeIds.add(id);
  render();
});
$("#employeeSelection").addEventListener("pointerup", (event) => {
  const input = event.target.closest("input[data-employee-id]") || event.target.closest("label")?.querySelector("input[data-employee-id]");
  if (!input) return;
  event.preventDefault();
  const id = input.dataset.employeeId;
  if (selectionModeAll) selectedEmployeeIds = new Set(employees().map((employee) => employee.id));
  selectionModeAll = false;
  if (selectedEmployeeIds.has(id)) selectedEmployeeIds.delete(id);
  else selectedEmployeeIds.add(id);
  render();
});document.addEventListener("input", (event) => {
  if (event.target.matches(".currency-input")) formatCurrencyInput(event.target);
});
$("#emptyAdd").addEventListener("click", () => showDialog());
$("#addEmployeeHeader").addEventListener("click", () => showDialog());
$("#panelAdd").addEventListener("click", () => showDialog());
$("#resetAllData").addEventListener("click", requestResetAllData);
$("#overviewAdd").addEventListener("click", () => showDialog());
$("#openEmployeeManagement").addEventListener("click", () => setView("employees"));
$("#openOverview").addEventListener("click", () => setView("overview"));
$("#overviewExport").addEventListener("click", () => openExportDialog("overview"));
$("#panelExport").addEventListener("click", () => openExportDialog("employees"));
$("#cancelDialog").addEventListener("click", closeDialog);
$("#payrollMethod").addEventListener("change", (event) => { $("#payrollCustomStartDateWrap").hidden = event.target.value !== "custom-start"; });
$("#payrollEndMode").addEventListener("change", (event) => {
  $("#employmentEndWrap").hidden = event.target.value !== "termination-date";
  if (event.target.value === "termination-date" && !$("#employmentEnd").value) $("#employmentEnd").value = todayKey();
});
$("#employeeForm").addEventListener("submit", submitEmployee);
$("#organizationLogoInput").addEventListener("change", async (event) => {
  if (!event.currentTarget.files[0]) return;
  try {
    state.organizationLogo = await readImage("organizationLogoInput", state.organizationLogo);
    saveState();
    renderOrganizationLogoSetting();
    showToast("Đã cập nhật logo tổ chức");
  } catch {}
  event.currentTarget.value = "";
});
$("#removeOrganizationLogo").addEventListener("click", () => {
  state.organizationLogo = "";
  saveState();
  renderOrganizationLogoSetting();
  showToast("Đã dùng lại logo mặc định");
});
$("#avatarImage").addEventListener("change", (event) => {
  if (!event.currentTarget.files[0]) return;
  document.querySelector('input[name="avatarSource"][value="custom"]').checked = true;
  $("#avatarImageStatus").textContent = "Đã chọn ảnh mới";
});
$("#employeePhoto").addEventListener("change", (event) => {
  if (event.currentTarget.files[0]) $("#employeePhotoStatus").textContent = "Đã chọn ảnh mới";
});
$("#exportBackup").addEventListener("click", downloadBackup);
$("#shareBackup").addEventListener("click", shareBackup);
$("#importBackup").addEventListener("click", () => $("#importBackupFile").click());
$("#importBackupFile").addEventListener("change", importBackup);
$("#deleteEmployee").addEventListener("click", deleteEmployee);
$("#exportEmployeeInfo").addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Đang xuất…";
  try {
    await exportEmployeeInformation(button.dataset.employeeId);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});
$("#closeConfirmAction").addEventListener("click", closeConfirmAction);
$("#cancelConfirmAction").addEventListener("click", closeConfirmAction);
$("#confirmAction").addEventListener("click", confirmEmployeeAction);
$("#confirmActionDialog").addEventListener("click", (event) => { if (event.target === $("#confirmActionDialog")) closeConfirmAction(); });
$("#closeExportDialog").addEventListener("click", closeExportDialog);
$("#closeIosExport").addEventListener("click", closeIosExportPreview);
$("#shareIosExport").addEventListener("click", shareIosExport);
$("#iosExportPreview").addEventListener("click", (event) => { if (event.target === $("#iosExportPreview")) closeIosExportPreview(); });
$("#exportDialog").addEventListener("click", (event) => { if (event.target === $("#exportDialog")) closeExportDialog(); });
$("#exportOptions").addEventListener("click", (event) => {
  if (event.target.closest("[data-export-all]")) return exportFullPayrollImage(pendingExportView);
  const employeeButton = event.target.closest("[data-export-employee]");
  if (!employeeButton) return;
  return exportFullPayrollImage(pendingExportView, [employeeButton.dataset.exportEmployee]);
});
$("#iosPreviousMonth").addEventListener("click", () => { iosDisplayDate = new Date(iosDisplayDate.getFullYear(), iosDisplayDate.getMonth() - 1, 1); renderIosCalendar(); });
$("#iosNextMonth").addEventListener("click", () => { iosDisplayDate = new Date(iosDisplayDate.getFullYear(), iosDisplayDate.getMonth() + 1, 1); renderIosCalendar(); });
$("#iosCalendarDays").addEventListener("click", (event) => {
  const value = event.target.dataset.iosDate;
  if (!value || !iosDateTarget) return;
  iosDateTarget.value = value;
  iosDateTarget.dispatchEvent(new Event("change", { bubbles: true }));
  $("#iosDatePicker").close();
});
$("#iosToday").addEventListener("click", () => { if (iosDateTarget) { iosDateTarget.value = todayKey(); iosDateTarget.dispatchEvent(new Event("change", { bubbles: true })); } $("#iosDatePicker").close(); });
$("#iosCancel").addEventListener("click", () => $("#iosDatePicker").close());
$("#iosDatePicker").addEventListener("click", (event) => { if (event.target === $("#iosDatePicker")) $("#iosDatePicker").close(); });$("#closeEmploymentDialog").addEventListener("click", closeEmploymentDialog);
$("#doneEmploymentDialog").addEventListener("click", closeEmploymentDialog);
$("#employmentDialog").addEventListener("click", (event) => { if (event.target === $("#employmentDialog")) closeEmploymentDialog(); });
$("#entryDaysWrap").addEventListener("click", (event) => {
  const button = event.target.closest("[data-leave-days]");
  if (!button) return;
  $("#entryDays").value = button.dataset.leaveDays;
  document.querySelectorAll("[data-leave-days]").forEach((item) => item.classList.toggle("active", item === button));
});$("#closeEntryDialog").addEventListener("click", closeEntryDialog);
$("#cancelEntryDialog").addEventListener("click", closeEntryDialog);
$("#entryForm").addEventListener("submit", submitEntry);
$("#entryDialog").addEventListener("click", (event) => { if (event.target === $("#entryDialog")) closeEntryDialog(); });
$("#closeEntryList").addEventListener("click", closeEntryList);
$("#closeEntryListFooter").addEventListener("click", closeEntryList);
$("#entryListDialog").addEventListener("click", (event) => { if (event.target === $("#entryListDialog")) closeEntryList(); });
$("#addEntryFromList").addEventListener("click", () => {
  const employee = employees().find((item) => item.id === $("#entryListDialog").dataset.employeeId);
  const type = $("#entryListDialog").dataset.type;
  if (employee && type) showEntryDialog(employee, type);
});
$("#entryList").addEventListener("click", (event) => {
  const employee = employees().find((item) => item.id === $("#entryListDialog").dataset.employeeId);
  const type = $("#entryListDialog").dataset.type;
  if (!employee || !type) return;
  const edit = event.target.closest("[data-entry-edit]");
  if (edit) return showEntryDialog(employee, type, edit.dataset.entryEdit);
  const remove = event.target.closest("[data-entry-delete]");
  if (remove) requestEntryDelete(employee, type, remove.dataset.entryDelete);
});
$("#goToday").addEventListener("click", goToToday);
$("#copyPrevious").addEventListener("click", copyPrevious);


$("#themeToggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
$("#showAppBrand")?.addEventListener("change", (event) => {
  applyBrandVisibility(event.currentTarget.checked);
  showToast(event.currentTarget.checked ? "Đã hiện thanh logo và tên ứng dụng" : "Đã ẩn thanh logo và tên ứng dụng");
});
$("#showAppCredit")?.addEventListener("change", (event) => {
  applyCreditVisibility(event.currentTarget.checked);
  showToast(event.currentTarget.checked ? "Đã hiện thông tin thiết kế" : "Đã ẩn thông tin thiết kế");
});
$("#showPayrollPeriod")?.addEventListener("change", (event) => {
  applyPeriodVisibility(event.currentTarget.checked);
  render();
  showToast(event.currentTarget.checked ? "Đã hiện thanh Kỳ lương" : "Đã chuyển kỳ lương xuống từng nhân viên");
});
$("#updateSoftware")?.addEventListener("click", updateSoftware);
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
  button.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    setView(button.dataset.view);
  });
});
$("#payslipHubList")?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-payslip-hub-id]");
  if (!item) return;
  const month = item.dataset.payslipMonth || currentMonth;
  const employee = employeeMonth(item.dataset.payslipHubId, month) || employees().find((candidate) => candidate.id === item.dataset.payslipHubId);
  if (employee) showPayrollDetail(employee, month);
});
$("#themeSettingButton")?.addEventListener("click", () => $("#themeToggle")?.click());
document.querySelectorAll(".ios-setting-group").forEach((group) => {
  group.addEventListener("toggle", () => {
    if (!group.open) return;
    document.querySelectorAll(".ios-setting-group[open]").forEach((other) => { if (other !== group) other.removeAttribute("open"); });
  });
});

$("#hiddenManagementColumnsList")?.addEventListener("click", (event) => {
  const restore = event.target.closest("[data-column-restore]");
  if (restore) restoreManagementColumn(restore.dataset.columnRestore);
});
$("#employeeList").addEventListener("click", (event) => {
  const move = event.target.closest("[data-column-move]");
  if (move) { event.stopPropagation(); moveManagementColumn(move.dataset.columnMove, Number(move.dataset.direction)); return; }
  const hide = event.target.closest("[data-column-hide]");
  if (hide) { event.stopPropagation(); hideManagementColumn(hide.dataset.columnHide); return; }
  const row = event.target.closest(".employee-row");
  if (!row) return;
  const rowMonth = row.dataset.payrollMonth || currentMonth;
  const employee = employeeMonth(row.dataset.id, rowMonth);
  if (!employee) return;
  employee.__payrollMonth = rowMonth;
  if (event.target.closest("[data-period-shift]")) {
    const nextMonth = shiftMonth(rowMonth, Number(event.target.closest("[data-period-shift]").dataset.periodShift));
    setManagementMonth(employee.id, nextMonth);
    currentMonth = nextMonth;
    $("#payrollMonth").value = `${currentMonth}-01`;
    render();
    return;
  }
  if (event.target.closest("[data-toggle-payment]")) return toggleSalaryPayment(employee.id, rowMonth);
  const entryButton = event.target.closest("[data-entry-type]");
  if (entryButton) return showEntryDialog(employee, entryButton.dataset.entryType);
  const entryListButton = event.target.closest("[data-entry-list-type]");
  if (entryListButton) return showEntryList(employee, entryListButton.dataset.entryListType);
  if (event.target.closest(".edit-employee")) { editingEmployeeMonth = rowMonth; return showDialog(employee); }
  if (event.target.closest(".work-history")) showEmploymentDialog(employee);
});
$("#employeeList").addEventListener("change", (event) => {
  const input = event.target.closest("[data-period-month]");
  if (!input) return;
  const row = input.closest(".employee-row");
  if (!row || !input.value) return;
  setManagementMonth(row.dataset.id, input.value);
  currentMonth = input.value;
  $("#payrollMonth").value = `${currentMonth}-01`;
  render();
});
$("#employeeList").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const entryListButton = event.target.closest("[data-entry-list-type]");
  const row = event.target.closest(".employee-row");
  if (!entryListButton || !row) return;
  event.preventDefault();
  showEntryList(employees().find((item) => item.id === row.dataset.id), entryListButton.dataset.entryListType);
});
function openPayrollFromRow(event) {
  const paymentTrigger = event.target.closest("[data-toggle-payment]");
  if (paymentTrigger) return toggleSalaryPayment(paymentTrigger.dataset.togglePayment);
  const trigger = event.target.closest("[data-payslip-id]");
  if (!trigger) return;
  const employee = employees().find((item) => item.id === trigger.dataset.payslipId);
  if (employee) showPayrollDetail(employee, currentMonth);
}

$("#overviewEmployeeList").addEventListener("click", openPayrollFromRow);
$("#overviewEmployeeList").addEventListener("pointerup", (event) => {
  if (event.pointerType !== "touch") return;
  const trigger = event.target.closest("[data-payslip-id], [data-toggle-payment]");
  if (!trigger) return;
  event.preventDefault();
  openPayrollFromRow(event);
});
document.getElementById("closePayroll")?.addEventListener("click", closePayrollDetail);
document.addEventListener("change", (event) => {
  if (event.target.id !== "payslipSavedMonth") return;
  const employee = employeeMonth(payslipEmployeeId, event.target.value);
  if (employee) showPayrollDetail(employee, event.target.value);
});
document.getElementById("donePayroll")?.addEventListener("click", closePayrollDetail);
document.getElementById("togglePayrollPayment")?.addEventListener("click", (event) => toggleSalaryPayment(event.currentTarget.dataset.employeeId, event.currentTarget.dataset.month || payslipMonth));
document.getElementById("exportInfoFromPayslip")?.addEventListener("click", async () => {
  const dialog = document.getElementById("payrollDialog");
  const employeeId = dialog?.dataset.employeeId;
  const month = dialog?.dataset.month || payslipMonth || currentMonth;
  const employee = employeeMonth(employeeId, month) || employees().find((item) => item.id === employeeId);
  if (!employee) return showToast("Không tìm thấy nhân viên");
  payslipMonth = month;
  await exportPayslipInformation(employee.id);
});
document.getElementById("payrollDialog")?.addEventListener("click", (event) => {
  if (event.target === document.getElementById("payrollDialog")) closePayrollDetail();
});
$("#employeeDialog").addEventListener("click", (event) => {
  if (event.target === $("#employeeDialog")) closeDialog();
});

handleAppUpdateBoot();
if (location.search.includes("update=")) {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("update");
  window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
}
if (location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register(`./sw.js?v=${Date.now()}`));
}
setupIosDatePickers();
applyTheme(localStorage.getItem("tinh-luong-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
applyBrandVisibility(localStorage.getItem("tinh-luong-show-brand") !== "0");
applyCreditVisibility(localStorage.getItem("tinh-luong-show-credit") !== "0");
applyPeriodVisibility(showPayrollPeriod);
applySampleProfiles();
setView(currentView, false);
render();
