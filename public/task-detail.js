(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const STATUS_LIST = [
    ["todo", "Belum mulai"],
    ["in_progress", "Dikerjakan"],
    ["in_review", "Review"],
    ["done", "Selesai"]
  ];
  const STATUS_LABEL = Object.fromEntries(STATUS_LIST);
  const PRIORITY_LABEL = { low: "Rendah", medium: "Sedang", high: "Tinggi" };

  const modal = $("#taskModal");
  const body = $("#modalBody");
  const titleEl = $("#modalTitle");
  const message = $("#modalMessage");

  let currentId = null;
  let lastFocus = null;

  async function request(url, options = {}) {
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

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function say(text, success = false) {
    message.textContent = text;
    message.classList.toggle("success", success);
  }

  function formatDate(value) {
    if (!value) return "—";
    const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function changed() {
    document.dispatchEvent(new CustomEvent("taskora:changed"));
  }

  async function reload() {
    if (currentId === null) return;
    const id = currentId;
    const data = await request(`/api/tasks/${id}`);
    if (currentId === id) render(data);
  }

  async function refresh() {
    try {
      await reload();
    } catch (error) {
      say(error.message);
    }
  }

  function logText(log) {
    switch (log.action) {
      case "status_changed":
        return `Status diubah dari ${STATUS_LABEL[log.from_value] || log.from_value} ke ${STATUS_LABEL[log.to_value] || log.to_value}`;
      case "comment_added":
        return "Menambahkan komentar";
      case "revision_added":
        return "Menambahkan catatan revisi";
      case "revision_resolved":
        return "Menandai revisi sudah ditindaklanjuti";
      case "revision_reopened":
        return "Membuka kembali catatan revisi";
      default:
        return log.action;
    }
  }

  /* ---------- Bagian-bagian jendela ---------- */

  function infoItem(label, content) {
    const item = el("div", "info-item");
    item.appendChild(el("span", "info-label", label));
    item.appendChild(typeof content === "string" ? el("strong", "", content) : content);
    return item;
  }

  function renderInfo(task) {
    const grid = el("div", "info-grid");

    const select = el("select", "field");
    select.setAttribute("aria-label", "Ubah status");
    STATUS_LIST.forEach(([value, label]) => select.appendChild(new Option(label, value)));
    select.value = task.status;
    select.addEventListener("change", async () => {
      try {
        await request(`/api/tasks/${task.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: select.value })
        });
        say("Status diperbarui.", true);
        changed();
      } catch (error) {
        say(error.message);
      }
      await refresh();
    });

    grid.append(
      infoItem("Status", select),
      infoItem("Prioritas", PRIORITY_LABEL[task.priority] || "Sedang"),
      infoItem("Tenggat", formatDate(task.due_date)),
      infoItem("Proyek", task.project_name || "Tanpa proyek"),
      infoItem("Dibuat", formatDateTime(task.created_at)),
      infoItem("Selesai", task.completed_at ? formatDateTime(task.completed_at) : "—")
    );
    return grid;
  }

  function renderDescription(task) {
    const section = el("section", "modal-section");
    section.appendChild(el("h3", "", "Deskripsi"));
    if (task.description) {
      section.appendChild(el("p", "desc", task.description));
    } else {
      section.appendChild(el("p", "muted", "Belum ada deskripsi."));
    }
    return section;
  }

  function renderComment(task, comment) {
    const isRevision = comment.kind === "revision";
    const stateClass = isRevision ? (comment.is_resolved ? " revision resolved" : " revision open") : "";
    const item = el("article", "note" + stateClass);

    const head = el("div", "note-head");
    head.appendChild(
      el("span", "badge" + (isRevision ? (comment.is_resolved ? " low" : " high") : ""), isRevision ? "Revisi" : "Komentar")
    );
    if (comment.source) head.appendChild(el("span", "", "dari " + comment.source));
    head.appendChild(el("span", "note-time", formatDateTime(comment.created_at)));

    item.append(head, el("p", "note-body", comment.body));

    if (isRevision) {
      const foot = el("div", "note-foot");
      const stateText = comment.is_resolved
        ? "Sudah ditindaklanjuti" + (comment.resolved_at ? " · " + formatDateTime(comment.resolved_at) : "")
        : "Belum ditindaklanjuti";
      foot.appendChild(el("span", "note-state", stateText));

      const button = el("button", "btn ghost small", comment.is_resolved ? "Buka lagi" : "Tandai selesai");
      button.type = "button";
      button.addEventListener("click", async () => {
        try {
          await request(`/api/tasks/${task.id}/comments/${comment.id}`, {
            method: "PATCH",
            body: JSON.stringify({ resolved: !comment.is_resolved })
          });
          say(comment.is_resolved ? "Revisi dibuka kembali." : "Revisi ditandai selesai.", true);
          changed();
        } catch (error) {
          say(error.message);
        }
        await refresh();
      });
      foot.appendChild(button);
      item.appendChild(foot);
    }
    return item;
  }

  function renderNotes(task, comments) {
    const section = el("section", "modal-section");
    section.appendChild(el("h3", "", "Catatan & revisi"));

    const form = el("form", "note-form");
    const row = el("div", "note-row");

    const kind = el("select", "field");
    kind.setAttribute("aria-label", "Jenis catatan");
    kind.append(new Option("Komentar", "comment"), new Option("Catatan revisi", "revision"));

    const source = el("input");
    source.type = "text";
    source.maxLength = 60;
    source.placeholder = "Dari siapa? (mis. Dosen, Klien)";
    source.setAttribute("aria-label", "Sumber revisi");
    source.hidden = true;

    kind.addEventListener("change", () => {
      source.hidden = kind.value !== "revision";
    });
    row.append(kind, source);

    const text = el("textarea");
    text.rows = 3;
    text.maxLength = 2000;
    text.required = true;
    text.placeholder = "Tulis catatan...";
    text.setAttribute("aria-label", "Isi catatan");

    const submit = el("button", "btn primary", "Tambah");
    submit.type = "submit";

    form.append(row, text, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const content = text.value.trim();
      if (!content) return;
      try {
        await request(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          body: JSON.stringify({ kind: kind.value, source: source.value, body: content })
        });
        say(kind.value === "revision" ? "Catatan revisi ditambahkan." : "Komentar ditambahkan.", true);
        changed();
        await refresh();
      } catch (error) {
        say(error.message);
      }
    });
    section.appendChild(form);

    const list = el("div", "notes");
    if (!comments.length) {
      list.appendChild(el("div", "empty-state", "Belum ada catatan untuk tugas ini."));
    } else {
      comments.forEach((comment) => list.appendChild(renderComment(task, comment)));
    }
    section.appendChild(list);
    return section;
  }

  function renderTimeline(task, logs) {
    const section = el("section", "modal-section");
    section.appendChild(el("h3", "", "Riwayat aktivitas"));

    const list = el("ul", "timeline");
    const addEntry = (text, time) => {
      const item = el("li");
      item.appendChild(document.createTextNode(text));
      item.appendChild(el("time", "", formatDateTime(time)));
      list.appendChild(item);
    };

    logs.forEach((log) => addEntry(logText(log), log.created_at));
    addEntry("Tugas dibuat", task.created_at);

    section.appendChild(list);
    return section;
  }

  function render(data) {
    const { task, comments, logs } = data;
    titleEl.textContent = task.title;
    body.replaceChildren(
      renderInfo(task),
      renderDescription(task),
      renderNotes(task, comments),
      renderTimeline(task, logs)
    );
  }

  /* ---------- Buka / tutup ---------- */

  async function open(id) {
    currentId = id;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    titleEl.textContent = "Memuat...";
    body.replaceChildren();
    say("");
    $("#modalClose").focus();

    try {
      const data = await request(`/api/tasks/${id}`);
      if (currentId === id) render(data);
    } catch (error) {
      say(error.message);
    }
  }

  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
    currentId = null;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  $("#modalClose").addEventListener("click", close);
  modal.querySelector(".modal-backdrop").addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) close();
  });

  window.TaskoraDetail = { open, close };
})();