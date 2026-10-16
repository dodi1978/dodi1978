# TACSI DV prototype

**TACSI for people affected by domestic abuse.** A version of [TACSI](../tacsi/README.md) developed for one use case: domestic abuse.

Many people, most often women, do not talk about domestic abuse directly when they first ask for help. Some are not ready to say it, even to themselves. They come with a problem that is easier to talk about: money, debt, housing, children, a visa, their health, a court letter or the police.

TACSI DV is built for this. It:

- **helps fully with the problem she brings**, across all the areas linked to domestic abuse: family law, criminal law, housing, money and economic abuse, immigration, benefits, health and children;
- **notices indirect signs** (for example a partner controlling money, checking her phone, keeping her passport, her being afraid to go home) **without naming or labelling them**;
- **opens the door gently**: it reflects what she said and asks one question she can easily decline, accepts "no", and never pushes her to leave, to talk about it or to call the police;
- **checks it is safe to talk**, and keeps things short if someone is with her ("Leave this page" is always visible);
- **avoids unsafe advice**, such as couples counselling, mediation or confronting the other person;
- gives a **staff report** that records whether abuse was disclosed (direct, indirect or none) and the **signs noticed**, grouped by theme (for example economic abuse, strangling or threats to kill, stalking, immigration abuse), with a reminder that TACSI is not a risk assessment and that a full specialist assessment (for example the DASH risk checklist) and, where needed, IDVA or MARAC referral should follow.

Everything else works as in TACSI: the 7 interface languages, the conversation in many more, concept explanations, the help panel, conversation starters, the access code and the staff view.

## Run it

```bash
cd tacsi-dv
npm install
npm start               # offline demo mode
ANTHROPIC_API_KEY=sk-ant-... npm start   # with Claude
```

* Citizen screen: http://localhost:3000
* Staff view: http://localhost:3000/staff (PIN `1234`, change with `TACSI_STAFF_PIN`)
* Tests: `npm test`
* Online for stakeholders: see [DEPLOY.md](DEPLOY.md). Use **Root Directory** `tacsi-dv`.
* Shareable link version: `npm run build:demo`.

## What is different from TACSI

| File | Change |
|---|---|
| `src/prompt.js` | Rules for recognising and responding to indirect disclosure, safe-to-talk checks, all related legal and support areas, high-risk signs, and the domestic abuse fields in the staff report. |
| `src/knowledge/services.js` | Specialist services: domestic abuse, LGBT+, forced marriage, stalking, economic abuse, women's legal advice, Victim Support, police 101, and local IDVA and housing placeholders. |
| `src/knowledge/concepts.js` | Plain explanations of controlling behaviour, economic abuse, non-molestation and occupation orders, child arrangements, Clare's Law, refuges, council housing duties, legal aid, visas and abuse, Universal Credit, IDVA and MARAC, safeguarding. |
| `src/demo.js` | Offline engine that spots indirect signs, asks one gentle check-in question, checks it is safe to talk and records signs for staff. |
| `src/schemas.js`, `public/staff.js` | Staff report fields `disclosure` and `risk_indicators`. |
| `public/` | One entry point for everyone: no topic pictures before the conversation, so nobody has to pick a category before they are ready. The conversation finds the topics. |

## Before a pilot

* **Co-design and check the content** with a specialist domestic abuse service and survivors, and check the legal explanations with a family law and an immigration lawyer. They are drafts.
* **Check the service directory** and add the local IDVA service, MARAC route and housing options team.
* **Safety review**: how the screen is placed in the room, what staff do when a case is urgent, and how people are contacted safely afterwards.
* As with TACSI: review translations, and do not use real personal data in the prototype.
