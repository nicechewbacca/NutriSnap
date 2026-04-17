// =========================
//  IndexedDB
// =========================

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nutrisnap-db", 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("profile")) {
        db.createObjectStore("profile", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("meals")) {
        const store = db.createObjectStore("meals", {
          keyPath: "id",
          autoIncrement: true
        });
        store.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


// =========================
//  PROFILE
// =========================

async function saveProfile(profile) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("profile", "readwrite");
    const req = tx.objectStore("profile").put({ ...profile, id: 1 });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getProfile() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("profile", "readonly");
    const req = tx.objectStore("profile").get(1);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Расчёт BMR по формуле Миффлина–Сан Жеора
function calcBMR(profile) {
  if (!profile || !profile.weight || !profile.height || !profile.age) return null;
  const { weight, height, age, gender } = profile;
  const base = 10 * weight + 6.25 * height - 5 * age;
  return Math.round(gender === "female" ? base - 161 : base + 5);
}


// =========================
//  MEALS
// =========================

async function saveMeal(meal) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meals", "readwrite");
    const req = tx.objectStore("meals").add(meal);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function updateMeal(meal) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meals", "readwrite");
    const req = tx.objectStore("meals").put(meal);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteMeal(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meals", "readwrite");
    const req = tx.objectStore("meals").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getMealsForDate(dateStr) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meals", "readonly");
    const store = tx.objectStore("meals");
    const result = [];

    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const mealDate = new Date(cursor.value.date).toISOString().split("T")[0];
        if (mealDate === dateStr) result.push(cursor.value);
        cursor.continue();
      } else {
        resolve(result);
      }
    };

    store.openCursor().onerror = () => reject(store.openCursor().error);
  });
}

async function getAllMeals() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meals", "readonly");
    const req = tx.objectStore("meals").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}


// =========================
//  GEMINI VIA CLOUDFLARE WORKER
// =========================

const WORKER_URL = "https://nutrisnap1.nicechewbacca.workers.dev";

async function analyzeImage(file, comment) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append(
    "prompt",
    `Проанализируй еду на фото и верни ТОЛЬКО валидный JSON без markdown и пояснений:
{"calories":число,"protein":число,"fat":число,"carbs":число,"weight":число}
Все числа — целые, вес в граммах, КБЖУ на всю порцию.
Комментарий пользователя: ${comment || "не указан"}`
  );

  const response = await fetch(WORKER_URL, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Ошибка воркера: ${response.status}`);
  }

  const data = await response.json();

  // Правильный путь в структуре Gemini API
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    console.error("Unexpected Gemini response:", JSON.stringify(data));
    throw new Error("Пустой ответ от Gemini");
  }

  // Убираем возможные ```json ... ``` обёртки
  const cleaned = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Не удалось распарсить JSON:", cleaned);
    throw new Error("Gemini вернул неожиданный формат ответа");
  }
}


// =========================
//  STORAGE SIZE ESTIMATE
// =========================

async function estimateStorageUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota, percent: Math.round((usage / quota) * 100) };
}

async function checkStorageWarning() {
  const LIMIT_BYTES = 500 * 1024 * 1024; // 500 МБ
  const est = await estimateStorageUsage();
  if (!est) return;

  const usedOfLimit = est.usage / LIMIT_BYTES;
  if (usedOfLimit >= 0.9) {
    showNotification(
      `Хранилище заполнено на ${Math.round(usedOfLimit * 100)}% от лимита 500 МБ. ` +
      `Рекомендуется экспортировать и очистить старые данные.`,
      "warning"
    );
  }
}


// =========================
//  EXPORT
// =========================

async function exportCSV() {
  const meals = await getAllMeals();
  if (!meals.length) {
    showNotification("Нет данных для экспорта", "info");
    return;
  }

  const header = ["id", "date", "calories", "protein", "fat", "carbs", "weight", "comment"];
  const rows = meals.map((m) =>
    header.map((k) => {
      const val = m[k] ?? "";
      return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
    }).join(",")
  );

  const csv = [header.join(","), ...rows].join("\n");
  downloadFile(csv, `nutrisnap_export_${getTodayStr()}.csv`, "text/csv");
}

async function exportJSON() {
  const meals = await getAllMeals();
  if (!meals.length) {
    showNotification("Нет данных для экспорта", "info");
    return;
  }
  const json = JSON.stringify(meals, null, 2);
  downloadFile(json, `nutrisnap_export_${getTodayStr()}.json`, "application/json");
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


// =========================
//  NOTIFICATIONS
// =========================

function showNotification(message, type = "info") {
  const container = document.getElementById("notifications");
  if (!container) return;

  const el = document.createElement("div");
  el.className = `notification notification--${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => el.remove(), 5000);
}


// =========================
//  RENDER MEALS LIST
// =========================

async function renderMealsList(dateStr) {
  const meals = await getMealsForDate(dateStr);
  const container = document.getElementById("mealsList");
  if (!container) return;

  if (!meals.length) {
    container.innerHTML = `<p class="empty-state">Записей за этот день нет</p>`;
    return;
  }

  container.innerHTML = meals.map((m) => `
    <div class="meal-item" data-id="${m.id}">
      <div class="meal-item__info">
        <span class="meal-item__time">${new Date(m.date).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>
        ${m.comment ? `<span class="meal-item__comment">${escapeHtml(m.comment)}</span>` : ""}
      </div>
      <div class="meal-item__macros">
        <span class="macro macro--cal">${m.calories} ккал</span>
        <span class="macro macro--p">Б ${m.protein}г</span>
        <span class="macro macro--f">Ж ${m.fat}г</span>
        <span class="macro macro--c">У ${m.carbs}г</span>
        ${m.weight ? `<span class="macro macro--w">${m.weight}г</span>` : ""}
      </div>
      <div class="meal-item__actions">
        <button class="btn-icon btn-edit" data-id="${m.id}" title="Редактировать">✏️</button>
        <button class="btn-icon btn-delete" data-id="${m.id}" title="Удалить">🗑️</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.currentTarget.dataset.id);
      if (!confirm("Удалить запись?")) return;
      await deleteMeal(id);
      renderMealsList(dateStr);
      updateDailyStats(dateStr);
    });
  });

  container.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.currentTarget.dataset.id);
      const meal = meals.find((m) => m.id === id);
      if (meal) openEditModal(meal, dateStr);
    });
  });
}


// =========================
//  EDIT MODAL
// =========================

function openEditModal(meal, dateStr) {
  const modal = document.getElementById("editModal");
  if (!modal) return;

  document.getElementById("editCalories").value = meal.calories ?? "";
  document.getElementById("editProtein").value = meal.protein ?? "";
  document.getElementById("editFat").value = meal.fat ?? "";
  document.getElementById("editCarbs").value = meal.carbs ?? "";
  document.getElementById("editWeight").value = meal.weight ?? "";
  document.getElementById("editComment").value = meal.comment ?? "";

  modal.dataset.mealId = meal.id;
  modal.dataset.mealDate = meal.date;
  modal.classList.remove("hidden");
}

function closeEditModal() {
  const modal = document.getElementById("editModal");
  if (modal) modal.classList.add("hidden");
}


// =========================
//  DAILY STATS + BMR
// =========================

async function updateDailyStats(dateStr = getTodayStr()) {
  const meals = await getMealsForDate(dateStr);

  const total = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (Number(m.calories) || 0),
      protein: acc.protein + (Number(m.protein) || 0),
      fat: acc.fat + (Number(m.fat) || 0),
      carbs: acc.carbs + (Number(m.carbs) || 0)
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText("dailyCalories", total.calories);
  setText("dailyProtein", total.protein);
  setText("dailyFat", total.fat);
  setText("dailyCarbs", total.carbs);

  // BMR и дефицит
  const profile = await getProfile();
  const bmr = calcBMR(profile);

  if (bmr !== null) {
    setText("bmrValue", bmr);
    const deficit = bmr - total.calories;
    const deficitEl = document.getElementById("calorieDeficit");
    if (deficitEl) {
      deficitEl.textContent = deficit >= 0 ? `−${deficit}` : `+${Math.abs(deficit)}`;
      deficitEl.className = deficit >= 0 ? "deficit deficit--ok" : "deficit deficit--over";
    }

    // Прогресс-бары
    updateProgressBar("progressCalories", total.calories, bmr);
    updateProgressBar("progressProtein", total.protein, profile?.goalProtein || Math.round(bmr * 0.3 / 4));
    updateProgressBar("progressFat", total.fat, profile?.goalFat || Math.round(bmr * 0.3 / 9));
    updateProgressBar("progressCarbs", total.carbs, profile?.goalCarbs || Math.round(bmr * 0.4 / 4));
  }
}

function updateProgressBar(id, current, goal) {
  const el = document.getElementById(id);
  if (!el || !goal) return;
  const pct = Math.min(Math.round((current / goal) * 100), 100);
  el.style.width = pct + "%";
  el.setAttribute("aria-valuenow", pct);
  el.classList.toggle("progress--over", current > goal);
}


// =========================
//  WEEKLY CHART
// =========================

async function renderWeeklyChart() {
  const canvas = document.getElementById("weeklyChart");
  if (!canvas) return;

  const labels = [];
  const data = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const meals = await getMealsForDate(dateStr);
    const total = meals.reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
    labels.push(d.toLocaleDateString("ru", { weekday: "short", day: "numeric" }));
    data.push(total);
  }

  const profile = await getProfile();
  const bmr = calcBMR(profile);

  if (window._weeklyChartInstance) window._weeklyChartInstance.destroy();

  window._weeklyChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Калории",
          data,
          backgroundColor: "rgba(29, 158, 117, 0.7)",
          borderColor: "rgba(29, 158, 117, 1)",
          borderWidth: 1,
          borderRadius: 6
        },
        bmr
          ? {
              label: "BMR",
              data: Array(7).fill(bmr),
              type: "line",
              borderColor: "rgba(127, 119, 221, 0.8)",
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false
            }
          : null
      ].filter(Boolean)
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} ккал`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => v + " ккал" }
        }
      }
    }
  });
}


// =========================
//  MONTHLY CHART
// =========================

async function renderMonthlyChart() {
  const canvas = document.getElementById("monthlyChart");
  if (!canvas) return;

  const meals = await getAllMeals();
  const byDate = {};

  meals.forEach((m) => {
    const d = new Date(m.date).toISOString().split("T")[0];
    byDate[d] = (byDate[d] || 0) + (Number(m.calories) || 0);
  });

  // Последние 30 дней
  const labels = [];
  const data = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    labels.push(d.toLocaleDateString("ru", { day: "numeric", month: "short" }));
    data.push(byDate[dateStr] || 0);
  }

  if (window._monthlyChartInstance) window._monthlyChartInstance.destroy();

  window._monthlyChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Калории за день",
        data,
        borderColor: "rgba(29, 158, 117, 1)",
        backgroundColor: "rgba(29, 158, 117, 0.1)",
        borderWidth: 2,
        pointRadius: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => v + " ккал" }
        },
        x: {
          ticks: { maxTicksLimit: 10 }
        }
      }
    }
  });
}


// =========================
//  HELPERS
// =========================

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// =========================
//  INIT
// =========================

document.addEventListener("DOMContentLoaded", async () => {
  const today = getTodayStr();

  // Загрузка профиля
  const profile = await getProfile();
  if (profile) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? "";
    };
    set("name", profile.name);
    set("age", profile.age);
    set("weight", profile.weight);
    set("height", profile.height);
    const genderEl = document.getElementById("gender");
    if (genderEl) genderEl.value = profile.gender || "male";
  }

  await updateDailyStats(today);
  await renderMealsList(today);
  await checkStorageWarning();

  // Отрисовка графиков если canvas присутствует на странице
  if (document.getElementById("weeklyChart")) await renderWeeklyChart();
  if (document.getElementById("monthlyChart")) await renderMonthlyChart();


  // --- Сохранение профиля ---
  document.getElementById("saveProfile")?.addEventListener("click", async () => {
    const get = (id) => document.getElementById(id)?.value;
    const profile = {
      name: get("name"),
      age: Number(get("age")),
      weight: Number(get("weight")),
      height: Number(get("height")),
      gender: get("gender") || "male"
    };

    if (!profile.age || !profile.weight || !profile.height) {
      showNotification("Заполните возраст, вес и рост", "warning");
      return;
    }

    await saveProfile(profile);
    showNotification("Профиль сохранён");
    await updateDailyStats(today);
  });


  // --- Добавление приёма пищи ---
  document.getElementById("addMeal")?.addEventListener("click", async () => {
    const fileInput = document.getElementById("mealPhoto");
    const comment = document.getElementById("mealComment")?.value || "";

    if (!fileInput?.files?.length) {
      showNotification("Выберите фото", "warning");
      return;
    }

    const file = fileInput.files[0];
    const btn = document.getElementById("addMeal");
    btn.disabled = true;
    btn.textContent = "Анализирую...";

    try {
      const analysis = await analyzeImage(file, comment);

      // Показываем результат для проверки перед сохранением
      fillPreview(analysis, comment);
      document.getElementById("previewSection")?.classList.remove("hidden");
    } catch (e) {
      showNotification("Ошибка анализа: " + e.message, "error");
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.textContent = "Анализировать фото";
    }
  });


  // --- Подтверждение сохранения после AI-анализа ---
  document.getElementById("confirmMeal")?.addEventListener("click", async () => {
    const get = (id) => Number(document.getElementById(id)?.value) || 0;

    const meal = {
      calories: get("previewCalories"),
      protein: get("previewProtein"),
      fat: get("previewFat"),
      carbs: get("previewCarbs"),
      weight: get("previewWeight"),
      comment: document.getElementById("previewComment")?.value || "",
      date: new Date().toISOString()
    };

    await saveMeal(meal);
    document.getElementById("previewSection")?.classList.add("hidden");
    document.getElementById("mealComment").value = "";
    document.getElementById("mealPhoto").value = "";

    await renderMealsList(today);
    await updateDailyStats(today);
    await checkStorageWarning();

    showNotification("Запись добавлена");
  });

  document.getElementById("cancelMeal")?.addEventListener("click", () => {
    document.getElementById("previewSection")?.classList.add("hidden");
  });


  // --- Сохранение после ручного редактирования ---
  document.getElementById("saveEdit")?.addEventListener("click", async () => {
    const modal = document.getElementById("editModal");
    if (!modal) return;

    const get = (id) => Number(document.getElementById(id)?.value) || 0;

    const updated = {
      id: Number(modal.dataset.mealId),
      calories: get("editCalories"),
      protein: get("editProtein"),
      fat: get("editFat"),
      carbs: get("editCarbs"),
      weight: get("editWeight"),
      comment: document.getElementById("editComment")?.value || "",
      date: modal.dataset.mealDate
    };

    await updateMeal(updated);
    closeEditModal();
    await renderMealsList(today);
    await updateDailyStats(today);
    showNotification("Запись обновлена");
  });

  document.getElementById("cancelEdit")?.addEventListener("click", closeEditModal);


  // --- Экспорт ---
  document.getElementById("exportCSV")?.addEventListener("click", exportCSV);
  document.getElementById("exportJSON")?.addEventListener("click", exportJSON);
});


// Заполнение превью после AI-анализа (поля доступны для правки)
function fillPreview(analysis, comment) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };
  set("previewCalories", analysis.calories ?? 0);
  set("previewProtein", analysis.protein ?? 0);
  set("previewFat", analysis.fat ?? 0);
  set("previewCarbs", analysis.carbs ?? 0);
  set("previewWeight", analysis.weight ?? 0);
  set("previewComment", comment);
}
