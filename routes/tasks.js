const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/authMiddleware");
const { logActivity } = require("../lib/activity");

const router = express.Router();
router.use(requireAuth);

const ALLOWED_STATUS = ["todo", "in_progress", "in_review", "done"];
const ALLOWED_PRIORITY = ["low", "medium", "high"];

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.get("/", async (req, res) => {
  try {
    const userId = req.session.user.id;
    const where = ["t.user_id = ?"];
    const params = [userId];

    const project = String(req.query.project || "");
    if (project === "none") {
      where.push("t.project_id IS NULL");
    } else if (project) {
      const projectId = Number(project);
      if (!Number.isInteger(projectId) || projectId < 1) {
        return res.status(400).json({ error: "Filter proyek tidak valid." });
      }
      where.push("t.project_id = ?");
      params.push(projectId);
    }

    const status = String(req.query.status || "");
    if (status) {
      if (!ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({ error: "Filter status tidak valid." });
      }
      where.push("t.status = ?");
      params.push(status);
    }

    const q = String(req.query.q || "").trim().slice(0, 100);
    if (q) {
      where.push("t.title LIKE ?");
      params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    }

    const [rows] = await pool.execute(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
              t.created_at, t.completed_at, t.project_id, p.name AS project_name,
              (SELECT COUNT(*) FROM task_comments c
                 WHERE c.task_id = t.id) AS comment_count,
              (SELECT COUNT(*) FROM task_comments c
                 WHERE c.task_id = t.id AND c.kind = 'revision' AND c.is_resolved = 0) AS open_revisions
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY t.created_at DESC`,
      params
    );

    const [statRows] = await pool.execute(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status IN ('in_progress','in_review')), 0) AS in_progress,
              COALESCE(SUM(status = 'done'), 0) AS done
       FROM tasks WHERE user_id = ?`,
      [userId]
    );
    const stats = {
      total: Number(statRows[0].total),
      in_progress: Number(statRows[0].in_progress),
      done: Number(statRows[0].done)
    };

    res.json({ tasks: rows, stats });
  } catch (error) {
    console.error("Get tasks error:", error.message);
    res.status(500).json({ error: "Gagal mengambil tugas." });
  }
});

router.post("/", async (req, res) => {
  try {
    const userId = req.session.user.id;
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const dueDate = req.body.due_date ? String(req.body.due_date) : null;
    const priority = String(req.body.priority || "medium");

    if (!title || title.length > 200) {
      return res.status(400).json({ error: "Judul wajib diisi (maksimal 200 karakter)." });
    }
    if (description.length > 5000) {
      return res.status(400).json({ error: "Deskripsi maksimal 5000 karakter." });
    }
    if (dueDate && !isValidDate(dueDate)) {
      return res.status(400).json({ error: "Tanggal tidak valid (format YYYY-MM-DD)." });
    }
    if (!ALLOWED_PRIORITY.includes(priority)) {
      return res.status(400).json({ error: "Prioritas tidak valid." });
    }

    let projectId = null;
    const rawProject = req.body.project_id;
    if (rawProject !== undefined && rawProject !== null && rawProject !== "") {
      projectId = Number(rawProject);
      if (!Number.isInteger(projectId) || projectId < 1) {
        return res.status(400).json({ error: "ID proyek tidak valid." });
      }
      const [owned] = await pool.execute(
        "SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1",
        [projectId, userId]
      );
      if (!owned.length) {
        return res.status(404).json({ error: "Proyek tidak ditemukan." });
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO tasks (user_id, project_id, title, description, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, projectId, title, description || null, priority, dueDate]
    );

    const [rows] = await pool.execute(
      `SELECT id, title, description, status, priority, due_date, created_at, project_id
       FROM tasks WHERE id = ? AND user_id = ?`,
      [result.insertId, userId]
    );

    res.status(201).json({ task: rows[0] });
  } catch (error) {
    console.error("Create task error:", error.message);
    res.status(500).json({ error: "Gagal membuat tugas." });
  }
});

router.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;

  if (!Number.isInteger(id) || id < 1 || !ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: "ID atau status tidak valid." });
  }

  try {
    const userId = req.session.user.id;

    const [current] = await pool.execute(
      "SELECT status FROM tasks WHERE id = ? AND user_id = ? LIMIT 1",
      [id, userId]
    );
    if (!current.length) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }
    const previous = current[0].status;

    await pool.execute(
      `UPDATE tasks
       SET status = ?,
           completed_at = CASE
             WHEN ? = 'done' THEN COALESCE(completed_at, NOW())
             ELSE NULL
           END
       WHERE id = ? AND user_id = ?`,
      [status, status, id, userId]
    );

    if (previous !== status) {
      await logActivity({ taskId: id, userId, action: "status_changed", from: previous, to: status });
    }

    res.json({ message: "Status tugas diperbarui." });
  } catch (error) {
    console.error("Update task error:", error.message);
    res.status(500).json({ error: "Gagal memperbarui status." });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "ID tugas tidak valid." });
  }

  try {
    const [result] = await pool.execute(
      "DELETE FROM tasks WHERE id = ? AND user_id = ?",
      [id, req.session.user.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }
    res.json({ message: "Tugas berhasil dihapus." });
  } catch (error) {
    console.error("Delete task error:", error.message);
    res.status(500).json({ error: "Gagal menghapus tugas." });
  }
});

router.use(require("./taskDetails"));

module.exports = router;