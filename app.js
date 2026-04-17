const apiKey = 'sk-8979b33949c74e06be6bd6c37af70487'; // сюда временно можно подставить твой ключ для POC

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function calcBMR(profile) {
  const { gender, age, weight, height } = profile;
  if (gender === 'male') {
    return Math.round(10 * weight + 6.25 * height - 5 * age + 5);
  } else {
    return Math.round(10 * weight + 6.25 * height - 5 * age - 161);
  }
}

async function analyzeImage(file, comment) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('prompt', `Описание пользователя: ${comment || ''}. Определи калории, белки, жиры, углеводы и вес порции.`);

  // пример: заменить URL на реальный эндпоинт AI
  const response = await fetch('https://api.deepseek.com', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error('AI error');
  }

  const data = await response.json();
  return {
    calories: data.calories,
    protein: data.protein,
    fat: data.fat,
    carbs: data.carbs,
    weight: data.weight
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const genderEl = document.getElementById('gender');
  const ageEl = document.getElementById('age');
  const weightEl = document.getElementById('weight');
  const heightEl = document.getElementById('height');
  const goalTypeEl = document.getElementById('goalType');
  const deficitEl = document.getElementById('deficit');
  const bmrInfoEl = document.getElementById('bmrInfo');

  const mealPhotoEl = document.getElementById('mealPhoto');
  const mealCommentEl = document.getElementById('mealComment');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const analyzeStatusEl = document.getElementById('analyzeStatus');

  const aiResultEl = document.getElementById('aiResult');
  const caloriesInput = document.getElementById('caloriesInput');
  const proteinInput = document.getElementById('proteinInput');
  const fatInput = document.getElementById('fatInput');
  const carbsInput = document.getElementById('carbsInput');
  const weightInput = document.getElementById('weightInput');
  const saveMealBtn = document.getElementById('saveMealBtn');

  const dayDateEl = document.getElementById('dayDate');
  const dayBmrEl = document.getElementById('dayBmr');
  const dayCaloriesEl = document.getElementById('dayCalories');
  const dayDiffEl = document.getElementById('dayDiff');
  const mealsListEl = document.getElementById('mealsList');

  const saveProfileBtn = document.getElementById('saveProfileBtn');

  // загрузка профиля
  const existingProfile = await getProfile();
  let currentProfile = existingProfile || null;

  if (currentProfile) {
    genderEl.value = currentProfile.gender;
    ageEl.value = currentProfile.age;
    weightEl.value = currentProfile.weight;
    heightEl.value = currentProfile.height;
    goalTypeEl.value = currentProfile.goalType;
    deficitEl.value = currentProfile.calorieDeficit;
    const bmr = calcBMR(currentProfile);
    bmrInfoEl.textContent = `BMR: ${bmr} ккал/день`;
  } else {
    bmrInfoEl.textContent = 'Заполните профиль для расчёта BMR';
  }

  saveProfileBtn.addEventListener('click', async () => {
    const profile = {
      gender: genderEl.value,
      age: Number(ageEl.value),
      weight: Number(weightEl.value),
      height: Number(heightEl.value),
      goalType: goalTypeEl.value,
      calorieDeficit: Number(deficitEl.value)
    };
    const bmr = calcBMR(profile);
    profile.bmr = bmr;
    profile.updatedAt = new Date().toISOString();
    await saveProfile(profile);
    currentProfile = profile;
    bmrInfoEl.textContent = `BMR: ${bmr} ккал/день`;
    await refreshDaySummary();
  });

  analyzeBtn.addEventListener('click', async () => {
    const file = mealPhotoEl.files[0];
    if (!file) {
      analyzeStatusEl.textContent = 'Выберите фото';
      return;
    }
    analyzeStatusEl.textContent = 'Анализируем...';
    aiResultEl.classList.add('hidden');
    try {
      const result = await analyzeImage(file, mealCommentEl.value);
      caloriesInput.value = result.calories;
      proteinInput.value = result.protein;
      fatInput.value = result.fat;
      carbsInput.value = result.carbs;
      weightInput.value = result.weight;
      aiResultEl.classList.remove('hidden');
      analyzeStatusEl.textContent = 'Готово, проверьте и сохраните';
    } catch (e) {
      analyzeStatusEl.textContent = 'Ошибка анализа. Попробуйте ещё раз или введите вручную.';
      aiResultEl.classList.remove('hidden');
    }
  });

  saveMealBtn.addEventListener('click', async () => {
    const now = new Date();
    const meal = {
      date: formatDate(now),
      time: now.toISOString().slice(11, 16),
      calories: Number(caloriesInput.value),
      protein: Number(proteinInput.value),
      fat: Number(fatInput.value),
      carbs: Number(carbsInput.value),
      weight: Number(weightInput.value),
      comment: mealCommentEl.value || '',
      manualEdited: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    await addMeal(meal);
    analyzeStatusEl.textContent = 'Запись сохранена';
    aiResultEl.classList.add('hidden');
    mealPhotoEl.value = '';
    mealCommentEl.value = '';
    await refreshDaySummary();
  });

  async function refreshDaySummary() {
    const today = new Date();
    const dateStr = formatDate(today);
    dayDateEl.textContent = `Дата: ${dateStr}`;

    const meals = await getMealsByDate(dateStr);
    mealsListEl.innerHTML = '';
    let totalCalories = 0;
    meals.forEach(m => {
      totalCalories += m.calories;
      const li = document.createElement('li');
      li.textContent = `${m.time} — ${m.calories} ккал (${m.comment || 'без комментария'})`;
      mealsListEl.appendChild(li);
    });

    if (currentProfile) {
      const bmr = currentProfile.bmr || calcBMR(currentProfile);
      dayBmrEl.textContent = `BMR: ${bmr} ккал`;
      dayCaloriesEl.textContent = `Потреблено: ${totalCalories} ккал`;
      const diff = bmr + (currentProfile.calorieDeficit || 0) - totalCalories;
      dayDiffEl.textContent = `Остаток до цели: ${diff} ккал`;
    } else {
      dayBmrEl.textContent = 'BMR: профиль не заполнен';
      dayCaloriesEl.textContent = `Потреблено: ${totalCalories} ккал`;
      dayDiffEl.textContent = '';
    }
  }

  await refreshDaySummary();
});
