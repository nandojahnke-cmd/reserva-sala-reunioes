const STORAGE_KEY = "reserva-sala-reunioes-v1";
const CONFIG_KEY = "reserva-sala-reunioes-config-v1";
const CANCEL_CODES_KEY = "reserva-sala-reunioes-cancel-codes-v1";
const TABLE_NAME = "meeting_room_reservations";

const state = {
  view: "week",
  cursor: startOfWeek(new Date()),
  bookings: [],
  config: loadConfig(),
  online: false,
  recurrence: null,
};

const calendar = document.getElementById("calendar");
const periodTitle = document.getElementById("periodTitle");
const periodSubtitle = document.getElementById("periodSubtitle");
const form = document.getElementById("bookingForm");
const formMessage = document.getElementById("formMessage");
const roomStatus = document.getElementById("roomStatus");
const statusLabel = document.getElementById("statusLabel");
const statusDetail = document.getElementById("statusDetail");
const upcomingList = document.getElementById("upcomingList");
const historyList = document.getElementById("historyList");
const occupancyRate = document.getElementById("occupancyRate");
const monthTotal = document.getElementById("monthTotal");
const syncButton = document.getElementById("syncButton");
const syncPanel = document.getElementById("syncPanel");
const syncForm = document.getElementById("syncForm");
const syncStatus = document.getElementById("syncStatus");
const cancelCodeInput = document.getElementById("cancelCode");
const newCancelCodeButton = document.getElementById("newCancelCode");
const recurrenceSelect = document.getElementById("recurrenceSelect");
const recurrenceModal = document.getElementById("recurrenceModal");
const recInterval = document.getElementById("recInterval");
const recUnit = document.getElementById("recUnit");
const recWeekdaysBlock = document.getElementById("recWeekdaysBlock");
const recWeekdays = document.getElementById("recWeekdays");
const recEndDateInput = document.getElementById("recEndDate");
const recEndCountInput = document.getElementById("recEndCount");
const recDoneBtn = document.getElementById("recDoneBtn");
const recCancelBtn = document.getElementById("recCancelBtn");
const cancelModal = document.getElementById("cancelModal");
const cancelModalText = document.getElementById("cancelModalText");
const cancelOneBtn = document.getElementById("cancelOneBtn");
const cancelAllBtn = document.getElementById("cancelAllBtn");
const cancelBackBtn = document.getElementById("cancelBackBtn");
const submitButton = form.querySelector('button[type="submit"]');
let lastRecurrenceValue = "none";
let pendingCancel = null;

document.getElementById("date").valueAsDate = new Date();
document.getElementById("startTime").value = "09:00";
document.getElementById("endTime").value = "10:00";
document.getElementById("supabaseUrl").value = state.config.supabaseUrl || "";
document.getElementById("supabaseKey").value = state.config.supabaseKey || "";
cancelCodeInput.value = generateCancelCode();

document.getElementById("prevPeriod").addEventListener("click", () => movePeriod(-1));
document.getElementById("nextPeriod").addEventListener("click", () => movePeriod(1));
syncButton.addEventListener("click", () => syncPanel.classList.toggle("open"));
syncForm.addEventListener("submit", saveDatabaseConfig);
newCancelCodeButton.addEventListener("click", () => {
  cancelCodeInput.value = generateCancelCode();
});

recurrenceSelect.addEventListener("change", handleRecurrenceSelect);
recUnit.addEventListener("change", updateRecWeekdaysVisibility);
recWeekdays.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-dow]");
  if (button) button.classList.toggle("selected");
});
recDoneBtn.addEventListener("click", applyCustomRecurrence);
recCancelBtn.addEventListener("click", closeRecurrenceModal);
recurrenceModal.addEventListener("click", (event) => {
  if (event.target === recurrenceModal) closeRecurrenceModal();
});
cancelOneBtn.addEventListener("click", () => runPendingCancel("one"));
cancelAllBtn.addEventListener("click", () => runPendingCancel("all"));
cancelBackBtn.addEventListener("click", closeCancelModal);
cancelModal.addEventListener("click", (event) => {
  if (event.target === cancelModal) closeCancelModal();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
    state.cursor = state.view === "week" ? startOfWeek(state.cursor) : startOfMonth(state.cursor);
    render();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isConfigured()) {
    showMessage("Configure o Supabase antes de agendar.");
    syncPanel.classList.add("open");
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  const start = new Date(`${data.date}T${data.startTime}`);
  const end = new Date(`${data.date}T${data.endTime}`);
  const cancelCode = String(data.cancelCode || "").trim();

  if (end <= start) {
    showMessage("A hora final precisa ser maior que a hora inicial.");
    return;
  }

  if (cancelCode.length < 4) {
    showMessage("Crie um codigo de cancelamento com pelo menos 4 caracteres.");
    return;
  }

  await refreshBookings(false);

  if (state.recurrence) {
    await createRecurringBookings(data, cancelCode);
    return;
  }

  const conflict = findConflict(data.date, start, end);
  if (conflict) {
    showMessage(`Conflito com ${conflict.owner}, das ${formatTime(conflict.start)} as ${formatTime(conflict.end)}.`);
    return;
  }

  setBusy(true, "Criando...");
  try {
    const created = await createBooking({
      owner: data.owner.trim(),
      reason: data.reason.trim(),
      date: data.date,
      start: start.toISOString(),
      end: end.toISOString(),
      createdAt: new Date().toISOString(),
      cancelCode,
    });
    rememberCancelCode(created.id, cancelCode);
  } catch (error) {
    setBusy(false);
    showMessage(`Nao foi possivel salvar: ${cleanError(error.message)}`);
    return;
  }

  setBusy(false);
  resetBookingForm(data);
  showMessage(`Reserva criada. Guarde o codigo: ${cancelCode}`, true);
  await refreshBookings();
});

calendar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  const id = button.dataset.delete;
  const booking = state.bookings.find((b) => String(b.id) === String(id));
  const seriesId = booking && booking.series_id ? booking.series_id : null;
  const seriesCount = seriesId ? state.bookings.filter((b) => b.series_id === seriesId).length : 0;

  if (seriesId && seriesCount > 1) {
    pendingCancel = { id, seriesId };
    cancelModalText.textContent = `Este agendamento se repete (${seriesCount} ocorrências). O que você quer cancelar?`;
    cancelAllBtn.textContent = `Toda a recorrência (${seriesCount})`;
    cancelModal.hidden = false;
    return;
  }
  performCancel(id, "one", null);
});

setInterval(updateRoomStatus, 30000);
setInterval(() => refreshBookings(false), 60000);
boot();

function render() {
  state.bookings.sort((a, b) => new Date(a.start) - new Date(b.start));
  calendar.className = `calendar ${state.view}-view`;
  if (state.view === "week") renderWeek();
  if (state.view === "month") renderMonth();
  renderDashboard();
  updateRoomStatus();
}

const HOUR_HEIGHT = 50;

function renderWeek() {
  const start = startOfWeek(state.cursor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  periodTitle.textContent = `${formatDate(days[0], "short")} - ${formatDate(days[6], "short")}`;
  periodSubtitle.textContent = "Visao semanal";
  calendar.innerHTML = "";

  const scroll = create("div", "tg-scroll");
  const grid = create("div", "tg-grid");

  grid.append(create("div", "tg-corner"));
  days.forEach((day) => {
    const head = create("div", "tg-dayhead");
    const strong = create("strong");
    strong.textContent = day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    const span = create("span");
    span.textContent = day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    head.append(strong, span);
    grid.append(head);
  });

  const gutter = create("div", "tg-gutter");
  gutter.style.height = `${24 * HOUR_HEIGHT}px`;
  for (let hour = 0; hour < 24; hour += 1) {
    const label = create("div", "tg-hourlabel");
    label.style.top = `${hour * HOUR_HEIGHT}px`;
    label.textContent = `${String(hour).padStart(2, "0")}:00`;
    gutter.append(label);
  }
  grid.append(gutter);

  days.forEach((day) => {
    const col = create("div", "tg-col");
    col.style.height = `${24 * HOUR_HEIGHT}px`;
    bookingsForDate(day).forEach((booking) => {
      const startDate = new Date(booking.start);
      const endDate = new Date(booking.end);
      const startMin = startDate.getHours() * 60 + startDate.getMinutes();
      let endMin = endDate.getHours() * 60 + endDate.getMinutes();
      if (endMin <= startMin) endMin = startMin + 30;
      const event = eventCard(booking);
      event.style.top = `${(startMin / 60) * HOUR_HEIGHT}px`;
      event.style.height = `${Math.max(24, ((endMin - startMin) / 60) * HOUR_HEIGHT)}px`;
      col.append(event);
    });
    grid.append(col);
  });

  scroll.append(grid);
  calendar.append(scroll);
  scroll.scrollTop = 7 * HOUR_HEIGHT;
}

function eventCard(booking) {
  const card = create("article", "tg-event");
  const title = create("strong");
  title.textContent = booking.reason;
  const info = create("span");
  info.textContent = `${formatTime(booking.start)} – ${formatTime(booking.end)} · ${booking.owner}`;
  card.append(title, info);
  if (!String(booking.id).startsWith("sample-")) {
    const cancel = create("button", "tg-cancel");
    cancel.type = "button";
    cancel.dataset.delete = booking.id;
    cancel.setAttribute("aria-label", "Cancelar reserva");
    cancel.textContent = "×";
    card.append(cancel);
  }
  return card;
}

function renderMonth() {
  const start = startOfMonth(state.cursor);
  const firstCell = startOfWeek(start);
  const days = Array.from({ length: 42 }, (_, index) => addDays(firstCell, index));
  periodTitle.textContent = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  periodSubtitle.textContent = "Visao mensal";
  calendar.innerHTML = "";
  const grid = create("div", "month-grid");

  days.forEach((day) => {
    const cell = create("section", `month-day ${day.getMonth() !== start.getMonth() ? "outside" : ""}`);
    cell.append(dayHeader(day));
    const body = create("div", "day-body");
    const dayBookings = bookingsForDate(day);
    dayBookings.slice(0, 3).forEach((booking) => body.append(bookingCard(booking, false)));
    if (dayBookings.length > 3) body.append(emptyState(`+${dayBookings.length - 3} reserva(s)`));
    cell.append(body);
    grid.append(cell);
  });

  calendar.append(grid);
}

function renderDashboard() {
  const now = new Date();
  const upcoming = state.bookings.filter((booking) => new Date(booking.end) >= now).slice(0, 5);
  const history = state.bookings.filter((booking) => new Date(booking.end) < now).reverse().slice(0, 5);

  upcomingList.innerHTML = "";
  historyList.innerHTML = "";
  upcoming.forEach((booking) => upcomingList.append(bookingCard(booking, false)));
  history.forEach((booking) => historyList.append(bookingCard(booking, false)));
  if (!upcoming.length) upcomingList.append(emptyState("Nenhuma proxima reuniao."));
  if (!history.length) historyList.append(emptyState("Nenhuma reuniao finalizada."));

  const monthStart = startOfMonth(new Date());
  const monthEnd = addMonths(monthStart, 1);
  const monthBookings = state.bookings.filter((booking) => {
    const start = new Date(booking.start);
    return start >= monthStart && start < monthEnd;
  });
  const usedMinutes = monthBookings.reduce((total, booking) => {
    return total + (new Date(booking.end) - new Date(booking.start)) / 60000;
  }, 0);
  const businessMinutes = businessDaysInMonth(monthStart) * 10 * 60;
  occupancyRate.textContent = `${Math.min(100, Math.round((usedMinutes / businessMinutes) * 100))}%`;
  monthTotal.textContent = monthBookings.length;
}

function updateRoomStatus() {
  const now = new Date();
  const active = state.bookings.find((booking) => new Date(booking.start) <= now && new Date(booking.end) > now);
  const next = state.bookings.find((booking) => new Date(booking.start) > now);
  roomStatus.classList.remove("busy", "next");

  if (active) {
    roomStatus.classList.add("busy");
    statusLabel.textContent = "Ocupada";
    statusDetail.textContent = `${active.reason} ate ${formatTime(active.end)}`;
    return;
  }

  if (next) {
    roomStatus.classList.add("next");
    statusLabel.textContent = "Livre";
    statusDetail.textContent = `Proxima reuniao as ${formatTime(next.start)}`;
    return;
  }

  statusLabel.textContent = "Livre";
  statusDetail.textContent = "Sem proximas reunioes";
}

function bookingCard(booking, removable) {
  const card = document.getElementById("bookingTemplate").content.firstElementChild.cloneNode(true);
  card.querySelector("strong").textContent = booking.reason;
  card.querySelector("span").textContent = `${formatTime(booking.start)} - ${formatTime(booking.end)} - ${booking.owner}`;
  card.querySelector("small").textContent = formatDate(new Date(booking.start), "long");
  if (removable && !String(booking.id).startsWith("sample-")) {
    const button = create("button", "delete-button");
    button.type = "button";
    button.dataset.delete = booking.id;
    button.textContent = "Cancelar";
    card.append(button);
  }
  return card;
}

function dayHeader(day) {
  const header = create("div", "day-header");
  const title = create("strong");
  title.textContent = day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const subtitle = create("span");
  subtitle.textContent = day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  header.append(title, subtitle);
  return header;
}

function bookingsForDate(day) {
  const date = toDateInput(day);
  return state.bookings.filter((booking) => booking.date === date);
}

function showMessage(message, success = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle("success", success);
}

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    const bundled = window.RESERVA_DB || {};
    return {
      supabaseUrl: saved.supabaseUrl || bundled.supabaseUrl || "",
      supabaseKey: saved.supabaseKey || bundled.supabaseKey || "",
    };
  } catch {
    return window.RESERVA_DB || {};
  }
}

function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
}

async function saveDatabaseConfig(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(syncForm));
  state.config = {
    supabaseUrl: data.supabaseUrl.trim().replace(/\/$/, ""),
    supabaseKey: data.supabaseKey.trim(),
  };
  saveConfig();
  await refreshBookings();
}

async function boot() {
  if (!isConfigured()) {
    state.bookings = loadLocalSample();
    syncPanel.classList.add("open");
    syncStatus.textContent = "Supabase ainda nao configurado. Os dados exibidos abaixo sao apenas exemplos.";
    syncButton.textContent = "Configurar Supabase";
    render();
    return;
  }

  await refreshBookings();
}

async function refreshBookings(showErrors = true) {
  if (!isConfigured()) {
    state.online = false;
    render();
    return;
  }

  syncButton.textContent = "Sincronizando...";
  try {
    state.bookings = await listBookings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.bookings));
    state.online = true;
    syncStatus.textContent = `Agenda sincronizada com ${state.bookings.length} reserva(s).`;
    syncButton.textContent = "Supabase conectado";
    syncPanel.classList.remove("open");
  } catch (error) {
    state.online = false;
    state.bookings = loadCachedBookings();
    if (!state.bookings.length) state.bookings = loadLocalSample();
    if (showErrors) {
      syncPanel.classList.add("open");
      syncStatus.textContent = `Falha ao conectar ao Supabase: ${cleanError(error.message)}`;
    }
    syncButton.textContent = "Revisar Supabase";
  }
  render();
}

async function listBookings() {
  return supabaseRequest(`/${TABLE_NAME}?select=id,owner,reason,date,start,end,created_at,series_id&order=start.asc`);
}

async function createBooking(booking) {
  return supabaseRpc("create_meeting_reservation", {
    method: "POST",
    body: JSON.stringify({
      p_owner: booking.owner,
      p_reason: booking.reason,
      p_date: booking.date,
      p_start: booking.start,
      p_end: booking.end,
      p_cancel_code: booking.cancelCode,
      p_series_id: booking.seriesId || null,
    }),
  });
}

async function deleteBooking(id, cancelCode) {
  return supabaseRpc("cancel_meeting_reservation", {
    method: "POST",
    body: JSON.stringify({
      p_id: id,
      p_cancel_code: cancelCode,
    }),
  });
}

async function cancelSeries(seriesId, cancelCode) {
  return supabaseRpc("cancel_meeting_series", {
    method: "POST",
    body: JSON.stringify({
      p_series_id: seriesId,
      p_cancel_code: cancelCode,
    }),
  });
}

function makeUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${state.config.supabaseUrl}/rest/v1${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.config.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: options.body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.details || text || `HTTP ${response.status}`);
  }

  return payload || [];
}

async function supabaseRpc(functionName, options = {}) {
  const response = await fetch(`${state.config.supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: options.method || "POST",
    headers: {
      apikey: state.config.supabaseKey,
      Authorization: `Bearer ${state.config.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: options.body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.details || text || `HTTP ${response.status}`);
  }

  return Array.isArray(payload) ? payload[0] : payload;
}

function toDatabaseBooking(booking) {
  return {
    owner: booking.owner,
    reason: booking.reason,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    created_at: booking.createdAt,
  };
}

function findConflict(date, start, end) {
  return state.bookings.find((booking) => {
    if (booking.date !== date) return false;
    return start < new Date(booking.end) && end > new Date(booking.start);
  });
}

function isConfigured() {
  return Boolean(state.config.supabaseUrl && state.config.supabaseKey);
}

function loadCachedBookings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function loadLocalSample() {
  const cached = loadCachedBookings();
  if (cached.length) return cached;
  const today = new Date();
  return [
    ["09:00", "10:00", "Marina Costa", "Ritual semanal"],
    ["14:30", "15:30", "Joao Lima", "Planejamento de frota"],
    ["11:00", "12:00", "Bianca Alves", "Reuniao comercial"],
  ].map(([startTime, endTime, owner, reason], index) => {
    const day = addDays(today, index);
    const date = toDateInput(day);
    return {
      id: `sample-${index}`,
      owner,
      reason,
      date,
      start: new Date(`${date}T${startTime}`).toISOString(),
      end: new Date(`${date}T${endTime}`).toISOString(),
      createdAt: new Date().toISOString(),
    };
  });
}

function cleanError(message) {
  return String(message || "erro desconhecido").replace(/["{}[\]]/g, "").slice(0, 180);
}

function getCancelCodeMap() {
  try {
    return JSON.parse(localStorage.getItem(CANCEL_CODES_KEY)) || {};
  } catch {
    return {};
  }
}

function rememberCancelCode(id, code) {
  if (!id) return;
  const codes = getCancelCodeMap();
  codes[id] = code;
  localStorage.setItem(CANCEL_CODES_KEY, JSON.stringify(codes));
}

function getRememberedCancelCode(id) {
  return getCancelCodeMap()[id] || "";
}

function forgetCancelCode(id) {
  const codes = getCancelCodeMap();
  delete codes[id];
  localStorage.setItem(CANCEL_CODES_KEY, JSON.stringify(codes));
}

function generateCancelCode() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  const first = String(values[0] % 1000).padStart(3, "0");
  const second = String(values[1] % 1000).padStart(3, "0");
  return `${first}-${second}`;
}

function movePeriod(direction) {
  state.cursor = state.view === "week" ? addDays(state.cursor, direction * 7) : addMonths(state.cursor, direction);
  render();
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function addMonths(date, amount) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + amount);
  return result;
}

function addMinutes(time, amount) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(2026, 0, 1, hours, minutes + amount);
  return date.toTimeString().slice(0, 5);
}

function toDateInput(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value, style) {
  const options = style === "long" ? { weekday: "short", day: "2-digit", month: "short" } : { day: "2-digit", month: "short" };
  return value.toLocaleDateString("pt-BR", options).replace(".", "");
}

function businessDaysInMonth(monthStart) {
  const monthEnd = addMonths(monthStart, 1);
  let count = 0;
  for (let day = new Date(monthStart); day < monthEnd; day = addDays(day, 1)) {
    if (day.getDay() !== 0 && day.getDay() !== 6) count += 1;
  }
  return count;
}

function emptyState(text) {
  const node = create("div", "empty");
  node.textContent = text;
  return node;
}

function create(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function handleRecurrenceSelect() {
  const value = recurrenceSelect.value;
  if (value === "custom") {
    openRecurrenceModal();
    return;
  }
  if (value === "none") {
    state.recurrence = null;
  } else {
    const dow = parseYmd(dateValue()).getDay();
    const presets = {
      daily: { interval: 1, unit: "day", weekdays: [], end: { type: "never" } },
      weekly: { interval: 1, unit: "week", weekdays: [dow], end: { type: "never" } },
      monthly: { interval: 1, unit: "month", weekdays: [], end: { type: "never" } },
      yearly: { interval: 1, unit: "year", weekdays: [], end: { type: "never" } },
    };
    state.recurrence = presets[value];
  }
  lastRecurrenceValue = value;
}

function openRecurrenceModal() {
  const r = state.recurrence || {};
  recInterval.value = r.interval || 1;
  recUnit.value = r.unit && r.unit !== "none" ? r.unit : "week";
  const defaultDow = parseYmd(dateValue()).getDay();
  const selectedDays = r.weekdays && r.weekdays.length ? r.weekdays : [defaultDow];
  recWeekdays.querySelectorAll("button[data-dow]").forEach((button) => {
    button.classList.toggle("selected", selectedDays.includes(Number(button.dataset.dow)));
  });
  const end = r.end || { type: "never" };
  const endRadio = recurrenceModal.querySelector(`input[name="recEnd"][value="${end.type}"]`);
  if (endRadio) endRadio.checked = true;
  recEndDateInput.value = end.type === "on" && end.date ? end.date : "";
  recEndCountInput.value = end.type === "after" && end.count ? end.count : 13;
  updateRecWeekdaysVisibility();
  recurrenceModal.hidden = false;
}

function closeRecurrenceModal() {
  recurrenceSelect.value = lastRecurrenceValue;
  recurrenceModal.hidden = true;
}

function applyCustomRecurrence() {
  const unit = recUnit.value;
  const interval = Math.max(1, parseInt(recInterval.value, 10) || 1);
  let weekdays = [];
  if (unit === "week") {
    weekdays = Array.from(recWeekdays.querySelectorAll("button.selected")).map((b) => Number(b.dataset.dow));
    if (!weekdays.length) weekdays = [parseYmd(dateValue()).getDay()];
  }
  const checkedEnd = recurrenceModal.querySelector('input[name="recEnd"]:checked');
  const endType = checkedEnd ? checkedEnd.value : "never";
  const end = { type: endType };
  if (endType === "on") end.date = recEndDateInput.value || "";
  if (endType === "after") end.count = Math.max(1, parseInt(recEndCountInput.value, 10) || 1);

  state.recurrence = { interval, unit, weekdays, end };
  const customOption = recurrenceSelect.querySelector('option[value="custom"]');
  if (customOption) customOption.textContent = "Personalizado: " + recurrenceSummary(state.recurrence);
  recurrenceSelect.value = "custom";
  lastRecurrenceValue = "custom";
  recurrenceModal.hidden = true;
}

function updateRecWeekdaysVisibility() {
  recWeekdaysBlock.style.display = recUnit.value === "week" ? "" : "none";
}

function recurrenceSummary(r) {
  const units = { day: "dia", week: "semana", month: "mes", year: "ano" };
  let text = `a cada ${r.interval} ${units[r.unit]}${r.interval > 1 ? "s" : ""}`;
  if (r.unit === "week" && r.weekdays.length) {
    const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
    text += " (" + r.weekdays.slice().sort((a, b) => a - b).map((d) => names[d]).join(", ") + ")";
  }
  if (r.end.type === "on" && r.end.date) text += `, ate ${formatDateBR(r.end.date)}`;
  else if (r.end.type === "after") text += `, ${r.end.count}x`;
  return text;
}

async function createRecurringBookings(data, cancelCode) {
  const occurrences = computeOccurrences(data.date, state.recurrence);
  if (!occurrences.length) {
    showMessage("A repeticao nao gerou nenhuma data valida.");
    return;
  }

  const total = occurrences.length;
  const seriesId = total > 1 ? makeUuid() : null;
  let created = 0;
  const failed = [];
  setBusy(true, `Criando... (0/${total})`);
  for (const dateStr of occurrences) {
    const start = new Date(`${dateStr}T${data.startTime}`);
    const end = new Date(`${dateStr}T${data.endTime}`);
    try {
      const row = await createBooking({
        owner: data.owner.trim(),
        reason: data.reason.trim(),
        date: dateStr,
        start: start.toISOString(),
        end: end.toISOString(),
        createdAt: new Date().toISOString(),
        cancelCode,
        seriesId,
      });
      rememberCancelCode(row.id, cancelCode);
      created += 1;
    } catch (error) {
      failed.push(dateStr);
    }
    setBusy(true, `Criando... (${created + failed.length}/${total})`);
  }
  setBusy(false);

  resetBookingForm(data);
  if (created === 0) {
    showMessage(`Nenhuma reserva criada. As ${failed.length} datas tinham conflito de horario.`);
  } else {
    let message = `${created} reserva(s) criada(s). Guarde o codigo: ${cancelCode}.`;
    if (failed.length) {
      const list = failed.slice(0, 4).map(formatDateBR).join(", ");
      message += ` ${failed.length} pulada(s) por conflito (${list}${failed.length > 4 ? "..." : ""}).`;
    }
    showMessage(message, true);
  }
  await refreshBookings();
}

function computeOccurrences(baseDateStr, rule) {
  const MAX = 60;
  const base = parseYmd(baseDateStr);
  const endType = (rule.end && rule.end.type) || "never";
  const endDate = endType === "on" && rule.end.date ? parseYmd(rule.end.date) : null;
  const targetCount = endType === "after" ? Math.max(1, rule.end.count || 1) : MAX;
  const horizon = new Date(base);
  horizon.setFullYear(horizon.getFullYear() + 1);
  const out = [];

  const withinLimits = (d) => {
    if (out.length >= (endType === "after" ? targetCount : MAX)) return false;
    if (endType === "on" && endDate && d > endDate) return false;
    if (endType === "never" && d > horizon) return false;
    return true;
  };

  if (rule.unit === "week") {
    const days = rule.weekdays && rule.weekdays.length ? rule.weekdays.slice().sort((a, b) => a - b) : [base.getDay()];
    const weekStart = new Date(base);
    weekStart.setDate(base.getDate() - base.getDay());
    let done = false;
    while (!done) {
      for (const dow of days) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + dow);
        if (d < base) continue;
        if (!withinLimits(d)) {
          done = true;
          break;
        }
        out.push(ymd(d));
      }
      if (done) break;
      weekStart.setDate(weekStart.getDate() + 7 * rule.interval);
      if (out.length >= MAX) break;
    }
  } else {
    const d = new Date(base);
    let guard = 0;
    while (guard++ < 1200) {
      if (!withinLimits(d)) break;
      out.push(ymd(d));
      if (rule.unit === "month") d.setMonth(d.getMonth() + rule.interval);
      else if (rule.unit === "year") d.setFullYear(d.getFullYear() + rule.interval);
      else d.setDate(d.getDate() + rule.interval);
    }
  }
  return out;
}

function resetBookingForm(data) {
  form.reset();
  document.getElementById("date").value = data.date;
  document.getElementById("startTime").value = data.endTime;
  document.getElementById("endTime").value = addMinutes(data.endTime, 60);
  cancelCodeInput.value = generateCancelCode();
  state.recurrence = null;
  lastRecurrenceValue = "none";
  recurrenceSelect.value = "none";
}

function setBusy(isBusy, label) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? label || "Criando..." : "Agendar sala";
}

function dateValue() {
  return document.getElementById("date").value || todayStr();
}

function parseYmd(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  return ymd(new Date());
}

function formatDateBR(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

function closeCancelModal() {
  cancelModal.hidden = true;
  pendingCancel = null;
}

function runPendingCancel(scope) {
  const target = pendingCancel;
  cancelModal.hidden = true;
  pendingCancel = null;
  if (target) performCancel(target.id, scope, target.seriesId);
}

async function performCancel(id, scope, seriesId) {
  const knownCode = getRememberedCancelCode(id);
  const cancelCode = knownCode || window.prompt("Digite o codigo de cancelamento:");
  if (!cancelCode) {
    showMessage("Cancelamento interrompido. Informe o codigo para cancelar.");
    return;
  }
  try {
    if (scope === "all" && seriesId) {
      const count = await cancelSeries(seriesId, cancelCode);
      state.bookings
        .filter((b) => b.series_id === seriesId)
        .forEach((b) => forgetCancelCode(b.id));
      showMessage(`${count} reserva(s) da recorrencia cancelada(s).`, true);
    } else {
      await deleteBooking(id, cancelCode);
      forgetCancelCode(id);
    }
    await refreshBookings();
  } catch (error) {
    showMessage("Nao foi possivel cancelar. Verifique o codigo informado.");
  }
}
