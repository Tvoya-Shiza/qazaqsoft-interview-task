// ========== Константы и ключи хранилища ==========
const STORAGE_KEYS = {
  STATE: "quiz.state.v1",
};
const DATA_URL = "./data/questions.json";

// ========== Модели ==========
/**
 * @typedef {{ id: string; text: string; options: string[]; correctIndex: number; topic?: string }} QuestionDTO
 * @typedef {{ title: string; timeLimitSec: number; passThreshold: number; questions: QuestionDTO[] }} QuizDTO
 */

class Question {
  /** @param {QuestionDTO} dto */
  constructor(dto) {
    this.id = dto.id;
    this.text = dto.text;
    this.options = dto.options;
    this.correctIndex = dto.correctIndex;
    this.topic = dto.topic ?? null;
  }
}

// ========== Сервисы ==========
class StorageService {
  static saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
    } catch(e) {
      throw new Error("StorageService.saveState: ", e);
    }
  }

  static loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STATE);
      if(raw) return localStorage.getItem(STORAGE_KEYS.STATE);
      return null;
    } catch(e) {
      throw new Error("StorageService.loadState: ", e);
    }
  }

  static clear() {
    try {
      return localStorage.removeItem(STORAGE_KEYS.STATE)
    } catch(e) {
      throw new Error("StorageService.clear: ", e);
    }
  }
}

// ========== Движок теста ==========
class QuizEngine {
  /** @param {QuizDTO} quiz */
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec;
    this.passThreshold = quiz.passThreshold;
    this.questions = quiz.questions.map((q) => new Question(q));

    this.currentIndex = 0;
    /** @type {Record<string, number|undefined>} */
    this.answers = {}; // questionId -> selectedIndex
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;
  }

  get length() {
    return this.questions.length;
  }
  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  /** @param {number} index */
  goTo(index) {
    this.currentIndex = index
  }

  next() {
    if(this.currentIndex + 1 < this.length) {
      this.goTo(this.currentIndex + 1)
    }
  }

  prev() {
    if(this.currentIndex - 1 >= 0) {
      this.goTo(this.currentIndex - 1)
    }
  }

  /** @param {number} optionIndex */
  select(optionIndex) {
    this.answers[this.currentIndex] = optionIndex
  }

  getSelectedIndex() {
    if(this.answers[this.currentIndex]) return this.answers[this.currentIndex]
    return undefined;
  }

  tick() {
    if(this.isFinished) return;

    if(this.remainingSec > 0) this.remainingSec -= 1;

    if(this.remainingSec === 0 && !this.isFinished) {
      stopTimer();
      return renderResult(this.finish())
    }
  }

  finish() {
    this.isFinished = true
    var correct = 0;
    for(var i = 0; i < this.length; i++) {
      if(this.questions[i].correctIndex === this.answers[i]) correct++;
    }
    return { correct: correct, total: this.length, percent: correct / this.length, passed: correct / this.length >= 0.7 ? true : false}
  }

  toState() {
    return this.answers;
  }

  /** @param {any} state */
  static fromState(quiz, state) {
    engine = new QuizEngine(quiz);
    engine.answers = JSON.parse(state)
    return engine;
  }
}

// ========== DOM-утилиты ==========
const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
};

let engine = /** @type {QuizEngine|null} */ (null);
let timerId = /** @type {number|undefined} */ (undefined);
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState?.(); // заглушка
  if (saved) {
    engine = QuizEngine.fromState(quiz, saved);
  } else {
    engine = new QuizEngine(quiz);
  }

  bindEvents();
  renderAll();

  startTimer();
});

async function loadQuiz() {
  const res = await fetch(DATA_URL);
  /** @type {QuizDTO} */
  const data = await res.json();
  if (!data?.questions?.length) {
    throw new Error("Некорректные данные теста");
  }
  return data;
}

// ========== Таймер ==========
function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    try {
      engine.tick();
      persist();
      renderTimer();
    } catch (e) {
      stopTimer();
    }
  }, 1000);
}
function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
}

// ========== События ==========
function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    safeCall(() => engine.prev());
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    safeCall(() => engine.next());
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = safeCall(() => engine.finish());
    console.log(summary)
    if (summary) {
      stopTimer();
      renderResult(summary);
      persist();
    }
  });

  els.btnReview.addEventListener("click", () => {
    reviewMode = true;
    renderAll();
  });

  els.btnRestart.addEventListener("click", () => {
    StorageService.clear?.();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (target?.name === "option") {
      const idx = Number(target.value);
      safeCall(() => engine.select(idx));
      persist();
      renderNav();
    }
  });
}

function safeCall(fn) {
  try {
    return fn?.();
  } catch {
    /* noop в шаблоне */
  }
}

// ========== Рендер ==========
function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${
    engine.length
  }`;
}

function renderTimer() {
  const sec = engine.remainingSec ?? 0;
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {
  const q = engine.currentQuestion;
  els.qText.textContent = q.text;

  els.form.innerHTML = "";
  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`;
    const wrapper = document.createElement("label");
    wrapper.className = "option";
    if (reviewMode) {
      const chosen = engine.answers[q.id];
      if (i === q.correctIndex) wrapper.classList.add("correct");
      if (chosen === i && i !== q.correctIndex)
        wrapper.classList.add("incorrect");
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = String(i);
    input.id = id;
    input.checked = engine.getSelectedIndex?.() === i;

    const span = document.createElement("span");
    span.textContent = opt;

    wrapper.appendChild(input);
    wrapper.appendChild(span);
    els.form.appendChild(wrapper);
  });
}

function renderNav() {
  const hasSelection = Number.isInteger(engine.getSelectedIndex?.());
  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled = !(
    engine.currentIndex < engine.length - 1 && hasSelection
  );
  els.btnFinish.disabled = !(
    engine.currentIndex === engine.length - 1 && hasSelection
  );
}

function renderResult(summary) {
  els.result.classList.remove("hidden");
  const pct = Math.round(summary.percent * 100);
  const status = summary.passed ? "Пройден" : "Не пройден";
  els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${pct}%) — ${status}`;
}

// ========== Persist ==========
function persist() {
  try {
    const snapshot = engine.toState?.();
    console.log("Persist snapshot: ", snapshot)
    if (snapshot) {
      StorageService.saveState(snapshot);

    }
  } catch {
    /* noop в шаблоне */
  }
}
