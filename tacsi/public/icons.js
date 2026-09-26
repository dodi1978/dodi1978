// Simple line pictograms. Drawn on a 48x48 grid, stroke uses currentColor.
const P = {
  home: '<path d="M6 22 24 7l18 15"/><path d="M11 19v22h26V19"/><path d="M20 41V29h8v12"/>',
  coins: '<ellipse cx="18" cy="14" rx="11" ry="5"/><path d="M7 14v8c0 2.8 4.9 5 11 5s11-2.2 11-5v-8"/><path d="M7 22v8c0 2.8 4.9 5 11 5"/><ellipse cx="31" cy="30" rx="10" ry="4.5"/><path d="M21 30v7c0 2.5 4.5 4.5 10 4.5s10-2 10-4.5v-7"/>',
  shield: '<path d="M24 5 8 11v11c0 10 7 17.5 16 21 9-3.5 16-11 16-21V11z"/><path d="M17 24l5 5 9-10"/>',
  school: '<path d="M4 18 24 8l20 10-20 10z"/><path d="M12 22v10c0 3 5.4 6 12 6s12-3 12-6V22"/><path d="M44 18v12"/>',
  passport: '<rect x="11" y="5" width="26" height="38" rx="3"/><circle cx="24" cy="20" r="7"/><path d="M17 20h14M24 13c-3 4-3 10 0 14M24 13c3 4 3 10 0 14"/><path d="M17 35h14"/>',
  health: '<path d="M24 41S7 31 7 18a9 9 0 0 1 17-4 9 9 0 0 1 17 4c0 13-17 23-17 23z"/><path d="M16 23h5l3-5 3 9 2-4h4"/>',
  benefits: '<path d="M6 30h7l9 5h9a3 3 0 0 0 0-6h-7"/><path d="M13 30v11H6"/><path d="M24 35l14-6a3 3 0 0 1 3 5L27 42H13"/><circle cx="30" cy="14" r="7"/><path d="M30 10v8"/>',
  work: '<rect x="6" y="15" width="36" height="25" rx="3"/><path d="M17 15v-4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4"/><path d="M6 26h36"/>',
  question: '<circle cx="24" cy="24" r="18"/><path d="M18 19a6 6 0 1 1 8 5.6c-1.3.6-2 1.6-2 3V30"/><circle cx="24" cy="35" r="1" fill="currentColor"/>',
  building: '<path d="M6 42h36"/><path d="M8 18h32L24 7z"/><path d="M12 22v16M20 22v16M28 22v16M36 22v16"/>',
  door: '<path d="M12 42V6h24v36"/><circle cx="30" cy="25" r="1.5" fill="currentColor"/><path d="M6 42h36"/>',
  scales: '<path d="M24 6v34M14 42h20M10 12h28"/><path d="M10 12 4 26a6 6 0 0 0 12 0zM38 12l-6 14a6 6 0 0 0 12 0z"/>',
  child: '<circle cx="24" cy="10" r="5"/><path d="M24 17v14M14 22l10 3 10-3M18 42l6-11 6 11"/>',
  mic: '<rect x="18" y="5" width="12" height="22" rx="6"/><path d="M11 22a13 13 0 0 0 26 0M24 35v7M17 42h14"/>',
  speaker: '<path d="M8 18h8l10-8v28l-10-8H8z"/><path d="M32 17a9 9 0 0 1 0 14M36 12a15 15 0 0 1 0 24"/>',
  phone: '<path d="M14 6h-4a3 3 0 0 0-3 3c0 18 14 32 32 32a3 3 0 0 0 3-3v-4l-8-4-4 4c-5-2-9-6-11-11l4-4z"/>',
  globe: '<circle cx="24" cy="24" r="18"/><path d="M6 24h36M24 6c-6 6-6 30 0 36M24 6c6 6 6 30 0 36"/>',
  print: '<path d="M14 18V6h20v12"/><rect x="6" y="18" width="36" height="16" rx="2"/><path d="M14 28h20v14H14z"/>',
  warning: '<path d="M24 5 3 42h42z"/><path d="M24 18v11"/><circle cx="24" cy="35" r="1.2" fill="currentColor"/>',
  bulb: '<path d="M17 30a12 12 0 1 1 14 0v5H17z"/><path d="M19 40h10"/>',
  check: '<path d="M10 25l9 9 19-20"/>',
  cross: '<path d="M12 12l24 24M36 12 12 36"/>',
  send: '<path d="M6 24 42 7 32 41l-8-13z"/><path d="M24 28 42 7"/>',
};

export const TOPIC_ICONS = {
  housing: "home",
  money: "coins",
  safety: "shield",
  education: "school",
  immigration: "passport",
  health: "health",
  benefits: "benefits",
  work: "work",
  other: "question",
};

export function icon(name, cls = "icon") {
  const body = P[name] ?? P.question;
  return `<svg class="${cls}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
