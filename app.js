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
    // TODO: сериализовать state и сохранить в localStorage
    // Пример: localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
  }

  static loadState() {
    const state = localStorage.getItem(STORAGE_KEYS.STATE);
    if (state) {
      return JSON.parse(state);
    }
    return null;
  }

  static clear() {
    localStorage.removeItem(STORAGE_KEYS.STATE);
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
    this.questions = QuizEngine.shuffle(this.questions);
    
    this.currentIndex = 0;
    /** @type {Record<string, number|undefined>} */
    this.answers = {}; // questionId -> selectedIndex
    this.remainingSec = quiz.timeLimitSec;
    this.isFinished = false;
    this.order = this.questions.map(q => q.id);
  }
  
  static shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }
    return array;
  }

  get length() {
    return this.questions.length;
  }
  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  /** @param {number} index */
  goTo(index) {
    // TODO: валидировать границы и сменить текущий индекс
    if (index<this.length && index>-1){
      this.currentIndex=index;
    }
  }

  next() {
    // TODO: перейти к следующему вопросу, если возможно
    if (this.length>this.currentIndex+1){
      this.currentIndex++;
    }
  }

  prev() {
    // TODO: перейти к предыдущему вопросу, если возможно
    if (this.currentIndex!=0){
      this.currentIndex--;
    }
  }

  /** @param {number} optionIndex */
  select(optionIndex) {
    // TODO: сохранить выбор пользователя для текущего вопроса
    this.answers[this.currentQuestion.id]=optionIndex; 
  }

  getSelectedIndex() {
    // TODO: вернуть выбранный индекс для текущего вопроса (или undefined) DONE
    const idOfCurrentQuestion = this.currentQuestion.id;

    return this.answers[idOfCurrentQuestion];
  }

  tick() {
    // TODO: декремент таймера; если 0 — завершить тест
    this.remainingSec--;
    
    if(this.remainingSec<=0){
      this.finish();
    }
  }

  finish() {
    // TODO: зафиксировать завершение и вернуть сводку результата
    // return { correct: number, total: number, percent: number, passed: boolean , topicMap:{String:[]}}
    this.isFinished = true;

    const summary = { correct: 0, total: this.length, percent: 0, passed: false, topicMap:{}};
    this.questions.forEach(q=>{
      if (!summary.topicMap[q.topic]) {
        summary.topicMap[q.topic] = { correct: 0, total: 0 };
      }
  
      summary.topicMap[q.topic].total++;
  
      if (this.answers[q.id] === q.correctIndex) {
        summary.correct++;
        summary.topicMap[q.topic].correct++;
      }
    });
    
    summary.percent=summary.correct/summary.total;
    
    summary.passed = summary.percent >= this.passThreshold;

    return summary;
  }

  /** Восстановление/выгрузка состояния для localStorage */
  toState() {
    // TODO: вернуть сериализуемый снимок состояния
    return {
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
      order: this.order,
    };
  }
  

  /** @param {any} state */
  static fromState(quiz, state) {
    engine  = new QuizEngine(quiz);
    // TODO: создать двигатель на базе сохранённого состояния
    engine.remainingSec = state.remainingSec;
    engine.order = state.order;
    engine.currentIndex = state.currentIndex;
    engine.answers = state.answers; // questionId -> selectedIndex
    engine.isFinished = state.isFinished;
    
    const questionsById = new Map();
    quiz.questions.forEach(q => {
      const questionInstance = new Question(q);
      questionsById.set(questionInstance.id, questionInstance);
    });
    engine.questions = state.order.map(questionId => questionsById.get(questionId));

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
  rSection: $("#result-section"), //renmd for uniformitiy
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
  //Добавленные 
  sSection: $("#start-section"),
  btnStart: $("#btn-start"),
  hdr:$("#header"),
  navBar:$("#navbar"),
  navBarQuestionCont:$("#question-id-container"),
  topicWise:$("#topic-wise-summary"),
};

let engine = /** @type {QuizEngine|null} */ (null);
let timerId = /** @type {number|undefined} */ (undefined);
let reviewMode = false;

// ========== Инициализация ==========
function goToStart(){
  // Убираем старт
  els.sSection.classList.add("hidden");
  // Показываем куиз
  els.qSection.classList.remove("hidden");
  // Показываем хедер
  els.hdr.classList.remove("hidden");
  // Показываем навигатор
  els.navBar.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title;

  const saved = StorageService.loadState?.(); // заглушка
  if (saved) {
    engine = QuizEngine.fromState(quiz, saved);
    if (engine.isFinished){
      renderResult(engine.finish());
    }else{
      renderAll();
      startTimer();
    }
    goToStart();
  }else{
    engine = new QuizEngine(quiz);
  }
  
  bindEvents();
  renderAll();
  if (!engine.isFinished){
    startTimer();
  }
});

async function loadQuiz() {
  // Загружаем JSON с вопросами
  const res = await fetch(DATA_URL);
  /** @type {QuizDTO} */
  const data = await res.json();
  // Простейшая валидация формата (можно расширить) : уже не простейшая
  try {
    const validatedData = validateQuestionContainingJson(data);
    return validatedData;
  } catch (e) {
    console.error(e);
    throw new Error("Упс...! Тута: Небойтесь обратитесь к Супервайзеру/Администратору (tg:@horse_coffee)"+e.message);
  }
}
/**
 * @param {QuizDTO} data
 * @returns {QuizDTO}
 */
function validateQuestionContainingJson(data){
  if (!data || typeof data !== 'object') {
    throw new Error('Некорректные данные: объект не найден');
  }

  // Проверка формата джейсона
  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw new Error('Некорректные данные: заголовок (title) не является строкой');
  }
  if (typeof data.timeLimitSec !== 'number' || data.timeLimitSec <= 0) {
    throw new Error('Некорректные данные: лимит времени (timeLimitSec) не является положительным числом');
  }
  if (typeof data.passThreshold !== 'number' || data.passThreshold <= 0 || data.passThreshold > 1) {
    throw new Error('Некорректные данные: порог прохождения (passThreshold) должен быть числом от 0 до 1');
  }
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error('Некорректные данные: вопросы (questions) должны быть непустым массивом');
  }

  // Валидация каждого вопроса (Думаю необходимо)
  data.questions.forEach((q, index) => {
    if (typeof q.id !== 'string' || !q.id.trim()) {
      throw new Error(`Некорректные данные: вопрос ${index + 1} не имеет ID`);
    }
    if (typeof q.text !== 'string' || !q.text.trim()) {
      throw new Error(`Некорректные данные: вопрос ${q.id} не имеет текста`);
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Некорректные данные: вопрос ${q.id} должен иметь как минимум 2 варианта ответа`);
    }
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`Некорректные данные: вопрос ${q.id} имеет неверный индекс правильного ответа`);
    }
  });

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
      // До реализации tick() попадём сюда — это нормально для шаблона.
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
  els.btnStart.addEventListener(
    "click", () => {
    goToStart();
    // Стартуем рендеринг и таймер
    renderAll();
    startTimer();
  });

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
  // const hasSelection = Number.isInteger(engine.getSelectedIndex?.());
  const hasSelection = true;
  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled = !(
    engine.currentIndex < engine.length - 1 && hasSelection
  );
  const allQuestionsAnswered = Object.keys(engine.answers).length === engine.length;
  els.btnFinish.disabled = !(
    allQuestionsAnswered && hasSelection
  ); 

  els.navBarQuestionCont.innerHTML='';
  for (let i = 0; i < engine.length; i++) {
    const btn = document.createElement('button');
    btn.textContent = i + 1; // Display 1-based index
    btn.className = 'btn btn-question-nav';
    btn.type = 'button';
    if (engine.answers[engine.order[i]] !== undefined) { 
      btn.classList.add('touched');
    }
    // Highlight the current question
    if (i === engine.currentIndex) {
      btn.classList.add('active');
    }

    // Add a click listener to navigate to the question
    btn.addEventListener('click', () => {
      engine.goTo(i);
      renderAll();
    });

    els.navBarQuestionCont.appendChild(btn);
  }
  
}

function renderResult(summary) {
  // els.result.classList.remove("hidden");
  els.rSection.classList.remove("hidden");
  els.rSection.scrollIntoView({ behavior: 'smooth' });
  const pct = Math.round(summary.percent * 100);
  const status = summary.passed ? "Пройден" : "Не пройден";
  
  els.resultSummary.textContent = `По всем темам: ${summary.correct} / ${summary.total} (${pct}%) — ${status}`;
  
  for (const topic in summary.topicMap) {
    const topicData = summary.topicMap[topic];
    const e = document.createElement("p");
    e.textContent = `${topic}: ${topicData.correct} / ${topicData.total}`;
    els.topicWise.appendChild(e);
  }
  
}

// ========== Persist ==========
function persist() {
  try {
    const snapshot = engine.toState?.();
    if (snapshot) StorageService.saveState(snapshot);
  } catch {
    /* noop в шаблоне */
  }
}

