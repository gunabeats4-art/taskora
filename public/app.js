const $ = (selector) => document.querySelector(selector);

const authView = $("#authView");
const dashboardView = $("#dashboardView");
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const authMessage = $("#authMessage");
const taskMessage = $("#taskMessage");
const projectMessage = $("#projectMessage");

let currentUser = null;
let tasks = [];
let projects = [];
let stats = { total: 0, in_progress: 0, done: 0 };
let view = "list";
const filters = { project: "", status: "", q: "" };

const STATUSES = [
  ["todo", "Belum mulai"],
  ["in_progress", "Dikerjakan"],
  ["in_review", "Review"],
  ["done", "Selesai"]
];
const STATUS_LABEL = {
  todo: "Belum dikerjakan",
  in_progress: "Sedang dikerjakan",
  in_review: "Dalam review",
  done: "Selesai"
};
const PRIORITY_LABEL = { low: "Rendah", medium: "Sedang", high: "Tinggi" };

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data;
}

function showMessage(element, message, success = false) {
  element.textContent = message;
  element.classList.toggle("success", success);
}

function parseDay(value) {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDue(value) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(parseDay(value));
}

function isLate(task) {
  if (!task.due_date || task.status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDay(task.due_date) < today;
}

function showAuth(mode = "login") {
  authView.hidden = false;
  dashboardView.hidden = true;
  loginForm.hidden = mode !== "login";
  registerForm.hidden = mode !== "register";
  $("#showLogin").classList.toggle("active", mode === "login");
  $("#showRegister").classList.toggle("active", mode === "register");
  showMessage(authMessage, "");
}

function showDashboard(user) {
  currentUser = user;
  authView.hidden = true;
  dashboardView.hidden = false;
  $("#sideName").textContent = user.name;
  $("#topName").textContent = user.name;
  $("#avatar").textContent = (user.name || "T").trim().charAt(0).toUpperCase();
  $("#todayLabel").textContent = new Intl.DateTimeFormat("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date()).toUpperCase();
}

async function refreshAll() {
  await loadProjects();
  await loadTasks();
  if (typeof calIsVisible === "function" && calIsVisible()) await loadCalendar();
}

/* ---------- Proyek ---------- */

async function loadProjects() {
  const data = await api("/api/projects");
  projects = data.projects;
  fillProjectSelects();
  renderProjects();
}

function fillProjectSelects() {
  const taskSelect = $("#taskProject");
  const filterSelect = $("#filterProject");
  const taskValue = taskSelect.value;

  taskSelect.replaceChildren(new Option("Tanpa proyek", ""));
  filterSelect.replaceChildren(
    new Option("Semua proyek", ""),
    new Option("Tanpa proyek", "none")
  );
  projects.forEach(project => {
    taskSelect.appendChild(new Option(project.name, String(project.id)));
    filterSelect.appendChild(new Option(project.name, String(project.id)));
  });

  taskSelect.value = projects.some(p => String(p.id) === taskValue) ? taskValue : "";

  const validFilter =
    filters.project === "" ||
    filters.project === "none" ||
    projects.some(p => String(p.id) === filters.project);
  if (!validFilter) filters.project = "";
  filterSelect.value = filters.project;
}

function renderProjects() {
  $("#projectPill").textContent = `${projects.length} proyek`;
  const list = $("#projectList");
  list.replaceChildren();

  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Belum ada proyek. Buat proyek pertamamu di atas.";
    list.appendChild(empty);
    return;
  }

  projects.forEach(project => {
    const item = document.createElement("div");
    item.className = "project-item" + (filters.project === String(project.id) ? " active" : "");

    const row = document.createElement("div");
    row.className = "project-row";

    const name = document.createElement("div");
    name.className = "task-title";
    name.textContent = project.name;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-project";
    del.textContent = "Hapus";
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!window.confirm(`Hapus proyek "${project.name}"? Tugasnya tidak ikut terhapus.`)) return;
      try {
        await api(`/api/projects/${project.id}`, { method: "DELETE" });
        await refreshAll();
        showMessage(projectMessage, "Proyek dihapus.", true);
      } catch (error) {
        showMessage(projectMessage, error.message);
      }
    });

    row.append(name, del);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = `${project.done_tasks}/${project.total_tasks} tugas selesai`;

    const track = document.createElement("div");
    track.className = "mini-track";
    const bar = document.createElement("span");
    const pct = project.total_tasks ? Math.round((project.done_tasks / project.total_tasks) * 100) : 0;
    bar.style.width = pct + "%";
    track.appendChild(bar);

    item.append(row, meta, track);

    item.addEventListener("click", async () => {
      filters.project = filters.project === String(project.id) ? "" : String(project.id);
      $("#filterProject").value = filters.project;
      renderProjects();
      try {
        await loadTasks();
      } catch (error) {
        showMessage(taskMessage, error.message);
      }
    });

    list.appendChild(item);
  });
}

/* ---------- Tugas ---------- */

async function loadTasks() {
  const params = new URLSearchParams();
  if (filters.project) params.set("project", filters.project);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();

  const data = await api("/api/tasks" + (query ? "?" + query : ""));
  tasks = data.tasks;
  stats = data.stats;
  renderStats();
  renderTasks();
}

function renderStats() {
  const rate = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  $("#totalCount").textContent = stats.total;
  $("#progressCount").textContent = stats.in_progress;
  $("#doneCount").textContent = stats.done;
  $("#completionRate").textContent = rate + "%";
  $("#completionBar").style.width = rate + "%";
}

async function updateStatus(id, status) {
  try {
    await api(`/api/tasks/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    showMessage(taskMessage, "Status tugas diperbarui.", true);
  } catch (error) {
    showMessage(taskMessage, error.message);
  }
  await refreshAll();
}

async function deleteTask(task) {
  if (!window.confirm(`Hapus tugas "${task.title}"?`)) return;
  try {
    await api(`/api/tasks/${task.id}`, { method: "DELETE" });
    await refreshAll();
    showMessage(taskMessage, "Tugas berhasil dihapus.", true);
  } catch (error) {
    showMessage(taskMessage, error.message);
  }
}

function createStatusSelect(task) {
  const select = document.createElement("select");
  select.className = "select-status";
  select.setAttribute("aria-label", "Ubah status " + task.title);
  STATUSES.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = task.status === value;
    select.appendChild(option);
  });
  select.addEventListener("change", () => updateStatus(task.id, select.value));
  return select;
}

function createDeleteButton(task) {
  const del = document.createElement("button");
  del.className = "delete-task";
  del.type = "button";
  del.textContent = "Hapus";
  del.addEventListener("click", () => deleteTask(task));
  return del;
}

function renderTasks() {
  $("#taskPill").textContent = `${tasks.length} tugas`;

  const isBoard = view === "board";
  $("#taskList").hidden = isBoard;
  $("#boardView").hidden = !isBoard;
  $("#tasksSection").classList.toggle("board-mode", isBoard);
  $("#viewList").classList.toggle("active", !isBoard);
  $("#viewBoard").classList.toggle("active", isBoard);

  if (isBoard) renderBoard();
  else renderList();
}

function renderList() {
  const list = $("#taskList");
  list.replaceChildren();

  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const filtered = filters.project || filters.status || filters.q;
    empty.textContent = filtered
      ? "Tidak ada tugas yang cocok dengan filter."
      : "Belum ada tugas. Tambahkan tugas pertamamu di atas.";
    list.appendChild(empty);
    return;
  }

  tasks.forEach(task => {
    const item = document.createElement("article");
    item.className = "task-item";

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = [
      STATUS_LABEL[task.status] || task.status,
      task.project_name,
      "Prioritas " + (PRIORITY_LABEL[task.priority] || "Sedang").toLowerCase(),
      task.due_date ? "Tenggat " + formatDue(task.due_date) : ""
    ].filter(Boolean).join(" · ");

    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.append(createStatusSelect(task), createDeleteButton(task));

    item.append(info, actions);
    list.appendChild(item);
  });
}

function buildCard(task) {
  const card = document.createElement("article");
  card.className = "kanban-card";
  card.draggable = true;

  card.addEventListener("dragstart", event => {
    event.dataTransfer.setData("text/plain", String(task.id));
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;

  const tags = document.createElement("div");
  tags.className = "card-tags";
  const priority = task.priority || "medium";
  const priorityBadge = document.createElement("span");
  priorityBadge.className = "badge " + priority;
  priorityBadge.textContent = PRIORITY_LABEL[priority];
  tags.appendChild(priorityBadge);
  if (task.project_name) {
    const projectBadge = document.createElement("span");
    projectBadge.className = "badge";
    projectBadge.textContent = task.project_name;
    tags.appendChild(projectBadge);
  }

  const foot = document.createElement("div");
  foot.className = "card-foot";
  if (task.due_date) {
    const due = document.createElement("span");
    due.className = "due" + (isLate(task) ? " late" : "");
    due.textContent = (isLate(task) ? "Terlambat · " : "Tenggat ") + formatDue(task.due_date);
    foot.appendChild(due);
  }
  foot.append(createStatusSelect(task), createDeleteButton(task));

  card.append(title, tags, foot);
  return card;
}

function renderBoard() {
  const board = $("#boardView");
  board.replaceChildren();

  STATUSES.forEach(([status, label]) => {
    const column = document.createElement("section");
    column.className = "board-col";
    const items = tasks.filter(t => t.status === status);

    const head = document.createElement("div");
    head.className = "board-col-head";
    const name = document.createElement("span");
    name.className = "board-col-title";
    name.textContent = label;
    const count = document.createElement("span");
    count.className = "pill";
    count.textContent = items.length;
    head.append(name, count);

    const cards = document.createElement("div");
    cards.className = "board-cards";
    items.forEach(task => cards.appendChild(buildCard(task)));
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "board-empty";
      empty.textContent = "Kosong";
      cards.appendChild(empty);
    }

    column.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("drag-over");
    });
    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });
    column.addEventListener("drop", async event => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const id = Number(event.dataTransfer.getData("text/plain"));
      const task = tasks.find(t => t.id === id);
      if (task && task.status !== status) await updateStatus(id, status);
    });

    column.append(head, cards);
    board.appendChild(column);
  });
}

/* ---------- Kalender (tenggat tugas) ---------- */

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MAX_CHIPS = 3;

let calTasks = [];
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calSelected = null;

function dayKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function calIsVisible() {
  return !$("#calendarView").hidden;
}

function tasksByDay() {
  const map = new Map();
  calTasks.forEach(task => {
    const key = String(task.due_date).slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  });
  return map;
}

async function loadCalendar() {
  const data = await api("/api/tasks");
  calTasks = data.tasks.filter(t => t.due_date);
  renderCalendar();
}

function openCalendar() {
  const todayKey = dayKey(new Date());
  if (!calSelected) {
    calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    calSelected = todayKey;
  }
  renderCalendar();
  loadCalendar().catch(error => showMessage($("#calMessage"), error.message));
}
window.openCalendar = openCalendar;

function renderCalendar() {
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const byDay = tasksByDay();
  const todayKey = dayKey(new Date());

  $("#calTitle").textContent = `${MONTHS_ID[month]} ${year}`;

  const offset = (calMonth.getDay() + 6) % 7; // minggu dimulai Senin
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;

  const grid = $("#calGrid");
  grid.replaceChildren();

  let monthTotal = 0;
  let monthLate = 0;

  for (let i = 0; i < cellCount; i++) {
    const date = new Date(year, month, 1 - offset + i);
    const key = dayKey(date);
    const inMonth = date.getMonth() === month;
    const items = byDay.get(key) || [];

    if (inMonth) {
      monthTotal += items.length;
      monthLate += items.filter(isLate).length;
    }

    const cell = document.createElement("div");
    cell.className = "cal-cell"
      + (inMonth ? "" : " other")
      + (key === todayKey ? " today" : "")
      + (key === calSelected ? " selected" : "");
    cell.setAttribute("role", "gridcell");
    cell.tabIndex = 0;
    cell.setAttribute("aria-label", `${new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date)}, ${items.length} tugas`);

    const num = document.createElement("span");
    num.className = "cal-num";
    num.textContent = date.getDate();
    cell.appendChild(num);

    const chips = document.createElement("div");
    chips.className = "cal-chips";
    items.slice(0, MAX_CHIPS).forEach(task => {
      const chip = document.createElement("span");
      const late = isLate(task);
      chip.className = "cal-chip " + (task.priority || "medium")
        + (task.status === "done" ? " done" : "")
        + (late ? " late" : "");
      chip.textContent = task.title;
      chip.title = task.title;
      chips.appendChild(chip);
    });
    if (items.length > MAX_CHIPS) {
      const more = document.createElement("span");
      more.className = "cal-more";
      more.textContent = `+${items.length - MAX_CHIPS} lagi`;
      chips.appendChild(more);
    }
    cell.appendChild(chips);

    const select = () => {
      calSelected = key;
      if (!inMonth) calMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendar();
    };
    cell.addEventListener("click", select);
    cell.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });

    grid.appendChild(cell);
  }

  $("#calPill").textContent = monthLate
    ? `${monthTotal} tenggat · ${monthLate} terlambat`
    : `${monthTotal} tenggat`;

  renderCalendarDay(byDay);
}

function renderCalendarDay(byDay) {
  const list = $("#calDayList");
  list.replaceChildren();

  if (!calSelected) return;
  const date = parseDay(calSelected);
  const items = (byDay || tasksByDay()).get(calSelected) || [];

  $("#calDayTitle").textContent = new Intl.DateTimeFormat("id-ID", {
    weekday: "long", day: "numeric", month: "long"
  }).format(date);
  $("#calDayEyebrow").textContent = calSelected === dayKey(new Date()) ? "HARI INI" : "TANGGAL DIPILIH";
  $("#calDayPill").textContent = `${items.length} tugas`;

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Tidak ada tenggat di tanggal ini.";
    list.appendChild(empty);
    return;
  }

  items.forEach(task => {
    const item = document.createElement("article");
    item.className = "task-item";

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "task-title" + (task.status === "done" ? " cal-done" : "");
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = [
      isLate(task) ? "Terlambat" : STATUS_LABEL[task.status] || task.status,
      task.project_name,
      "Prioritas " + (PRIORITY_LABEL[task.priority] || "Sedang").toLowerCase()
    ].filter(Boolean).join(" · ");
    if (isLate(task)) meta.classList.add("late");

    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.append(createStatusSelect(task), createDeleteButton(task));

    item.append(info, actions);
    list.appendChild(item);
  });
}

function shiftMonth(delta) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
  renderCalendar();
}

$("#calPrev").addEventListener("click", () => shiftMonth(-1));
$("#calNext").addEventListener("click", () => shiftMonth(1));
$("#calToday").addEventListener("click", () => {
  const now = new Date();
  calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  calSelected = dayKey(now);
  renderCalendar();
});

$("#calAddForm").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#calAddTitle");
  const title = input.value.trim();
  if (!title || !calSelected) return;
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, priority: "medium", due_date: calSelected })
    });
    input.value = "";
    await refreshAll();
    showMessage($("#calMessage"), "Tugas ditambahkan ke kalender.", true);
  } catch (error) {
    showMessage($("#calMessage"), error.message);
  }
});

/* ---------- Event ---------- */

$("#showLogin").addEventListener("click", () => showAuth("login"));
$("#showRegister").addEventListener("click", () => showAuth("register"));

$("#viewList").addEventListener("click", () => { view = "list"; renderTasks(); });
$("#viewBoard").addEventListener("click", () => { view = "board"; renderTasks(); });

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(authMessage, "Memeriksa akun...");
  const form = new FormData(loginForm);
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password")
      })
    });
    showDashboard(data.user);
    await refreshAll();
  } catch (error) {
    showMessage(authMessage, error.message);
  }
});

registerForm.addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(authMessage, "Membuat akun...");
  const form = new FormData(registerForm);
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password")
      })
    });
    showDashboard(data.user);
    await refreshAll();
  } catch (error) {
    showMessage(authMessage, error.message);
  }
});

$("#taskForm").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#taskTitle");
  const title = input.value.trim();
  if (!title) return;
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        project_id: $("#taskProject").value || null,
        priority: $("#taskPriority").value,
        due_date: $("#taskDue").value || null
      })
    });
    input.value = "";
    $("#taskDue").value = "";
    await refreshAll();
    showMessage(taskMessage, "Tugas berhasil ditambahkan.", true);
  } catch (error) {
    showMessage(taskMessage, error.message);
  }
});

$("#projectForm").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#projectName");
  const name = input.value.trim();
  if (!name) return;
  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    input.value = "";
    await refreshAll();
    showMessage(projectMessage, "Proyek berhasil dibuat.", true);
  } catch (error) {
    showMessage(projectMessage, error.message);
  }
});

$("#filterProject").addEventListener("change", async event => {
  filters.project = event.target.value;
  renderProjects();
  try {
    await loadTasks();
  } catch (error) {
    showMessage(taskMessage, error.message);
  }
});

$("#filterStatus").addEventListener("change", async event => {
  filters.status = event.target.value;
  try {
    await loadTasks();
  } catch (error) {
    showMessage(taskMessage, error.message);
  }
});

let searchTimer = null;
$("#searchInput").addEventListener("input", event => {
  clearTimeout(searchTimer);
  const value = event.target.value.trim();
  searchTimer = setTimeout(async () => {
    filters.q = value;
    try {
      await loadTasks();
    } catch (error) {
      showMessage(taskMessage, error.message);
    }
  }, 300);
});

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    currentUser = null;
    tasks = [];
    projects = [];
    stats = { total: 0, in_progress: 0, done: 0 };
    calTasks = [];
    calSelected = null;
    filters.project = "";
    filters.status = "";
    filters.q = "";
    $("#searchInput").value = "";
    $("#filterStatus").value = "";
    showAuth("login");
  }
});

$("#jumpAdd").addEventListener("click", () => {
  $("#taskTitle").focus();
  $("#tasksSection").scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#focusTasks").addEventListener("click", () => {
  $("#tasksSection").scrollIntoView({ behavior: "smooth", block: "start" });
});

async function initialize() {
  try {
    const data = await api("/api/auth/me");
    showDashboard(data.user);
    await refreshAll();
  } catch {
    showAuth("login");
  }
}

initialize();