const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(requireAuth);

const TREND_DAYS = 14;
const URGENT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const diffDays = (from, to) => Math.round((parseYmd(to) - parseYmd(from)) / DAY_MS);
const dayOf = (value) => (value ? String(value).slice(0, 10) : null);

/*
  Skor kesehatan proyek (0-100), aturan transparan:
  - Progres        (30 poin): persentase tugas yang sudah selesai
  - Ketepatan waktu (50 poin): porsi tugas belum selesai yang TIDAK melewati tenggat
  - Kesiapan       (20 poin): porsi tugas belum selesai yang TIDAK "mendesak tapi belum dimulai"
                              (jatuh tempo <= 3 hari dan statusnya masih todo)
  Level: >= 70 sehat, 40-69 perlu perhatian, < 40 berisiko.
*/
function evaluateProject(project, list, ctx) {
  const total = list.length;
  const done = list.filter((t) => t.status === "done").length;
  const openList = list.filter((t) => t.status !== "done");
  const open = openList.length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  const base = { id: project.id, name: project.name, total, done, open, progress };

  if (!total) {
    return {
      ...base,
      score: null,
      level: "empty",
      label: "Belum ada tugas",
      overdue: 0,
      reasons: ["Belum ada tugas di proyek ini."]
    };
  }

  const overdue = openList.filter((t) => t.due_date && t.due_date < ctx.todayStr).length;
  const urgentIdle = openList.filter(
    (t) =>
      t.status === "todo" &&
      t.due_date &&
      t.due_date >= ctx.todayStr &&
      t.due_date <= ctx.urgentStr
  ).length;
  const noDeadline = openList.filter((t) => !t.due_date).length;

  const progressRatio = done / total;
  const onTimeRatio = open ? 1 - overdue / open : 1;
  const readyRatio = open ? 1 - urgentIdle / open : 1;
  const score = Math.round(30 * progressRatio + 50 * onTimeRatio + 20 * readyRatio);

  const level = score >= 70 ? "healthy" : score >= 40 ? "warning" : "risk";
  const label = { healthy: "Sehat", warning: "Perlu perhatian", risk: "Berisiko" }[level];

  const reasons = [];
  if (overdue) reasons.push(`${overdue} tugas melewati tenggat`);
  if (urgentIdle) {
    reasons.push(`${urgentIdle} tugas jatuh tempo dalam ${URGENT_DAYS} hari tapi belum dimulai`);
  }
  if (open && progress < 30) reasons.push(`Progres baru ${progress}%`);
  if (noDeadline) reasons.push(`${noDeadline} tugas belum punya tenggat`);
  if (!reasons.length) reasons.push(open ? "Tidak ada hambatan terdeteksi." : "Semua tugas selesai.");

  return { ...base, score, level, label, overdue, reasons };
}

router.get("/", async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [tasks] = await pool.execute(
      `SELECT id, project_id, title, status, priority, due_date, created_at, completed_at
       FROM tasks WHERE user_id = ?`,
      [userId]
    );
    const [projects] = await pool.execute(
      "SELECT id, name FROM projects WHERE owner_id = ? ORDER BY created_at DESC",
      [userId]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ctx = {
      todayStr: toYmd(today),
      urgentStr: toYmd(addDays(today, URGENT_DAYS))
    };
    const weekAgoStr = toYmd(addDays(today, -6));
    const weekAheadStr = toYmd(addDays(today, 7));

    const openTasks = tasks.filter((t) => t.status !== "done");
    const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date < ctx.todayStr);
    const dueThisWeek = openTasks.filter(
      (t) => t.due_date && t.due_date >= ctx.todayStr && t.due_date <= weekAheadStr
    );

    const status = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
    tasks.forEach((t) => { status[t.status] += 1; });

    const priority = { low: 0, medium: 0, high: 0 };
    openTasks.forEach((t) => { priority[t.priority] += 1; });

    const trend = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      trend.push({ date: toYmd(addDays(today, -i)), created: 0, completed: 0 });
    }
    const trendByDate = new Map(trend.map((d) => [d.date, d]));
    tasks.forEach((t) => {
      const created = trendByDate.get(dayOf(t.created_at));
      if (created) created.created += 1;
      const completed = trendByDate.get(dayOf(t.completed_at));
      if (completed) completed.completed += 1;
    });

    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const grouped = new Map();
    tasks.forEach((t) => {
      if (t.project_id === null) return;
      if (!grouped.has(t.project_id)) grouped.set(t.project_id, []);
      grouped.get(t.project_id).push(t);
    });

    const health = projects.map((p) => evaluateProject(p, grouped.get(p.id) || [], ctx));
    health.sort(
      (a, b) => (a.score === null) - (b.score === null) || (a.score ?? 0) - (b.score ?? 0)
    );

    const workload = health
      .filter((h) => h.open > 0)
      .map((h) => ({ name: h.name, open: h.open }));
    const noProjectOpen = openTasks.filter((t) => t.project_id === null).length;
    if (noProjectOpen) workload.push({ name: "Tanpa proyek", open: noProjectOpen });
    workload.sort((a, b) => b.open - a.open);

    const attention = openTasks
      .filter((t) => t.due_date && t.due_date <= ctx.urgentStr)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 6)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        due_date: t.due_date,
        project: t.project_id ? projectName.get(t.project_id) || null : null,
        days_left: diffDays(ctx.todayStr, t.due_date)
      }));

    res.json({
      date: ctx.todayStr,
      summary: {
        total: tasks.length,
        done: status.done,
        open: openTasks.length,
        overdue: overdueTasks.length,
        due_week: dueThisWeek.length,
        completion_rate: tasks.length ? Math.round((status.done / tasks.length) * 100) : 0
      },
      week: {
        completed: tasks.filter((t) => t.completed_at && dayOf(t.completed_at) >= weekAgoStr).length,
        created: tasks.filter((t) => dayOf(t.created_at) >= weekAgoStr).length,
        due: dueThisWeek.length,
        overdue: overdueTasks.length
      },
      status,
      priority,
      trend,
      workload,
      attention,
      projects: health
    });
  } catch (error) {
    console.error("Analytics error:", error.message);
    res.status(500).json({ error: "Gagal memuat analitik." });
  }
});

module.exports = router;