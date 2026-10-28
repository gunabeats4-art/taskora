const pool = require("../db");

// Mencatat riwayat aktivitas tugas. Kalau pencatatan gagal, aksi utama tetap berjalan.
async function logActivity({ taskId, userId, action, from = null, to = null }) {
  try {
    await pool.execute(
      `INSERT INTO task_activity_logs (task_id, user_id, action, from_value, to_value)
       VALUES (?, ?, ?, ?, ?)`,
      [taskId, userId, action, from, to]
    );
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
}

module.exports = { logActivity };