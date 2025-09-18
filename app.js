// ========== Константы и ключи хранилища ==========
const STORAGE_KEYS = { STATE: "quiz.state.v1" };
const DATA_URL = "./data/questions.json";

// ========== Модели ==========
class Question {
    constructor({ id, text, options, correctIndex, topic }) {
        this.id = id;
        this.text = text;
        this.options = options;
        this.correctIndex = correctIndex;
        this.topic = topic ?? null;
    }
}

// ========== StorageService ==========
class StorageService {
    static saveState(state) {
        localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state));
    }

    static loadState() {
        const json = localStorage.getItem(STORAGE_KEYS.STATE);
        return json ? JSON.parse(json) : null;
    }

    static clear() {
        localStorage.removeItem(STORAGE_KEYS.STATE);
    }
}

// ========== QuizEngine ==========
class QuizEngine {
    constructor(quiz) {
        this.title = quiz.title;
        this.timeLimitSec = quiz.timeLimitSec;
        this.passThreshold = quiz.passThreshold;
        this.questions = quiz.questions.map((q) => new Question(q));

        this.currentIndex = 0;
        this.answers = {};
        this.remainingSec = quiz.timeLimitSec;
        this.isFinished = false;
    }

    get length() { return this.questions.length; }
    get currentQuestion() { return this.questions[this.currentIndex]; }

    goTo(index) {
        if (index >= 0 && index < this.questions.length) this.currentIndex = index;
    }

    next() { if (this.currentIndex < this.questions.length - 1) this.currentIndex++; }
    prev() { if (this.currentIndex > 0) this.currentIndex--; }

    select(optionIndex) {
        this.answers[this.currentQuestion.id] = optionIndex;
    }

    getSelectedIndex() {
        return this.answers[this.currentQuestion.id];
    }

    tick() {
        if (this.isFinished) return;
        this.remainingSec--;
        if (this.remainingSec <= 0) this.finish();
    }

    finish() {
        if (this.isFinished) return null;
        this.isFinished = true;

        const correct = this.questions.reduce(
            (acc, q) => acc + (this.answers[q.id] === q.correctIndex ? 1 : 0),
            0
        );

        const total = this.questions.length;
        const percent = correct / total;
        const passed = percent >= this.passThreshold;

        return { correct, total, percent, passed };
    }

    toState() {
        return {
            currentIndex: this.currentIndex,
            answers: this.answers,
            remainingSec: this.remainingSec,
            isFinished: this.isFinished,
        };
    }

    static fromState(quiz, state) {
        const engine = new QuizEngine(quiz);
        engine.currentIndex = state.currentIndex ?? 0;
        engine.answers = state.answers ?? {};
        engine.remainingSec = state.remainingSec ?? quiz.timeLimitSec;
        engine.isFinished = state.isFinished ?? false;
        return engine;
    }
}

// ========== DOM ==========
const $ = (sel) => document.querySelector(sel);
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

let engine = null;
let timerId;
let reviewMode = false;

// ========== Инициализация ==========
document.addEventListener("DOMContentLoaded", async () => {
    const quiz = await loadQuiz();
    els.title.textContent = quiz.title;

    const saved = StorageService.loadState();
    engine = saved ? QuizEngine.fromState(quiz, saved) : new QuizEngine(quiz);

    bindEvents();
    renderAll();
    startTimer();
});

async function loadQuiz() {
    const res = await fetch(DATA_URL);
    const data = await res.json();
    if (!data?.questions?.length) throw new Error("Некорректные данные теста");
    return data;
}

// ========== Таймер ==========
function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
        engine.tick();
        persist();
        renderTimer();
        if (engine.isFinished) {
            stopTimer();
            const summary = engine.finish();
            renderResult(summary);
        }
    }, 1000);
}

function stopTimer() {
    if (timerId) clearInterval(timerId);
}

// ========== События ==========
function bindEvents() {
    els.btnPrev.addEventListener("click", () => { engine.prev(); persist(); renderAll(); });
    els.btnNext.addEventListener("click", () => { engine.next(); persist(); renderAll(); });
    els.btnFinish.addEventListener("click", () => {
        const summary = engine.finish();
        stopTimer();
        renderResult(summary);
        persist();
    });
    els.btnReview.addEventListener("click", () => { reviewMode = true; renderAll(); });
    els.btnRestart.addEventListener("click", () => { StorageService.clear(); location.reload(); });

    els.form.addEventListener("change", (e) => {
        const target = e.target;
        if (target?.name === "option") {
            engine.select(Number(target.value));
            persist();
            renderNav();
        }
    });
}

// ========== Render ==========
function renderAll() {
    renderProgress();
    renderTimer();
    renderQuestion();
    renderNav();
}

function renderProgress() {
    els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
}

function renderTimer() {
    const sec = engine.remainingSec ?? 0;
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
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
            if (chosen === i && i !== q.correctIndex) wrapper.classList.add("incorrect");
        }

        const input = document.createElement("input");
        input.type = "radio";
        input.name = "option";
        input.value = i;
        input.id = id;
        input.checked = engine.getSelectedIndex() === i;
        input.disabled = reviewMode || engine.isFinished;

        const span = document.createElement("span");
        span.textContent = opt;

        wrapper.appendChild(input);
        wrapper.appendChild(span);
        els.form.appendChild(wrapper);
    });
}

function renderNav() {
    const hasSelection = Number.isInteger(engine.getSelectedIndex());
    els.btnPrev.disabled = engine.currentIndex === 0;
    els.btnNext.disabled = !(engine.currentIndex < engine.length - 1 && hasSelection);
    els.btnFinish.disabled = !(engine.currentIndex === engine.length - 1 && hasSelection);
}

function renderResult(summary) {
    els.result.classList.remove("hidden");
    const pct = Math.round(summary.percent * 100);
    const status = summary.passed ? "Пройден" : "Не пройден";
    els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${pct}%) — ${status}`;
}

// ========== Persist ==========
function persist() {
    if (!engine) return;
    StorageService.saveState(engine.toState());
}
