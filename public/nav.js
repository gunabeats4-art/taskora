(function () {
  const items = Array.from(document.querySelectorAll(".side-nav .nav-item"));
  const soon = document.getElementById("soonView");
  const soonTitle = document.getElementById("soonTitle");
  const soonText = document.getElementById("soonText");
  const pageTitle = document.getElementById("pageTitle");

  // Menu yang sudah punya halaman asli: key menu -> id halaman di index.html
  const VIEW_IDS = {
    overview: "overviewView",
    projects: "overviewView",
    calendar: "calendarView",
    analytics: "analyticsView"
  };
  const ALL_VIEWS = ["overviewView", "calendarView", "analyticsView"];

  // Dijalankan setiap kali halaman dibuka supaya datanya segar
  const LOADERS = {
    calendar: () => window.TaskoraCalendar && window.TaskoraCalendar.load(),
    analytics: () => window.TaskoraAnalytics && window.TaskoraAnalytics.load()
  };

  // Teks "Segera hadir" untuk menu yang halamannya belum ada
  const DESCRIPTIONS = {
    calendar: "Lihat semua tenggat tugas dalam kalender bulanan supaya tidak ada deadline yang terlewat.",
    analytics: "Grafik penyelesaian tugas, tugas terlambat, beban kerja, dan skor kesehatan proyek.",
    notifications: "Pemberitahuan tugas baru, perubahan status, dan tenggat yang mendekat.",
    team: "Undang anggota tim, atur peran, dan hak akses di setiap proyek.",
    settings: "Profil, preferensi, dan tema tampilan (dark atau light mode)."
  };

  function select(item) {
    const key = item.dataset.view;
    const targetId = VIEW_IDS[key];
    const target = targetId ? document.getElementById(targetId) : null;
    const showSoon = !target;

    items.forEach(other => {
      const active = other === item;
      other.classList.toggle("active", active);
      if (active) other.setAttribute("aria-current", "page");
      else other.removeAttribute("aria-current");
    });

    pageTitle.textContent = item.dataset.title;

    ALL_VIEWS.forEach(id => {
      const node = document.getElementById(id);
      if (node) node.hidden = node !== target;
    });
    soon.hidden = !showSoon;

    if (showSoon) {
      soonTitle.textContent = item.dataset.title;
      soonText.textContent = DESCRIPTIONS[key] || "";
    }

    if (target && LOADERS[key]) LOADERS[key]();

    if (key === "projects") {
      const panel = document.getElementById("projectsPanel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  items.forEach(item => item.addEventListener("click", () => select(item)));
  document.getElementById("backOverview").addEventListener("click", () => select(items[0]));
  document.getElementById("logoutBtn").addEventListener("click", () => select(items[0]));
})();