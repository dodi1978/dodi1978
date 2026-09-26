import { z } from "zod";
import { TOPICS } from "./knowledge/services.js";

export const RISK_LEVELS = ["none", "concern", "immediate"];
export const PRIORITIES = ["urgent", "high", "standard"];
export const TRIAGE_TYPES = ["global", "service-level", "first-aid"];

// Structured outputs carry enums as descriptions only, so these are plain
// strings here and normalised in ai.js (normaliseTurn / normaliseReport).
const oneOf = (values) => z.string().describe(`One of: ${values.join(", ")}.`);
const Topic = oneOf(TOPICS);

// One conversational turn from TACSI.
export const TurnSchema = z.object({
  reply: z.string().describe("What TACSI says next, in the person's language. GOV.UK plain style. Max about 60 words. At most one question."),
  reply_english: z.string().describe("The same reply in English, for the staff transcript."),
  user_message_english: z.string().describe("The person's last message translated into English. Copy it if already English."),
  quick_replies: z.array(z.string()).describe("0 to 4 short answers the person can tap, in their language."),
  concepts: z
    .array(z.object({ term: z.string(), explanation: z.string() }))
    .describe("UK ideas used in the reply that the person may not know, explained simply in their language. Usually 0 or 1."),
  topics: z.array(Topic).describe("All areas of need identified so far."),
  risk: z.object({
    level: oneOf(RISK_LEVELS),
    reason: z.string().describe("English. Why this level. Empty if none."),
  }),
  first_aid: z.array(z.string()).describe("Urgent do's and don'ts to show now, in the person's language. Usually empty."),
  ready_for_referral: z.boolean().describe("True when you know enough to refer, or the person wants to finish."),
});

const Referral = z.object({
  service_id: z.string().describe("Must be an id from the service directory."),
  why: z.string().describe("Person's language. Why this service, in one or two sentences."),
  what_to_say: z.string().describe("Person's language. A short sentence the person can say or show when they contact the service."),
  what_to_bring: z.array(z.string()).describe("Person's language. Documents or information to have ready."),
});

export const ReportSchema = z.object({
  citizen: z.object({
    summary: z.string().describe("Person's language. 'What you told us' in 2 to 4 short sentences, using 'you'."),
    referrals: z.array(Referral).describe("Most important first. Usually 1 to 3."),
    do_now: z.array(z.string()).describe("Person's language. Things to do now."),
    dont: z.array(z.string()).describe("Person's language. Things not to do."),
    words_to_know: z.array(z.object({ term: z.string(), explanation: z.string() })),
  }),
  staff: z.object({
    headline: z.string().describe("English. One line case summary."),
    priority: oneOf(PRIORITIES),
    priority_reason: z.string(),
    triage_types: z
      .array(oneOf(TRIAGE_TYPES))
      .describe("global = several linked needs across services; service-level = prioritise within one service; first-aid = immediate do's and don'ts given."),
    presenting_issues: z.array(z.object({ topic: Topic, description: z.string() })),
    key_facts: z.array(z.string()),
    deadlines: z.array(z.string()).describe("Any dates or time limits mentioned. Empty if none."),
    safeguarding_flags: z.array(z.string()).describe("Risks to the person, children or adults at risk. Empty if none."),
    access_needs: z.array(z.string()).describe("Language, interpreter, literacy, digital, disability or emotional needs observed."),
    person_goals: z.string().describe("What the person wants to happen, in their own terms."),
    unknowns: z.array(z.string()).describe("Important information still missing, for staff to ask."),
    recommended_actions: z.array(z.string()).describe("Concrete next steps for the support worker."),
    referrals: z.array(z.object({ service_id: z.string(), rationale: z.string() })),
  }),
});
