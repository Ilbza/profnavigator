const subjectLabels = {
  russian: "Русский язык",
  math: "Математика",
  informatics: "Информатика",
  physics: "Физика",
  chemistry: "Химия",
  biology: "Биология",
  social: "Обществознание",
  history: "История",
  literature: "Литература",
  english: "Английский язык"
};

const interestLabels = {
  tech: "IT и данные",
  engineering: "Инженерия",
  health: "Медицина",
  economics: "Экономика и бизнес",
  law: "Право и госслужба",
  communication: "Коммуникации",
  creative: "Творчество и дизайн"
};

const db = window.PROFORIENT_DB || { version: "unknown", updatedAt: "unknown", coverageNote: "", sources: [], programs: [] };
const sourceMap = new Map(db.sources.map((source) => [source.id, source]));
const verifiedPrograms = db.programs.map((program) => {
  const source = sourceMap.get(program.sourceId) || { name: "Источник не указан", url: "#" };
  return { ...program, sourceName: source.name, sourceUrl: source.url };
});

const scoreInputs = Array.from(document.querySelectorAll("#assessment-form input[type='number']"));
const rangeInputs = Array.from(document.querySelectorAll("input[type='range'][data-interest-key]"));
const pickBtn = document.getElementById("pick-btn");
const resultsPanel = document.getElementById("results-panel");
const resultsSummary = document.getElementById("results-summary");
const dbMeta = document.getElementById("db-meta");
const resultsList = document.getElementById("results-list");
const sourcesBox = document.getElementById("sources-box");
const regionFilter = document.getElementById("region-filter");
const budgetFilter = document.getElementById("budget-filter");

const applicationForm = document.getElementById("application-form");
const downloadBtn = document.getElementById("download-btn");
const downloadHint = document.getElementById("download-hint");
const parentPhoneInput = document.getElementById("parentPhone");
const parentEmailInput = document.getElementById("parentEmail");

let lastRecommendations = [];

scoreInputs.forEach((input) => {
  input.addEventListener("input", () => {
    if (input.value === "") {
      updateDownloadState();
      return;
    }
    const value = Number(input.value);
    if (Number.isNaN(value)) {
      return;
    }
    if (value > 100) input.value = "100";
    if (value < 0) input.value = "0";
    updateDownloadState();
  });
});

rangeInputs.forEach((input) => {
  const valueBox = input.parentElement.querySelector(".range-value");
  input.addEventListener("input", () => {
    valueBox.textContent = input.value;
  });
});

applicationForm.addEventListener("input", updateDownloadState);
applicationForm.addEventListener("change", updateDownloadState);

parentPhoneInput.addEventListener("input", () => {
  const digitsOnly = parentPhoneInput.value.replace(/\D/g, "").slice(0, 11);
  parentPhoneInput.value = digitsOnly;
  if (!/^\d{11}$/.test(digitsOnly)) {
    parentPhoneInput.setCustomValidity("Введите ровно 11 цифр, без пробелов и символов.");
  } else {
    parentPhoneInput.setCustomValidity("");
  }
});

parentEmailInput.addEventListener("input", () => {
  const email = parentEmailInput.value.trim();
  const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailPattern.test(email)) {
    parentEmailInput.setCustomValidity("Введите email латиницей в формате name@example.com.");
  } else {
    parentEmailInput.setCustomValidity("");
  }
});

pickBtn.addEventListener("click", () => {
  const scores = getScores();
  if (!scores) {
    return;
  }

  const interests = getInterests();
  const region = regionFilter.value;
  const mode = budgetFilter.value;

  const filteredPrograms = verifiedPrograms.filter((program) => {
    const regionMatch = region === "all" ? true : program.region === region;
    if (!regionMatch) {
      return false;
    }
    if (mode === "budget") {
      return Number(program.thresholdBudget) > 0;
    }
    if (mode === "paid") {
      return Number(program.thresholdPaid) > 0;
    }
    return true;
  });

  const recommendations = filteredPrograms
    .map((program) => evaluateProgram(program, scores, interests, mode))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 8);

  if (!recommendations.length) {
    alert("По выбранным фильтрам пока нет данных. Измените регион или формат.");
    return;
  }

  lastRecommendations = recommendations;
  renderRecommendations(recommendations, mode);
  updateDownloadState();

  resultsPanel.classList.remove("hidden");
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

downloadBtn.addEventListener("click", async () => {
  if (!lastRecommendations.length) {
    alert("Сначала нажмите «Подобрать варианты поступления» в шаге 2.");
    document.getElementById("interests-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (!validateApplicationFormWithMessage()) {
    return;
  }

  const applicantData = getApplicantData();
  const scores = getScores();
  const interests = getInterests();

  if (!scores) {
    return;
  }

  await createPdfReport(applicantData, scores, interests, lastRecommendations);
});

function validateApplicationFormWithMessage() {
  const fieldOrder = [
    { id: "childName", label: "ФИО ребенка" },
    { id: "childAge", label: "Возраст" },
    { id: "city", label: "Город" },
    { id: "parentEmail", label: "Email родителя" },
    { id: "parentPhone", label: "Телефон родителя" },
    { id: "consent", label: "Согласие на обработку персональных данных" }
  ];

  for (const field of fieldOrder) {
    const element = document.getElementById(field.id);
    if (!element) {
      continue;
    }
    if (!element.checkValidity()) {
      let details = "";
      if (element.id === "parentPhone") {
        details = "Введите ровно 11 цифр, без пробелов и символов.";
      } else if (element.id === "parentEmail") {
        details = "Введите email латиницей в формате name@example.com.";
      } else if (element.id === "consent") {
        details = "Поставьте галочку согласия.";
      } else if (element.validity.valueMissing) {
        details = "Это обязательное поле.";
      } else if (element.validationMessage) {
        details = element.validationMessage;
      }

      alert(`Поле заполнено некорректно: ${field.label}. ${details}`);
      element.focus();
      return false;
    }
  }

  return true;
}

function getScores() {
  const result = {};

  for (const input of scoreInputs) {
    const value = Number(input.value);
    if (input.value.trim() === "" || Number.isNaN(value) || value < 0 || value > 100) {
      alert("Проверьте баллы: каждое поле должно быть заполнено числом от 0 до 100.");
      input.focus();
      return null;
    }
    result[input.id] = value;
  }

  return result;
}

function getInterests() {
  return rangeInputs.reduce((acc, input) => {
    acc[input.dataset.interestKey] = Number(input.value);
    return acc;
  }, {});
}

function evaluateProgram(program, scores, interests, mode) {
  const requiredScores = program.required.map((subjectKey) => scores[subjectKey]);
  const requiredAverage = average(requiredScores);

  const interestScores = program.interests.map((interestKey) => (interests[interestKey] || 3) * 20);
  const interestAverage = average(interestScores);

  const fitScore = requiredAverage * 0.72 + interestAverage * 0.28;

  let targetScore = program.thresholdBudget;
  if (mode === "paid") {
    targetScore = program.thresholdPaid;
  }
  if (mode === "all") {
    targetScore = Math.min(program.thresholdBudget || 100, program.thresholdPaid || 100);
  }

  const gap = requiredAverage - targetScore;

  let chance = "low";
  let chanceLabel = "Нужна подготовка";

  if (gap >= 4 && interestAverage >= 60) {
    chance = "high";
    chanceLabel = "Высокая вероятность";
  } else if (gap >= -7) {
    chance = "mid";
    chanceLabel = "Реально при доработке";
  }

  const weakSubjects = program.required
    .map((subject) => ({ key: subject, value: scores[subject] }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 2)
    .map((item) => subjectLabels[item.key]);

  let advice = "Баллы по профильным предметам выглядят конкурентно.";
  if (chance === "mid") {
    advice = `Фокус на усилении предметов: ${weakSubjects.join(", ")}. Это заметно повысит шанс.`;
  }
  if (chance === "low") {
    advice = `Рекомендуется подтянуть: ${weakSubjects.join(", ")}, и рассмотреть интенсивную подготовку на 4-8 месяцев.`;
  }

  return {
    ...program,
    fitScore,
    targetScore,
    requiredAverage,
    interestAverage,
    chance,
    chanceLabel,
    advice
  };
}

function renderRecommendations(recommendations, mode) {
  const best = recommendations[0];
  const highCount = recommendations.filter((item) => item.chance === "high").length;
  const modeLabel = mode === "budget" ? "бюджета" : mode === "paid" ? "платного обучения" : "бюджета/платного";

  resultsSummary.textContent =
    `Подобрано ${recommendations.length} направлений для ${modeLabel}. ` +
    `Лучшее совпадение: ${best.direction} (${best.university}). ` +
    `Высокая вероятность у ${highCount} вариантов.`;
  dbMeta.textContent = `Версия базы: ${db.version}. Обновлено: ${db.updatedAt}. ${db.coverageNote || ""}`;

  resultsList.innerHTML = recommendations
    .map((item) => {
      const badgeClass = item.chance === "high" ? "badge-high" : item.chance === "mid" ? "badge-mid" : "badge-low";

      return `
        <article class="result-card">
          <div class="result-head">
            <div>
              <h3 class="result-title">${item.direction}</h3>
              <p class="result-university">${item.university}, ${item.city}</p>
            </div>
            <span class="badge ${badgeClass}">${item.chanceLabel}</span>
          </div>
          <p class="result-meta"><strong>Профильные предметы:</strong> ${item.required
            .map((subjectKey) => subjectLabels[subjectKey])
            .join(", ")}</p>
          <p class="result-meta"><strong>Ваш средний профильный балл:</strong> ${item.requiredAverage.toFixed(1)} из 100</p>
          <p class="result-meta"><strong>Ориентир для фильтра:</strong> ${item.targetScore} из 100</p>
          <p class="result-meta"><strong>Совпадение интересов:</strong> ${Math.round(item.interestAverage)}%</p>
          ${item.budgetPlaces ? `<p class="result-meta"><strong>Бюджетных мест:</strong> ${item.budgetPlaces}</p>` : ""}
          ${item.paidPlaces ? `<p class="result-meta"><strong>Платных мест:</strong> ${item.paidPlaces}</p>` : ""}
          <p class="result-meta">${item.advice}</p>
          ${item.note ? `<p class="result-meta"><strong>Важно:</strong> ${item.note}</p>` : ""}
          <p class="result-meta"><strong>Источник:</strong> <a href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">${item.sourceName}</a></p>
        </article>
      `;
    })
    .join("");

  const uniqueSources = Array.from(new Map(recommendations.map((item) => [item.sourceUrl, item.sourceName])).entries());
  sourcesBox.innerHTML = `<p><strong>Проверенные источники базы (обновление: ${db.updatedAt}):</strong></p>
    <ul>${uniqueSources
      .map(([url, name]) => `<li><a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a></li>`)
      .join("")}</ul>`;
}

function getApplicantData() {
  return {
    childName: document.getElementById("childName").value.trim(),
    childAge: document.getElementById("childAge").value.trim(),
    city: document.getElementById("city").value.trim(),
    parentEmail: document.getElementById("parentEmail").value.trim(),
    parentPhone: document.getElementById("parentPhone").value.trim(),
    comment: document.getElementById("comment").value.trim()
  };
}

function updateDownloadState() {
  downloadBtn.disabled = false;

  if (!lastRecommendations.length) {
    downloadHint.textContent = "Сначала заполните баллы и тест интересов, затем нажмите «Подобрать варианты поступления».";
    return;
  }

  if (!applicationForm.checkValidity()) {
    downloadHint.textContent = "Заполните обязательные поля заявки и отметьте согласие на обработку данных.";
    return;
  }

  downloadHint.textContent = "Все готово: можно скачивать PDF-заявку.";
}

async function createPdfReport(applicant, scores, interests, recommendations) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Не удалось загрузить модуль PDF. Обновите страницу и попробуйте снова.");
    return;
  }

  const now = new Date();
  const topInterests = Object.entries(interests)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, value]) => `${interestLabels[key]} (${value}/5)`)
    .join(", ");

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const left = 40;
    const top = 50;
    const line = 18;
    const pageHeight = pdf.internal.pageSize.getHeight();
    let y = top;

    const addText = (text, size = 12, bold = false) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(text, 510);
      for (const row of lines) {
        if (y > pageHeight - 40) {
          pdf.addPage();
          y = top;
        }
        pdf.text(row, left, y);
        y += line;
      }
    };

    addText("ProfNavigator by Umskul Repetitory - personal report", 16, true);
    y += 4;
    addText(`Date: ${now.toLocaleDateString("ru-RU")}`);
    y += 8;

    addText("Application data", 13, true);
    addText(`Child name: ${applicant.childName}`);
    addText(`Age: ${applicant.childAge}`);
    addText(`City: ${applicant.city}`);
    addText(`Parent email: ${applicant.parentEmail}`);
    addText(`Parent phone: ${applicant.parentPhone}`);
    y += 6;

    addText("Interests", 13, true);
    addText(`Top-3: ${topInterests}`);
    y += 6;

    addText("Scores by subjects", 13, true);
    addText(
      Object.entries(scores)
        .map(([key, value]) => `${subjectLabels[key]}: ${value}`)
        .join(" | ")
    );
    y += 6;

    addText("Recommended programs", 13, true);
    recommendations.forEach((item, index) => {
      addText(`${index + 1}. ${item.direction} - ${item.university}, ${item.city}`, 12, true);
      addText(`Subjects: ${item.required.map((subjectKey) => subjectLabels[subjectKey]).join(", ")}`);
      addText(`Average: ${item.requiredAverage.toFixed(1)} | Chance: ${item.chanceLabel}`);
      addText(`Source: ${item.sourceName}`);
      addText(`Advice: ${item.advice}`);
      y += 4;
    });

    addText("Family comment", 13, true);
    addText(applicant.comment || "-");

    const safeName = (applicant.childName || "anketa").replace(/[^a-zA-Zа-яА-Я0-9-_ ]/g, "").trim();
    const reportDate = now.toISOString().slice(0, 10);
    const filename = `profil-${safeName || "anketa"}-${reportDate}.pdf`;

    try {
      pdf.save(filename);
    } catch {
      const blobUrl = pdf.output("bloburl");
      window.location.href = blobUrl;
    }
  } catch (error) {
    console.error(error);
    alert("Не удалось выгрузить PDF в этом окне. Попробуйте открыть сайт в Safari/Chrome или перезагрузить страницу.");
  }
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((sum, current) => sum + current, 0);
  return total / values.length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

updateDownloadState();
