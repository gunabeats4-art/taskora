const express = require("express");
const pool = require("../db");
const { logActivity } = require("../lib/activity");

// Router ini dipasang di dalam routes/tasks.js, jadi sudah dilindungi requireAuth.
const router = express.Router();

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

async function findOwnedTask(taskId, userId) {
  const [rows] = await pool.execute(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
            t.created_at, t.completed_at, t.project_id, p.name AS project_name
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? AND t.user_id = ? LIMIT 1`,
    [taskId, userId]
  );
  return rows[0] || null;
}

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID tugas tidak valid." });

  try {
    const task = await findOwnedTask(id, req.session.user.id);
    if (!task) return res.status(404).json({ error: "Tugas tidak ditemukan." });

    const [comments] = await pool.execute(
      `SELECT id, kind, source, body, is_resolved, resolved_at, created_at
       FROM task_comments WHERE task_id = ?
       ORDER BY created_at DESC, id DESC`,
      [id]
    );
    const [logs] = await pool.execute(
      `SELECT id, action, from_value, to_value, created_at
       FROM task_activity_logs WHERE task_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [id]
    );

    res.json({
      task,
      comments: comments.map((c) => ({ ...c, is_resolved: Boolean(c.is_resolved) })),
      logs
    });
  } catch (error) {
    console.error("Get task detail error:", error.message);
    res.status(500).json({ error: "Gagal mengambil detail tugas." });
  }
});

router.post("/:id/comments", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID tugas tidak valid." });

  const kind = req.body.kind === "revision" ? "revision" : "comment";
  const body = String(req.body.body || "").trim();
  const source = kind === "revision" ? String(req.body.source || "").trim() : "";

  if (!body || body.length > 2000) {
    return res.status(400).json({ error: "Isi catatan wajib diisi (maksimal 2000 karakter)." });
  }
  if (source.length > 60) {
    return res.status(400).json({ error: "Nama sumber maksimal 60 karakter." });
  }

  try {
    const userId = req.session.user.id;
    const task = await findOwnedTask(id, userId);
    if (!task) return res.status(404).json({ error: "Tugas tidak ditemukan." });

    const [result] = await pool.execute(
      `INSERT INTO task_comments (task_id, user_id, kind, source, body)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, kind, source || null, body]
    );

    await logActivity({
      taskId: id,
      userId,
      action: kind === "revision" ? "revision_added" : "comment_added"
    });

    res.status(201).json({ comment: { id: result.insertId, kind, source: source || null, body } });
  } catch (error) {
    console.error("Create comment error:", error.message);
    res.status(500).json({ error: "Gagal menyimpan catatan." });
  }
});

router.patch("/:id/comments/:commentId", async (req, res) => {
  const taskId = parseId(req.params.id);
  const commentId = parseId(req.params.commentId);
  if (!taskId || !commentId) return res.status(400).json({ error: "ID tidak valid." });
  if (typeof req.body.resolved !== "boolean") {
    return res.status(400).json({ error: "Nilai resolved harus true atau false." });
  }

  const resolved = req.body.resolved;

  try {
    const userId = req.session.user.id;
    const [rows] = await pool.execute(
      `SELECT c.id, c.kind, c.is_resolved
       FROM task_comments c
       JOIN tasks t ON t.id = c.task_id
       WHERE c.id = ? AND c.task_id = ? AND t.user_id = ? LIMIT 1`,
      [commentId, taskId, userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Catatan tidak ditemukan." });
    if (rows[0].kind !== "revision") {
      return res.status(400).json({ error: "Hanya catatan revisi yang bisa ditandai." });
    }

    const flag = resolved ? 1 : 0;
    await pool.execute(
      `UPDATE task_comments
       SET is_resolved = ?, resolved_at = IF(? = 1, NOW(), NULL)
       WHERE id = ?`,
      [flag, flag, commentId]
    );

    if (Boolean(rows[0].is_resolved) !== resolved) {
      await logActivity({
        taskId,
        userId,
        action: resolved ? "revision_resolved" : "revision_reopened"
      });
    }

    res.json({ message: resolved ? "Revisi ditandai selesai." : "Revisi dibuka kembali." });
  } catch (error) {
    console.error("Update comment error:", error.message);
    res.status(500).json({ error: "Gagal memperbarui catatan." });
  }
});

module.exports = router;