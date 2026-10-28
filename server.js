require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const path = require("path");
const pool = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET harus diisi dengan string acak minimal 32 karakter.");
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(session({
  name: "taskora.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/analytics", require("./routes/analytics"));

app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT DATABASE() AS database_name");
    res.json({
      status: "ok",
      message: "TASKORA backend berjalan",
      database: rows[0].database_name
    });
  } catch (error) {
    console.error("Health check error:", error.message);
    res.status(500).json({ status: "error", message: "Koneksi database gagal." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

async function start() {
  try {
    await pool.query("SELECT 1");
    app.listen(PORT, () => {
      console.log(`TASKORA berjalan di http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Tidak dapat terhubung ke MySQL:", error.message);
    process.exit(1);
  }
}

start();