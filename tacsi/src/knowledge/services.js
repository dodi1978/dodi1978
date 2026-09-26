// Directory of services TACSI can refer people to.
//
// PROTOTYPE DATA: national services below are real, but contact details must be
// checked before any pilot. Local entries are placeholders - each deploying
// council or charity replaces them with its own services and referral routes.
//
// Fields:
//   id          stable id the AI must use when it picks a referral
//   topics      which needs this service helps with
//   kind        "emergency" | "national" | "local"
//   urgentOnly  only suggest when there is an immediate risk

export const SERVICES = [
  {
    id: "emergency-999",
    name: "Emergency services (police, ambulance, fire)",
    kind: "emergency",
    topics: ["safety", "health"],
    urgentOnly: true,
    what: "Call if someone is in danger right now or badly hurt.",
    phone: "999",
    hours: "Always open",
    notes: "If you cannot speak, call 999, then press 55 when asked. This tells the police you need help.",
  },
  {
    id: "nhs-111",
    name: "NHS 111",
    kind: "national",
    topics: ["health"],
    what: "Medical help when it is urgent but not an emergency.",
    phone: "111",
    web: "https://111.nhs.uk",
    hours: "Always open",
    notes: "You can ask for an interpreter.",
  },
  {
    id: "samaritans",
    name: "Samaritans",
    kind: "national",
    topics: ["health", "safety"],
    what: "Someone to talk to if you feel very low, or think about ending your life.",
    phone: "116 123",
    web: "https://www.samaritans.org",
    hours: "Always open. Free to call.",
  },
  {
    id: "domestic-abuse-helpline",
    name: "National Domestic Abuse Helpline (Refuge)",
    kind: "national",
    topics: ["safety"],
    what: "Free, private help if someone you live with or are close to hurts, scares or controls you.",
    phone: "0808 2000 247",
    web: "https://www.nationaldahelpline.org.uk",
    hours: "Always open. Free to call.",
    notes: "They can use an interpreter. The call will not show on most phone bills.",
  },
  {
    id: "mens-advice-line",
    name: "Men's Advice Line",
    kind: "national",
    topics: ["safety"],
    what: "Help for men who are hurt, scared or controlled by a partner or family member.",
    phone: "0808 8010 327",
    web: "https://mensadviceline.org.uk",
  },
  {
    id: "citizens-advice",
    name: "Citizens Advice",
    kind: "national",
    topics: ["money", "housing", "benefits", "work", "immigration", "other"],
    what: "Free advice on money, benefits, housing, work, family and your rights.",
    phone: "0800 144 8848",
    web: "https://www.citizensadvice.org.uk",
    hours: "Monday to Friday, 9am to 5pm",
    notes: "You can also visit a local office. Ask for an interpreter if you need one.",
  },
  {
    id: "national-debtline",
    name: "National Debtline",
    kind: "national",
    topics: ["money"],
    what: "Free advice if you owe money and cannot pay.",
    phone: "0808 808 4000",
    web: "https://nationaldebtline.org",
  },
  {
    id: "stepchange",
    name: "StepChange Debt Charity",
    kind: "national",
    topics: ["money"],
    what: "Free help to make a plan to pay back money you owe.",
    phone: "0800 138 1111",
    web: "https://www.stepchange.org",
  },
  {
    id: "shelter",
    name: "Shelter",
    kind: "national",
    topics: ["housing"],
    what: "Free advice if you have a problem with your home, or might lose your home.",
    phone: "0808 800 4444",
    web: "https://www.shelter.org.uk",
  },
  {
    id: "coram-child-law",
    name: "Coram Child Law Advice",
    kind: "national",
    topics: ["education"],
    what: "Free legal advice about school places, school appeals, exclusions and children's rights.",
    web: "https://childlawadvice.org.uk",
  },
  {
    id: "ipsea",
    name: "IPSEA",
    kind: "national",
    topics: ["education"],
    what: "Free legal advice for families of children with special educational needs and disabilities (SEND), including EHC plans.",
    web: "https://www.ipsea.org.uk",
  },
  {
    id: "migrant-help",
    name: "Migrant Help",
    kind: "national",
    topics: ["immigration"],
    what: "Free help if you have claimed asylum in the UK, or are a victim of modern slavery.",
    phone: "0808 8010 503",
    web: "https://www.migranthelpuk.org",
    hours: "Always open",
  },
  {
    id: "local-council",
    name: "Your local council",
    kind: "local",
    topics: ["housing", "money", "education", "benefits", "other"],
    what: "The council runs local services such as council tax, housing help, school places and social care.",
    web: "https://www.gov.uk/find-local-council",
    notes: "PLACEHOLDER: the deploying council adds its own phone number, opening times and front-door address.",
  },
  {
    id: "local-community-hub",
    name: "Local community advice hub",
    kind: "local",
    topics: ["money", "housing", "benefits", "immigration", "safety", "education", "health", "other"],
    what: "A local charity who can help you face to face, fill in forms and speak for you.",
    notes: "PLACEHOLDER: replace with a partner charity (for example a local council for voluntary service or domestic abuse service).",
  },
];

export const TOPICS = ["housing", "money", "safety", "education", "immigration", "health", "benefits", "work", "other"];

export function getService(id) {
  return SERVICES.find((s) => s.id === id);
}

export function servicesForTopics(topics, { urgent = false } = {}) {
  return SERVICES.filter(
    (s) => s.topics.some((t) => topics.includes(t)) && (!s.urgentOnly || urgent),
  );
}

// Compact text version of the directory for the model's system prompt.
export function directoryForPrompt() {
  return SERVICES.map(
    (s) =>
      `- id: ${s.id} | ${s.name} | topics: ${s.topics.join(", ")}${s.urgentOnly ? " | ONLY for immediate danger" : ""} | ${s.what}`,
  ).join("\n");
}
