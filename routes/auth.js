const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const pool = require("../db");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Terlalu banyak percobaan. Coba lagi nanti." }
});

router.post("/register", authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Nama harus 2–100 karakter." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 191) {
      return res.status(400).json({ error: "Format email tidak valid." });
    }
    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({
        error: "Password harus 10–72 karakter untuk versi ini."
      });
    }

    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (existing.length) {
      return res.status(409).json({ error: "Email sudah terdaftar." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, passwordHash]
    );

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Gagal membuat sesi." });
      req.session.user = { id: result.insertId, name, email };
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Gagal menyimpan sesi." });
        res.status(201).json({ user: req.session.user });
      });
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email sudah terdaftar." });
    }
    console.error("Register error:", error.message);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const [rows] = await pool.execute(
      "SELECT id, name, email, password_hash FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (!rows.length) {
      return res.status(401).json({ error: "Email atau password salah." });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Email atau password salah." });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Gagal membuat sesi." });
      req.session.user = { id: user.id, name: user.name, email: user.email };
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Gagal menyimpan sesi." });
        res.json({ user: req.session.user });
      });
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

router.post("/logout", (req, res, next) => {
  if (!req.session) return res.json({ message: "Logout berhasil." });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("taskora.sid");
    res.json({ message: "Logout berhasil." });
  });
});

router.get("/me", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Belum login." });
  }
  res.json({ user: req.session.user });
});

module.exports = router;