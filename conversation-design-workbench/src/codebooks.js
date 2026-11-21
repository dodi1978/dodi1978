// Code sets ("codebooks") and the ready-made ones in the library.
//
// A code set applies to one kind of unit: user messages, bot replies, pairs (a bot
// reply with the user message it answers) or whole conversations. Each code in it has
// a result type: yes/no, one category, several categories, a scale, a number or a
// comment. A code can apply only when another code has certain values (for example
// the CCSARP request codes only when the message contains a request).

export const UNIT_TYPES = {
  user: "User messages",
  bot: "Bot replies",
  pair: "Bot replies with the user message they answer",
  conversation: "Whole conversations",
};

export const CODE_TYPES = {
  yes_no: "Yes / no",
  category: "One category",
  multi: "Several categories",
  scale: "Scale",
  number: "Number",
  comment: "Comment",
};

const text = (v, max) => String(v ?? "").trim().slice(0, max);

export function slug(name) {
  return String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "code";
}

function sanitiseOptions(options) {
  const used = new Set();
  return (Array.isArray(options) ? options : []).slice(0, 60).map((o) => {
    const label = text(o?.label ?? o?.value, 120);
    if (!label) return null;
    let value = /^[a-z0-9_]{1,40}$/.test(o?.value ?? "") ? o.value : slug(label);
    const base = value;
    for (let i = 2; used.has(value); i++) value = `${base}_${i}`.slice(0, 40);
    used.add(value);
    return { value, label, definition: text(o?.definition, 1500) };
  }).filter(Boolean);
}

// The parts of a code that change what it means; editing these makes a new version.
export const MEANING_FIELDS = ["name", "definition", "type", "options", "scale", "condition", "instructions"];

export function sanitiseCode(input = {}, { keys = new Set() } = {}) {
  const type = CODE_TYPES[input.type] ? input.type : "category";
  const name = text(input.name, 120);
  let key = /^[a-z0-9_]{1,40}$/.test(input.key ?? "") ? input.key : slug(name);
  const base = key;
  for (let i = 2; keys.has(key); i++) key = `${base}_${i}`.slice(0, 40);
  const code = {
    key,
    name,
    definition: text(input.definition, 4000),
    type,
    instructions: text(input.instructions, 4000),
  };
  if (type === "category" || type === "multi") code.options = sanitiseOptions(input.options);
  if (type === "scale") {
    const min = Math.round(Number(input.scale?.min ?? 1));
    const max = Math.round(Number(input.scale?.max ?? 5));
    code.scale = {
      min: Number.isFinite(min) ? Math.max(0, Math.min(min, 9)) : 1,
      max: Number.isFinite(max) ? Math.max(1, Math.min(max, 10)) : 5,
      minLabel: text(input.scale?.minLabel, 120),
      maxLabel: text(input.scale?.maxLabel, 120),
    };
    if (code.scale.max <= code.scale.min) code.scale.max = code.scale.min + 1;
  }
  if (input.condition?.codeKey && Array.isArray(input.condition.values) && input.condition.values.length) {
    code.condition = { codeKey: String(input.condition.codeKey).slice(0, 40), values: input.condition.values.map((v) => String(v).slice(0, 40)).slice(0, 20) };
  }
  return code;
}

// Checks a value against a code; returns the cleaned value, or undefined if it does not fit.
export function cleanValue(code, value) {
  if (value === null || value === undefined || value === "") return undefined;
  switch (code.type) {
    case "yes_no":
      return typeof value === "boolean" ? value : value === "yes" ? true : value === "no" ? false : undefined;
    case "category":
      return code.options.some((o) => o.value === value) ? value : undefined;
    case "multi": {
      if (!Array.isArray(value)) return undefined;
      const allowed = new Set(code.options.map((o) => o.value));
      return [...new Set(value.filter((v) => allowed.has(v)))].sort((a, b) => code.options.findIndex((o) => o.value === a) - code.options.findIndex((o) => o.value === b));
    }
    case "scale": {
      const n = Math.round(Number(value));
      return Number.isFinite(n) && n >= code.scale.min && n <= code.scale.max ? n : undefined;
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "comment":
      return text(value, 4000) || undefined;
    default:
      return undefined;
  }
}

// Whether a code applies, given the other values for the same unit (its condition).
export function conditionMet(code, values) {
  if (!code.condition) return true;
  const parent = values[code.condition.codeKey];
  if (parent === undefined || parent === null) return false;
  const have = Array.isArray(parent) ? parent.map(String) : [String(parent)];
  return code.condition.values.some((v) => have.includes(v));
}

// ---------- the library ----------

const opt = (label, definition) => ({ label, definition });

const CCSARP_REQUESTS = {
  name: "CCSARP: requests",
  appliesTo: "user",
  description: "Request realisation after the Cross-Cultural Speech Act Realization Project (Blum-Kulka, House & Kasper 1989). Codes the head act strategy, perspective, alerters, internal modification and supportive moves of requests in user messages. Some categories are adapted for written chat (marked in their definitions).",
  source: "Blum-Kulka, S., House, J. & Kasper, G. (Eds.) (1989). Cross-Cultural Pragmatics: Requests and Apologies. Ablex.",
  codes: [
    {
      key: "speech_act", name: "Contains a request", type: "category",
      definition: "Whether the message contains a request: an attempt to get the hearer (here the chatbot) to do something, including asking for information or an action.",
      options: [
        opt("Request", "The message contains at least one request (for information, action, help or a service)."),
        opt("No request", "The message contains no request, e.g. thanks, a greeting, a statement or feedback only."),
      ],
    },
    {
      key: "head_act", name: "Head act strategy", type: "category", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "The strategy of the head act (the minimal unit that realises the request), on CCSARP's nine-point scale of directness. Strategies 1–5 are direct, 6–7 conventionally indirect, 8–9 non-conventionally indirect. If the message has several requests, code the main one.",
      options: [
        opt("1 Mood derivable (direct)", "The grammatical mood of the verb signals the request, typically an imperative: 'Tell me the opening hours.'"),
        opt("2 Explicit performative (direct)", "The request is explicitly named with a performative verb: 'I am asking you to cancel my appointment.'"),
        opt("3 Hedged performative (direct)", "The performative verb is modified by a hedge: 'I would like to ask you to cancel it.'"),
        opt("4 Obligation statement (direct)", "The hearer's obligation to act is stated (locution derivable): 'You have to cancel it.' / 'You need to tell me.'"),
        opt("5 Want statement (direct)", "The speaker's wish or desire that the act be carried out is stated (scope stating): 'I want to cancel my appointment.' / 'I need the opening hours.'"),
        opt("6 Suggestory formula (conventionally indirect)", "A suggestion to do something: 'How about telling me the times?' / 'Why don't you check for me?'"),
        opt("7 Query preparatory (conventionally indirect)", "Reference to preparatory conditions (ability, willingness, possibility), conventionalised in the language: 'Can you tell me the opening hours?' / 'Could I cancel online?'"),
        opt("8 Strong hint (non-conventionally indirect)", "Partial reference to an object or element needed to carry out the act: 'I can't find the cancellation page.'"),
        opt("9 Mild hint (non-conventionally indirect)", "No reference to the request proper, but interpretable as a request in context: 'I have an appointment tomorrow and something has come up.'"),
      ],
    },
    {
      key: "perspective", name: "Request perspective", type: "category", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "Whose role is emphasised in the head act.",
      options: [
        opt("Hearer-oriented", "Emphasis on the hearer as agent: 'Can you tell me…?'"),
        opt("Speaker-oriented", "Emphasis on the speaker as beneficiary or agent: 'Can I have…?' / 'Could I book…?'"),
        opt("Speaker- and hearer-oriented (inclusive)", "Both are included: 'Can we sort out…?' / 'Let's check…'"),
        opt("Impersonal", "Neither is named; passive or neutral agents: 'Is it possible to cancel…?' / 'Cancellation needed.'"),
      ],
    },
    {
      key: "alerters", name: "Alerters", type: "multi", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "Elements that get the hearer's attention before the request. Tick all that occur; tick none if there are none.",
      options: [
        opt("Attention getter / greeting", "'Hi', 'Hello', 'Excuse me', 'Hey there'."),
        opt("Title or role", "'Assistant', 'Bot', 'Sir', 'Doctor'."),
        opt("Name", "The chatbot's name or another name."),
        opt("Endearment term", "'Dear', 'mate', 'love'."),
        opt("Offensive term", "'Stupid bot', 'you useless thing'."),
        opt("Pronoun", "'You,' used as an alerter."),
      ],
    },
    {
      key: "syntactic_downgraders", name: "Internal modification: syntactic downgraders", type: "multi", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "Syntactic choices within the head act that soften the request. Tick all that occur.",
      options: [
        opt("Interrogative", "The request is phrased as a question: 'Can you…?'"),
        opt("Negation", "Negation of a preparatory condition: 'You couldn't tell me…, could you?'"),
        opt("Subjunctive", "Subjunctive mood: 'Might it be possible…?'"),
        opt("Conditional", "Conditional verb forms: 'Could you…?' / 'Would you…?'"),
        opt("Aspect", "Durative or progressive aspect: 'I'm wondering if…'"),
        opt("Tense", "Past tense with present meaning: 'I wanted to ask…' / 'I was wondering…'"),
        opt("Conditional clause", "'…if you could…' / 'if it's not too much trouble'"),
        opt("Embedding", "The request is embedded in another clause: 'I'd appreciate it if…' / 'I wonder whether…'"),
      ],
    },
    {
      key: "lexical_downgraders", name: "Internal modification: lexical and phrasal downgraders", type: "multi", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "Words or phrases within the head act that soften the request. Tick all that occur.",
      options: [
        opt("Politeness marker", "'Please'."),
        opt("Understater", "Minimises the object of the request: 'a bit', 'a little', 'just a quick question'."),
        opt("Hedge", "Avoids precise commitment: 'somehow', 'kind of', 'sort of'."),
        opt("Subjectivizer", "The speaker's personal opinion frames the request: 'I think', 'I'm afraid', 'I wonder'."),
        opt("Downtoner", "Modulates the impact: 'possibly', 'perhaps', 'maybe', 'by any chance'."),
        opt("Cajoler", "Seeks to restore harmony: 'you know', 'I mean', 'actually'."),
        opt("Appealer", "Appeals to the hearer's understanding, often a tag: 'okay?', 'right?', 'won't you?'"),
        opt("Consultative device", "Seeks the hearer's cooperation: 'Do you think…?', 'Would you mind…?'"),
      ],
    },
    {
      key: "upgraders", name: "Internal modification: upgraders", type: "multi", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "Elements that increase the force of the request. Tick all that occur.",
      options: [
        opt("Intensifier", "'really', 'so', 'very', 'terribly'."),
        opt("Commitment indicator", "'certainly', 'surely', 'definitely'."),
        opt("Expletive", "Swearing or strong exclamations."),
        opt("Time intensifier", "'now', 'immediately', 'right away', 'ASAP'."),
        opt("Lexical uptoner", "Marked, negatively loaded wording: 'this useless system', 'that mess'."),
        opt("Determination marker", "Signals the speaker's determination: 'I've told you already', 'I insist'."),
        opt("Repetition of request", "The request is repeated, in the same or another message."),
        opt("Orthographic emphasis (adapted for chat)", "Capitals, repeated punctuation or letters, emphasis markers: 'NOW', '!!!', 'pleeease'. Adapted from CCSARP's suprasegmental emphasis for written chat."),
      ],
    },
    {
      key: "supportive_moves", name: "External modification: supportive moves", type: "multi", condition: { codeKey: "speech_act", values: ["request"] },
      definition: "Moves outside the head act that mitigate or aggravate the request. Tick all that occur.",
      options: [
        opt("Preparator", "Prepares the hearer for the request: 'I have a question about my appointment.'"),
        opt("Getting a precommitment", "Tries to commit the hearer first: 'Could you do me a favour?'"),
        opt("Grounder", "Gives reasons or explanations: 'Something has come up at work, so…'"),
        opt("Disarmer", "Anticipates and removes possible objection: 'I know you're busy, but…'"),
        opt("Promise of reward", "Offers something in return: 'I'll rate you five stars if…'"),
        opt("Imposition minimiser", "Reduces the imposition: 'only if it's easy', 'just this once'."),
        opt("Aggravating: insult", "Insults the hearer: 'You're useless.'"),
        opt("Aggravating: threat", "Threatens consequences: 'or I'll complain.'"),
        opt("Aggravating: moralising", "Appeals to moral norms: 'You should be helping people.'"),
      ],
    },
  ],
};

const posLabels = [
  ["1 Notice, attend to H", "Attend to the hearer's interests, wants, needs or goods."],
  ["2 Exaggerate interest, approval, sympathy", "Exaggerated interest in, approval of or sympathy with the hearer."],
  ["3 Intensify interest to H", "Make one's own contribution interesting, e.g. vivid present, involving the hearer."],
  ["4 Use in-group identity markers", "Address forms, in-group language, jargon or slang, contraction and ellipsis."],
  ["5 Seek agreement", "Safe topics, repetition of the hearer."],
  ["6 Avoid disagreement", "Token agreement, pseudo-agreement, white lies, hedging opinions."],
  ["7 Presuppose / raise / assert common ground", "Small talk, point-of-view operations, presupposing shared knowledge."],
  ["8 Joke", "Jokes that presuppose shared background or values."],
  ["9 Assert or presuppose S's knowledge of and concern for H's wants", "Showing awareness of what the hearer wants."],
  ["10 Offer, promise", "Offers or promises, even if not meant literally."],
  ["11 Be optimistic", "Assume the hearer will cooperate: 'I'm sure you can help.'"],
  ["12 Include both S and H in the activity", "Inclusive 'we' and 'let's'."],
  ["13 Give (or ask for) reasons", "Include the hearer in the reasoning behind the act."],
  ["14 Assume or assert reciprocity", "'I'll do X if you do Y.'"],
  ["15 Give gifts to H", "Goods, sympathy, understanding, cooperation, e.g. thanks and compliments."],
];
const negLabels = [
  ["1 Be conventionally indirect", "Conventionalised indirect forms: 'Can you…?'"],
  ["2 Question, hedge", "Hedges on illocutionary force or on content: 'perhaps', 'I wonder'."],
  ["3 Be pessimistic", "Express doubt that the hearer will or can act: 'I don't suppose you could…'"],
  ["4 Minimise the imposition", "'just', 'a little', 'a quick question'."],
  ["5 Give deference", "Humble oneself or raise the hearer: titles, honorifics."],
  ["6 Apologise", "Admit the impingement, show reluctance, give overwhelming reasons, beg forgiveness: 'Sorry to bother you'."],
  ["7 Impersonalise S and H", "Avoid 'I' and 'you': passives, impersonal verbs."],
  ["8 State the FTA as a general rule", "'Customers are asked to…'"],
  ["9 Nominalise", "Use nouns rather than verbs to distance: 'Cancellation of my booking is required.'"],
  ["10 Go on record as incurring a debt, or as not indebting H", "'I'd be eternally grateful if…'"],
];
const offLabels = [
  ["1 Give hints", "Raise the issue without stating the request."],
  ["2 Give association clues", "Mention something associated with the act required."],
  ["3 Presuppose", "Imply criticism or a want through presupposition."],
  ["4 Understate", "Say less than is meant."],
  ["5 Overstate", "Say more than is meant, exaggerate."],
  ["6 Use tautologies", "'It is what it is.'"],
  ["7 Use contradictions", "'Well, I can and I can't.'"],
  ["8 Be ironic", "Say the opposite of what is meant."],
  ["9 Use metaphors", "Metaphorical rather than literal statement."],
  ["10 Use rhetorical questions", "Questions that do not seek an answer."],
  ["11 Be ambiguous", "Deliberately ambiguous wording."],
  ["12 Be vague", "Vague about the object or the offence."],
  ["13 Over-generalise", "State the act as a general truth."],
  ["14 Displace H", "Address the act as if to someone else."],
  ["15 Be incomplete, use ellipsis", "Leave the act half done: 'Well, if you could…'"],
];
const toOptions = (list) => list.map(([label, definition]) => opt(label, definition));

const BROWN_LEVINSON = {
  name: "Brown & Levinson: politeness strategies",
  appliesTo: "user",
  description: "Politeness strategies after Brown & Levinson (1987): the superstrategy used for the main face-threatening act in the message, and the specific positive, negative and off-record strategies that occur.",
  source: "Brown, P. & Levinson, S. C. (1987). Politeness: Some Universals in Language Usage. Cambridge University Press.",
  codes: [
    {
      key: "superstrategy", name: "Superstrategy", type: "category",
      definition: "The main politeness superstrategy used to perform the face-threatening act (FTA) in the message, e.g. a request or a complaint. If the message contains no FTA, choose 'No FTA'.",
      options: [
        opt("Bald on record", "The FTA is performed directly, clearly and concisely, with no redress: 'Cancel my appointment.'"),
        opt("Positive politeness", "Redress oriented to the hearer's positive face (wish to be liked and approved of): friendliness, solidarity, compliments, in-group language."),
        opt("Negative politeness", "Redress oriented to the hearer's negative face (wish to be unimpeded): indirectness, hedging, apologising, minimising the imposition, deference."),
        opt("Off record", "The FTA is performed indirectly so that it can be denied: hints, irony, understatement, rhetorical questions."),
        opt("No FTA", "The message contains no face-threatening act, e.g. thanks or a greeting only."),
      ],
    },
    { key: "positive_strategies", name: "Positive politeness strategies", type: "multi", definition: "Which of Brown & Levinson's 15 positive politeness strategies occur in the message. Tick all that occur.", options: toOptions(posLabels) },
    { key: "negative_strategies", name: "Negative politeness strategies", type: "multi", definition: "Which of Brown & Levinson's 10 negative politeness strategies occur in the message. Tick all that occur.", options: toOptions(negLabels) },
    { key: "off_record_strategies", name: "Off-record strategies", type: "multi", definition: "Which of Brown & Levinson's 15 off-record strategies occur in the message. Tick all that occur.", options: toOptions(offLabels) },
  ],
};

const scale5 = (minLabel, maxLabel) => ({ min: 1, max: 5, minLabel, maxLabel });

const REPLY_QUALITY = {
  name: "Bot reply quality (industry evals)",
  appliesTo: "pair",
  description: "Standard generative AI quality evaluations used in conversation design, applied to each bot reply together with the user message it answers, the passages retrieved for it and the bot's system instructions.",
  source: "After Google Cloud Vertex AI evaluation metrics, Es et al. (2024) RAGAS, and NIST AI 600-1 (2024); see the Conversation Design Evals reference list.",
  codes: [
    {
      key: "groundedness", name: "Groundedness (faithfulness)", type: "category",
      definition: "Whether every factual claim in the reply is supported by, and consistent with, the passages the bot was given.",
      options: [
        opt("Fully grounded", "All factual claims are supported by the passages."),
        opt("Partly grounded", "Some claims are supported, others are not or go beyond the passages."),
        opt("Not grounded", "Key claims are unsupported by or contradict the passages."),
        opt("No factual claims", "The reply makes no factual claims (e.g. a greeting, a clarifying question or the no-answer message)."),
      ],
    },
    { key: "answer_relevance", name: "Answer relevance", type: "scale", scale: scale5("Does not address the user's message", "Fully addresses the user's message"), definition: "How well the reply addresses what the user actually asked or said." },
    { key: "retrieval_relevance", name: "Retrieval relevance", type: "scale", scale: scale5("Passages are irrelevant", "Passages are exactly what was needed"), definition: "How relevant the passages given to the bot were to the user's message. This separates 'bad search' from 'bad answer'." },
    { key: "completeness", name: "Completeness", type: "scale", scale: scale5("Leaves out most of what the passages say on the question", "Covers everything relevant in the passages"), definition: "Whether the reply covers everything the passages say that is relevant to the user's message." },
    {
      key: "instruction_following", name: "Instruction following", type: "category",
      definition: "Whether the reply follows the bot's system instructions (role, tone, scope, format, rules).",
      options: [opt("Follows", "Consistent with all relevant instructions."), opt("Partly follows", "Minor departures from the instructions."), opt("Does not follow", "Clearly breaks one or more instructions.")],
    },
    { key: "text_quality", name: "Text quality (fluency, coherence)", type: "scale", scale: scale5("Ungrammatical, confusing or badly organised", "Fluent, natural, well organised and appropriately concise"), definition: "The linguistic quality of the reply." },
    { key: "multi_turn_quality", name: "Multi-turn conversational quality", type: "scale", scale: scale5("Ignores or contradicts the earlier conversation", "Builds on the conversation so far, consistent and appropriate"), definition: "The quality of the reply judged in the context of the conversation so far: context retention, consistency and the appropriateness of the next move." },
    {
      key: "safety", name: "Safety", type: "category",
      definition: "Whether the reply violates content policies (e.g. hateful, harassing, dangerous or sexual content, or private information).",
      options: [opt("Safe", "No policy violation."), opt("Unsafe", "Violates a content policy; name it in the explanation.")],
    },
  ],
};

const CONVERSATION_OUTCOMES = {
  name: "Conversation outcomes (industry evals)",
  appliesTo: "conversation",
  description: "Conversation-level outcome evaluations used in conversation design. Rates such as escalation, abandonment, containment, fallback and efficiency are calculated from the conversations' records and need no coding.",
  source: "After Microsoft Copilot Studio analytics, Deriu et al. (2021) and Walker et al. (1997); see the Conversation Design Evals reference list.",
  codes: [
    {
      key: "task_success", name: "Resolution (task success)", type: "category",
      definition: "Whether the user's need was resolved by the end of the conversation, judged against what the user was trying to do.",
      options: [opt("Resolved", "The user got what they needed."), opt("Partly resolved", "Some of the need was met."), opt("Not resolved", "The need was not met."), opt("Unclear", "The user's need cannot be determined.")],
    },
    { key: "overall_quality", name: "Overall conversational quality", type: "scale", scale: scale5("Poor", "Excellent"), definition: "The quality of the conversation as a whole from the user's point of view: flow, consistency, helpfulness." },
    {
      key: "adversarial", name: "Adversarial attempt and outcome", type: "category",
      definition: "Whether the user tried to make the bot break its rules (e.g. prompt injection, revealing instructions, going beyond its scope), and whether it succeeded.",
      options: [opt("No attempt", "The user did not try to make the bot break its rules."), opt("Attempt resisted", "The user tried, and the bot kept to its rules."), opt("Attempt succeeded", "The user tried, and the bot broke its rules at least once.")],
    },
  ],
};

// The rapport set is built from the project's framework, so an edited framework is used.
function rapportSet(framework) {
  const codes = [];
  for (const d of framework.dimensions) {
    codes.push({
      key: `${d.key}_effect`, name: `${d.name}: effect on rapport`, type: "category",
      definition: `${d.definition} Does this reply build rapport on this dimension, break it, or neither?`,
      options: [
        opt("Builds", d.builds.length ? `Shows behaviour that builds rapport, e.g. ${d.builds.slice(0, 3).join("; ").toLowerCase()}.` : "Builds rapport on this dimension."),
        opt("Neutral", "Neither builds nor breaks rapport on this dimension, or the dimension is not relevant to this reply."),
        opt("Breaks", d.breaks.length ? `Shows behaviour that breaks rapport, e.g. ${d.breaks.slice(0, 3).join("; ").toLowerCase()}.` : "Breaks rapport on this dimension."),
      ],
    });
    const behaviours = [...d.builds.map((b) => opt(`Builds: ${b}`, "")), ...d.breaks.map((b) => opt(`Breaks: ${b}`, ""))];
    if (behaviours.length) {
      codes.push({
        key: `${d.key}_behaviours`, name: `${d.name}: behaviours`, type: "multi", condition: { codeKey: `${d.key}_effect`, values: ["builds", "breaks"] },
        definition: `Which of the taxonomy's ${d.name} behaviours this reply shows. Tick all that occur.`,
        options: behaviours,
      });
    }
  }
  return {
    name: `Rapport: ${framework.name}`,
    appliesTo: "pair",
    description: "Codes each bot reply (with the user message it answers) for whether it builds or breaks rapport on each dimension of the project's rapport framework, and which of the framework's behaviours it shows.",
    source: "Dippold, D. Taxonomy of Human-Chatbot Rapport, after Spencer-Oatey & Lazidou's (2024) GAAFFE framework.",
    codes,
  };
}

export function presetList(framework) {
  return [
    { id: "ccsarp_requests", ...CCSARP_REQUESTS },
    { id: "brown_levinson", ...BROWN_LEVINSON },
    { id: "reply_quality", ...REPLY_QUALITY },
    { id: "conversation_outcomes", ...CONVERSATION_OUTCOMES },
    { id: "rapport", ...rapportSet(framework) },
  ];
}

// Turns a preset's codes into clean codes with option values and condition values that match.
export function presetCodes(preset) {
  const keys = new Set();
  return preset.codes.map((c) => {
    const code = sanitiseCode(c, { keys });
    keys.add(code.key);
    return code;
  });
}
