// The rapport framework personas are described with. Every project starts with
// Dippold's Taxonomy of Human-Chatbot Rapport (six GAAFFE dimensions, after
// Spencer-Oatey & Lazidou 2024) and can edit it.

export const IMPORTANCE = ["low", "medium", "high"];

export const GAAFFE = {
  name: "Taxonomy of Human-Chatbot Rapport (Dippold), GAAFFE",
  dimensions: [
    {
      key: "goals",
      name: "Goals",
      definition: "The degree to which the system helps users accomplish what they came to do.",
      builds: ["Integrates easily into the user's routine", "Saves the user time and effort", "Responds quickly and with clarity", "Provides relevant, structured, and flexible options", "Personalises dialogue to user needs", "Facilitates disclosure of difficult topics"],
      breaks: ["Produces inflexible, pushy, confusing dialogue", "Offers unclear or limited options", "Provides repetitive or irrelevant information", "Fails to provide timely or relevant follow-ups", "Fails to reassure the anxious user"],
    },
    {
      key: "autonomy",
      name: "Autonomy",
      definition: "The degree of control and independence the user feels in the interaction.",
      builds: ["Provides convenient and easy navigation", "Respects user privacy", "Allows the user to ask questions and clarify", "Provides alternatives and flexibility", "Supports user agency through choice-oriented language"],
      breaks: ["Constrains user actions with inflexible dialogue structure", "Sends pushy, coercive or repetitive messages", "Over-messages the user", "Withholds alternative options or opt-out opportunities", "Offers too little control over the process"],
    },
    {
      key: "attention",
      name: "Attention",
      definition: "The quality of responsiveness and care the user experiences from the system.",
      builds: ["Responds in a timely and prompt manner", "Provides clear and structured information", "Uses a warm, friendly, cooperative tone", "Adapts to user needs and preferences", "Fosters comfort and emotional safety", "Offers opportunity for anonymous engagement"],
      breaks: ["Delays or omits responses; ignores user questions", "Produces repetitive, wordy, or confusing messages", "Demonstrates limited flexibility and unclear capabilities", "Provides incorrect or unreliable information", "Uses robotic, over-familiar, or inappropriate tone"],
    },
    {
      key: "face",
      name: "Face",
      definition: "The extent to which the system recognises and respects the user's identity and needs.",
      builds: ["Shows appropriate balance of familiarity and attention", "Respects user autonomy by providing options", "Respects user privacy, competence, and needs", "Uses a personalised, friendly and empathetic tone", "Recognises and validates user anxieties"],
      breaks: ["Fails to follow up on or apologise for system errors", "Provides fixed, unclear, or limited options", "Uses over-familiar, patronising, or impersonal tone", "Prompts persistently for user responses", "Does not attend to users' skills, preferences and experiences"],
    },
    {
      key: "fairness",
      name: "Fairness",
      definition: "The user's sense of being treated justly, equitably and without undue pressure.",
      builds: ["Is responsive to users", "Uses a supportive, friendly, and user-centred tone", "Gives the user agency over the process", "Provides relevant information responding to user needs", "Acts transparently and provides flexible choices"],
      breaks: ["Constrains the user with inflexible dialogue", "Fails to follow up after system errors", "Over-messages the user", "Imposes undue pressure on the user", "Neglects to provide expected information", "Ignores users' real-life needs"],
    },
    {
      key: "ethicality",
      name: "Ethicality",
      definition: "The transparency, honesty and trustworthiness of the system's conduct.",
      builds: ["Discloses clearly that it is an AI system", "Respects the user's right to disengage and offers alternatives", "Balances human-like tone with transparency about AI identity", "Recognises when vulnerable users need escalation to a human agent"],
      breaks: ["Pretends to be human", "Fails to reassure users over data security and privacy", "Prevents the user from opting out of AI interactions", "Fails to signal organisational backing", "Provides false, misleading, or confusing responses"],
    },
  ],
};

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const lines = (v) => (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => text(x, 300)).filter(Boolean).slice(0, 30);

function slug(name) {
  return String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "dimension";
}

// Keeps existing keys (so renaming a dimension keeps its data) and gives new ones a unique key.
export function sanitiseFramework(input) {
  const used = new Set();
  const dimensions = (Array.isArray(input?.dimensions) ? input.dimensions : []).slice(0, 12).map((d) => {
    const name = text(d.name, 60);
    if (!name) return null;
    let key = /^[a-z0-9_]{1,30}$/.test(d.key ?? "") ? d.key : slug(name);
    const base = key;
    for (let i = 2; used.has(key); i++) key = `${base}_${i}`.slice(0, 30);
    used.add(key);
    return { key, name, definition: text(d.definition, 600), builds: lines(d.builds), breaks: lines(d.breaks) };
  }).filter(Boolean);
  return { name: text(input?.name, 120) || "Rapport framework", dimensions };
}

export function frameworkOf(project) {
  return project?.framework ? sanitiseFramework(project.framework) : structuredClone(GAAFFE);
}

// A persona's rapport profile: { key: { importance, note, evidence[] } }, only for known dimensions.
export function sanitiseRapport(input, framework) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  const keys = framework ? new Set(framework.dimensions.map((d) => d.key)) : null;
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-z0-9_]{1,30}$/.test(key) || (keys && !keys.has(key)) || !value || typeof value !== "object") continue;
    const importance = IMPORTANCE.includes(value.importance) ? value.importance : "";
    const note = text(value.note, 1500);
    const evidence = (Array.isArray(value.evidence) ? value.evidence : []).map((q) => text(q, 600)).filter(Boolean).slice(0, 6);
    if (importance || note || evidence.length) out[key] = { importance, note, ...(evidence.length ? { evidence } : {}) };
  }
  return out;
}

// For prompts: what this user needs, dimension by dimension.
export function rapportNeedsText(rapport, framework) {
  if (!framework?.dimensions?.length || !rapport) return "";
  const rows = framework.dimensions
    .filter((d) => rapport[d.key]?.importance || rapport[d.key]?.note)
    .map((d) => {
      const r = rapport[d.key];
      return `- ${d.name} (${d.definition || "no definition"}): ${r.importance ? `${r.importance} importance to this user` : "importance not stated"}${r.note ? `. ${r.note}` : ""}`;
    });
  return rows.length ? `Rapport needs (${framework.name}):\n${rows.join("\n")}` : "";
}

export function frameworkText(framework) {
  return framework.dimensions.map((d) => [
    `${d.name}: ${d.definition}`,
    d.builds.length ? `  Builds rapport: ${d.builds.join("; ")}` : "",
    d.breaks.length ? `  Breaks rapport: ${d.breaks.join("; ")}` : "",
  ].filter(Boolean).join("\n")).join("\n");
}

// Spreadsheet values: "high", "H", "4", "4/5" … → low / medium / high (or "" if not a level).
// scaleMax: the top of the numeric scale used in that column (the importer works it out).
export function parseImportance(value, scaleMax) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "";
  if (["high", "h", "very high", "important", "very important"].includes(v)) return "high";
  if (["medium", "med", "m", "moderate", "mid", "some"].includes(v)) return "medium";
  if (["low", "l", "not important", "minor", "very low"].includes(v)) return "low";
  const scored = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?$/.exec(v);
  if (scored) {
    const n = Number(scored[1]);
    const max = scored[2] ? Number(scored[2]) : scaleMax || (n <= 3 ? 3 : n <= 5 ? 5 : n <= 7 ? 7 : 10);
    const ratio = max > 1 ? (n - 1) / (max - 1) : 0;
    return ratio >= 2 / 3 ? "high" : ratio >= 1 / 3 ? "medium" : "low";
  }
  return "";
}
