// Simulated users: an AI plays a persona talking to the chatbot, one turn at a time.
// Personas describe who the user is. What a run should cover (conversations where
// the user asks for a human, gives up, or misreads a reply) is a test-design choice:
// the researcher sets a scenario mix per run, and each conversation's scenario is
// decided here in code and recorded, so it is known ground truth rather than
// something the AI may or may not do.

import { personaProfile } from "./personas.js";
import { IMPORTANCE, frameworkText } from "./framework.js";

export const SCENARIOS = {
  normal: "normal",
  asks_for_human: "asks for a human",
  gives_up: "gives up partway",
  misreads: "misreads a reply",
};

export function randomInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

// counts: { askHuman, giveUp, misread }; the rest of the conversations are normal.
// Returns one scenario per conversation, shuffled so they are spread across personas.
export function assignScenarios(total, counts = {}, rng = Math.random) {
  const list = [
    ...Array(counts.askHuman ?? 0).fill("asks_for_human"),
    ...Array(counts.giveUp ?? 0).fill("gives_up"),
    ...Array(counts.misread ?? 0).fill("misreads"),
  ];
  while (list.length < total) list.push("normal");
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, total);
}

// Decides up front how a simulated conversation will go. The simulated user ends
// the conversation when they are done, but never before minTurns user messages,
// never before the planned scenario has happened, and never after maxTurns.
export function planConversation(scenario, { minTurns, maxTurns }, rng = Math.random) {
  const turnLimit = maxTurns;
  const plan = { scenario, turnLimit, minTurns, giveUpAtTurn: null, askHumanAtTurn: null, misreadAtTurn: null };
  // Giving up means leaving before writing user message n (n >= 2), without a word.
  if (scenario === "gives_up") plan.giveUpAtTurn = randomInt(2, Math.max(2, turnLimit), rng);
  if (scenario === "asks_for_human") plan.askHumanAtTurn = randomInt(1, turnLimit, rng);
  // Misreading needs a bot reply to misread, so it happens in message 2 or later.
  if (scenario === "misreads") plan.misreadAtTurn = randomInt(2, Math.max(2, turnLimit), rng);
  return plan;
}

// The first user message at which the simulated user may choose to end.
export function mayEndFrom(plan) {
  return Math.max(
    (plan.minTurns ?? 1) + 1,
    plan.askHumanAtTurn ?? 0,
    plan.giveUpAtTurn ?? 0,
    plan.misreadAtTurn ? plan.misreadAtTurn + 1 : 0,
  );
}

function transcriptText(messages) {
  if (!messages.length) return "(The conversation has not started yet.)";
  return messages.map((m) => `${m.role === "user" ? "USER" : "CHATBOT"}: ${m.text}`).join("\n\n");
}

function excerpts(passages) {
  return passages.map((p, i) => `[${i + 1}] (${p.documentTitle}) ${p.text.slice(0, 700)}`).join("\n\n");
}

const TURN_SCHEMA = {
  type: "object",
  properties: {
    goal: { type: "string", description: "The user's goal in this conversation, in one sentence." },
    action: { type: "string", enum: ["send", "end"] },
    message: { type: "string", description: "The user's next message, exactly as they would type it. Empty if ending without a message." },
    end_reason: { type: "string", enum: ["none", "goal_met", "gave_up", "other"] },
  },
  required: ["goal", "action", "message", "end_reason"],
  additionalProperties: false,
};

export const SIMULATOR_SYSTEM = `You simulate a user of a chatbot, for research and testing by conversation designers.
Play the persona you are given, consistently, as a real person would: their knowledge, mood, writing style, spelling and message length.
You only ever write the user's messages, never the chatbot's. Do not mention that you are simulated, an AI, or a test.
Real users rarely write long, perfectly structured messages; match the persona instead.`;

// Writes the persona's next message (or decides to end). turnNo counts user messages, from 1.
export async function personaTurn(claude, { model, effort = "low", persona, framework, plan, goal, messages, turnNo, misunderstand, passages, insist = false }) {
  const instructions = [];
  if (turnNo === 1) {
    instructions.push(goal
      ? `Your goal in this conversation: ${goal}`
      : `Choose a realistic goal for this persona, something a person like this would want from this chatbot. Base it on the knowledge base excerpts below${persona.adversarial ? ", or on the adversarial aim in the persona" : ""}. Vary it: do not always pick the first topic.\n\nKnowledge base excerpts:\n${excerpts(passages)}`);
    instructions.push("Write the user's first message. Set action to \"send\".");
  } else {
    instructions.push(`Your goal: ${goal}`);
    instructions.push(`Write the user's message number ${turnNo}, responding to the chatbot's last reply.`);
    if (turnNo < mayEndFrom(plan)) instructions.push("Do not end the conversation yet: set action to \"send\".");
    else instructions.push("If your goal has been met, or you have nothing more to ask, you may end: set action to \"end\" and end_reason to \"goal_met\" (with a short closing message such as thanks, or an empty message if this person would just leave). Otherwise set action to \"send\".");
  }
  if (plan.askHumanAtTurn === turnNo) instructions.push("In this message, ask to speak to a human (a real person or member of staff), in this persona's own words. Set action to \"send\".");
  if (misunderstand) instructions.push("In this message, misunderstand or misread something in the chatbot's last reply, the way this persona plausibly might, and respond based on that misunderstanding. Do not say that you misunderstood.");
  if (insist) instructions.push("Important: the user does not leave yet. Write a real next message (not empty) and set action to \"send\".");
  if (persona.rapport && Object.keys(persona.rapport).length) {
    instructions.push("React to the chatbot's behaviour in line with this persona's rapport needs: when the chatbot meets or ignores a need that matters to them, show it the way this person would (for example warmer, more trusting, more curt, pushing back, or disengaging). Do not name the dimensions.");
  }
  instructions.push("Keep \"goal\" the same once chosen.");

  const prompt = `PERSONA\n${personaProfile(persona, framework)}\n\nCONVERSATION SO FAR\n${transcriptText(messages)}\n\nINSTRUCTIONS\n${instructions.join("\n")}`;
  const result = await claude.complete({ model, effort, system: SIMULATOR_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 1500, schema: TURN_SCHEMA });
  if (result.refused || !result.json) return { ...result, turn: { goal: goal || "", action: "end", message: "", end_reason: "other" } };
  return { ...result, turn: result.json };
}

// The rating schema adds one 1-5 perception per rapport dimension when a framework is in use.
function ratingSchema(framework) {
  const dims = framework?.dimensions ?? [];
  const schema = {
    type: "object",
    properties: {
      score: { type: "integer", enum: [1, 2, 3, 4, 5] },
      comment: { type: "string", description: "One or two sentences, in the persona's own voice." },
    },
    required: ["score", "comment"],
    additionalProperties: false,
  };
  if (dims.length) {
    schema.properties.rapport = {
      type: "object",
      properties: Object.fromEntries(dims.map((d) => [d.key, {
        type: "object",
        properties: {
          score: { type: "integer", enum: [1, 2, 3, 4, 5] },
          comment: { type: "string", description: `In the persona's own voice: how they experienced ${d.name}.` },
        },
        required: ["score", "comment"],
        additionalProperties: false,
      }])),
      required: dims.map((d) => d.key),
      additionalProperties: false,
    };
    schema.required.push("rapport");
  }
  return schema;
}

const OUTCOME_TEXT = {
  goal_met: "You ended the conversation because you got what you needed (or had nothing more to ask).",
  gave_up: "You gave up and left the conversation without finishing.",
  asked_for_human: "You asked to speak to a human.",
  max_turns: "The conversation stopped before you were finished.",
  other: "The conversation ended.",
};

// The end-of-chat satisfaction rating (CSAT, 1 to 5), given in character, plus, when the
// project uses a rapport framework, the persona's perception of each dimension.
export async function rateConversation(claude, { model, effort = "low", persona, framework, goal, messages, outcome }) {
  const dims = framework?.dimensions ?? [];
  const rapportAsk = dims.length
    ? `\n\nThen, for each of these aspects of rapport, say how this persona experienced the chatbot (1 = it clearly undermined this, 3 = neutral or mixed, 5 = it clearly supported this), with a short comment in their own voice. Base this on what actually happened in the conversation and on what matters to this persona.\n${dims.map((d) => `- ${d.key}: ${d.name}. ${d.definition}`).join("\n")}`
    : "";
  const prompt = `PERSONA\n${personaProfile(persona, framework)}\n\nYOUR GOAL\n${goal}\n\nCONVERSATION\n${transcriptText(messages)}\n\nHOW IT ENDED\n${OUTCOME_TEXT[outcome] ?? OUTCOME_TEXT.other}\n\nThe service now asks: "How satisfied were you with this conversation?" (1 = very dissatisfied, 5 = very satisfied). Answer as this persona honestly would, with a score and a short comment.${rapportAsk}`;
  const result = await claude.complete({ model, effort, system: SIMULATOR_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: dims.length ? 1500 : 600, schema: ratingSchema(framework) });
  const json = result.json ?? null;
  return { ...result, rating: json ? { score: json.score, comment: json.comment } : null, rapport: json?.rapport ?? null };
}

const QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          in_scope: { type: "boolean", description: "True if the knowledge base excerpts can answer it." },
        },
        required: ["text", "in_scope"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export async function generateQuestions(claude, { model, effort = "low", count, outOfScopePct, persona, framework, passages, avoid = [] }) {
  const outOfScope = Math.round((count * outOfScopePct) / 100);
  const prompt = [
    `Write ${count} different questions or requests that real users might send to a chatbot whose knowledge base includes the excerpts below.`,
    `${count - outOfScope} should be answerable from the excerpts (in_scope true) and ${outOfScope} should be plausible for this chatbot's users but NOT answerable from them (in_scope false).`,
    "Vary the topics, wording, length and difficulty. Write them as users actually type: not every one is a neat, complete question.",
    persona ? `Write them all as this persona would:\n${personaProfile(persona, framework)}` : "Write them as a mix of different kinds of users would.",
    avoid.length ? `Do not repeat these existing questions:\n${avoid.slice(-60).map((q) => `- ${q}`).join("\n")}` : "",
    `Knowledge base excerpts:\n${excerpts(passages)}`,
  ].filter(Boolean).join("\n\n");
  const result = await claude.complete({ model, effort, system: "You help conversation designers create realistic test inputs for chatbots.", messages: [{ role: "user", content: prompt }], maxTokens: 4000, schema: QUESTIONS_SCHEMA });
  return { ...result, questions: (result.json?.questions ?? []).map((q) => ({ text: String(q.text).trim(), inScope: Boolean(q.in_scope) })).filter((q) => q.text) };
}

// A persona's descriptive fields, plus a rapport profile for the project's framework.
function personaItemSchema(framework) {
  const dims = framework?.dimensions ?? [];
  const item = {
    type: "object",
    properties: {
      name: { type: "string", description: "A short label, e.g. 'Retired teacher with hearing loss'." },
      description: { type: "string" },
      goal: { type: "string", description: "Empty unless the source implies a specific goal." },
      communication_style: { type: "string" },
      language_background: { type: "string" },
      adversarial: { type: "boolean" },
    },
    required: ["name", "description", "goal", "communication_style", "language_background", "adversarial"],
    additionalProperties: false,
  };
  if (dims.length) {
    const dimProps = {
      importance: { type: "string", enum: [...IMPORTANCE, "unclear"], description: "How much this aspect of rapport matters to this user." },
      note: { type: "string", description: "What this user needs or reacts to on this dimension, in one or two sentences." },
    };
    item.properties.rapport = {
      type: "object",
      properties: Object.fromEntries(dims.map((d) => [d.key, { type: "object", properties: dimProps, required: Object.keys(dimProps), additionalProperties: false }])),
      required: dims.map((d) => d.key),
      additionalProperties: false,
    };
    item.required.push("rapport");
  }
  return item;
}

function personaFromJson(p) {
  return {
    name: p.name,
    description: p.description,
    goal: p.goal,
    communicationStyle: p.communication_style,
    languageBackground: p.language_background,
    adversarial: p.adversarial,
    rapport: Object.fromEntries(Object.entries(p.rapport ?? {}).map(([k, v]) => [k, { importance: v.importance === "unclear" ? "" : v.importance, note: v.note, ...(v.evidence ? { evidence: v.evidence } : {}) }])),
  };
}

const PERSONA_SYSTEM = "You help conversation designers and researchers create user personas for chatbot testing.";

function frameworkBlock(framework) {
  return framework?.dimensions?.length
    ? `Describe each persona's rapport needs using this framework (${framework.name}):\n${frameworkText(framework)}`
    : "";
}

export async function generatePersonas(claude, { model, effort = "low", brief, count, passages, framework }) {
  const prompt = [
    `Create ${count} distinct user personas for testing a chatbot, following this brief from a conversation designer:\n"${brief}"`,
    "Make them specific and realistic, and different from each other in background, needs and communication style. Avoid stereotypes.",
    frameworkBlock(framework),
    passages.length ? `The chatbot's knowledge base includes excerpts like these, which shows what it is for:\n${excerpts(passages)}` : "",
  ].filter(Boolean).join("\n\n");
  const schema = { type: "object", properties: { personas: { type: "array", items: personaItemSchema(framework) } }, required: ["personas"], additionalProperties: false };
  const result = await claude.complete({ model, effort, system: PERSONA_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 6000, schema });
  return { ...result, personas: (result.json?.personas ?? []).map(personaFromJson) };
}
