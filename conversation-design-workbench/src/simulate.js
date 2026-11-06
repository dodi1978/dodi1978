// Simulated users: an AI plays a persona talking to the chatbot, one turn at a time.
// Behaviour that researchers need to control (giving up, asking for a human,
// misunderstanding) is decided here in code and recorded, so it is known
// ground truth rather than something the AI may or may not do.

import { personaProfile } from "./personas.js";

export function randomInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Decides up front how a simulated conversation will go. The simulated user ends
// the conversation when they are done, but never before minTurns and never after
// maxTurns user messages.
export function planConversation(persona, { minTurns, maxTurns }, rng = Math.random) {
  const turnLimit = maxTurns;
  const b = persona.behaviour ?? {};
  const plan = { turnLimit, minTurns, giveUpAtTurn: null, askHumanAtTurn: null, misunderstandPct: b.misunderstandPct ?? 0 };
  // Giving up means leaving before writing user message n (n >= 2), without a word.
  if (turnLimit >= 2 && rng() * 100 < (b.giveUpPct ?? 0)) plan.giveUpAtTurn = randomInt(2, turnLimit, rng);
  else if (rng() * 100 < (b.askHumanPct ?? 0)) plan.askHumanAtTurn = randomInt(1, turnLimit, rng);
  return plan;
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
export async function personaTurn(claude, { model, effort = "low", persona, plan, goal, messages, turnNo, misunderstand, passages }) {
  const instructions = [];
  if (turnNo === 1) {
    instructions.push(goal
      ? `Your goal in this conversation: ${goal}`
      : `Choose a realistic goal for this persona, something a person like this would want from this chatbot. Base it on the knowledge base excerpts below${persona.adversarial ? ", or on the adversarial aim in the persona" : ""}. Vary it: do not always pick the first topic.\n\nKnowledge base excerpts:\n${excerpts(passages)}`);
    instructions.push("Write the user's first message. Set action to \"send\".");
  } else {
    instructions.push(`Your goal: ${goal}`);
    instructions.push(`Write the user's message number ${turnNo}, responding to the chatbot's last reply.`);
    if (turnNo <= plan.minTurns) instructions.push("Do not end the conversation yet: set action to \"send\".");
    else instructions.push("If your goal has been met, or you have nothing more to ask, you may end: set action to \"end\" and end_reason to \"goal_met\" (with a short closing message such as thanks, or an empty message if this person would just leave). Otherwise set action to \"send\".");
  }
  if (plan.askHumanAtTurn === turnNo) instructions.push("In this message, ask to speak to a human (a real person or member of staff), in this persona's own words. Set action to \"send\".");
  if (misunderstand) instructions.push("In this message, misunderstand or misread something in the chatbot's last reply, the way this persona plausibly might, and respond based on that misunderstanding. Do not say that you misunderstood.");
  instructions.push("Keep \"goal\" the same once chosen.");

  const prompt = `PERSONA\n${personaProfile(persona)}\n\nCONVERSATION SO FAR\n${transcriptText(messages)}\n\nINSTRUCTIONS\n${instructions.join("\n")}`;
  const result = await claude.complete({ model, effort, system: SIMULATOR_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 1500, schema: TURN_SCHEMA });
  if (result.refused || !result.json) return { ...result, turn: { goal: goal || "", action: "end", message: "", end_reason: "other" } };
  return { ...result, turn: result.json };
}

const RATING_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", enum: [1, 2, 3, 4, 5] },
    comment: { type: "string", description: "One or two sentences, in the persona's own voice." },
  },
  required: ["score", "comment"],
  additionalProperties: false,
};

const OUTCOME_TEXT = {
  goal_met: "You ended the conversation because you got what you needed (or had nothing more to ask).",
  gave_up: "You gave up and left the conversation without finishing.",
  asked_for_human: "You asked to speak to a human.",
  max_turns: "The conversation stopped before you were finished.",
  other: "The conversation ended.",
};

// The end-of-chat satisfaction rating (CSAT, 1 to 5), given in character.
export async function rateConversation(claude, { model, effort = "low", persona, goal, messages, outcome }) {
  const prompt = `PERSONA\n${personaProfile(persona)}\n\nYOUR GOAL\n${goal}\n\nCONVERSATION\n${transcriptText(messages)}\n\nHOW IT ENDED\n${OUTCOME_TEXT[outcome] ?? OUTCOME_TEXT.other}\n\nThe service now asks: "How satisfied were you with this conversation?" (1 = very dissatisfied, 5 = very satisfied). Answer as this persona honestly would, with a score and a short comment.`;
  const result = await claude.complete({ model, effort, system: SIMULATOR_SYSTEM, messages: [{ role: "user", content: prompt }], maxTokens: 600, schema: RATING_SCHEMA });
  return { ...result, rating: result.json ?? null };
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

export async function generateQuestions(claude, { model, effort = "low", count, outOfScopePct, persona, passages, avoid = [] }) {
  const outOfScope = Math.round((count * outOfScopePct) / 100);
  const prompt = [
    `Write ${count} different questions or requests that real users might send to a chatbot whose knowledge base includes the excerpts below.`,
    `${count - outOfScope} should be answerable from the excerpts (in_scope true) and ${outOfScope} should be plausible for this chatbot's users but NOT answerable from them (in_scope false).`,
    "Vary the topics, wording, length and difficulty. Write them as users actually type: not every one is a neat, complete question.",
    persona ? `Write them all as this persona would:\n${personaProfile(persona)}` : "Write them as a mix of different kinds of users would.",
    avoid.length ? `Do not repeat these existing questions:\n${avoid.slice(-60).map((q) => `- ${q}`).join("\n")}` : "",
    `Knowledge base excerpts:\n${excerpts(passages)}`,
  ].filter(Boolean).join("\n\n");
  const result = await claude.complete({ model, effort, system: "You help conversation designers create realistic test inputs for chatbots.", messages: [{ role: "user", content: prompt }], maxTokens: 4000, schema: QUESTIONS_SCHEMA });
  return { ...result, questions: (result.json?.questions ?? []).map((q) => ({ text: String(q.text).trim(), inScope: Boolean(q.in_scope) })).filter((q) => q.text) };
}

const PERSONAS_SCHEMA = {
  type: "object",
  properties: {
    personas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "A short label, e.g. 'Retired teacher with hearing loss'." },
          description: { type: "string" },
          goal: { type: "string", description: "Empty unless the brief implies a specific goal." },
          communication_style: { type: "string" },
          language_background: { type: "string" },
          give_up_pct: { type: "integer", description: "0 to 100: chance this person leaves a conversation early." },
          ask_human_pct: { type: "integer", description: "0 to 100: chance they ask for a human." },
          misunderstand_pct: { type: "integer", description: "0 to 100: chance per message that they misread a reply." },
          adversarial: { type: "boolean" },
        },
        required: ["name", "description", "goal", "communication_style", "language_background", "give_up_pct", "ask_human_pct", "misunderstand_pct", "adversarial"],
        additionalProperties: false,
      },
    },
  },
  required: ["personas"],
  additionalProperties: false,
};

export async function generatePersonas(claude, { model, effort = "low", brief, count, passages }) {
  const prompt = [
    `Create ${count} distinct user personas for testing a chatbot, following this brief from a conversation designer:\n"${brief}"`,
    "Make them specific and realistic, and different from each other in background, needs and communication style. Avoid stereotypes.",
    passages.length ? `The chatbot's knowledge base includes excerpts like these, which shows what it is for:\n${excerpts(passages)}` : "",
  ].filter(Boolean).join("\n\n");
  const result = await claude.complete({ model, effort, system: "You help conversation designers create user personas for chatbot testing.", messages: [{ role: "user", content: prompt }], maxTokens: 4000, schema: PERSONAS_SCHEMA });
  const personas = (result.json?.personas ?? []).map((p) => ({
    name: p.name,
    description: p.description,
    goal: p.goal,
    communicationStyle: p.communication_style,
    languageBackground: p.language_background,
    behaviour: { giveUpPct: p.give_up_pct, askHumanPct: p.ask_human_pct, misunderstandPct: p.misunderstand_pct },
    adversarial: p.adversarial,
  }));
  return { ...result, personas };
}
