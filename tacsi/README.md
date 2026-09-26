# TACSI prototype

**Triage for Access to Citizen Support and Inclusion.** A triage tool that sits in community spaces such as libraries, GP surgeries and community centres. It helps people who find it hard to reach council or charity support to explain their problem. It then sends them to the right help and gives staff a report they can act on.

This is the first prototype: the MVP for readiness level 3 to 5. It is for demos, workshops and focus groups. **Do not use it with real personal data.**

## What it does

| Aim (from the pitch) | How the prototype does it |
|---|---|
| Comes to citizens | Kiosk-style web app for a shared screen. `?place=GP surgery` tags where the conversation happened. A "Leave this page" button (or pressing Shift 3 times) jumps to BBC Weather. The screen clears itself after 3 minutes without use. |
| Linguistic *and* cultural access | 7 interface languages (English, Polish, Romanian, Urdu, Bengali, Arabic, Ukrainian), with right-to-left layout for Urdu and Arabic. 12 more languages can be used for the conversation. **Concept translation**: when a UK idea comes up (council tax, school appeal, EHC plan, bailiffs, eviction notice, no recourse to public funds…), TACSI shows a "What does this mean?" card. The card explains what the idea is and why it matters to you, not just the word. |
| GOV.UK content design | The system prompt applies GOV.UK style rules: plain words (reading age 9), short sentences, "you", active voice, one question at a time, no idioms, numerals and sentence case. The interface follows GOV.UK Design System patterns: type scale, focus state, buttons, "Exit this page", inset text and summary lists. It does not use GOV.UK branding. |
| Multimodal | Picture buttons for topics, pictograms on referrals and concepts, speech input (microphone), read-aloud on every message and on the whole results page, tap-to-answer quick replies, bigger-text mode, and a printable referral slip. |
| Messy input → referral | TACSI takes whatever the person types or says and asks short questions to fill the gaps: danger, deadlines, other linked problems, and barriers. It does not ask for names or addresses. |
| Referral + staff report | **Citizen:** "What you told us", things to do now, things not to do (first aid), referral cards (phone, website, *what to say*, *what to have ready*) and words to know, all in the person's language. **Staff:** after consent, an English report with priority (urgent / high / standard), triage type (global / service-level / first aid), presenting issues, key facts, deadlines, safeguarding flags, access needs, unknowns, recommended actions and the full bilingual transcript. |

## Run it

Needs Node 20 or later.

```bash
cd tacsi
npm install
npm start               # offline demo mode
# or, with Claude:
ANTHROPIC_API_KEY=sk-ant-... npm start
```

* Citizen screen: http://localhost:3000 (add `?place=Library` or similar)
* Staff view: http://localhost:3000/staff. The PIN is `1234`. Change it with `TACSI_STAFF_PIN`.
* Tests: `npm test`

### Two engines

* **Claude mode** (when `ANTHROPIC_API_KEY` is set). Every turn is one Claude call that returns structured JSON: reply, quick replies, concept explanations, topics, risk level, first aid, and whether it is ready to refer. The report is a second call. Settings:
  * `TACSI_MODEL`: default `claude-opus-5`
  * `TACSI_TURN_EFFORT`: default `medium`
  * `TACSI_REPORT_EFFORT`: default `high`
  * Refusal fallbacks (`fallbacks: "default"`) are switched on, so a safety-classifier decline is re-run on a fallback model and the conversation is not blocked.
* **Demo mode** (no key, or when the AI fails). A scripted, keyword-based engine in English that returns the same data shapes. It lets you run workshops offline, and the app keeps working if the network goes down.

### Safety design

* Keyword risk detection always runs alongside the AI. It can raise the risk level to "immediate" but never lower it.
* When risk is immediate, the screen shows a 999 / "press 55" / Samaritans banner.
* Referrals can only come from the service directory. Any service the AI makes up is removed before it reaches the screen.
* Staff only see a case after the person ticks a consent box. Cases are kept in memory only.

## Where things are

```
server.js                    HTTP server and API (/api/turn, /api/report, /api/cases)
src/prompt.js                System prompt: GOV.UK style, scaffolding, safety rules
src/schemas.js               Structured output for turns and reports
src/ai.js                    Claude calls and output normalisation
src/demo.js                  Offline rule-based engine
src/knowledge/services.js    Service directory (edit for each council or charity)
src/knowledge/concepts.js    UK concepts in plain English
public/                      Citizen screen (index.html, app.js, i18n.js, icons.js) and staff view
```

## Before a pilot

* **Check the service directory.** National numbers were correct when written but must be checked. Replace the two `local-*` placeholders with the partner's own services, such as a local advice hub, the council front door or a domestic abuse service.
* **Review the translations** with community translators. They are drafts.
* **Test the concept explanations** with people who will use TACSI. Are they clear? Are they culturally appropriate? This fits the focus groups planned in months 2 and 3.
* **Speech features depend on the device.** They need Chrome or Edge, and voices for some languages (for example Bengali, Urdu, Somali) may not be installed on a kiosk.
* **Production work still to do:** real staff login and roles, encrypted storage and retention rules, a DPIA, a safeguarding escalation route (for example, an alert when a case is urgent), logging for auditing, and a GDPR-compliant way to handle data for a "contact me" option.
