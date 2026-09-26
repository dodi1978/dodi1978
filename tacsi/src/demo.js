// Offline demo engine: a scripted, rule-based stand-in for the AI.
//
// It lets TACSI run with no API key (for workshops, focus groups and when the
// network is down). It speaks English only and follows fixed question paths,
// but it returns exactly the same shapes as the AI engine.

import { findConceptsInText } from "./knowledge/concepts.js";
import { servicesForTopics } from "./knowledge/services.js";

const KEYWORDS = {
  safety: ["hit", "hits", "hurt", "abuse", "violent", "violence", "scared of him", "scared of her", "afraid", "threat", "control", "controls", "beat", "partner", "husband", "wife", "boyfriend", "unsafe"],
  money: ["debt", "owe", "bill", "bills", "money", "bailiff", "loan", "credit card", "arrears", "council tax", "can't pay", "cannot pay", "energy", "food bank"],
  housing: ["landlord", "rent", "evict", "eviction", "homeless", "house", "flat", "housing", "mould", "damp", "repairs", "overcrowded", "section 21", "home"],
  education: ["school", "appeal", "ehcp", "ehc", "special needs", "teacher", "exclusion", "excluded", "nursery", "college"],
  immigration: ["visa", "asylum", "home office", "immigration", "refugee", "brp", "settled status", "passport", "no recourse", "deport"],
  health: ["health", "feelings", "ill", "sick", "doctor", "gp", "pain", "depressed", "depression", "anxious", "anxiety", "mental", "hospital", "medicine"],
  benefits: ["universal credit", "benefit", "benefits", "pip", "jobcentre", "sanction", "pension credit", "child benefit"],
  work: ["job", "work", "employer", "boss", "wages", "sacked", "fired", "hours"],
};

const IMMEDIATE = ["kill me", "kill myself", "end my life", "suicide", "going to kill", "he is here now", "she is here now", "bleeding", "can't breathe", "cannot breathe", "not safe now", "not safe tonight", "hurting me now", "take my own life"];
const CONCERN = ["hit", "hits", "hurt", "scared", "afraid", "threat", "bailiff", "homeless", "evict", "abuse", "no food", "sleeping rough", "controls"];

const TOPIC_LABELS = {
  housing: "Home and housing",
  money: "Money and debt",
  safety: "Feeling unsafe",
  education: "School and children",
  immigration: "Visas and immigration",
  health: "Health and feelings",
  benefits: "Benefits",
  work: "Work",
  other: "Something else",
};

// Question paths per topic. Each question has a key so answers can be used in the report.
const QUESTIONS = {
  safety: [
    { key: "safe_now", q: "Thank you for telling me. Are you safe right now?", options: ["Yes", "No", "I'm not sure"] },
    { key: "lives_with", q: "Does the person who hurts or scares you live with you?", options: ["Yes", "No", "I'd rather not say"] },
    { key: "children", q: "Are there children living with you?", options: ["Yes", "No"] },
  ],
  money: [
    { key: "owe_to", q: "Who do you owe money to? You can choose more than one by typing.", options: ["Council tax", "Rent", "Energy bills", "Loans or credit cards", "I'm not sure"] },
    { key: "court_bailiffs", q: "Has anyone sent a court letter, or said bailiffs will come?", options: ["Yes", "No", "I'm not sure"] },
    { key: "food_heat", q: "Do you have enough money for food and heating this week?", options: ["Yes", "No"] },
  ],
  housing: [
    { key: "tenure", q: "Do you rent your home, or own it?", options: ["I rent from a private landlord", "I rent from the council or housing association", "I own it", "I don't have a home"] },
    { key: "notice", q: "Have you had a letter asking you to leave your home?", options: ["Yes", "No", "I'm not sure"] },
    { key: "tonight", q: "Do you have somewhere safe to sleep tonight?", options: ["Yes", "No"] },
  ],
  education: [
    { key: "edu_issue", q: "Is this about a school place, extra help for special needs, or something else?", options: ["A school place or appeal", "Special needs or EHC plan", "My child was excluded", "Something else"] },
    { key: "deadline", q: "Do you have a letter with a date or a deadline on it?", options: ["Yes", "No", "I'm not sure"] },
    { key: "child_age", q: "How old is your child?", options: ["Under 5", "5 to 11", "11 to 16", "Over 16"] },
  ],
  immigration: [
    { key: "status", q: "Which is closest to your situation?", options: ["I have a visa", "I have claimed asylum", "I have settled or pre-settled status", "I'm not sure of my status"] },
    { key: "nrpf", q: "Does your visa or letter say 'no recourse to public funds'?", options: ["Yes", "No", "I'm not sure"] },
    { key: "deadline", q: "Do you have a letter from the Home Office with a deadline?", options: ["Yes", "No", "I'm not sure"] },
  ],
  health: [
    { key: "health_kind", q: "Is this about your body, your feelings, or both?", options: ["My body", "My feelings", "Both"] },
    { key: "gp", q: "Are you registered with a GP (a local doctor)?", options: ["Yes", "No", "I'm not sure"] },
  ],
  benefits: [
    { key: "on_benefits", q: "Do you get any benefits now, like Universal Credit?", options: ["Yes", "No", "I'm not sure"] },
    { key: "deadline", q: "Do you have a letter with a date or a deadline on it?", options: ["Yes", "No", "I'm not sure"] },
  ],
  work: [
    { key: "work_issue", q: "Is this about pay, losing your job, or how you are treated at work?", options: ["Pay", "Losing my job", "How I am treated", "Something else"] },
  ],
  other: [
    { key: "describe", q: "Can you tell me a bit more about what is happening? You can type or tap the microphone.", options: [] },
  ],
};

const FIRST_AID = {
  money: [
    "Do not open the door to bailiffs or debt collectors on their first visit. Do not let them in.",
    "Do not ignore letters. Keep them all in one place.",
    "Pay for your home, council tax and energy first, before other debts.",
  ],
  housing: [
    "Do not leave your home just because your landlord sent a letter. Only a court can make you leave.",
    "If you may be homeless in the next 8 weeks, ask the council for help now.",
  ],
  safety: [
    "If you are in danger, call 999. If you cannot speak, press 55 when asked.",
    "Use the 'Leave this page' button if someone comes near.",
  ],
  education: ["Check the date on your letter. School appeals usually have a deadline of 20 school days."],
  immigration: ["Do not ignore Home Office letters. Get free advice before the deadline."],
};

const ORDER = ["safety", "housing", "money", "immigration", "education", "benefits", "health", "work", "other"];

function includesAny(text, words) {
  const t = ` ${text.toLowerCase()} `;
  return words.some((w) => new RegExp(`[^a-z]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?[^a-z]`).test(t));
}

export function detectTopics(text) {
  return Object.keys(KEYWORDS).filter((k) => includesAny(text, KEYWORDS[k]));
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

function nextQuestion(state) {
  for (const topic of ORDER) {
    if (!state.topics.includes(topic)) continue;
    for (const q of QUESTIONS[topic]) {
      const id = `${topic}.${q.key}`;
      if (!state.asked.includes(id)) return { id, topic, ...q };
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

  // Record the answer to the question we asked last time.
  const pending = state.asked.at(-1);
  if (pending && state.stage === "asking") state.answers[pending] = text;

  for (const t of detectTopics(text)) if (!state.topics.includes(t)) state.topics.push(t);
  state.risk = maxRisk(state.risk, detectRisk(text));
  if (pending === "safety.safe_now" && /^no\b/i.test(text.trim())) {
    state.risk = { level: "immediate", reason: "Person said they are not safe right now." };
  }
  if (pending === "housing.tonight" && /^no\b/i.test(text.trim())) {
    state.risk = maxRisk(state.risk, { level: "concern", reason: "No safe place to sleep tonight." });
  }

  const concepts = findConceptsInText(text).slice(0, 2).map((c) => ({ term: c.term, explanation: `${c.plain} ${c.matters}` }));
  const firstAid = [];
  for (const t of state.topics) {
    if (FIRST_AID[t] && !state.firstAidShown.includes(t) && (state.risk.level !== "none" || t === "money" || t === "housing")) {
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
    if (/^yes$/i.test(text.trim())) {
      return turn(state, "Please tell me about it. You can type, or tap the microphone and speak.", { concepts, userEnglish: text });
    }
    if (!state.topics.length) state.topics.push("other");
  }

  if (!state.topics.length && state.stage === "choose_topic") state.topics.push("other");

  if (!state.topics.length) {
    state.stage = "choose_topic";
    return turn(state, "Thank you for telling me. What is this mostly about?", {
      quick_replies: ["Home and housing", "Money and debt", "Feeling unsafe", "School and children", "Visas and immigration", "Health and feelings"],
      concepts,
      userEnglish: text,
    });
  }

  const q = nextQuestion(state);
  if (q) {
    state.stage = "asking";
    state.asked.push(q.id);
    const ack = state.asked.length === 1 ? "Thank you. I will ask a few short questions so I can find the right help. " : "";
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

function answer(state, id) {
  return state.answers[id];
}

export function demoReport({ history, demoState }) {
  const state = demoState ?? newState();
  const topics = state.topics.length ? state.topics : ["other"];
  const userText = history.filter((m) => m.role === "user").map((m) => m.text).join(" ");
  const risk = state.risk;
  const hasDeadline = Object.entries(state.answers).some(([k, v]) => /deadline|notice|court_bailiffs/.test(k) && /^yes/i.test(v));
  const priority = risk.level === "immediate" ? "urgent" : risk.level === "concern" || hasDeadline ? "high" : "standard";

  // Pick up to 1 national service per topic, plus the local hub, plus 999 if urgent.
  const chosen = [];
  if (risk.level === "immediate") chosen.push("emergency-999");
  for (const t of topics) {
    // Prefer the most specialist service (fewest topics) for each need.
    const s = servicesForTopics([t])
      .filter((x) => x.kind === "national" && !chosen.includes(x.id))
      .sort((a, b) => a.topics.length - b.topics.length)[0];
    if (s) chosen.push(s.id);
  }
  if (topics.length > 1 || priority !== "standard") chosen.push("local-community-hub");
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
      do_now: topics.flatMap((t) => (FIRST_AID[t] ?? []).slice(0, 2)),
      dont: [],
      words_to_know: concepts.map((c) => ({ term: c.term, explanation: c.plain })),
    },
    staff: {
      headline: `${topics.map((t) => TOPIC_LABELS[t]).join(" + ")} - ${priority} priority (demo mode triage)`,
      priority,
      priority_reason: risk.level !== "none" ? risk.reason : hasDeadline ? "Person reports a letter with a deadline." : "No immediate risk or deadline reported.",
      triage_types: [topics.length > 1 ? "global" : "service-level", ...(state.firstAidShown.length ? ["first-aid"] : [])],
      presenting_issues: topics.map((t) => ({ topic: t, description: TOPIC_LABELS[t] })),
      key_facts: Object.entries(state.answers).map(([k, v]) => `${k}: ${v}`),
      deadlines: hasDeadline ? ["Person has a letter with a deadline - date not recorded."] : [],
      safeguarding_flags: risk.level !== "none" ? [risk.reason] : [],
      access_needs: ["Not assessed in demo mode - check language, reading and digital needs."],
      person_goals: "Not captured in demo mode - ask the person what they want to happen.",
      unknowns: ["Exact dates on any letters", "Household make-up", "Income and benefits", "What the person has already tried"],
      recommended_actions: [
        priority === "urgent" ? "Contact the person the same day. Follow your safeguarding procedure." : "Contact the person within your normal service standard.",
        "Confirm the facts above with the person, using an interpreter if needed.",
        ...(topics.length > 1 ? ["Coordinate referrals across services - several linked needs."] : []),
      ],
      referrals: chosen.map((id) => ({ service_id: id, rationale: "Rule-based match on topic (demo mode)." })),
    },
  };
}
