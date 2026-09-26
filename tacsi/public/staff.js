const app = document.getElementById("app");
const STATIC = Boolean(window.TACSI_STATIC);
let pin = sessionStorageGet("tacsi-pin");
let services = [];

function sessionStorageGet(k) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k, v) {
  try {
    sessionStorage.setItem(k, v);
  } catch {}
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "x-staff-pin": pin ?? "", "content-type": "application/json" } });
  if (res.status === 401) {
    pin = null;
    renderLogin("That PIN is not right.");
    throw new Error("unauthorised");
  }
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

function renderLogin(error = "") {
  app.innerHTML = `
    <h1 class="heading-l">Sign in</h1>
    ${error ? `<p class="warning-text">${esc(error)}</p>` : ""}
    <form id="login">
      <div class="field"><label for="pin">Staff PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off"></div>
      ${STATIC ? `<p class="hint">Demo PIN: 1234</p>` : ""}
      <button class="button">Sign in</button>
    </form>`;
  document.getElementById("login").addEventListener("submit", (e) => {
    e.preventDefault();
    pin = document.getElementById("pin").value;
    sessionStorageSet("tacsi-pin", pin);
    route();
  });
}

const priorityTag = (p) => `<strong class="tag tag--${esc(p)}">${esc(p)}</strong>`;
const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "None recorded");
const serviceName = (id) => services.find((s) => s.id === id)?.name ?? id;

async function renderList() {
  const { cases } = await api("/api/cases");
  app.innerHTML = `
    <h1 class="heading-l">Referrals from TACSI</h1>
    <p class="hint">Newest first. Urgent cases need a same-day response.</p>
    ${
      cases.length
        ? `<table><thead><tr><th>Reference</th><th>Priority</th><th>Summary</th><th>Language</th><th>Received</th><th>Status</th></tr></thead><tbody>
      ${cases
        .map(
          (c) => `<tr><td><a href="#${esc(c.reference)}">${esc(c.reference)}</a></td><td>${priorityTag(c.priority)}</td><td>${esc(c.headline)}</td>
          <td>${esc(c.language)}</td><td>${new Date(c.createdAt).toLocaleString("en-GB")}</td><td><span class="tag tag--status">${esc(c.status)}</span></td></tr>`,
        )
        .join("")}</tbody></table>`
        : `<p>No referrals yet. Complete a conversation on the <a href="./">citizen screen</a> and choose to send it to a support worker.</p>`
    }
    <button class="button button--secondary" id="refresh">Refresh</button>`;
  document.getElementById("refresh").addEventListener("click", route);
}

async function renderCase(ref) {
  const c = await api(`/api/cases/${encodeURIComponent(ref)}`);
  const s = c.report.staff;
  const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  app.innerHTML = `
    <p><a href="#">Back to all referrals</a></p>
    <span class="meta">${esc(c.reference)} · received ${new Date(c.createdAt).toLocaleString("en-GB")} · ${esc(c.session.place ?? "")} · engine: ${esc(c.engine)}</span>
    <h1 class="heading-l">${esc(s.headline)}</h1>
    <p>${priorityTag(s.priority)} ${esc(s.priority_reason)}</p>
    ${s.safeguarding_flags.length ? `<div class="urgent"><div><h2 class="heading-s">Safeguarding</h2>${list(s.safeguarding_flags)}</div></div>` : ""}

    <h2 class="heading-m">Triage</h2>
    <dl class="summary-list">
      ${row("Triage type", esc(s.triage_types.join(", ")))}
      ${row("Presenting issues", list(s.presenting_issues.map((i) => `${i.topic}: ${i.description}`)))}
      ${row("What the person wants", esc(s.person_goals))}
      ${row("Key facts", list(s.key_facts))}
      ${row("Deadlines", list(s.deadlines))}
      ${row("Access needs", list([`Preferred language: ${c.session.languageName ?? "unknown"}`, ...s.access_needs]))}
      ${row("Still to find out", list(s.unknowns))}
    </dl>

    <h2 class="heading-m">Recommended actions</h2>
    ${list(s.recommended_actions)}

    <h2 class="heading-m">Referrals given to the person</h2>
    <dl class="summary-list">${s.referrals.map((r) => row(serviceName(r.service_id), esc(r.rationale))).join("")}</dl>

    <h2 class="heading-m">Conversation</h2>
    <div class="transcript">
      ${c.transcript
        .map(
          (m) => `<p><strong>${m.role === "user" ? "Person" : "TACSI"}:</strong> ${esc(m.text)}
          ${m.english && m.english !== m.text ? `<span class="en">English: ${esc(m.english)}</span>` : ""}</p>`,
        )
        .join("")}
    </div>

    <h2 class="heading-m">Update status</h2>
    <div class="button-row no-print">
      ${["new", "in-progress", "closed"].map((st) => `<button class="button ${st === c.status ? "" : "button--secondary"}" data-status="${st}">${st}</button>`).join("")}
      ${STATIC ? "" : `<button class="button button--secondary" id="print">Print</button>
      <button class="button button--secondary" id="download">Download JSON</button>`}
    </div>`;
  app.querySelectorAll("[data-status]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/cases/${encodeURIComponent(ref)}`, { method: "PATCH", body: JSON.stringify({ status: b.dataset.status }) });
      renderCase(ref);
    }),
  );
  document.getElementById("print")?.addEventListener("click", () => window.print());
  document.getElementById("download")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${c.reference}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

async function route() {
  if (!pin) return renderLogin();
  try {
    const ref = location.hash.slice(1);
    await (ref ? renderCase(ref) : renderList());
    window.scrollTo(0, 0);
  } catch (err) {
    if (err.message !== "unauthorised") app.innerHTML = `<p class="warning-text">${esc(err.message)}</p><p><a href="#">Back</a></p>`;
  }
}

fetch("/api/knowledge")
  .then((r) => r.json())
  .then((k) => (services = k.services))
  .finally(route);
window.addEventListener("hashchange", route);
