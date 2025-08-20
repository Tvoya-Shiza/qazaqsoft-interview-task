
const STORAGE_KEYS = { STATE: "quiz.state.v2" }
const DATA_URL = "./data/questions.json"

class Question {
  constructor(dto) {
    this.id = dto.id
    this.text = dto.text
    this.options = [...dto.options]
    this.correctIndex = dto.correctIndex
    this.topic = dto.topic ?? null
  }
}

class StorageService {
  static saveState(state) { localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state)) }
  static loadState() { try { const raw = localStorage.getItem(STORAGE_KEYS.STATE); if (!raw) return null; return JSON.parse(raw) } catch { return null } }
  static clear() { localStorage.removeItem(STORAGE_KEYS.STATE) }
}

class QuizEngine {
  constructor(quiz, opts = {}) {
    this.title = quiz.title
    this.timeLimitSec = Number.isFinite(quiz.timeLimitSec) ? quiz.timeLimitSec : 300
    this.passThreshold = Number.isFinite(quiz.passThreshold) ? quiz.passThreshold : 0.7
    this.questions = quiz.questions.map(q => new Question(q))
    this.currentIndex = 0
    this.answers = {}
    this.remainingSec = this.timeLimitSec
    this.isFinished = false
    this.perQuestionSec = {}
    this.optionOrders = {}
    this.summaryCache = null
    const seed = opts.seed ?? Math.floor(Math.random() * 1e9)
    this.prng = this.mkPrng(seed)
    const order = opts.order ?? this.shuffleOrder(this.questions.length)
    this.questions = order.map(i => this.questions[i])
    for (const q of this.questions) {
      const ord = opts.optionOrders?.[q.id] ?? this.shuffleOrder(q.options.length)
      this.optionOrders[q.id] = ord
      const original = [...q.options]
      q.options = ord.map(i => original[i])
      q.correctIndex = ord.findIndex(i => i === q.correctIndex)
    }
    if (opts.state) {
      this.currentIndex = Math.min(Math.max(opts.state.currentIndex || 0, 0), this.questions.length - 1)
      this.answers = opts.state.answers || {}
      this.remainingSec = Math.max(0, opts.state.remainingSec ?? this.timeLimitSec)
      this.isFinished = !!opts.state.isFinished
      this.perQuestionSec = opts.state.perQuestionSec || {}
    }
  }
  get length() { return this.questions.length }
  get currentQuestion() { return this.questions[this.currentIndex] }
  mkPrng(seed) { let s = seed >>> 0; return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
  shuffleOrder(n) { const arr = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(this.prng() * (i + 1)); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp } return arr }
  goTo(index) { if (index < 0 || index >= this.length) return; this.currentIndex = index }
  next() { const sel = this.getSelectedIndex(); if (!Number.isInteger(sel)) return; this.goTo(this.currentIndex + 1) }
  prev() { this.goTo(this.currentIndex - 1) }
  select(optionIndex) { if (this.isFinished) return; const q = this.currentQuestion; this.answers[q.id] = optionIndex }
  getSelectedIndex() { const q = this.currentQuestion; const v = this.answers[q.id]; return Number.isInteger(v) ? v : undefined }
  tick() { if (this.isFinished) return; this.remainingSec = Math.max(0, (this.remainingSec ?? 0) - 1); const q = this.currentQuestion; this.perQuestionSec[q.id] = (this.perQuestionSec[q.id] || 0) + 1; if (this.remainingSec <= 0) { this.finish() } }
  finish() { if (this.isFinished) { return this.getSummary() } this.isFinished = true; this.summaryCache = this.computeSummary(); return this.summaryCache }
  computeSummary() { let correct = 0; for (const q of this.questions) { if (this.answers[q.id] === q.correctIndex) correct++ } const total = this.length; const percent = total ? correct / total : 0; const passed = percent >= this.passThreshold; return { correct, total, percent, passed } }
  getSummary() { return this.summaryCache ?? this.computeSummary() }
  toState() { const questionOrder = this.questions.map(q => q.id); return { title: this.title, currentIndex: this.currentIndex, answers: this.answers, remainingSec: this.remainingSec, isFinished: this.isFinished, questionOrder, optionOrders: this.optionOrders, perQuestionSec: this.perQuestionSec, passThreshold: this.passThreshold, timeLimitSec: this.timeLimitSec } }
  static fromState(quiz, state) { if (!state || state.title !== quiz.title) return new QuizEngine(quiz); const byId = new Map(quiz.questions.map(q => [q.id, new Question(q)])); const ordered = []; const ids = state.questionOrder || quiz.questions.map(q => q.id); for (const id of ids) { const src = byId.get(id); if (src) ordered.push(src) } const engine = new QuizEngine({ title: quiz.title, timeLimitSec: quiz.timeLimitSec, passThreshold: quiz.passThreshold, questions: ordered.length ? ordered : quiz.questions }, { seed: 1, order: Array.from({ length: (ordered.length ? ordered : quiz.questions).length }, (_, i) => i), optionOrders: state.optionOrders, state }); return engine }
}

const $ = sel => document.querySelector(sel)
const els = { title: $("#quiz-title"), progress: $("#progress"), bar: $("#progressbar-value"), timer: $("#timer"), qSection: $("#question-section"), qText: $("#question-text"), form: $("#options-form"), btnPrev: $("#btn-prev"), btnNext: $("#btn-next"), btnFinish: $("#btn-finish"), result: $("#result-section"), resultSummary: $("#result-summary"), btnReview: $("#btn-review"), btnRestart: $("#btn-restart"), analytics: $("#analytics") }

let engine = null
let timerId = undefined
let reviewMode = false

document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz()
  els.title.textContent = quiz.title
  const saved = StorageService.loadState()
  engine = saved && saved.title === quiz.title ? QuizEngine.fromState(quiz, saved) : new QuizEngine(quiz)
  bindEvents()
  renderAll()
  startTimer()
  if (engine.isFinished) { renderResult(engine.getSummary()) }
})

async function loadQuiz() {
  const res = await fetch(DATA_URL)
  const data = await res.json()
  if (!data?.questions?.length) throw new Error("Некорректные данные теста")
  return data
}

function startTimer() {
  stopTimer()
  timerId = window.setInterval(() => {
    if (!engine || engine.isFinished || reviewMode) return
    engine.tick()
    persist()
    renderTimer()
    if (engine.isFinished) { renderResult(engine.getSummary()); persist() }
  }, 1000)
}

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = undefined } }

function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    if (reviewMode || engine.isFinished) engine.goTo(engine.currentIndex - 1)
    else engine.prev()
    persist(); renderAll()
  })
  els.btnNext.addEventListener("click", () => {
    if (reviewMode || engine.isFinished) engine.goTo(engine.currentIndex + 1)
    else engine.next()
    persist(); renderAll()
  })
  els.btnFinish.addEventListener("click", () => {
    if (reviewMode || engine.isFinished) {
      StorageService.clear()
      window.location.reload()
      return
    }
    const summary = engine.finish()
    renderResult(summary)
    persist()
  })
  els.btnReview?.addEventListener("click", () => {
    reviewMode = true
    els.result.classList.add("hidden")
    engine.currentIndex = 0
    renderAll()
    els.qSection.scrollIntoView({ behavior: "smooth", block: "start" })
  })
  els.btnRestart.addEventListener("click", () => {
    StorageService.clear()
    window.location.reload()
  })
  els.form.addEventListener("change", e => {
    const target = e.target
    if (target?.name === "option") {
      const idx = Number(target.value)
      engine.select(idx)
      persist()
      renderNav()
      renderProgressBar()
    }
  })
  document.addEventListener("keydown", e => {
    if (!(reviewMode || engine?.isFinished)) return
    if (e.key === "ArrowRight") { engine.goTo(Math.min(engine.currentIndex + 1, engine.length - 1)); renderAll() }
    else if (e.key === "ArrowLeft") { engine.goTo(Math.max(engine.currentIndex - 1, 0)); renderAll() }
  })
}

function renderAll() { renderProgress(); renderProgressBar(); renderTimer(); renderQuestion(); renderNav() }

function renderProgress() { els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}` }

function renderProgressBar() {
  let pct = 0
  if (reviewMode || engine.isFinished) pct = ((engine.currentIndex + 1) / engine.length) * 100
  else pct = engine.length ? ((engine.currentIndex + (Number.isInteger(engine.getSelectedIndex()) ? 1 : 0)) / engine.length) * 100 : 0
  els.bar.style.width = `${Math.min(100, Math.max(0, pct))}%`
}

function formatTime(sec) { const m = Math.floor(sec / 60).toString().padStart(2, "0"); const s = Math.floor(sec % 60).toString().padStart(2, "0"); return `${m}:${s}` }

function renderTimer() { els.timer.textContent = formatTime(engine.remainingSec ?? 0) }

function renderQuestion() {
  const q = engine.currentQuestion
  els.qText.textContent = q.text
  els.form.innerHTML = ""
  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`
    const label = document.createElement("label")
    label.className = "option"
    if (reviewMode || engine.isFinished) {
      const chosen = engine.answers[q.id]
      if (i === q.correctIndex) label.classList.add("correct")
      if (chosen === i && i !== q.correctIndex) label.classList.add("incorrect")
    }
    const input = document.createElement("input")
    input.type = "radio"
    input.name = "option"
    input.value = String(i)
    input.id = id
    input.checked = engine.getSelectedIndex() === i
    input.disabled = reviewMode || engine.isFinished
    const span = document.createElement("span")
    span.textContent = opt
    label.appendChild(input)
    label.appendChild(span)
    els.form.appendChild(label)
  })
}

function renderNav() {
  const atStart = engine.currentIndex === 0
  const atEnd = engine.currentIndex === engine.length - 1
  if (reviewMode || engine.isFinished) {
    els.btnPrev.disabled = atStart
    els.btnNext.disabled = atEnd
    els.btnFinish.textContent = "Пройти заново"
    els.btnFinish.disabled = false
    return
  }
  const hasSelection = Number.isInteger(engine.getSelectedIndex())
  els.btnPrev.disabled = atStart
  els.btnNext.disabled = !(engine.currentIndex < engine.length - 1 && hasSelection)
  els.btnFinish.textContent = "Завершить"
  els.btnFinish.disabled = !(engine.currentIndex === engine.length - 1 && hasSelection)
}

function renderResult(summary) {
  els.result.classList.remove("hidden")
  const pct = Math.round(summary.percent * 100)
  const status = summary.passed ? "Пройден" : "Не пройден"
  els.resultSummary.textContent = `${summary.correct} / ${summary.total} (${pct}%) — ${status}`
  renderAnalytics()
}

function renderAnalytics() {
  const items = engine.questions.map(q => {
    const t = engine.perQuestionSec[q.id] || 0
    const ok = engine.answers[q.id] === q.correctIndex
    return { q: q.text, time: t, ok }
  })
  const grid = document.createElement("div")
  grid.className = "stats-grid"
  for (let i = 0; i < items.length; i++) {
    const row = document.createElement("div")
    row.className = "stats-row"
    const a = document.createElement("div")
    a.textContent = `Вопрос ${i + 1}`
    const b = document.createElement("div")
    b.textContent = formatTime(items[i].time)
    const c = document.createElement("div")
    c.textContent = items[i].ok ? "✔ Правильно" : "✖ Неправильно"
    c.style.color = items[i].ok ? "#22c55e" : "#ef4444"
    row.appendChild(a)
    row.appendChild(b)
    row.appendChild(c)
    grid.appendChild(row)
  }
  els.analytics.innerHTML = ""
  els.analytics.appendChild(grid)
}

function persist() { try { const snapshot = engine.toState(); if (snapshot) StorageService.saveState(snapshot) } catch {} }
