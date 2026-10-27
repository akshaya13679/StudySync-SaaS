```javascript
/* StudySync — Student Planner
   Tasks, exams, focus timer, analytics, and dark mode.
*/

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const STORAGE_KEY = "studysync_tasks_v1";
const EXAM_KEY = "studysync_exams_v1";
const THEME_KEY = "studysync_dark_v1";

let tasks = load(STORAGE_KEY, []);
let exams = load(EXAM_KEY, []);
let currentFilter = "ALL";
let searchText = "";
let editingId = null;

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(EXAM_KEY, JSON.stringify(exams));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function todayString() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "No due date";
  const date = new Date(value + "T00:00:00");
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short"
  });
}

function daysUntil(value) {
  if (!value) return null;
  const target = new Date(value + "T00:00:00");
  const today = new Date(todayString() + "T00:00:00");
  return Math.ceil((target - today) / 86400000);
}

function notify(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove("show"), 2500);
}

function categoryClass(category) {
  return "tag-" + String(category || "").toLowerCase().replace(/[^a-z]/g, "");
}

function taskCard(task) {
  const category = escapeHTML(task.category || "STUDY");
  const priority = escapeHTML(task.priority || "MEDIUM");
  const due = task.due ? formatDate(task.due) : "No due date";

  return `
    <article class="task-row">
      <button class="check ${task.done ? "checked" : ""}"
        data-action="toggle" data-id="${escapeHTML(task.id)}"
        aria-label="${task.done ? "Mark incomplete" : "Mark complete"}">
        ${task.done ? "✓" : ""}
      </button>
      <div class="task-info">
        <div class="task-title ${task.done ? "done" : ""}">
          ${escapeHTML(task.title)}
        </div>
        <div class="meta">
          <span class="tag ${categoryClass(category)}">${category}</span>
          <span class="tag ${categoryClass(priority)}">${priority}</span>
          <span>📅 ${escapeHTML(due)}</span>
        </div>
      </div>
      <div class="row-actions">
        <button data-action="edit" data-id="${escapeHTML(task.id)}"
          aria-label="Edit task" title="Edit">✎</button>
        <button data-action="delete" data-id="${escapeHTML(task.id)}"
          aria-label="Delete task" title="Delete">×</button>
      </div>
    </article>`;
}

function visibleTasks() {
  return tasks.filter((task) => {
    const matchesFilter =
      currentFilter === "ALL" ||
      task.category === currentFilter ||
      (currentFilter === "PENDING" && !task.done) ||
      (currentFilter === "COMPLETED" && task.done);

    const matchesSearch =
      (task.title || "").toLowerCase().includes(searchText.toLowerCase());

    return matchesFilter && matchesSearch;
  }).sort((a, b) => {
    if (a.done !== b.done) return Number(a.done) - Number(b.done);
    return (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31");
  });
}

function renderTasks() {
  const list = $("#taskList");
  if (!list) return;

  const filtered = visibleTasks();
  list.innerHTML = filtered.map(taskCard).join("");

  const empty = $("#taskEmpty");
  if (empty) empty.classList.toggle("show", filtered.length === 0);

  const today = todayString();
  const pending = tasks.filter((task) => !task.done);
  const completed = tasks.filter((task) => task.done);
  const dueToday = pending.filter((task) => task.due === today);
  const overdue = pending.filter((task) => task.due && task.due < today);

  setText("#statTotal", tasks.length);
  setText("#statPending", pending.length);
  setText("#statCompleted", completed.length);
  setText("#statDue", dueToday.length);
  setText("#statOverdue", overdue.length);

  const percent = tasks.length
    ? Math.round((completed.length / tasks.length) * 100)
    : 0;

  setText("#completionPercent", percent + "%");
  setText("#progressPercent", percent + "%");

  const progress = $("#progressBar");
  if (progress) progress.style.width = percent + "%";

  const homeList = $("#homeTaskList");
  if (homeList) {
    const upcoming = tasks
      .filter((task) => !task.done)
      .sort((a, b) => (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31"))
      .slice(0, 4);

    homeList.innerHTML = upcoming.map(taskCard).join("");
    const empty = $("#homeTaskEmpty");
    if (empty) empty.classList.toggle("show", upcoming.length === 0);
  }

  const count = $("#taskCount");
  if (count) count.textContent = pending.length;

  renderAnalytics();
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function openTaskModal(task = null) {
  const modal = $("#taskModal");
  if (!modal) {
    notify("Task form is missing from index.html.");
    return;
  }

  editingId = task?.id || null;
  $("#taskModalTitle").textContent = task ? "Edit task" : "Create a task";
  $("#taskTitle").value = task?.title || "";
  $("#taskCategory").value = task?.category || "STUDY";
  $("#taskPriority").value = task?.priority || "MEDIUM";
  $("#taskDue").value = task?.due || "";
  $("#taskNotes").value = task?.notes || "";
  modal.classList.add("open");
  $("#taskTitle").focus();
}

function closeTaskModal() {
  $("#taskModal")?.classList.remove("open");
  editingId = null;
}

function handleTaskSubmit(event) {
  event.preventDefault();

  const title = $("#taskTitle").value.trim();
  if (!title) {
    notify("Please enter a task title.");
    return;
  }

  const data = {
    title,
    category: $("#taskCategory").value,
    priority: $("#taskPriority").value,
    due: $("#taskDue").value,
    notes: $("#taskNotes").value.trim()
  };

  if (editingId) {
    tasks = tasks.map((task) =>
      task.id === editingId ? { ...task, ...data } : task
    );
    notify("Task updated successfully!");
  } else {
    tasks.push({
      id: uid(),
      ...data,
      done: false,
      createdAt: new Date().toISOString()
    });
    notify("Task added successfully!");
  }

  save();
  renderTasks();
  closeTaskModal();
  event.target.reset();
}

function handleTaskAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const task = tasks.find((item) => item.id === id);
  if (!task) return;

  if (action === "toggle") {
    task.done = !task.done;
    notify(task.done ? "Great work! Task completed 🎉" : "Task marked pending.");
  }

  if (action === "delete") {
    if (!confirm(`Delete "${task.title}"?`)) return;
    tasks = tasks.filter((item) => item.id !== id);
    notify("Task deleted.");
  }

  if (action === "edit") {
    openTaskModal(task);
    return;
  }

  save();
  renderTasks();
}

function renderAnalytics() {
  const categories = ["STUDY", "EXAM", "ASSIGNMENT", "PROJECT", "PERSONAL", "EVENT"];
  const container = $("#categoryAnalytics");
  if (!container) return;

  const total = tasks.length || 1;
  container.innerHTML = categories.map((category) => {
    const count = tasks.filter((task) => task.category === category).length;
    const percent = Math.round(count / total * 100);
    return `
      <div style="margin:14px 0">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:7px">
          <span>${category}</span><b>${count}</b>
        </div>
        <div class="progress-track">
          <div style="width:${percent}%"></div>
        </div>
      </div>`;
  }).join("");
}

function navigate(viewName) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  const target = $("#view-" + viewName);
  if (target) target.classList.add("active");

  $$(".nav[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  setText("#breadcrumb", viewName.charAt(0).toUpperCase() + viewName.slice(1));
  $("#sidebar")?.classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderExams() {
  const list = $("#examList");
  if (!list) return;

  if (exams.length === 0) {
    list.innerHTML = `
      <div class="panel" style="grid-column:1/-1;text-align:center;padding:35px">
        <div style="font-size:35px">📚</div>
        <h2>No exams added yet</h2>
        <p class="muted">Add your first exam to track the countdown.</p>
        <button class="primary" id="addFirstExam">＋ Add an exam</button>
      </div>`;
    $("#addFirstExam")?.addEventListener("click", openExamModal);
    return;
  }

  list.innerHTML = exams.slice().sort((a, b) => a.date.localeCompare(b.date))
    .map((exam) => {
      const days = daysUntil(exam.date);
      const countdown = days < 0 ? "Passed" : days === 0 ? "Today!" : `${days} days`;
      return `
        <article class="exam-card">
          <div class="exam-card-top">
            <span>📘</span>
            <button data-exam-delete="${escapeHTML(exam.id)}" title="Delete exam">×</button>
          </div>
          <h3>${escapeHTML(exam.name)}</h3>
          <p>${escapeHTML(exam.subject || "Subject not specified")} · ${formatDate(exam.date)}</p>
          <div class="countdown"><span>TIME LEFT</span><b>${countdown}</b></div>
        </article>`;
    }).join("");
}

function openExamModal() {
  const modal = $("#examModal");
  if (!modal) {
    notify("Exam form is missing from index.html.");
    return;
  }
  modal.classList.add("open");
  $("#examName")?.focus();
}

function handleExamSubmit(event) {
  event.preventDefault();

  const name = $("#examName").value.trim();
  const date = $("#examDate").value;

  if (!name || !date) {
    notify("Enter an exam name and date.");
    return;
  }

  exams.push({
    id: uid(),
    name,
    subject: $("#examSubject").value.trim(),
    date
  });

  save();
  renderExams();
  event.target.reset();
  $("#examModal")?.classList.remove("open");
  notify("Exam added successfully!");
}

function closeModalOnBackdrop(event) {
  if (event.target === event.currentTarget) {
    event.currentTarget.classList.remove("open");
  }
}

/* Focus timer */
let timerMinutes = 25;
let timerSeconds = 0;
let timerInterval = null;
let timerRunning = false;
let timerTotal = timerMinutes * 60;

function renderTimer() {
  const display = $("#timerDisplay");
  if (display) {
    display.textContent =
      String(timerMinutes).padStart(2, "0") + ":" +
      String(timerSeconds).padStart(2, "0");
  }

  const ring = $("#timerRing");
  if (ring) {
    const remaining = timerMinutes * 60 + timerSeconds;
    const degrees = timerTotal ? (1 - remaining / timerTotal) * 360 : 0;
    ring.style.background =
      `conic-gradient(var(--purple) ${degrees}deg, #e6e0ff ${degrees}deg)`;
  }

  setText("#timerStatus", timerRunning ? "FOCUS IN PROGRESS" : "READY WHEN YOU ARE");
}

function setTimer(minutes) {
  clearInterval(timerInterval);
  timerRunning = false;
  timerMinutes = minutes;
  timerSeconds = 0;
  timerTotal = minutes * 60;
  renderTimer();

  $$(".preset").forEach((button) => {
    button.classList.toggle("selected", Number(button.dataset.minutes) === minutes);
  });
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  renderTimer();

  timerInterval = setInterval(() => {
    if (timerMinutes === 0 && timerSeconds === 0) {
      clearInterval(timerInterval);
      timerRunning = false;
      notify("Focus session complete! Take a short break 🎉");
      renderTimer();
      return;
    }

    if (timerSeconds === 0) {
      timerMinutes--;
      timerSeconds = 59;
    } else {
      timerSeconds--;
    }

    renderTimer();
  }, 1000);
}

function pauseTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  renderTimer();
}

function resetTimer() {
  setTimer(Number($(".preset.selected")?.dataset.minutes || 25));
}

/* Theme */
function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  setText("#themeButton", dark ? "☀ Light mode" : "☾ Dark mode");
  localStorage.setItem(THEME_KEY, dark ? "true" : "false");
}

/* Events */
document.addEventListener("DOMContentLoaded", () => {
  setText("#today", new Date().toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric"
  }));

  const greeting = $("#greeting");
  if (greeting) {
    const hour = new Date().getHours();
    greeting.textContent = hour < 12 ? "Good morning" :
      hour < 17 ? "Good afternoon" : "Good evening";
  }

  renderTasks();
  renderExams();
  setTimer(25);

  applyTheme(localStorage.getItem(THEME_KEY) === "true");

  $("#taskForm")?.addEventListener("submit", handleTaskSubmit);
  $("#examForm")?.addEventListener("submit", handleExamSubmit);

  $("#addTaskButton")?.addEventListener("click", () => openTaskModal());
  $("#addTaskHeader")?.addEventListener("click", () => openTaskModal());
  $("#closeTaskModal")?.addEventListener("click", closeTaskModal);
  $("#cancelTaskModal")?.addEventListener("click", closeTaskModal);
  $("#closeExamModal")?.addEventListener("click", () => $("#examModal")?.classList.remove("open"));
  $("#cancelExamModal")?.addEventListener("click", () => $("#examModal")?.classList.remove("open"));
  $("#addExamButton")?.addEventListener("click", openExamModal);

  $("#taskModal")?.addEventListener("click", closeModalOnBackdrop);
  $("#examModal")?.addEventListener("click", closeModalOnBackdrop);

  $("#taskList")?.addEventListener("click", handleTaskAction);
  $("#homeTaskList")?.addEventListener("click", handleTaskAction);

  $("#examList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-exam-delete]");
    if (!button) return;
    exams = exams.filter((exam) => exam.id !== button.dataset.examDelete);
    save();
    renderExams();
    notify("Exam removed.");
  });

  $("#searchTasks")?.addEventListener("input", (event) => {
    searchText = event.target.value;
    renderTasks();
  });

  $$(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter || "ALL";
      $$(".filter").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      renderTasks();
    });
  });

  $$(".nav[data-view]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.view));
  });

  $("#themeButton")?.addEventListener("click", () => {
    applyTheme(!document.body.classList.contains("dark"));
  });

  $("#menuButton")?.addEventListener("click", () => {
    $("#sidebar")?.classList.toggle("open");
  });

  $$(".preset").forEach((button) => {
    button.addEventListener("click", () => setTimer(Number(button.dataset.minutes)));
  });

  $("#timerStart")?.addEventListener("click", startTimer);
  $("#timerPause")?.addEventListener("click", pauseTimer);
  $("#timerReset")?.addEventListener("click", resetTimer);

  $("#goTasks")?.addEventListener("click", () => navigate("tasks"));
  $("#goExams")?.addEventListener("click", () => navigate("exams"));
});
```
