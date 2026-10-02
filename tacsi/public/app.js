import { LANGUAGES, MORE_LANGUAGES, t, hasUi, findLanguage } from "./i18n.js";
import { icon, TOPIC_ICONS } from "./icons.js";

const TOPICS = ["housing", "money", "safety", "education", "immigration", "health", "benefits", "work"];
const IDLE_MS = 3 * 60 * 1000;
const IDLE_COUNTDOWN = 60;
// Set by the static demo build, where microphone and printing are not available.
const STATIC = Boolean(window.TACSI_STATIC);
const PLACE = new URLSearchParams(location.search).get("place") || "Library";

const $ = (id) => document.getElementById(id);

let knowledge = { services: [], concepts: [] };
let mode = "demo";

const fresh = () => ({
  lang: "en",
  uiLang: "en",
  langName: "English",
  speech: "en-GB",
  topics: [],
  history: [],
  demoState: null,
  engine: null,
  report: null,
  reference: null,
  busy: false,
});
let state = fresh();
let prefs = { readAloud: false, largeText: false };

// ---------- Text and language ----------

const tr = (key) => t(state.uiLang, key);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function applyText() {
  const lang = findLanguage(state.lang);
  document.documentElement.lang = state.lang;
  document.documentElement.dir = lang?.rtl ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = tr(el.dataset.i18n)));
  $("message").placeholder = tr("typeHere");
  document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}

function renderLanguages() {
  const button = (l) => `
    <button type="button" class="lang-button" data-lang="${l.code}" lang="${l.code}">
      <span class="lang-button__name">${esc(l.name)}</span>
      <span class="lang-button__english" lang="en">${esc(l.english)}</span>
    </button>`;
  $("lang-grid").innerHTML = LANGUAGES.map(button).join("");
  $("lang-grid-more").innerHTML = MORE_LANGUAGES.map(button).join("");
  document.querySelectorAll(".lang-button").forEach((b) => b.addEventListener("click", () => chooseLanguage(b.dataset.lang)));
}

function chooseLanguage(code) {
  const l = findLanguage(code);
  state.lang = l.code;
  state.uiLang = hasUi(l.code) ? l.code : "en";
  state.langName = l.english;
  state.speech = l.speech;
  applyText();
  $("tool-lang").hidden = false;
  show("welcome");
}

// ---------- Screens ----------

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== `screen-${name}`));
  const heading = document.querySelector(`#screen-${name} h1`);
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
  window.scrollTo(0, 0);
  if (name === "topics") renderTopics();
  if (name === "chat" && !state.history.length) startChat();
}

// ---------- Topics ----------

function renderTopics() {
  $("topic-grid").innerHTML = [...TOPICS, "other"]
    .map((topic) => {
      const label = topic === "other" ? tr("notSure") : tr(`topic_${topic}`);
      return `<button type="button" class="topic" data-topic="${topic}" aria-pressed="${state.topics.includes(topic)}">
        ${icon(TOPIC_ICONS[topic])}<span class="topic__label">${esc(label)}</span></button>`;
    })
    .join("");
  document.querySelectorAll(".topic").forEach((b) =>
    b.addEventListener("click", () => {
      const topic = b.dataset.topic;
      state.topics = state.topics.includes(topic) ? state.topics.filter((x) => x !== topic) : [...state.topics, topic];
      b.setAttribute("aria-pressed", state.topics.includes(topic));
      if (prefs.readAloud) speak(b.textContent.trim());
    }),
  );
}

// ---------- Speech ----------

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(base));
}

function speak(text) {
  if (!("speechSynthesis" in window)) return false;
  speechSynthesis.cancel();
  const voice = voiceFor(state.speech);
  if (!voice && state.lang !== "en") {
    $("mic-status").textContent = tr("noVoice");
    return false;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang ?? state.speech;
  if (voice) u.voice = voice;
  u.rate = 0.9;
  speechSynthesis.speak(u);
  return true;
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function setupMic() {
  if (!Recognition || STATIC) return;
  $("mic").hidden = false;
  $("mic").addEventListener("click", () => {
    if (recognition) return recognition.stop();
    recognition = new Recognition();
    recognition.lang = state.speech;
    recognition.interimResults = true;
    const before = $("message").value;
    recognition.onresult = (e) => {
      const heard = [...e.results].map((r) => r[0].transcript).join(" ");
      $("message").value = `${before} ${heard}`.trim();
    };
    recognition.onerror = () => ($("mic-status").textContent = tr("micError"));
    recognition.onend = () => {
      recognition = null;
      $("mic").classList.remove("is-listening");
      if ($("mic-status").textContent === tr("listening")) $("mic-status").textContent = "";
      $("message").focus();
    };
    recognition.start();
    $("mic").classList.add("is-listening");
    $("mic-status").textContent = tr("listening");
  });
}

// ---------- Conversation ----------

function startChat() {
  $("demo-notice").hidden = mode !== "demo";
  addTacsi({ reply: tr("greeting"), reply_english: t("en", "greeting"), quick_replies: [], concepts: [], first_aid: [] });
  $("message").focus();
}

function addTacsi(result) {
  state.history.push({ role: "assistant", text: result.reply, english: result.reply_english });
  const li = document.createElement("li");
  li.className = "msg msg--tacsi";
  li.innerHTML = `
    <div class="msg__who">TACSI</div>
    <div class="msg__bubble">${esc(result.reply)}</div>
    <div class="msg__actions"><button type="button" class="link-button" data-say>${icon("speaker")}${esc(tr("listen"))}</button></div>
    ${(result.first_aid ?? []).length ? `<div class="first-aid"><h2 class="heading-s">${esc(tr("doNow"))}</h2><ul>${result.first_aid.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${(result.concepts ?? [])
      .map(
        (c) => `<details class="concept"><summary>${icon(conceptIcon(c.term))}<span>${esc(tr("whatDoesThisMean"))} “${esc(c.term)}”</span></summary>
        <div class="concept__body"><p>${esc(c.explanation)}</p><button type="button" class="link-button" data-say-text="${esc(`${c.term}. ${c.explanation}`)}">${icon("speaker")}${esc(tr("listen"))}</button></div></details>`,
      )
      .join("")}`;
  li.querySelector("[data-say]").addEventListener("click", () => speak(result.reply));
  li.querySelectorAll("[data-say-text]").forEach((b) => b.addEventListener("click", () => speak(b.dataset.sayText)));
  $("chat").append(li);
  renderQuick(result.quick_replies ?? []);
  if (result.risk?.level === "immediate") $("urgent").hidden = false;
  if (prefs.readAloud) speak(result.reply);
  li.scrollIntoView({ behavior: "smooth", block: "start" });
}

function conceptIcon(term) {
  const c = knowledge.concepts.find((x) => term.toLowerCase().includes(x.term.toLowerCase().split(" (")[0].toLowerCase()));
  return c?.icon ?? "bulb";
}

function addUser(text) {
  state.history.push({ role: "user", text });
  const li = document.createElement("li");
  li.className = "msg msg--user";
  li.innerHTML = `<div class="msg__bubble">${esc(text)}</div>`;
  $("chat").append(li);
}

function renderQuick(options) {
  $("quick").innerHTML = options.map((o) => `<button type="button" class="chip">${esc(o)}</button>`).join("");
  $("quick").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => sendMessage(b.textContent)));
}

function session() {
  return {
    language: state.lang,
    languageName: state.langName,
    place: PLACE,
    topics: state.topics.filter((x) => x !== "other"),
  };
}

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function setBusy(busy) {
  state.busy = busy;
  $("loading").hidden = !busy;
  $("send").disabled = busy;
  $("finish").disabled = busy;
  if (busy) $("chat").after($("loading"));
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || state.busy) return;
  $("message").value = "";
  renderQuick([]);
  addUser(text);
  setBusy(true);
  try {
    const data = await api("/api/turn", { history: state.history, session: session(), demoState: state.demoState });
    state.demoState = data.demoState;
    state.engine = data.engine;
    if (data.engine === "demo-fallback") $("demo-notice").textContent = tr("aiUnavailable");
    if (data.engine !== "ai") $("demo-notice").hidden = false;
    const lastUser = state.history.findLast((m) => m.role === "user");
    if (lastUser) lastUser.english = data.result.user_message_english || text;
    addTacsi(data.result);
    if (data.result.ready_for_referral) await finish();
  } catch (err) {
    console.error(err);
    state.history.pop();
    $("chat").lastElementChild?.remove();
    $("message").value = text;
    $("mic-status").textContent = tr("error");
  } finally {
    setBusy(false);
  }
}

// ---------- Result ----------

async function finish() {
  if (state.busy && !state.history.length) return;
  setBusy(true);
  try {
    const data = await api("/api/report", { history: state.history, session: session(), demoState: state.demoState });
    state.report = data.report;
    state.engine = data.engine;
    renderResult();
    show("result");
  } catch (err) {
    console.error(err);
    $("mic-status").textContent = tr("error");
  } finally {
    setBusy(false);
  }
}

function serviceById(id) {
  return knowledge.services.find((s) => s.id === id);
}

function renderResult() {
  const c = state.report.citizen;
  const referrals = c.referrals
    .map((r) => {
      const s = serviceById(r.service_id);
      if (!s) return "";
      const topic = s.topics.find((x) => TOPIC_ICONS[x]) ?? "other";
      return `<article class="referral ${s.kind === "emergency" ? "referral--emergency" : ""}">
        <div class="referral__head">${icon(s.kind === "emergency" ? "warning" : s.kind === "local" ? "building" : TOPIC_ICONS[topic])}<h3 class="referral__name">${esc(s.name)}</h3></div>
        <p>${esc(r.why)}</p>
        <div class="contact">
          ${s.phone ? `<a class="contact__phone" href="tel:${s.phone.replace(/\s/g, "")}">${icon("phone")}${esc(tr("call"))} ${esc(s.phone)}</a>` : ""}
          ${s.web ? `<a href="${esc(s.web)}" rel="noopener">${esc(tr("website"))}: ${esc(s.web.replace(/^https?:\/\//, ""))}</a>` : ""}
        </div>
        ${s.hours ? `<p class="meta">${esc(s.hours)}</p>` : ""}
        ${s.notes && !s.notes.startsWith("PLACEHOLDER") ? `<p class="meta">${esc(s.notes)}</p>` : ""}
        ${r.what_to_say ? `<h4 class="heading-s">${esc(tr("whatToSay"))}</h4><p class="say">“${esc(r.what_to_say)}”</p>` : ""}
        ${r.what_to_bring?.length ? `<h4 class="heading-s">${esc(tr("whatToBring"))}</h4><ul class="list-check">${r.what_to_bring.map((x) => `<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul>` : ""}
      </article>`;
    })
    .join("");

  $("result").innerHTML = `
    <div class="panel">
      <h1 class="heading-l" tabindex="-1">${esc(tr("resultTitle"))}</h1>
    </div>
    <div class="button-row no-print" style="margin-top:-10px;margin-bottom:30px">
      <button type="button" class="button button--secondary" id="listen-all">${icon("speaker")}${esc(tr("listenAll"))}</button>
      ${STATIC ? "" : `<button type="button" class="button button--secondary" id="print">${icon("print")}${esc(tr("print"))}</button>`}
    </div>
    <section class="section"><h2 class="heading-m">${esc(tr("whatYouTold"))}</h2><p>${esc(c.summary)}</p></section>
    ${c.do_now.length ? `<section class="section"><h2 class="heading-m">${esc(tr("doNow"))}</h2><ul class="list-check">${c.do_now.map((x) => `<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul></section>` : ""}
    ${c.dont.length ? `<section class="section"><h2 class="heading-m">${esc(tr("dont"))}</h2><ul class="list-cross">${c.dont.map((x) => `<li>${icon("cross")}<span>${esc(x)}</span></li>`).join("")}</ul></section>` : ""}
    <section class="section">${referrals}</section>
    ${c.words_to_know.length ? `<section class="section"><h2 class="heading-m">${esc(tr("wordsToKnow"))}</h2><dl class="words">${c.words_to_know.map((w) => `<dt>${esc(w.term)}</dt><dd>${esc(w.explanation)}</dd>`).join("")}</dl></section>` : ""}
    <section class="share no-print" id="share">${shareForm()}</section>
    <button type="button" class="button button--secondary no-print" id="start-again">${esc(tr("startAgain"))}</button>`;

  $("listen-all").addEventListener("click", () => speak($("result").innerText));
  $("print")?.addEventListener("click", () => window.print());
  $("start-again").addEventListener("click", reset);
  bindShare();
}

function shareForm() {
  if (state.reference) {
    return `<h2 class="heading-m">${esc(tr("referenceTitle"))}</h2><p class="reference">${esc(state.reference)}</p><p>${esc(tr("referenceText"))}</p>${STATIC ? `<p lang="en"><a href="#staff">See what the support worker gets (staff view, PIN 1234)</a></p>` : ""}`;
  }
  return `<h2 class="heading-m">${esc(tr("shareTitle"))}</h2>
    <p>${esc(tr("shareText"))}</p>
    <div class="checkbox"><input type="checkbox" id="consent"><label for="consent">${esc(tr("shareConsent"))}</label></div>
    <button type="button" class="button" id="share-button" disabled>${esc(tr("shareButton"))}</button>`;
}

function bindShare() {
  const consent = $("consent");
  if (!consent) return;
  consent.addEventListener("change", () => ($("share-button").disabled = !consent.checked));
  $("share-button").addEventListener("click", async () => {
    try {
      const data = await api("/api/cases", { consent: true, session: session(), report: state.report, history: state.history, engine: state.engine });
      state.reference = data.reference;
      $("share").innerHTML = shareForm();
      $("share").querySelector("h2").setAttribute("tabindex", "-1");
      $("share").querySelector("h2").focus();
      if (prefs.readAloud) speak(`${tr("referenceTitle")}: ${state.reference.split("").join(" ")}`);
    } catch {
      $("share-button").insertAdjacentHTML("afterend", `<p>${esc(tr("error"))}</p>`);
    }
  });
}

// ---------- Privacy: reset, leave, idle ----------

function reset() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  recognition?.abort();
  state = fresh();
  $("chat").innerHTML = "";
  $("quick").innerHTML = "";
  $("result").innerHTML = "";
  $("urgent").hidden = true;
  $("message").value = "";
  $("mic-status").textContent = "";
  $("tool-lang").hidden = true;
  applyText();
  show("language");
}

function leave() {
  reset();
  try {
    window.location.replace("https://www.bbc.co.uk/weather");
  } catch {}
}

let shiftPresses = [];
document.addEventListener("keydown", (e) => {
  if (e.key !== "Shift") return;
  const now = Date.now();
  shiftPresses = [...shiftPresses.filter((x) => now - x < 1500), now];
  if (shiftPresses.length >= 3) leave();
});

let idleTimer;
let countdownTimer;
function inUse() {
  return state.history.some((m) => m.role === "user") || state.topics.length || state.report;
}
function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!inUse()) return reset();
    let left = IDLE_COUNTDOWN;
    $("idle-count").textContent = left;
    $("idle-dialog").showModal();
    countdownTimer = setInterval(() => {
      left -= 1;
      $("idle-count").textContent = left;
      if (left <= 0) {
        clearInterval(countdownTimer);
        $("idle-dialog").close();
        reset();
      }
    }, 1000);
  }, IDLE_MS);
}
["pointerdown", "keydown", "input"].forEach((ev) => document.addEventListener(ev, () => !$("idle-dialog").open && armIdle(), { passive: true }));

// ---------- Wire up ----------

async function init() {
  renderLanguages();
  applyText();
  setupMic();
  // Render first; which engine is running can take a moment to find out.
  fetch("/api/knowledge")
    .then((r) => r.json())
    .then((k) => (knowledge = k))
    .catch(() => {});
  fetch("/api/health")
    .then((r) => r.json())
    .then((h) => (mode = h.mode))
    .catch(() => (mode = "demo"));

  $("exit").addEventListener("click", leave);
  $("start").addEventListener("click", () => show("topics"));
  $("topics-continue").addEventListener("click", () => show("chat"));
  $("topics-skip").addEventListener("click", () => {
    state.topics = [];
    show("chat");
  });
  $("tool-lang").addEventListener("click", () => {
    reset();
  });
  $("tool-read").addEventListener("click", (e) => {
    prefs.readAloud = !prefs.readAloud;
    e.currentTarget.setAttribute("aria-pressed", prefs.readAloud);
    if (!prefs.readAloud && "speechSynthesis" in window) speechSynthesis.cancel();
  });
  $("tool-size").addEventListener("click", (e) => {
    prefs.largeText = !prefs.largeText;
    document.documentElement.classList.toggle("large-text", prefs.largeText);
    e.currentTarget.setAttribute("aria-pressed", prefs.largeText);
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage($("message").value);
  });
  $("message").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage($("message").value);
    }
  });
  $("finish").addEventListener("click", () => {
    if (!state.history.some((m) => m.role === "user")) return $("message").focus();
    finish();
  });
  $("idle-stay").addEventListener("click", () => {
    clearInterval(countdownTimer);
    $("idle-dialog").close();
    armIdle();
  });
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  armIdle();
}

init();
