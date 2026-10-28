const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(requireAuth);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.name, p.description, p.created_at,
              COUNT(t.id) AS total_tasks,
              COALESCE(SUM(t.status = 'done'), 0) AS done_tasks
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.owner_id
       WHERE p.owner_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.session.user.id]
    );
    const projects = rows.map(r => ({
      ...r,
      total_tasks: Number(r.total_tasks),
      done_tasks: Number(r.done_tasks)
    }));
    res.json({ projects });
  } catch (error) {
    console.error("Get projects error:", error.message);
    res.status(500).json({ error: "Gagal mengambil proyek." });
  }
});

router.post("/", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    if (!name || name.length > 100) {
      return res.status(400).json({ error: "Nama proyek wajib diisi (maksimal 100 karakter)." });
    }
    if (description.length > 2000) {
      return res.status(400).json({ error: "Deskripsi maksimal 2000 karakter." });
    }

    const [result] = await pool.execute(
      "INSERT INTO projects (owner_id, name, description) VALUES (?, ?, ?)",
      [req.session.user.id, name, description || null]
    );
    res.status(201).json({ project: { id: result.insertId, name, description: description || null } });
  } catch (error) {
    console.error("Create project error:", error.message);
    res.status(500).json({ error: "Gagal membuat proyek." });
  }
});

router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (!id) return res.status(400).json({ error: "ID proyek tidak valid." });
  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Nama proyek wajib diisi (maksimal 100 karakter)." });
  }
  if (description.length > 2000) {
    return res.status(400).json({ error: "Deskripsi maksimal 2000 karakter." });
  }

  try {
    const [result] = await pool.execute(
      "UPDATE projects SET name = ?, description = ? WHERE id = ? AND owner_id = ?",
      [name, description || null, id, req.session.user.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: "Proyek tidak ditemukan." });
    }
    res.json({ message: "Proyek diperbarui." });
  } catch (error) {
    console.error("Update project error:", error.message);
    res.status(500).json({ error: "Gagal memperbarui proyek." });
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID proyek tidak valid." });

  try {
    const [result] = await pool.execute(
      "DELETE FROM projects WHERE id = ? AND owner_id = ?",
      [id, req.session.user.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: "Proyek tidak ditemukan." });
    }
    res.json({ message: "Proyek dihapus." });
  } catch (error) {
    console.error("Delete project error:", error.message);
    res.status(500).json({ error: "Gagal menghapus proyek." });
  }
});

module.exports = router;