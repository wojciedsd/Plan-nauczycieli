// Lokalny serwer: pobiera plan lekcji z EduPage, wyciąga nauczycieli i serwuje stronę.
// Uruchomienie:  node server.js   (wymaga Node.js 18 lub nowszego, bez dodatkowych paczek)
const http = require("http");
const fs = require("fs");
const path = require("path");

const SCHOOL = "zs2ostrzeszow";
const BASE = `https://${SCHOOL}.edupage.org`;
const PORT = 3000;
const CACHE = path.join(__dirname, "dane.json");

async function edupage(file, func, args) {
  const res = await fetch(`${BASE}/timetable/server/${file}?__func=${func}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ __args: [null, ...args], __gsh: "00000000" }),
  });
  if (!res.ok) throw new Error(`EduPage odpowiedział kodem ${res.status}`);
  const json = await res.json();
  return json.r;
}

async function findTimetableNumber() {
  const now = new Date();
  const schoolYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  for (const year of [schoolYear, schoolYear - 1]) {
    try {
      const r = await edupage("ttviewer.js", "getTTViewerData", [year]);
      const reg = r && r.regular;
      if (!reg) continue;
      const list = reg.timetables || [];
      if (reg.default_num) return String(reg.default_num);
      if (list.length) return String(list[list.length - 1].tt_num);
    } catch (e) {
      console.warn(`Rok ${year}: ${e.message}`);
    }
  }
  throw new Error("Nie znaleziono planu lekcji na EduPage.");
}

function buildData(tables) {
  const T = {};
  for (const t of tables) T[t.id] = t.data_rows || [];
  const byId = (name) => Object.fromEntries((T[name] || []).map((r) => [r.id, r]));

  const subjects = byId("subjects");
  const classes = byId("classes");
  const rooms = byId("classrooms");
  const groups = byId("groups");
  const lessons = byId("lessons");

  const periods = (T.periods || [])
    .map((p) => ({ period: Number(p.period), start: p.starttime, end: p.endtime }))
    .sort((a, b) => a.period - b.period);

  const teachers = (T.teachers || []).map((t) => ({
    id: t.id,
    name: ((t.firstname || "") + " " + (t.lastname || "")).trim() || t.name || t.short || t.id,
    short: t.short || "",
    lessons: [],
  }));
  const teacherMap = Object.fromEntries(teachers.map((t) => [t.id, t]));

  for (const card of T.cards || []) {
    const lesson = lessons[card.lessonid];
    if (!lesson) continue;
    const dayStr = String(card.days || "");
    const day = dayStr.indexOf("1"); // 0 = poniedziałek ... 4 = piątek
    if (day < 0 || day > 4) continue;
    const entry = {
      day,
      period: Number(card.period),
      len: Number(lesson.durationperiods) || 1,
      subject: (subjects[lesson.subjectid] || {}).name || "?",
      classes: (lesson.classids || []).map((id) => (classes[id] || {}).short || "?"),
      groups: (lesson.groupids || []).map((id) => (groups[id] || {}).name).filter(Boolean),
      rooms: (card.classroomids || []).map((id) => (rooms[id] || {}).short || (rooms[id] || {}).name).filter(Boolean),
      weeks: String(card.weeks || ""),
    };
    for (const tid of lesson.teacherids || []) {
      if (teacherMap[tid]) teacherMap[tid].lessons.push(entry);
    }
  }

  return {
    school: SCHOOL,
    fetchedAt: new Date().toISOString(),
    periods,
    teachers: teachers.filter((t) => t.lessons.length).sort((a, b) => a.name.localeCompare(b.name, "pl")),
  };
}

async function fetchFresh() {
  const num = await findTimetableNumber();
  const r = await edupage("regulartt.js", "regularttGetData", [num]);
  const tables = r && r.dbiAccessorRes && r.dbiAccessorRes.tables;
  if (!tables) throw new Error("EduPage zwrócił dane w nieoczekiwanym formacie.");
  const data = buildData(tables);
  fs.writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

async function getData(refresh) {
  if (!refresh && fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  try {
    return await fetchFresh();
  } catch (e) {
    if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
    throw e;
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/api/data") {
      try {
        const data = await getData(url.searchParams.get("refresh") === "1");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!TYPES[path.extname(file)] || file.includes("..")) {
      res.writeHead(404);
      return res.end("Nie znaleziono");
    }
    fs.readFile(path.join(__dirname, file), (err, buf) => {
      if (err) {
        res.writeHead(404);
        return res.end("Nie znaleziono");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] });
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`Gotowe: otwórz http://localhost:${PORT}`));
