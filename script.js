const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek"];
const $ = (id) => document.getElementById(id);
let data = null;
let activeIndex = -1;
let shown = [];

// Normalizacja: małe litery, bez polskich znaków, żeby "zolc" znalazło "Żółć".
const norm = (s) =>
  s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };

// Każdy przedmiot dostaje stały kolor (odcień wyliczony z nazwy).
function hue(subject) {
  let h = 5381;
  for (const c of subject) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/* ---------- motyw ---------- */
$("theme").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}
});

/* ---------- dane ---------- */
function setStatus(text, { error = false, loading = false } = {}) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", error);
  el.classList.toggle("loading", loading);
}

async function load(refresh = false) {
  setStatus("Wczytuję dane z EduPage…", { loading: true });
  $("q").disabled = true;
  try {
    let json = null;
    // 1) wersja w internecie: gotowy plik dane.json obok strony
    if (!refresh) {
      try {
        const r = await fetch("dane.json", { cache: "no-cache" });
        if (r.ok) json = await r.json();
      } catch (e) { /* przejdź do wersji z lokalnym serwerem */ }
    }
    if (json) {
      $("refresh").hidden = true; // dane odświeżają się automatycznie
    } else {
      // 2) wersja lokalna: node server.js
      const res = await fetch("/api/data" + (refresh ? "?refresh=1" : ""));
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Błąd serwera");
      json = j;
      $("refresh").hidden = false;
    }
    data = json;
    data.teachers.forEach((t) => (t._n = norm(t.name)));
    $("q").disabled = false;
    $("q").focus();
    setStatus(`Znaleziono nauczycieli: ${data.teachers.length}. Zacznij wpisywać imię lub nazwisko.`);
    $("updated").textContent = "Plan zaktualizowany: " + new Date(data.fetchedAt).toLocaleString("pl-PL");
  } catch (e) {
    setStatus("Nie udało się wczytać danych (" + e.message + "). Odśwież stronę lub spróbuj za chwilę.", { error: true });
  }
}

/* ---------- wyszukiwanie ---------- */
function search(text) {
  const words = norm(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return data.teachers.filter((t) => words.every((w) => t._n.includes(w))).slice(0, 8);
}

function showSuggestions(list) {
  shown = list;
  activeIndex = -1;
  const ul = $("suggestions");
  ul.innerHTML = "";
  list.forEach((t, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.innerHTML = `<span class="mini-avatar">${esc(initials(t.name))}</span><span>${esc(t.name)}</span>`;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
    ul.appendChild(li);
  });
  ul.hidden = !list.length;
  if (!list.length && $("q").value.trim()) setStatus("Nie znaleziono nauczyciela o takim imieniu lub nazwisku.");
  else if (list.length) setStatus(`Znaleziono nauczycieli: ${data.teachers.length}.`);
}

function highlight(i) {
  [...$("suggestions").children].forEach((li, n) => li.setAttribute("aria-selected", n === i));
  activeIndex = i;
}

function choose(i) {
  const t = shown[i];
  if (!t) return;
  $("q").value = t.name;
  $("suggestions").hidden = true;
  renderTeacher(t);
}

/* ---------- plan ---------- */
const isEveryWeek = (w) => !w || !w.includes("0");
function weekLabel(w) {
  if (isEveryWeek(w)) return "";
  const idx = w.indexOf("1");
  return "tydz. " + (idx === 0 ? "A" : idx === 1 ? "B" : idx + 1);
}

function renderTeacher(t) {
  const now = new Date();
  const todayCol = now.getDay() - 1; // 0 = poniedziałek, -1/5 = weekend
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const periods = data.periods;
  const slot = (n) => periods.find((p) => p.period === n);

  const activeDay = todayCol >= 0 && todayCol <= 4 ? todayCol : 0;
  const SHORT = ["Pon", "Wt", "Śr", "Czw", "Pt"];
  let tabs = "";
  let html = "";
  for (let d = 0; d < 5; d++) {
    const cnt = t.lessons.filter((l) => l.day === d).length;
    tabs += `<button type="button" role="tab" class="tab${d === activeDay ? " active" : ""}${d === todayCol ? " is-today" : ""}" data-day="${d}" aria-selected="${d === activeDay}">${SHORT[d]}<small>${cnt}</small></button>`;
    const list = t.lessons.filter((l) => l.day === d).sort((a, b) => a.period - b.period);
    const n = list.length;
    const word = n === 1 ? "lekcja" : n >= 2 && n <= 4 ? "lekcje" : "lekcji";
    const isToday = d === todayCol;
    html += `<div class="day${isToday ? " today" : ""}${d === activeDay ? " active" : ""}"><div class="day-head">${DAYS[d]}<small>${n} ${word}</small></div>`;

    if (!n) html += `<div class="day-empty">Brak lekcji</div>`;

    let prevEnd = null; // numer lekcji zaraz po poprzedniej
    list.forEach((l, i) => {
      const last = l.period + l.len - 1;
      const a = slot(l.period), b = slot(last);
      if (prevEnd !== null && l.period > prevEnd) {
        const g = l.period - prevEnd;
        html += `<div class="gap">okienko: ${g} ${g === 1 ? "lekcja" : g <= 4 ? "lekcje" : "lekcji"}</div>`;
      }
      prevEnd = Math.max(prevEnd ?? 0, last + 1);

      const isNow = isToday && a && b && nowMin >= toMin(a.start) && nowMin < toMin(b.end);
      const extra = [l.classes.join(", "), l.groups.join(", "), l.rooms.length ? "sala " + l.rooms.join(", ") : ""].filter(Boolean).join(" · ");
      const wk = weekLabel(l.weeks);
      const num = l.len > 1 ? `${l.period}–${last}` : `${l.period}`;
      const time = a && b ? `${a.start}–${b.end}` : "";
      html += `<div class="lesson${isNow ? " now" : ""}" style="--h:${hue(l.subject)};--i:${d + i}">` +
        `<div class="when"><strong>${num}</strong><small>${time}</small></div>` +
        `<div class="what"><b>${esc(l.subject)}</b>${extra ? `<span>${esc(extra)}</span>` : ""}${wk ? `<em>${wk}</em>` : ""}</div></div>`;
    });
    html += "</div>";
  }
  $("grid").innerHTML = html;
  $("dayTabs").innerHTML = tabs;

  const total = t.lessons.length;
  $("avatar").textContent = initials(t.name);
  $("teacherName").textContent = t.name;
  $("teacherMeta").textContent = `${total} lekcji w tygodniu` + (t.short ? ` · skrót: ${t.short}` : "");
  $("todayInfo").textContent = todayText(t, todayCol, periods);

  // restart animacji wejścia przy każdym wyborze
  const res = $("result");
  res.hidden = false;
  res.style.animation = "none";
  void res.offsetWidth;
  res.style.animation = "";
}

function todayText(t, col, periods) {
  if (col < 0 || col > 4) return "Dziś weekend";
  const todays = t.lessons.filter((l) => l.day === col);
  if (!todays.length) return "Dziś bez lekcji";
  const first = Math.min(...todays.map((l) => l.period));
  const last = Math.max(...todays.map((l) => l.period + l.len - 1));
  const a = periods.find((p) => p.period === first), b = periods.find((p) => p.period === last);
  return `Dziś: ${a ? a.start : "?"}–${b ? b.end : "?"}`;
}

/* ---------- zdarzenia ---------- */
$("q").addEventListener("input", (e) => showSuggestions(search(e.target.value)));
$("q").addEventListener("keydown", (e) => {
  const n = shown.length;
  if (e.key === "ArrowDown" && n) { e.preventDefault(); highlight((activeIndex + 1) % n); }
  else if (e.key === "ArrowUp" && n) { e.preventDefault(); highlight((activeIndex - 1 + n) % n); }
  else if (e.key === "Enter") { e.preventDefault(); choose(activeIndex >= 0 ? activeIndex : 0); }
  else if (e.key === "Escape") { $("suggestions").hidden = true; }
});
$("q").addEventListener("blur", () => ($("suggestions").hidden = true));
$("refresh").addEventListener("click", () => load(true));
$("dayTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const d = btn.dataset.day;
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b === btn);
    b.setAttribute("aria-selected", b === btn);
  });
  document.querySelectorAll(".day").forEach((el, i) => el.classList.toggle("active", String(i) === d));
});

load();
