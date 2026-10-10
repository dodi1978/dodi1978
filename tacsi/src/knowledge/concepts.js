// "Concept translation": UK ideas that people new to the system may not know.
//
// Each entry explains the idea itself, not just the word. The AI uses these as
// trusted source text and adapts them to the person's language and situation.
// In demo mode they are shown as they are.
//
// Writing rules (GOV.UK content design): short sentences, common words,
// "you", active voice, no idioms, numbers as numerals.

export const CONCEPTS = [
  {
    id: "council-tax",
    term: "Council tax",
    icon: "home",
    match: ["council tax", "council-tax", "podatek", "impozit"],
    plain:
      "Council tax is money most homes pay to the local council. It pays for things like bin collections, street lights and schools. The bill is for the home, not for each person.",
    matters:
      "If you do not pay, the council can take legal action and send enforcement agents (bailiffs). You may be able to pay less if you live alone or have a low income. This is called a discount or council tax support.",
  },
  {
    id: "council",
    term: "The council (local authority)",
    icon: "building",
    match: ["council", "local authority"],
    plain:
      "The council runs public services in your area. It is not the same as the government in London, or the police. It helps with housing, school places, social care and council tax.",
    matters: "You can ask the council for help even if you do not speak English well. You can ask for an interpreter.",
  },
  {
    id: "school-appeal",
    term: "School admission appeal",
    icon: "school",
    match: ["appeal", "school place", "didn't get a place", "did not get a place", "school admission"],
    plain:
      "If your child does not get a place at a school you asked for, you can ask an independent panel to look again. This is called an appeal. It is free.",
    matters:
      "The panel can only say yes for certain reasons. For example: the school did not follow its own rules, or your child has a strong reason to go to that school, such as a medical need. Wanting a school because it is 'better' is usually not enough. You must appeal before the deadline on your letter, usually 20 school days.",
  },
  {
    id: "ehcp",
    term: "EHC plan (Education, Health and Care plan)",
    icon: "child",
    match: ["ehcp", "ehc plan", "education health and care", "special needs", "special educational"],
    plain:
      "An EHC plan is a legal document for a child or young person with special educational needs. It says what extra help they must get at school or college.",
    matters:
      "Any parent can ask the council to check if their child needs an EHC plan. You do not need the school to agree. The council must reply within 6 weeks.",
  },
  {
    id: "bailiffs",
    term: "Bailiffs (enforcement agents)",
    icon: "door",
    match: ["bailiff", "enforcement agent", "debt collector", "collectors"],
    plain:
      "Bailiffs are people who collect money that a court or council says you owe. Debt collectors are different. Debt collectors cannot take your things.",
    matters:
      "You do not have to open the door to a bailiff or a debt collector the first time they visit. Do not let them in. Speak to a free debt adviser as soon as you can.",
  },
  {
    id: "universal-credit",
    term: "Universal Credit",
    icon: "coins",
    match: ["universal credit", "uc", "benefits"],
    plain:
      "Universal Credit is money from the government to help with living costs if you have a low income or are out of work. It is paid once a month.",
    matters:
      "You apply online. If you cannot use a computer, you can ask for help by phone or at a Jobcentre. It can take 5 weeks to get the first payment. You can ask for an advance.",
  },
  {
    id: "eviction-notice",
    term: "Eviction notice (Section 21 or Section 8)",
    icon: "home",
    match: ["eviction", "evict", "section 21", "section 8", "notice to leave", "kicked out", "landlord wants me out"],
    plain:
      "An eviction notice is a letter from your landlord saying they want you to leave. It is only the first step. Your landlord cannot make you leave on their own. Only a court and court bailiffs can do that.",
    matters:
      "Do not leave your home just because you got a letter. Get free housing advice straight away. If you might become homeless in the next 8 weeks, the council must help you.",
  },
  {
    id: "legal-aid",
    term: "Legal aid",
    icon: "scales",
    match: ["legal aid", "lawyer", "solicitor"],
    plain: "Legal aid means the government pays for a lawyer for you. You do not pay, or you pay less.",
    matters:
      "You can often get legal aid for domestic abuse, losing your home, and some immigration and special needs cases. It depends on your income.",
  },
  {
    id: "gp",
    term: "GP (family doctor)",
    icon: "health",
    match: ["gp", "doctor", "surgery"],
    plain: "A GP is a local doctor for everyday health problems. Seeing a GP is free.",
    matters: "You do not need an address, ID or immigration papers to register with a GP.",
  },
  {
    id: "safeguarding",
    term: "Safeguarding",
    icon: "shield",
    match: ["safeguarding", "social services", "social worker"],
    plain:
      "Safeguarding means protecting children and adults from harm. Staff in councils, schools and charities have to act if they think someone is in danger.",
    matters:
      "If you tell a worker that a child or adult is being hurt, they may have to share this with other services. They should tell you first, unless that would put someone at risk.",
  },
  {
    id: "no-recourse",
    term: "No recourse to public funds (NRPF)",
    icon: "passport",
    match: ["no recourse", "nrpf", "public funds", "visa condition"],
    plain:
      "Some visas say 'no recourse to public funds'. This means you cannot get most benefits, like Universal Credit or council housing.",
    matters:
      "You can still get help. Children can still go to school. You can still see a GP. Councils can still help families with children who are in need. Get advice before you apply for anything.",
  },
];

export function findConceptsInText(text) {
  const lower = ` ${text.toLowerCase()} `;
  return CONCEPTS.filter((c) =>
    c.match.some((m) => new RegExp(`[^a-z]${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?[^a-z]`).test(lower)),
  );
}

export function conceptsForPrompt() {
  return CONCEPTS.map((c) => `- ${c.term}: ${c.plain} ${c.matters}`).join("\n");
}
