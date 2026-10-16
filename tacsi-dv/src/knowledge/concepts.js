// "Concept translation" for TACSI DV: UK ideas around domestic abuse and the
// problems that come with it (family law, criminal law, housing, money,
// immigration). England and Wales. Explains the idea, not just the word.
//
// The AI uses these as trusted source text and adapts them to the person's
// language and situation. In demo mode they are shown as they are.
//
// PROTOTYPE CONTENT: check with a specialist domestic abuse service and a
// family / immigration lawyer before a pilot. Writing rules (GOV.UK content
// design): short sentences, common words, "you", active voice.

export const CONCEPTS = [
  {
    id: "coercive-control",
    term: "Controlling behaviour (coercive control)",
    icon: "shield",
    match: ["coercive control", "controls me", "controlling", "not allowed to", "won't let me", "checks my phone"],
    plain:
      "Abuse is not only hitting. It can also be someone controlling what you do, who you see, what you wear or your money, checking your phone, or making you afraid. In the UK this is a crime.",
    matters: "You do not need bruises to get help. Specialist services help people in this situation every day, in private.",
  },
  {
    id: "economic-abuse",
    term: "Economic abuse",
    icon: "coins",
    match: ["economic abuse", "takes my money", "takes my wages", "controls the money", "debt in my name", "loans in my name"],
    plain:
      "Economic abuse is when someone controls your money or things you need, like food, a phone or transport. It includes taking your wages or benefits, or making you take on debt.",
    matters: "Debt someone forced you to take on can sometimes be challenged. A free debt adviser can help. You can also ask for Universal Credit to be paid into your own account.",
  },
  {
    id: "non-molestation-order",
    term: "Non-molestation order",
    icon: "scales",
    match: ["non-molestation", "non molestation", "protection order", "injunction", "restraining order"],
    plain:
      "A non-molestation order is a court order. It tells a person to stop hurting, threatening or harassing you or your children. Breaking it is a crime, and the police can arrest them.",
    matters: "It is free to apply to the court. In an emergency the court can make the order without telling the other person first. Legal aid can often pay for a lawyer.",
  },
  {
    id: "occupation-order",
    term: "Occupation order",
    icon: "home",
    match: ["occupation order", "get him out", "stay in the house", "who lives in the home"],
    plain:
      "An occupation order is a court order that decides who can live in the family home. It can tell the other person to leave, or to stay away from the area.",
    matters: "It can let you stay in your home instead of leaving. Get legal advice: a lawyer or a domestic abuse service can help you apply.",
  },
  {
    id: "child-arrangements",
    term: "Child arrangements order",
    icon: "child",
    match: ["child arrangements", "custody", "contact with the children", "see the children", "take the children", "where the children live", "family court"],
    plain:
      "A child arrangements order is a family court order. It decides where children live and when they see each parent.",
    matters:
      "If there has been abuse, tell the court. The court must think about the safety of you and your children. You usually do not have to try mediation first if there has been domestic abuse.",
  },
  {
    id: "clares-law",
    term: "Clare's Law",
    icon: "scales",
    match: ["clare's law", "clares law", "his past", "history of violence", "did this before"],
    plain:
      "Clare's Law lets you ask the police if your partner, or someone close to you, has a history of abuse or violence.",
    matters: "You can ask by calling 101 or at a police station. Someone else, like a friend or relative, can also ask. The police decide what they can tell you.",
  },
  {
    id: "refuge",
    term: "Refuge",
    icon: "home",
    match: ["refuge", "safe house", "shelter for women", "somewhere safe to go"],
    plain:
      "A refuge is a safe house for people escaping abuse, often with their children. The address is kept secret. Staff there help you with money, housing and next steps.",
    matters: "The National Domestic Abuse Helpline (0808 2000 247) can look for a space for you, in your area or far away.",
  },
  {
    id: "homeless-duty",
    term: "Help from the council if you need to leave home",
    icon: "building",
    match: ["homeless", "nowhere to go", "nowhere to live"],
    plain:
      "If you have to leave your home because of abuse, the council must help you. People who are homeless because of domestic abuse are a 'priority' for housing.",
    matters:
      "You can ask any council for help, not only the one where you live now. The council must not tell the other person where you are. Some councils also offer extra locks and security so you can stay at home safely.",
  },
  {
    id: "legal-aid",
    term: "Legal aid",
    icon: "scales",
    match: ["legal aid", "lawyer", "solicitor", "can't afford a lawyer"],
    plain: "Legal aid means the government pays for a lawyer for you, or helps to pay.",
    matters:
      "If you have experienced domestic abuse, you can often get legal aid for family court cases, such as protection orders and child arrangements. You usually need some evidence, for example a letter from a doctor, the police or a domestic abuse service.",
  },
  {
    id: "visa-abuse",
    term: "If your visa depends on your partner",
    icon: "passport",
    match: ["spouse visa", "partner visa", "my visa", "deport", "send me back", "immigration", "no recourse"],
    plain:
      "If you came to the UK on a visa as someone's husband, wife or partner, and the relationship ended because of abuse, there are special rules that may let you stay in the UK.",
    matters:
      "You may be able to get help with money and housing for a short time while you apply. An abuser saying you will be 'sent back' is often not true. Get advice from a specialist immigration adviser before you decide anything.",
  },
  {
    id: "universal-credit",
    term: "Universal Credit (and abuse)",
    icon: "coins",
    match: ["universal credit", "benefits", "uc", "joint claim"],
    plain:
      "Universal Credit is money from the government to help with living costs. Couples usually get one payment into one account.",
    matters:
      "If someone controls the money, you can ask for your part to be paid into your own account, or make your own claim. If you have experienced abuse, you can ask to be let off looking for work for a while. Tell your work coach in private.",
  },
  {
    id: "idva-marac",
    term: "IDVA and MARAC",
    icon: "shield",
    match: ["idva", "marac", "domestic abuse adviser", "support worker"],
    plain:
      "An IDVA is an independent domestic abuse adviser. They support you with safety, court, housing and the police. A MARAC is a meeting where local services work together to keep someone at high risk safe.",
    matters: "An IDVA works for you, not for the police. They will explain everything and ask what you want before they act.",
  },
  {
    id: "safeguarding",
    term: "Safeguarding (and your children)",
    icon: "child",
    match: ["safeguarding", "social services", "social worker", "take my children away", "take the kids"],
    plain:
      "Safeguarding means protecting children and adults from harm. Staff in councils, schools and charities have to act if they think someone is in danger.",
    matters:
      "Many parents fear that asking for help will mean losing their children. Social services aim to keep children safe with the parent who is protecting them. Asking for help is a sign of protecting your children.",
  },
  {
    id: "gp",
    term: "GP (family doctor)",
    icon: "health",
    match: ["gp", "doctor", "injury", "injuries", "bruise"],
    plain: "A GP is a local doctor. Seeing a GP is free. You can ask to see the doctor on your own.",
    matters:
      "A GP can treat injuries and help with stress, sleep or low mood. They can also write down what happened, which can help later with legal aid or court. You do not need an address or immigration papers to register.",
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
