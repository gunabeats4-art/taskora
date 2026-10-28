(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const SVG_NS = "http://www.w3.org/2000/svg";

  const STATUS_META = [
    ["todo", "Belum mulai", "#5B6372"],
    ["in_progress", "Dikerjakan", "#FF7A1A"],
    ["in_review", "Review", "#E9B949"],
    ["done", "Selesai", "#55C99A"]
  ];
  const PRIORITY_META = [
    ["high", "Tinggi", "#F69B87"],
    ["medium", "Sedang", "#FF7A1A"],
    ["low", "Rendah", "#55C99A"]
  ];
  const STATUS_LABEL = {
    todo: "Belum mulai",
    in_progress: "Dikerjakan",
    in_review: "Review",
    done: "Selesai"
  };
  const PRIORITY_LABEL = { low: "Rendah", medium: "Sedang", high: "Tinggi" };

  async function request(url) {
    const response = await fetch(url, { credentials: "same-origin" });
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

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function parseDay(value) {
    const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDay(value) {
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(parseDay(value));
  }

  function panel(eyebrow, title) {
    const box = el("article", "panel");
    const head = el("div", "panel-head");
    const heading = el("div");
    heading.append(el("p", "eyebrow", eyebrow), el("h2", "", title));
    head.appendChild(heading);
    const body = el("div", "panel-body");
    box.append(head, body);
    return { box, body };
  }

  function kpiCard(label, value, hint, icon, danger) {
    const card = el("article", "stat-card" + (danger ? " danger" : ""));
    const top = el("div", "stat-top");
    top.append(el("span", "", label), el("span", "stat-icon", icon));
    card.append(top, el("strong", "", String(value)), el("small", "muted", hint));
    return card;
  }

  function emptyState(text) {
    return el("div", "empty-state", text);
  }

  /* ---------- Ringkasan minggu ---------- */

  function weeklySentence(week) {
    const parts = [
      `Dalam 7 hari terakhir kamu menyelesaikan ${week.completed} tugas dan menambah ${week.created} tugas baru.`
    ];
    if (week.overdue) {
      parts.push(`Ada ${week.overdue} tugas yang sudah lewat tenggat. Selesaikan atau jadwalkan ulang lebih dulu.`);
    } else {
      parts.push("Tidak ada tugas yang melewati tenggat.");
    }
    if (week.due) parts.push(`${week.due} tugas jatuh tempo dalam 7 hari ke depan.`);
    return parts.join(" ");
  }

  function renderWeekly(body, week) {
    body.appendChild(el("p", "muted week-text", weeklySentence(week)));
    const stats = el("div", "week-stats");
    [
      ["Selesai", week.completed],
      ["Tugas baru", week.created],
      ["Jatuh tempo", week.due],
      ["Terlambat", week.overdue]
    ].forEach(([label, value]) => {
      const item = el("div", "week-stat");
      item.append(el("strong", "", String(value)), el("span", "", label));
      stats.appendChild(item);
    });
    body.appendChild(stats);
  }

  /* ---------- Perlu perhatian ---------- */

  function dueText(daysLeft) {
    if (daysLeft < 0) return `Terlambat ${-daysLeft} hari`;
    if (daysLeft === 0) return "Hari ini";
    return `H-${daysLeft}`;
  }

  function renderAttention(body, items) {
    if (!items.length) {
      body.appendChild(emptyState("Tidak ada tugas yang lewat tenggat atau jatuh tempo dalam 3 hari."));
      return;
    }
    const list = el("ul", "attention-list");
    items.forEach((item) => {
      const row = el("li", "attention-item");
      const info = el("div");
      const meta = [item.project, "Tenggat " + formatDay(item.due_date), STATUS_LABEL[item.status]]
        .filter(Boolean)
        .join(" · ");
      info.append(el("div", "task-title", item.title), el("div", "task-meta", meta));
      row.append(info, el("span", "badge " + (item.days_left < 0 ? "high" : "medium"), dueText(item.days_left)));
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  /* ---------- Donut status ---------- */

  function renderDonut(body, counts) {
    const total = STATUS_META.reduce((sum, [key]) => sum + counts[key], 0);
    if (!total) {
      body.appendChild(emptyState("Belum ada tugas untuk dianalisis."));
      return;
    }

    const wrap = el("div", "donut-wrap");
    const svg = svgEl("svg", {
      viewBox: "0 0 140 140",
      class: "donut",
      role: "img",
      "aria-label": "Distribusi status tugas"
    });
    const R = 54;
    const C = 2 * Math.PI * R;

    svg.appendChild(svgEl("circle", { cx: 70, cy: 70, r: R, fill: "none", stroke: "#2A2E37", "stroke-width": 16 }));

    let offset = 0;
    STATUS_META.forEach(([key, label, color]) => {
      const count = counts[key];
      if (!count) return;
      const length = (count / total) * C;
      const segment = svgEl("circle", {
        cx: 70,
        cy: 70,
        r: R,
        fill: "none",
        stroke: color,
        "stroke-width": 16,
        "stroke-dasharray": `${length} ${C - length}`,
        "stroke-dashoffset": -offset,
        transform: "rotate(-90 70 70)"
      });
      const tip = svgEl("title");
      tip.textContent = `${label}: ${count}`;
      segment.appendChild(tip);
      svg.appendChild(segment);
      offset += length;
    });

    const totalText = svgEl("text", { x: 70, y: 74, "text-anchor": "middle", class: "donut-total" });
    totalText.textContent = String(total);
    const subText = svgEl("text", { x: 70, y: 90, "text-anchor": "middle", class: "donut-sub" });
    subText.textContent = "tugas";
    svg.append(totalText, subText);

    const legend = el("ul", "legend");
    STATUS_META.forEach(([key, label, color]) => {
      const item = el("li");
      const dot = el("span", "dot");
      dot.style.background = color;
      const percent = Math.round((counts[key] / total) * 100);
      item.append(dot, el("span", "", label), el("span", "legend-count", `${counts[key]} (${percent}%)`));
      legend.appendChild(item);
    });

    wrap.append(svg, legend);
    body.appendChild(wrap);
  }

  /* ---------- Tren 14 hari ---------- */

  function renderTrend(body, trend) {
    const W = 560;
    const H = 200;
    const left = 26;
    const right = 6;
    const top = 10;
    const bottom = 26;
    const plotW = W - left - right;
    const plotH = H - top - bottom;

    const max = Math.max(1, ...trend.flatMap((d) => [d.created, d.completed]));
    const step = plotW / trend.length;
    const barW = Math.min(10, step / 2 - 2);
    const yOf = (value) => top + plotH - (value / max) * plotH;
    const ticks = max >= 4 ? [0, Math.round(max / 2), max] : Array.from({ length: max + 1 }, (_, i) => i);

    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "chart-svg",
      role: "img",
      "aria-label": "Tugas dibuat dan diselesaikan per hari"
    });

    ticks.forEach((tick) => {
      const y = yOf(tick);
      svg.appendChild(svgEl("line", { x1: left, x2: W - right, y1: y, y2: y, class: "chart-grid" }));
      const label = svgEl("text", { x: left - 6, y: y + 3, "text-anchor": "end", class: "chart-text" });
      label.textContent = String(tick);
      svg.appendChild(label);
    });

    trend.forEach((day, index) => {
      const center = left + index * step + step / 2;
      [
        [day.created, center - barW - 1, "#7C8596", "dibuat"],
        [day.completed, center + 1, "#55C99A", "selesai"]
      ].forEach(([value, x, color, word]) => {
        if (!value) return;
        const height = (value / max) * plotH;
        const bar = svgEl("rect", { x, y: yOf(value), width: barW, height, rx: 2, fill: color });
        const tip = svgEl("title");
        tip.textContent = `${formatDay(day.date)}: ${word} ${value}`;
        bar.appendChild(tip);
        svg.appendChild(bar);
      });

      const label = svgEl("text", { x: center, y: H - 8, "text-anchor": "middle", class: "chart-text" });
      label.textContent = String(parseDay(day.date).getDate());
      svg.appendChild(label);
    });

    body.appendChild(svg);

    const legend = el("div", "chart-legend");
    [["Dibuat", "#7C8596"], ["Selesai", "#55C99A"]].forEach(([text, color]) => {
      const item = el("span");
      const swatch = el("i");
      swatch.style.background = color;
      item.append(swatch, document.createTextNode(text));
      legend.appendChild(item);
    });
    body.appendChild(legend);

    if (trend.every((d) => !d.created && !d.completed)) {
      body.appendChild(emptyState("Belum ada aktivitas dalam 14 hari terakhir."));
    }
  }

  /* ---------- Bar horizontal ---------- */

  function renderBars(body, rows, emptyText) {
    if (!rows.length || rows.every((row) => !row.value)) {
      body.appendChild(emptyState(emptyText));
      return;
    }
    const max = Math.max(...rows.map((row) => row.value));
    rows.forEach((row) => {
      const line = el("div", "bar-row");
      const label = el("span", "bar-label", row.label);
      label.title = row.label;
      const track = el("div", "bar-track");
      const fill = el("span", "bar-fill");
      fill.style.width = (row.value / max) * 100 + "%";
      if (row.color) fill.style.background = row.color;
      track.appendChild(fill);
      line.append(label, track, el("span", "bar-value", String(row.value)));
      body.appendChild(line);
    });
  }

  /* ---------- Kesehatan proyek ---------- */

  function renderHealth(body, projects) {
    if (!projects.length) {
      body.appendChild(emptyState("Belum ada proyek. Buat proyek di halaman Ringkasan untuk melihat skor kesehatannya."));
      return;
    }
    const grid = el("div", "health-grid");
    projects.forEach((project) => {
      const card = el("article", "health-card " + project.level);

      const top = el("div", "health-top");
      top.append(el("div", "task-title", project.name), el("span", "health-badge h-" + project.level, project.label));

      const score = el("div", "health-score");
      score.append(el("strong", "", project.score === null ? "—" : String(project.score)), el("span", "", "/ 100"));

      const track = el("div", "mini-track");
      const bar = el("span");
      bar.style.width = project.progress + "%";
      track.appendChild(bar);
      const caption = el("div", "task-meta", `${project.done}/${project.total} tugas selesai · ${project.progress}%`);

      const reasons = el("ul", "health-reasons");
      project.reasons.forEach((reason) => reasons.appendChild(el("li", "", reason)));

      card.append(top, score, track, caption, reasons);
      grid.appendChild(card);
    });
    body.appendChild(grid);
  }

  function renderRules(body) {
    const list = el("ul", "rules");
    [
      ["Progres (30 poin):", " persentase tugas proyek yang sudah selesai."],
      ["Ketepatan waktu (50 poin):", " porsi tugas belum selesai yang tidak melewati tenggat."],
      ["Kesiapan (20 poin):", " porsi tugas belum selesai yang tidak berstatus \"Belum mulai\" padahal jatuh tempo dalam 3 hari."],
      ["Level:", " 70 ke atas Sehat, 40–69 Perlu perhatian, di bawah 40 Berisiko."]
    ].forEach(([bold, rest]) => {
      const item = el("li");
      item.append(el("strong", "", bold), document.createTextNode(rest));
      list.appendChild(item);
    });
    body.appendChild(list);
    body.appendChild(el("p", "muted", "Ini aturan sederhana yang bisa kamu cek sendiri dari datamu, bukan prediksi AI."));
  }

  /* ---------- Halaman ---------- */

  function render(container, data) {
    container.replaceChildren();

    const kpis = el("section", "stats-grid");
    kpis.append(
      kpiCard("Tugas aktif", data.summary.open, "Belum selesai", "▦", false),
      kpiCard("Lewat tenggat", data.summary.overdue, data.summary.overdue ? "Perlu segera ditangani" : "Aman", "!", data.summary.overdue > 0),
      kpiCard("Jatuh tempo 7 hari", data.summary.due_week, "Dalam seminggu ke depan", "◷", false),
      kpiCard("Selesai 7 hari", data.week.completed, `Completion rate ${data.summary.completion_rate}%`, "✓", false)
    );
    container.appendChild(kpis);

    const topRow = el("div", "analytics-grid");
    const weekly = panel("WEEKLY SUMMARY", "Ringkasan 7 hari");
    renderWeekly(weekly.body, data.week);
    const attention = panel("DEADLINE RISK", "Perlu perhatian");
    renderAttention(attention.body, data.attention);
    topRow.append(weekly.box, attention.box);
    container.appendChild(topRow);

    const chartRow = el("div", "analytics-grid wide-right");
    const donut = panel("STATUS", "Distribusi status");
    renderDonut(donut.body, data.status);
    const trend = panel("PRODUCTIVITY", "Tren 14 hari terakhir");
    renderTrend(trend.body, data.trend);
    chartRow.append(donut.box, trend.box);
    container.appendChild(chartRow);

    const loadRow = el("div", "analytics-grid");
    const workload = panel("WORKLOAD", "Beban kerja per proyek");
    renderBars(
      workload.body,
      data.workload.map((row) => ({ label: row.name, value: row.open })),
      "Tidak ada tugas yang sedang berjalan."
    );
    const priority = panel("PRIORITY", "Prioritas tugas aktif");
    renderBars(
      priority.body,
      PRIORITY_META.map(([key, label, color]) => ({ label, value: data.priority[key], color })),
      "Tidak ada tugas aktif."
    );
    loadRow.append(workload.box, priority.box);
    container.appendChild(loadRow);

    const health = panel("PROJECT HEALTH", "Skor kesehatan proyek");
    renderHealth(health.body, data.projects);
    container.appendChild(health.box);

    const rules = panel("TRANSPARANSI", "Cara skor dihitung");
    renderRules(rules.body);
    container.appendChild(rules.box);
  }

  async function load() {
    const message = $("#analyticsMessage");
    const container = $("#analyticsBody");
    message.classList.remove("success");
    message.textContent = "Memuat analitik...";
    try {
      const data = await request("/api/analytics");
      render(container, data);
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  /* ---------- Unduh CSV ---------- */

  function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  async function downloadCsv() {
    const message = $("#analyticsMessage");
    message.classList.remove("success");
    try {
      const data = await request("/api/tasks");
      const header = ["ID", "Judul", "Status", "Prioritas", "Proyek", "Tenggat", "Dibuat", "Selesai"];
      const lines = [header.map(csvCell).join(",")];
      data.tasks.forEach((task) => {
        lines.push(
          [
            task.id,
            task.title,
            STATUS_LABEL[task.status] || task.status,
            PRIORITY_LABEL[task.priority] || task.priority,
            task.project_name || "",
            task.due_date || "",
            task.created_at || "",
            task.completed_at || ""
          ].map(csvCell).join(",")
        );
      });

      const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "taskora-tugas-" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      message.classList.add("success");
      message.textContent = `${data.tasks.length} tugas diekspor.`;
    } catch (error) {
      message.textContent = error.message;
    }
  }

  $("#refreshAnalytics").addEventListener("click", load);
  $("#exportCsv").addEventListener("click", downloadCsv);

  window.TaskoraAnalytics = { load };
})();