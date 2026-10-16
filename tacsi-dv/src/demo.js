// Offline demo engine: a scripted, rule-based stand-in for the AI.
//
// It lets TACSI run with no API key (for workshops, focus groups and when the
// network is down). It speaks English only and follows fixed question paths,
// but it returns exactly the same shapes as the AI engine.

import { findConceptsInText } from "./knowledge/concepts.js";
import { servicesForTopics } from "./knowledge/services.js";

// Direct disclosure (safety) and the everyday problems that often come with
// domestic abuse. TACSI DV helps with all of these.
const KEYWORDS = {
  safety: ["hits me", "hit me", "hurts me", "hurt me", "abuse", "abusive", "violent", "violence", "beats me", "beat me", "scared of him", "scared of her", "afraid of him", "afraid of her", "scared of my husband", "scared of my partner", "threatens me", "threatened me", "raped", "strangled", "choked", "worries at home", "hard at home", "problems at home", "trouble at home"],
  money: ["debt", "owe", "bill", "bills", "money", "bailiff", "loan", "credit card", "arrears", "council tax", "can't pay", "cannot pay", "wages", "bank"],
  housing: ["landlord", "rent", "evict", "eviction", "homeless", "housing", "tenancy", "flat", "house", "nowhere to live", "move out", "refuge", "home and housing"],
  family: ["children", "child", "kids", "son", "daughter", "custody", "contact", "divorce", "separate", "separation", "social services", "baby", "pregnant", "family"],
  law: ["police", "arrested", "report it", "injunction", "court order", "solicitor", "lawyer", "legal", "clare's law", "crime", "charged", "court", "law"],
  immigration: ["visa", "spouse visa", "partner visa", "home office", "immigration", "passport", "deport", "send me back", "no recourse", "asylum", "brp"],
  health: ["health", "feelings", "doctor", "gp", "pain", "injury", "bruise", "depressed", "depression", "anxious", "panic", "can't sleep", "mental", "hospital", "crying"],
  benefits: ["universal credit", "benefit", "benefits", "pip", "jobcentre", "child benefit", "work coach"],
};

// Indirect signs of abuse: what people say before (or instead of) naming it.
// Each is noted for the staff report, and the first one leads to one gentle,
// optional question.
const CUES = [
  { theme: "Economic abuse", words: ["takes my money", "takes my wages", "takes my benefits", "controls the money", "controls all the money", "decides about money", "has my bank card", "keeps my bank card", "no access to the bank", "have to ask him for money", "have to ask her for money", "loans in my name", "debt in my name", "made me take a loan", "won't give me money", "someone else controls the money"] },
  { theme: "Coercive control", words: ["not allowed", "won't let me", "doesn't let me", "does not let me", "need his permission", "need her permission", "have to ask permission", "checks my phone", "reads my messages", "tracks my phone", "tracks where i am", "jealous"] },
  { theme: "Isolation", words: ["can't see my friends", "cannot see my friends", "can't see my family", "cannot see my family", "not allowed out", "can't go out", "stops me working", "won't let me work"] },
  { theme: "Fear", words: ["walking on eggshells", "his temper", "her temper", "gets angry", "shouts at me", "afraid to go home", "scared to go home", "what he will do", "what he'll do", "what she will do", "breaks things", "smashed"] },
  { theme: "Immigration abuse", words: ["keeps my passport", "takes my passport", "has my passport", "send me back", "get me deported", "someone else keeps them"] },
  { theme: "Children at risk", words: ["the children see", "the kids see", "the children hear", "the kids hear", "take the children", "take the kids", "take my children"] },
  { theme: "Possible physical harm", words: ["i fell", "walked into", "bruises", "bruise"] },
  { theme: "Forced marriage or 'honour'", words: ["forced to marry", "forcing me to marry", "honour", "my in-laws control"] },
];

const IMMEDIATE = ["kill me", "kill myself", "end my life", "suicide", "going to kill", "he is here now", "she is here now", "bleeding", "can't breathe", "cannot breathe", "not safe now", "not safe tonight", "hurting me now", "take my own life"];
const CONCERN = ["hit", "hits", "hurt", "scared", "afraid", "threat", "bailiff", "homeless", "evict", "abuse", "no food", "sleeping rough", "controls", "can't feed", "cannot feed", "can't buy food", "cannot buy food", "gets angry", "temper", "walking on eggshells", "not allowed", "won't let me"];

const TOPIC_LABELS = {
  safety: "Worries at home",
  housing: "Home and housing",
  money: "Money and debt",
  family: "Children and family",
  law: "Police and the law",
  immigration: "Visas and immigration",
  health: "Health and feelings",
  benefits: "Benefits",
  other: "Something else",
};

// Question paths per topic. Each question has a key so answers can be used in the report.
// Wording follows the person's lead: abuse is not named unless they name it.
const QUESTIONS = {
  safety: [
    { key: "talk_ok", q: "Is it OK to talk here? Is anyone with you, or able to see this screen?", options: ["It's OK to talk", "Someone is with me"] },
    { key: "safe_now", q: "Do you feel safe right now?", options: ["Yes", "No", "I'm not sure"], when: (s) => !s.notPrivate },
    { key: "at_home", q: "Does the person you are worried about live with you?", options: ["Yes", "No", "I'd rather not say"], when: (s) => !s.notPrivate },
    { key: "children", q: "Are there children living with you?", options: ["Yes", "No"], when: (s) => !s.notPrivate },
    { key: "high_risk", q: "Has this person ever tried to choke or strangle you, or threatened to kill you? You do not have to answer.", options: ["Yes", "No", "I'd rather not say"], when: (s) => !s.notPrivate },
  ],
  money: [
    { key: "money_kind", q: "What is the main money problem?", options: ["I don't have enough money for food or bills", "I owe money", "Someone else controls the money", "My benefits have stopped or are late"] },
    { key: "owe_to", q: "Who do you owe money to? You can choose more than one by typing.", options: ["Council tax", "Rent", "Energy bills", "Loans or credit cards", "I'm not sure"], when: (s) => owesMoney(s) },
    { key: "court_bailiffs", q: "Has anyone sent a court letter, or said bailiffs will come?", options: ["Yes", "No", "I'm not sure"], when: (s) => owesMoney(s) },
    { key: "food_heat", q: "Do you have enough money for food and heating this week?", options: ["Yes", "No"] },
    { key: "how_long", q: "How long has money been a problem?", options: ["A few days", "A few weeks", "Months or longer"] },
  ],
  housing: [
    { key: "tenure", q: "Whose name is the home in?", options: ["Mine", "My partner's", "Both of us", "I don't have a home"] },
    { key: "stay_move", q: "Do you want to stay in your home, or do you need to move?", options: ["Stay", "Move", "I'm not sure"] },
    { key: "tonight", q: "Do you have somewhere safe to sleep tonight?", options: ["Yes", "No"] },
  ],
  family: [
    { key: "fam_issue", q: "What is worrying you about your family or children?", options: ["Where the children live or who they see", "A court letter or court case", "Separating or divorce", "Something else"] },
    { key: "deadline", q: "Is there a court date, or a letter with a deadline?", options: ["Yes", "No", "I'm not sure"] },
    { key: "children_ok", q: "How are the children at the moment?", options: ["They are OK", "I'm worried about them", "I'd rather not say"] },
  ],
  law: [
    { key: "law_issue", q: "What is this about?", options: ["Something that happened to me", "A letter from the police or court", "Someone I am worried about", "Something else"] },
    { key: "police_told", q: "Have the police been told about it? Telling the police is always your choice.", options: ["Yes", "No", "I'm not sure"] },
  ],
  immigration: [
    { key: "status", q: "Which is closest to your situation?", options: ["I'm on a spouse or partner visa", "Another visa", "I have claimed asylum", "I'm not sure of my status"] },
    { key: "documents", q: "Do you have your passport and visa papers?", options: ["Yes", "No, someone else keeps them", "I'm not sure"] },
    { key: "deadline", q: "Do you have a letter from the Home Office with a deadline?", options: ["Yes", "No", "I'm not sure"] },
  ],
  health: [
    { key: "health_kind", q: "Is this about your body, your feelings, or both?", options: ["My body", "My feelings", "Both"] },
    { key: "gp", q: "Can you see a doctor on your own when you need to?", options: ["Yes", "No", "I'm not registered with a doctor"] },
  ],
  benefits: [
    { key: "on_benefits", q: "Do you get any benefits now, like Universal Credit?", options: ["Yes", "No", "I'm not sure"] },
    { key: "own_account", q: "Is the money paid into a bank account you can use yourself?", options: ["Yes", "No", "I'm not sure"], when: (s) => /^yes/i.test(s.answers["benefits.on_benefits"] ?? "") },
  ],
  other: [
    { key: "describe", q: "Can you tell me a bit more about what is happening? You can type or tap the microphone.", options: [] },
  ],
};

// Answers that are themselves signs (the person picked them, not typed them).
const ANSWER_CUES = {
  "money.money_kind": [/controls/i, "Economic abuse"],
  "immigration.documents": [/someone else/i, "Immigration abuse"],
  "health.gp": [/^no\b/i, "Coercive control"],
  "benefits.own_account": [/^no\b/i, "Economic abuse"],
  "family.children_ok": [/worried/i, "Children at risk"],
};

const FIRST_AID = {
  money: [
    "Do not open the door to bailiffs or debt collectors on their first visit. Do not let them in.",
    "Do not ignore letters. Keep them all in one place.",
  ],
  economic: ["You can ask for Universal Credit to be paid into your own bank account, or make your own claim."],
  housing: [
    "You can ask any council for help if you need to leave your home, not only the council where you live now.",
    "If you may be homeless in the next 8 weeks, ask the council for help now.",
  ],
  safety: [
    "If you are in danger, call 999. If you cannot speak, press 55 when asked.",
    "Use the 'Leave this page' button at the top if someone comes near.",
    "Only take information from this screen with you if it is safe to do so.",
  ],
  family: ["Keep any letters from the court somewhere safe. A free family law adviser can explain them."],
  immigration: [
    "If you can do it safely, keep a photo or copy of your passport and visa somewhere only you can reach.",
    "Do not ignore Home Office letters. Get free advice before the deadline.",
  ],
};

// One-line answers for when someone raises a new topic mid-conversation.
const TOPIC_TIPS = {
  money: "Free money and debt advice is available.",
  housing: "The council and housing charities can help, for free.",
  benefits: "Citizens Advice can help you check what benefits you can get.",
  safety: "There is free, private help, and you decide what happens next.",
  family: "There is free legal advice about children and family.",
  law: "There is free advice about the police and courts. What you do is always your choice.",
  immigration: "There is free advice about visas and immigration.",
  health: "If it is urgent, you can call NHS 111.",
};

const ORDER = ["safety", "housing", "money", "family", "law", "immigration", "benefits", "health", "other"];

function includesAny(text, words) {
  const t = ` ${text.toLowerCase()} `;
  return words.some((w) => new RegExp(`[^a-z]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?[^a-z]`).test(t));
}

export function detectTopics(text) {
  return Object.keys(KEYWORDS).filter((k) => includesAny(text, KEYWORDS[k]));
}

export function detectCues(text) {
  return CUES.filter((c) => includesAny(text, c.words)).map((c) => c.theme);
}

function noteCue(state, theme, evidence) {
  state.cues ??= [];
  if (!state.cues.some((c) => c.theme === theme)) state.cues.push({ theme, evidence });
}

export function detectRisk(text) {
  if (includesAny(text, IMMEDIATE)) return { level: "immediate", reason: "Words suggesting immediate danger or risk to life." };
  if (includesAny(text, CONCERN)) return { level: "concern", reason: "Words suggesting harm, threat or loss of home." };
  return { level: "none", reason: "" };
}

function maxRisk(a, b) {
  const rank = { none: 0, concern: 1, immediate: 2 };
  return rank[b.level] > rank[a.level] ? b : a;
}

function newState(session) {
  return { topics: [...(session?.topics ?? [])].filter((t) => QUESTIONS[t]), queue: [], answers: {}, asked: [], risk: { level: "none", reason: "" }, stage: "start", firstAidShown: [] };
}

// Asked once, after the topic questions and before "anything else", so the
// main problem is understood before moving on.
const GENERAL = [
  { key: "household", q: "Who lives with you?", options: ["I live alone", "My partner", "My children", "Other family or friends"] },
  { key: "tried", q: "Have you already asked anyone for help with this?", options: ["No, not yet", "Yes, the council", "Yes, a charity or advice service", "Yes, someone else"] },
  { key: "goal", q: "What would you most like to happen? You can say it in your own words.", options: [] },
  { key: "more", q: "Is there anything else about this that I should know? For example, a date, a letter, or something that makes it harder for you.", options: ["No, that's all about this"] },
];

function allUserText(state) {
  return [state.firstText ?? "", ...Object.values(state.answers)].join(" ");
}

function owesMoney(state) {
  const kind = state.answers["money.money_kind"] ?? "";
  if (/not in debt|don't owe|do not owe|no debt/i.test(allUserText(state))) return false;
  return /owe|debt/i.test(kind) || includesAny(allUserText(state), ["owe", "debt", "bailiff", "arrears", "council tax", "loan"]);
}

// One conversation starter per topic: what to say when calling the main service.
function newStarters(state) {
  state.startersGiven ??= [];
  const out = [];
  for (const t of state.topics) {
    const service = servicesForTopics([t])
      .filter((x) => x.kind === "national" && x.phone)
      .sort((a, b) => a.topics.length - b.topics.length)[0];
    if (!service || state.startersGiven.includes(service.id)) continue;
    state.startersGiven.push(service.id);
    const text = `Hello. I need help with ${TOPIC_LABELS[t].toLowerCase()}. I do not know where to start. Can you help me, please?`;
    out.push({ service_id: service.id, text, text_english: text });
  }
  return out;
}

function isQuestion(text) {
  return /\?\s*$/.test(text.trim()) || /^(how|what|where|who|why|when|can i|can you|could|should i|do i|is there)\b/i.test(text.trim());
}

function nextQuestion(state) {
  // A topic the person just raised comes first, then the rest in priority order.
  const order = state.focus ? [state.focus, ...ORDER.filter((t) => t !== state.focus)] : ORDER;
  const groups = order.filter((t) => state.topics.includes(t)).map((t) => [t, QUESTIONS[t]]);
  groups.push(["general", GENERAL]);
  for (const [topic, questions] of groups) {
    for (const q of questions) {
      const id = `${topic}.${q.key}`;
      if (state.asked.includes(id)) continue;
      if (q.when && !q.when(state)) continue;
      return { id, topic, ...q };
    }
  }
  return null;
}

function turn(state, reply, extra = {}) {
  return {
    result: {
      reply,
      reply_english: reply,
      user_message_english: extra.userEnglish ?? "",
      quick_replies: extra.quick_replies ?? [],
      concepts: extra.concepts ?? [],
      topics: state.topics.length ? state.topics : ["other"],
      risk: state.risk,
      first_aid: extra.first_aid ?? [],
      starters: newStarters(state),
      ready_for_referral: extra.ready ?? false,
    },
    state,
  };
}

// history: [{role, text}], demoState: opaque object the client sends back each turn.
export function demoTurn({ history, session, demoState }) {
  const state = demoState ?? newState(session);
  const last = [...history].reverse().find((m) => m.role === "user");
  const text = last?.text ?? "";

  // A new problem, or a question of their own, instead of an answer.
  const known = state.topics.length > 0;
  const mentioned = detectTopics(text);
  const newTopics = mentioned.filter((t) => !state.topics.includes(t));
  const asksQuestion = isQuestion(text);
  const currentTopic = state.stage === "asking" ? state.asked.at(-1)?.split(".")[0] : null;
  // Switch when they raise a different topic (new, or one with questions still to ask)
  // instead of answering about the current one.
  const switchTo =
    known && currentTopic && !mentioned.includes(currentTopic)
      ? mentioned.find((t) => newTopics.includes(t) || QUESTIONS[t]?.some((q) => !state.asked.includes(`${t}.${q.key}`)))
      : undefined;
  const changedTopic = Boolean(switchTo);

  // Record the answer to the question we asked last time. If they changed
  // topic instead, leave that question to come back to later.
  const pending = state.asked.at(-1);
  const pendingTopic = pending?.split(".")[0];
  if (pending && state.stage === "asking") {
    if (changedTopic || asksQuestion) state.asked.pop();
    else state.answers[pending] = text;
  }
  state.firstText ??= text;

  // Signs of abuse: in what they typed, and in answers they picked.
  for (const theme of detectCues(text)) noteCue(state, theme, `"${text}"`);
  const answerCue = pending && state.answers[pending] === text ? ANSWER_CUES[pending] : null;
  if (answerCue && answerCue[0].test(text)) noteCue(state, answerCue[1], `Answered "${text}" to: ${questionText(pending)}`);
  if (mentioned.includes("safety")) state.disclosure = "direct";
  if (pending === "safety.talk_ok" && /someone/i.test(text)) state.notPrivate = true;
  if (pending === "safety.high_risk" && /^yes/i.test(text.trim())) {
    state.highRisk = true;
    noteCue(state, "Strangling, choking or threats to kill", `Answered "Yes" to: ${questionText(pending)}`);
  }

  // Answer to the one gentle check-in question.
  let checkinAck = "";
  if (state.stage === "checkin") {
    state.stage = "asking";
    if (/^(yes|things are hard)/i.test(text.trim())) {
      state.disclosure = "direct";
      if (!state.topics.includes("safety")) state.topics.push("safety");
      state.focus = "safety";
      checkinAck = "Thank you for telling me. It is not your fault. There is free, private help, and you decide what happens next. ";
    } else {
      checkinAck = "That is OK. If you ever want to talk about it, there is free, private help. Let's carry on. ";
    }
  }
  if (asksQuestion) (state.questions ??= []).push(text);

  for (const t of newTopics) if (!state.topics.includes(t)) state.topics.push(t);
  let ack = "";
  if (changedTopic) {
    const previous = pendingTopic;
    state.focus = switchTo;
    const back = previous && previous !== "general" && TOPIC_LABELS[previous] ? ` Then we can come back to ${TOPIC_LABELS[previous].toLowerCase()}.` : "";
    ack = `You also need help with ${TOPIC_LABELS[switchTo].toLowerCase()}. ${TOPIC_TIPS[switchTo] ?? ""} Let me ask about that now.${back} `.replace(/ {2,}/g, " ");
  } else if (asksQuestion && known) {
    ack = "That is a good question. I will add it to your notes so a support worker can answer it. ";
  }
  if (pending === "safety.talk_ok" && state.notPrivate) {
    ack = "OK. We can keep this short. You can use the 'Leave this page' button at the top at any time. ";
  }
  ack = checkinAck + ack;
  state.risk = maxRisk(state.risk, detectRisk(text));
  if (pending === "safety.safe_now" && /^no\b/i.test(text.trim())) {
    state.risk = { level: "immediate", reason: "Person said they are not safe right now." };
  }
  if (pending === "housing.tonight" && /^no\b/i.test(text.trim())) {
    state.risk = maxRisk(state.risk, { level: "concern", reason: "No safe place to sleep tonight." });
  }

  // Explain each UK idea only once per conversation.
  state.conceptsShown ??= [];
  const concepts = findConceptsInText(text)
    .filter((c) => !state.conceptsShown.includes(c.id))
    .slice(0, 2)
    .map((c) => (state.conceptsShown.push(c.id), { term: c.term, explanation: `${c.plain} ${c.matters}` }));
  const firstAid = [];
  if (state.cues?.some((c) => c.theme === "Economic abuse") && !state.firstAidShown.includes("economic")) {
    firstAid.push(...FIRST_AID.economic);
    state.firstAidShown.push("economic");
  }
  for (const t of state.topics) {
    const relevant = t === "money" ? owesMoney(state) : t === "safety" || t === "housing" || t === "family" || t === "immigration";
    if (FIRST_AID[t] && !state.firstAidShown.includes(t) && relevant) {
      firstAid.push(...FIRST_AID[t]);
      state.firstAidShown.push(t);
    }
  }

  if (state.risk.level === "immediate" && !state.urgentShown) {
    state.urgentShown = true;
    const r = "This sounds very serious. If you or someone else is in danger now, call 999. If you feel you might hurt yourself, call Samaritans on 116 123. When you are ready, we can carry on.";
    state.stage = "asking";
    const q = nextQuestion(state);
    if (q) state.asked.push(q.id);
    return turn(state, q ? `${r} ${q.q}` : r, { quick_replies: q?.options ?? ["Carry on"], concepts, first_aid: firstAid.length ? firstAid : FIRST_AID.safety, userEnglish: text });
  }

  if (/^(finish|that's everything|that is everything|no, that's everything|show me where to get help)/i.test(text.trim()) && state.stage !== "start") {
    state.stage = "done";
    return turn(state, "Thank you. I have what I need. Here is where you can get help.", { ready: true, concepts, first_aid: firstAid, userEnglish: text });
  }

  if (state.stage === "anything_else") {
    if (/^(no|nothing)/i.test(text.trim())) {
      state.stage = "done";
      return turn(state, "Thank you. I have what I need. Here is where you can get help.", { ready: true, concepts, first_aid: firstAid, userEnglish: text });
    }
    if (/^yes\b/i.test(text.trim())) {
      return turn(state, "Please tell me about it. You can type, or tap the microphone and speak.", { concepts, userEnglish: text });
    }
    if (!state.topics.length) state.topics.push("other");
  }

  if (!state.topics.length && state.stage === "choose_topic") state.topics.push("other");

  if (!state.topics.length) {
    state.stage = "choose_topic";
    return turn(state, "Thank you for telling me. What is this mostly about?", {
      quick_replies: ["Home and housing", "Money and debt", "Children and family", "Police and the law", "Visas and immigration", "Health and feelings", "Worries at home"],
      concepts,
      userEnglish: text,
    });
  }

  if (/(don't|do not|dont) know what to say/i.test(text)) {
    return turn(state, "That is OK. Many people feel like this. In the help panel there are sentences you can read out or show when you call. You do not have to explain everything.", {
      concepts,
      first_aid: firstAid,
      userEnglish: text,
    });
  }

  if (/what (do|should|can) i do|what now|what happens now/i.test(text)) {
    state.stage = "anything_else";
    return turn(state, `I can show you where to get help now. Is there anything else you want to tell me first?`, {
      quick_replies: ["Show me where to get help", "Yes, there is something else"],
      concepts,
      first_aid: firstAid,
      userEnglish: text,
    });
  }

  // Signs of abuse she has not named: reflect without a label and ask once,
  // gently, in a way that is easy to decline. Never ask again.
  if (state.cues?.length && !state.checkinDone && state.disclosure !== "direct" && !state.topics.includes("safety")) {
    state.checkinDone = true;
    state.stage = "checkin";
    return turn(
      state,
      `${ack}Thank you for telling me. Some people tell me that problems like this are part of a bigger worry at home. Is anything like that happening for you? You do not have to answer.`,
      { quick_replies: ["Yes, things are hard at home", "No", "I'd rather not say"], concepts, first_aid: firstAid, userEnglish: text },
    );
  }

  const q = nextQuestion(state);
  if (q) {
    state.stage = "asking";
    state.asked.push(q.id);
    if (q.id === "safety.talk_ok" && !checkinAck) ack = `Thank you for telling me. It is not your fault. ${ack}`;
    else if (!ack && state.asked.length === 1) ack = "Thank you. I will ask a few short questions so I can find the right help. ";
    return turn(state, `${ack}${q.q}`, { quick_replies: q.options, concepts, first_aid: firstAid, userEnglish: text });
  }

  state.stage = "anything_else";
  return turn(state, "Thank you. Is anything else worrying you? Many people have more than one problem.", {
    quick_replies: ["No, that's everything", "Yes"],
    concepts,
    first_aid: firstAid,
    userEnglish: text,
  });
}

const GROUP_SPECIFIC = new Set(["mens-advice-line", "galop", "karma-nirvana", "forced-marriage-unit", "stalking-helpline", "southall-black-sisters", "migrant-help"]);

function questionText(id) {
  const [topic, key] = id.split(".");
  const q = (topic === "general" ? GENERAL : QUESTIONS[topic] ?? []).find((x) => x.key === key);
  return q ? `${q.q.split("?")[0]}?` : `${id}:`;
}

export function demoReport({ history, demoState }) {
  const state = demoState ?? newState();
  const topics = state.topics.length ? state.topics : ["other"];
  const userText = history.filter((m) => m.role === "user").map((m) => m.text).join(" ");
  const risk = state.risk;
  const hasDeadline = Object.entries(state.answers).some(([k, v]) => /deadline|notice|court_bailiffs/.test(k) && /^yes/i.test(v));
  const cues = state.cues ?? [];
  const disclosure = state.disclosure ?? (cues.length ? "indirect" : "none");
  const priority = risk.level === "immediate" ? "urgent" : risk.level === "concern" || hasDeadline || state.highRisk || disclosure === "direct" ? "high" : "standard";

  // Pick up to 1 national service per topic, plus the local hub, plus 999 if urgent.
  const chosen = [];
  if (risk.level === "immediate") chosen.push("emergency-999");
  if (disclosure !== "none") chosen.push("domestic-abuse-helpline");
  for (const t of topics) {
    if (t === "safety") continue; // covered by the National Domestic Abuse Helpline above
    // Prefer the most specialist service (fewest topics) for each need. Services
    // for particular groups are only offered by Claude, when they fit.
    const s = servicesForTopics([t])
      .filter((x) => x.kind === "national" && !chosen.includes(x.id) && !GROUP_SPECIFIC.has(x.id))
      .sort((a, b) => a.topics.length - b.topics.length)[0];
    if (s) chosen.push(s.id);
  }
  if (topics.length > 1 || priority !== "standard" || disclosure !== "none") chosen.push("local-da-service");
  if (!chosen.length) chosen.push("citizens-advice");
  const services = chosen.map((id) => servicesForTopics(topics, { urgent: true }).find((s) => s.id === id) ?? { id, what: "" });

  const labels = topics.map((t) => TOPIC_LABELS[t].toLowerCase());
  const concepts = findConceptsInText(userText);

  return {
    citizen: {
      summary: `You told us you need help with ${labels.join(" and ")}. ${hasDeadline ? "You have a letter with a deadline, so it is important to act soon. " : ""}${risk.level !== "none" ? "Your safety comes first. " : ""}Below is where you can get help.`,
      referrals: services.map((s) => ({
        service_id: s.id,
        why: s.what,
        what_to_say: `I was sent by TACSI. I need help with ${labels.join(" and ")}.${hasDeadline ? " I have a letter with a deadline." : ""}`,
        what_to_bring: hasDeadline ? ["Any letters you have got", "Your reference number from this screen"] : ["Your reference number from this screen"],
      })),
      do_now: [
        ...topics.filter((t) => t !== "safety").flatMap((t) => (FIRST_AID[t] ?? []).slice(0, 2)),
        ...(disclosure !== "none" ? ["Only take this information with you if it is safe to do so."] : []),
      ],
      dont: [],
      words_to_know: concepts.map((c) => ({ term: c.term, explanation: c.plain })),
    },
    staff: {
      headline: `${topics.map((t) => TOPIC_LABELS[t]).join(" + ")} - ${priority} priority (demo mode triage)`,
      priority,
      priority_reason: risk.level !== "none" ? risk.reason : hasDeadline ? "Person reports a letter with a deadline." : "No immediate risk or deadline reported.",
      triage_types: [topics.length > 1 ? "global" : "service-level", ...(state.firstAidShown.length ? ["first-aid"] : [])],
      presenting_issues: topics.map((t) => ({ topic: t, description: TOPIC_LABELS[t] })),
      key_facts: [
        ...(state.firstText ? [`In their own words: "${state.firstText}"`] : []),
        ...state.asked.filter((id) => id in state.answers && id !== "general.goal").map((id) => `${questionText(id)} ${state.answers[id]}`),
      ],
      deadlines: hasDeadline ? ["Person has a letter with a deadline - date not recorded."] : [],
      safeguarding_flags: risk.level !== "none" ? [risk.reason] : [],
      access_needs: ["Not assessed in demo mode - check language, reading and digital needs."],
      person_goals: state.answers["general.goal"] || "Not captured - ask the person what they want to happen.",
      unknowns: ["Exact dates on any letters", "Household make-up", "Income and benefits", "What the person has already tried"],
      recommended_actions: [
        ...(state.questions ?? []).map((q) => `Answer the person's question: "${q}"`),
        priority === "urgent" ? "Contact the person the same day. Follow your safeguarding procedure." : "Contact the person within your normal service standard.",
        ...(disclosure !== "none" ? ["Signs of domestic abuse: complete a full specialist risk assessment (for example the DASH risk checklist) with the person. Agree a safe way and time to contact them."] : []),
        ...(state.highRisk ? ["High-risk sign reported: consider a referral to an IDVA and to MARAC."] : []),
        "Confirm the facts above with the person, using an interpreter if needed.",
        ...(topics.length > 1 ? ["Coordinate referrals across services - several linked needs."] : []),
      ],
      referrals: chosen.map((id) => ({ service_id: id, rationale: "Rule-based match on topic (demo mode)." })),
      disclosure,
      risk_indicators: cues,
    },
  };
}
