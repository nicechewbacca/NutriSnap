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
        db.createObjectStore("meals", { keyPath: "id", autoIncrement: true });
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
  const tx = db.transaction("profile", "readwrite");
  tx.objectStore("profile").put({ ...profile, id: 1 });
  return tx.complete;
}

async function getProfile() {
  const db = await getDB();
  const tx = db.transaction("profile", "readonly");
  return tx.objectStore("profile").get(1);
}


// =========================
//  MEALS
// =========================
async function saveMeal(meal) {
  const db = await getDB();
  const tx = db.transaction("meals", "readwrite");
  tx.objectStore("meals").add(meal);
  return tx.complete;
}

async function getMealsForToday() {
  const db = await getDB();
  const tx = db.transaction("meals", "readonly");
  const store = tx.objectStore("meals");

  return new Promise((resolve) => {
    const result = [];
    const today = new Date().toISOString().split("T")[0];

    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const mealDate = new Date(cursor.value.date).toISOString().split("T")[0];
        if (mealDate === today) result.push(cursor.value);
        cursor.continue();
      } else {
        resolve(result);
      }
    };
  });
}


// =========================
//  GEMINI VIA CLOUDFLARE WORKER
// =========================
async function analyzeImage(file, comment) {
  const formData = new FormData();

  formData.append("image", file);
  formData.append(
    "prompt",
    `
Проанализируй еду на фото и верни строго JSON:
{
  "calories": число,
  "protein": число,
  "fat": число,
  "carbs": число,
  "weight": число
}

Комментарий пользователя: ${comment}
`
  );

  const response = await fetch("https://nutrisnap1.nicechewbacca.workers.dev", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  try {
    const text = data.candidates[0].content[0].text;
    return JSON.parse(text);
  } catch (e) {
    console.error("Ошибка парсинга ответа Gemini:", e, data);
    throw new Error("Gemini вернул неожиданный формат ответа");
  }
}


// =========================
//  UI LOGIC
// =========================

// Загружаем профиль при старте
document.addEventListener("DOMContentLoaded", async () => {
  const profile = await getProfile();

  if (profile) {
    document.getElementById("name").value = profile.name || "";
    document.getElementById("age").value = profile.age || "";
    document.getElementById("weight").value = profile.weight || "";
    document.getElementById("height").value = profile.height || "";
    document.getElementById("gender").value = profile.gender || "male";
  }

  updateDailyStats();
});


// Сохранение профиля
document.getElementById("saveProfile").addEventListener("click", async () => {
  const profile = {
    name: document.getElementById("name").value,
    age: Number(document.getElementById("age").value),
    weight: Number(document.getElementById("weight").value),
    height: Number(document.getElementById("height").value),
    gender: document.getElementById("gender").value
  };

  await saveProfile(profile);
  alert("Профиль сохранён");
});


// Добавление записи с фото
document.getElementById("addMeal").addEventListener("click", async () => {
  const fileInput = document.getElementById("mealPhoto");
  const comment = document.getElementById("mealComment").value;

  if (!fileInput.files.length) {
    alert("Выберите фото");
    return;
  }

  const file = fileInput.files[0];

  try {
    const analysis = await analyzeImage(file, comment);

    const meal = {
      ...analysis,
      comment,
      date: new Date().toISOString()
    };

    await saveMeal(meal);
    updateDailyStats();

    alert("Запись добавлена");
  } catch (e) {
    alert("Ошибка анализа изображения");
    console.error(e);
  }
});


// Обновление дневной статистики
async function updateDailyStats() {
  const meals = await getMealsForToday();

  const total = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      fat: acc.fat + (m.fat || 0),
      carbs: acc.carbs + (m.carbs || 0)
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 }
  );

  document.getElementById("dailyCalories").textContent = total.calories;
  document.getElementById("dailyProtein").textContent = total.protein;
  document.getElementById("dailyFat").textContent = total.fat;
  document.getElementById("dailyCarbs").textContent = total.carbs;
}
