// Directory of services TACSI DV can refer people to (domestic abuse and the
// problems that come with it).
//
// PROTOTYPE DATA: national services below are real, but contact details must be
// checked before any pilot. Local entries are placeholders - each deploying
// council or charity replaces them with its own services and referral routes
// (for example the local IDVA service, MARAC route and housing options team).
//
// Fields:
//   id          stable id the AI must use when it picks a referral
//   topics      which needs this service helps with
//   kind        "emergency" | "national" | "local"
//   urgentOnly  only suggest when there is an immediate risk

export const SERVICES = [
  {
    id: "emergency-999",
    name: "Emergency services (police, ambulance)",
    kind: "emergency",
    topics: ["safety", "health", "law"],
    urgentOnly: true,
    what: "Call if you or someone else is in danger right now or badly hurt.",
    phone: "999",
    hours: "Always open",
    notes: "If you cannot speak, call 999, then press 55 when asked. This tells the police you need help.",
  },
  {
    id: "police-101",
    name: "Police (not an emergency)",
    kind: "national",
    topics: ["law", "safety"],
    what: "Report something that has already happened, or ask about Clare's Law (finding out if a partner has a history of abuse).",
    phone: "101",
    web: "https://www.police.uk",
  },
  {
    id: "domestic-abuse-helpline",
    name: "National Domestic Abuse Helpline (Refuge)",
    kind: "national",
    topics: ["safety", "housing", "family"],
    what: "Free, private help if someone close to you hurts, scares or controls you. They can also help you find a refuge.",
    phone: "0808 2000 247",
    web: "https://www.nationaldahelpline.org.uk",
    hours: "Always open. Free to call.",
    notes: "They can use an interpreter. You can also use their live chat online.",
  },
  {
    id: "womens-aid",
    name: "Women's Aid",
    kind: "national",
    topics: ["safety", "family", "health"],
    what: "Information, a live chat and an online forum where women support each other.",
    web: "https://www.womensaid.org.uk",
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
    id: "galop",
    name: "Galop LGBT+ Domestic Abuse Helpline",
    kind: "national",
    topics: ["safety"],
    what: "Help for lesbian, gay, bisexual, trans and queer people who are hurt or controlled by a partner or family.",
    phone: "0800 999 5428",
    web: "https://galop.org.uk",
  },
  {
    id: "karma-nirvana",
    name: "Karma Nirvana",
    kind: "national",
    topics: ["safety", "family"],
    what: "Help if your family is forcing you to marry, or hurting or controlling you because of 'honour'.",
    phone: "0800 5999 247",
    web: "https://karmanirvana.org.uk",
  },
  {
    id: "forced-marriage-unit",
    name: "Forced Marriage Unit (UK government)",
    kind: "national",
    topics: ["safety", "immigration"],
    what: "Help if you or someone you know is being forced to marry, in the UK or abroad.",
    phone: "020 7008 0151",
    web: "https://www.gov.uk/stop-forced-marriage",
  },
  {
    id: "stalking-helpline",
    name: "National Stalking Helpline",
    kind: "national",
    topics: ["safety", "law"],
    what: "Help if someone keeps following, watching, contacting or frightening you.",
    phone: "0808 802 0300",
    web: "https://www.suzylamplugh.org",
  },
  {
    id: "victim-support",
    name: "Victim Support",
    kind: "national",
    topics: ["law", "health"],
    what: "Free, private support after a crime, whether or not you have told the police.",
    phone: "08 08 16 89 111",
    web: "https://www.victimsupport.org.uk",
    hours: "Always open",
  },
  {
    id: "rights-of-women",
    name: "Rights of Women",
    kind: "national",
    topics: ["family", "law", "immigration"],
    what: "Free legal advice for women about family law, criminal law and immigration, including court orders to protect you.",
    web: "https://rightsofwomen.org.uk",
  },
  {
    id: "surviving-economic-abuse",
    name: "Surviving Economic Abuse",
    kind: "national",
    topics: ["money"],
    what: "Information and help if someone controls your money, takes it, or makes you take on debt.",
    web: "https://survivingeconomicabuse.org",
  },
  {
    id: "national-debtline",
    name: "National Debtline",
    kind: "national",
    topics: ["money"],
    what: "Free advice if you owe money and cannot pay, including debts someone made you take on.",
    phone: "0808 808 4000",
    web: "https://nationaldebtline.org",
  },
  {
    id: "citizens-advice",
    name: "Citizens Advice",
    kind: "national",
    topics: ["money", "housing", "benefits", "immigration", "family", "other"],
    what: "Free advice on money, benefits, housing, family and your rights.",
    phone: "0800 144 8848",
    web: "https://www.citizensadvice.org.uk",
    hours: "Monday to Friday, 9am to 5pm",
    notes: "You can also visit a local office. Ask for an interpreter if you need one.",
  },
  {
    id: "shelter",
    name: "Shelter",
    kind: "national",
    topics: ["housing"],
    what: "Free advice if you have a problem with your home, need to leave your home, or might become homeless.",
    phone: "0808 800 4444",
    web: "https://www.shelter.org.uk",
  },
  {
    id: "coram-child-law",
    name: "Coram Child Law Advice",
    kind: "national",
    topics: ["family"],
    what: "Free legal advice about children, for example where children live and when they see each parent.",
    web: "https://childlawadvice.org.uk",
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
    id: "southall-black-sisters",
    name: "Southall Black Sisters",
    kind: "national",
    topics: ["safety", "immigration"],
    what: "Advice for Black and minoritised women facing abuse, including women whose visa depends on their partner.",
    web: "https://southallblacksisters.org.uk",
  },
  {
    id: "nhs-111",
    name: "NHS 111",
    kind: "national",
    topics: ["health"],
    what: "Medical help when it is urgent but not an emergency, including injuries.",
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
    id: "local-council-housing",
    name: "Your local council (housing help)",
    kind: "local",
    topics: ["housing", "benefits"],
    what: "The council must help you if you are homeless or may become homeless because of abuse. You can ask any council, not only the one where you live.",
    web: "https://www.gov.uk/find-local-council",
    notes: "PLACEHOLDER: the deploying council adds its housing options phone number and out-of-hours number.",
  },
  {
    id: "local-da-service",
    name: "Local domestic abuse service",
    kind: "local",
    topics: ["safety", "family", "housing", "money", "law", "health", "immigration", "benefits", "other"],
    what: "A local specialist service who can talk with you face to face, help you plan how to stay safe, and help with forms, court and housing. This can include an independent domestic abuse adviser (IDVA).",
    notes: "PLACEHOLDER: replace with the partner service (for example the local IDVA service or a specialist charity).",
  },
];

export const TOPICS = ["safety", "housing", "money", "family", "law", "immigration", "health", "benefits", "other"];

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
