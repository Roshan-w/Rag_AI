import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";
import { initTheme, checkStatus } from "/static/common.js";
import { setPip } from "/static/mascot.js";

pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";

const DEMO = ["admissions-policy.pdf", "fee-circular.pdf", "programme-handbook.pdf"];
const MAX_DOCS = 12, MAX_CHARS = 900_000, TICKS = 30, CHATS_KEY = "ragai-chats", PAGE_CHARS = 2500;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pip = $("#pip");

let docs = [];          // {id, name, kind, pages[], words, status: busy|ok|bad, error, added}
let chats = [];         // [{id, title, updated, messages: [...]}]
let chat = null;        // current chat
let running = false;

/* ================= storage ================= */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open("ragai", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "id" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function dbAll() {
  try { const db = await idb; return await new Promise((res) => { const q = db.transaction("docs").objectStore("docs").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); }
  catch { return []; }
}
async function dbPut(d) { try { const db = await idb; db.transaction("docs", "readwrite").objectStore("docs").put(d); } catch {} }
async function dbDel(id) { try { const db = await idb; db.transaction("docs", "readwrite").objectStore("docs").delete(id); } catch {} }
function saveChats() { try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 20))); } catch {} }
function loadChats() { try { return JSON.parse(localStorage.getItem(CHATS_KEY)) || []; } catch { return []; } }

/* ================= helpers ================= */
function toast(msg) {
  $(".toast")?.remove();
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg, role: "status" });
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}
function notice(msg) { const n = $("#notice"); n.textContent = msg || ""; n.hidden = !msg; }
function greet() {
  const h = new Date().getHours();
  $("#greet").textContent = h < 12 ? "Good morning!" : h < 17 ? "Good afternoon!" : "Good evening!";
}
const readyDocs = () => docs.filter((d) => d.status === "ok");
const payloadDocs = () => readyDocs().map(({ name, pages }) => ({ name, pages }));

/* ================= reading files ================= */
function splitPages(text) {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/);
  const pages = []; let cur = "";
  for (const p of paras) {
    if (cur.length + p.length > PAGE_CHARS && cur) { pages.push(cur.trim()); cur = ""; }
    cur += p + "\n\n";
  }
  if (cur.trim()) pages.push(cur.trim());
  return pages.length ? pages : [text];
}
async function readFile(name, buffer) {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 400); i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      pages.push(c.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim());
    }
    return { kind: "PDF", pages };
  }
  if (ext === "docx") {
    if (!window.mammoth) throw new Error("Word reader is still loading, try again in a moment");
    const r = await window.mammoth.extractRawText({ arrayBuffer: buffer });
    return { kind: "DOCX", pages: splitPages(r.value) };
  }
  if (ext === "txt" || ext === "md") return { kind: "TXT", pages: splitPages(new TextDecoder().decode(buffer)) };
  throw new Error("Unsupported file type");
}
async function addFile(name, buffer) {
  if (docs.length >= MAX_DOCS) return toast(`Up to ${MAX_DOCS} documents per library`);
  if (docs.some((d) => d.name === name)) return toast(`${name} is already in the library`);
  const doc = { id: crypto.randomUUID(), name, kind: "", pages: [], words: 0, status: "busy", added: Date.now() };
  docs.push(doc); renderDocs();
  try {
    const r = await readFile(name, buffer);
    doc.kind = r.kind; doc.pages = r.pages;
    doc.words = r.pages.join(" ").split(/\s+/).filter(Boolean).length;
    if (!doc.words) throw new Error("No text found (scanned file?)");
    if (docs.reduce((s, d) => s + d.pages.join("").length, 0) > MAX_CHARS) throw new Error("Library is full for the online demo");
    doc.status = "ok";
    dbPut({ ...doc });
  } catch (e) {
    doc.status = "bad";
    doc.error = /password/i.test(`${e?.name} ${e?.message}`) ? "Password protected" : (e?.message || "Could not read this file");
  }
  renderDocs(); renderInsightsSelect();
}
function handleFiles(list) {
  for (const f of [...list]) {
    if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) { toast(`${f.name}: only PDF, Word or text files`); continue; }
    f.arrayBuffer().then((b) => addFile(f.name, b));
  }
}
async function loadDemo() {
  for (const n of DEMO) {
    if (docs.some((d) => d.name === n)) continue;
    const r = await fetch(`/samples/${n}`);
    if (r.ok) await addFile(n, await r.arrayBuffer());
  }
  closeSide(); selectTab("library");
  toast("Demo library loaded: 3 university documents");
}
function removeDoc(id) { docs = docs.filter((d) => d.id !== id); dbDel(id); renderDocs(); renderInsightsSelect(); }

function renderDocs() {
  const info = (d) => d.status === "bad" ? d.error : d.status === "busy" ? "Reading…" : `${d.kind} · ${d.pages.length} ${d.pages.length === 1 ? "page" : "pages"} · ${d.words.toLocaleString()} words`;
  $("#doc-list").innerHTML = docs.map((d) => `
    <li class="doc" data-id="${d.id}">
      <span class="pdf">${esc(d.kind || "…")}</span>
      <span class="info"><span class="nm">${esc(d.name)}</span><small>${esc(info(d))}</small></span>
      <span class="st ${d.status}" title="${d.status === "ok" ? "Indexed" : d.status === "busy" ? "Reading" : "Problem"}"></span>
      <button type="button" aria-label="Remove ${esc(d.name)}">×</button>
    </li>`).join("");
  $$("#doc-list .doc button").forEach((b) => b.addEventListener("click", () => removeDoc(b.closest("[data-id]").dataset.id)));
  $("#doc-empty").hidden = docs.length > 0;
  const ok = readyDocs();
  $("#lib-count").textContent = ok.length; $("#lib-count").hidden = !ok.length;
  // composer scope chips
  const shown = ok.slice(0, 3);
  $("#scope").innerHTML = ok.length ? shown.map((d) => `<span class="att"><span class="pdf">${esc(d.kind)}</span><span class="nm">${esc(d.name)}</span></span>`).join("") +
    (ok.length > 3 ? `<span class="more">+${ok.length - 3} more</span>` : "") : "";
  // library meter: share of the online library capacity
  const chars = ok.reduce((s, d) => s + d.pages.join("").length, 0), pages = ok.reduce((s, d) => s + d.pages.length, 0);
  const pct = Math.min(100, Math.round((chars / MAX_CHARS) * 100));
  $("#ctx-label").textContent = ok.length ? `${pages} pages · ${Math.round(chars / 1000)}K characters indexed` : "No documents yet";
  $("#ctx-pct").textContent = `${ok.length} ${ok.length === 1 ? "doc" : "docs"}`;
  const on = ok.length ? Math.max(1, Math.round((TICKS * pct) / 100)) : 0;
  $("#ctx-meter").innerHTML = Array.from({ length: TICKS }, (_, i) => `<i class="${i < on ? "on" : ""}${i === on - 1 ? " last" : ""}"></i>`).join("");
  $("#hint").textContent = docs.some((d) => d.status === "busy") ? "Reading files…" : ok.length ? "Enter to send" : "Add documents first";
}

/* ================= markdown + citations ================= */
function renderAnswer(md, sources = []) {
  const tpl = document.createElement("template");
  tpl.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: false }));
  tpl.content.querySelectorAll("table").forEach((t) => { const w = Object.assign(document.createElement("div"), { className: "table-wrap" }); t.replaceWith(w); w.append(t); });
  // [Doc: name, Page: 3]  (also tolerate "Pages: 3, 4" and several in one bracket separated by ;)
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const RE = /\[((?:Doc(?:ument)?:\s*[^\]]+?,\s*Pages?:\s*[\d,\s\-–]+;?\s*)+)\]/gi;
  for (const n of nodes) {
    if (!RE.test(n.nodeValue)) continue;
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment(); let last = 0, m;
    const text = n.nodeValue;
    while ((m = RE.exec(text))) {
      frag.append(text.slice(last, m.index));
      for (const part of m[1].split(";")) {
        const mm = /Doc(?:ument)?:\s*(.+?),\s*Pages?:\s*([\d]+)/i.exec(part);
        if (!mm) continue;
        const b = document.createElement("button");
        b.type = "button"; b.className = "cite"; b.dataset.doc = mm[1].trim(); b.dataset.page = mm[2];
        b.textContent = `${mm[1].trim().replace(/\.(pdf|docx|txt|md)$/i, "")} · p.${mm[2]}`;
        frag.append(b);
      }
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    n.replaceWith(frag);
  }
  return tpl.innerHTML;
}

function openSource(docName, page, sources = []) {
  const d = docs.find((x) => x.name === docName) || docs.find((x) => x.name.startsWith(docName));
  $("#dr-doc").textContent = docName;
  $("#dr-page").textContent = `Page ${page}`;
  const hits = sources.filter((s) => s.doc === (d?.name || docName) && +s.page === +page);
  let html = "";
  if (hits.length) html += `<div class="dr-label">Passage used for this answer</div>` + hits.map((h) => `<div class="dr-pass match">${esc(h.text)}</div>`).join("");
  if (d && d.pages[page - 1]) html += `<div class="dr-label">Full page ${page}</div><div class="dr-pass">${esc(d.pages[page - 1])}</div>`;
  else if (!hits.length) html += `<p class="empty-note">This document isn't in your library anymore, so the page can't be shown.</p>`;
  $("#dr-body").innerHTML = html;
  $("#drawer").hidden = false;
}

/* ================= chat ================= */
function newChat() {
  chat = { id: crypto.randomUUID(), title: "New chat", updated: Date.now(), messages: [] };
  renderThread();
}
function persistChat() {
  if (!chat.messages.length) return;
  chat.updated = Date.now();
  chats = [chat, ...chats.filter((c) => c.id !== chat.id)];
  saveChats(); renderRecent();
}

function msgEl(m) {
  const el = document.createElement("div");
  if (m.role === "user") {
    el.className = "msg user";
    el.innerHTML = `<div class="bubble">${esc(m.content)}</div>`;
    return el;
  }
  el.className = "msg bot";
  el.innerHTML = `<div class="pip avatar"></div><div class="card${m.error ? " error" : ""}">
      <div class="mode-tag"></div><div class="md"></div><div class="msg-foot" hidden></div></div>`;
  import("/static/mascot.js").then(({ mountPip }) => mountPip(el.querySelector(".avatar")));
  fillBot(el, m);
  return el;
}

const MODE_LABEL = { rag: "Answered from your documents", library: "About your library", chat: "Chat", not_found: "Not found in your documents" };
function fillBot(el, m, streaming = false) {
  const card = el.querySelector(".card");
  card.classList.toggle("error", !!m.error);
  const tag = el.querySelector(".mode-tag");
  tag.className = `mode-tag ${m.mode || ""}`;
  tag.textContent = m.mode ? MODE_LABEL[m.mode] || "" : "Thinking…";
  tag.hidden = !m.mode && !streaming;
  const md = el.querySelector(".md");
  if (m.error) md.textContent = m.error;
  else if (!m.content) md.innerHTML = `<div class="skeleton"><i></i><i></i><i></i><i></i></div>`;
  else md.innerHTML = renderAnswer(m.content, m.sources);
  md.classList.toggle("caret", streaming && !!m.content);
  $$(".cite", md).forEach((b) => b.addEventListener("click", () => openSource(b.dataset.doc, b.dataset.page, m.sources || [])));
  const foot = el.querySelector(".msg-foot");
  if (streaming || m.error || !m.content) { foot.hidden = true; return; }
  foot.hidden = false;
  const srcs = m.sources || [];
  foot.innerHTML = `
    <button class="tool" data-act="copy" type="button">Copy</button>
    ${srcs.length ? `<button class="tool" data-act="audit" type="button">${m.audit ? "Re-audit" : "Audit claims"}</button>` : ""}
    <span class="msg-meta">${m.seconds ? `Qwen 2.5 14B · ${m.seconds}s` : ""}</span>
    ${srcs.length ? `<div class="srcs">${srcs.map((s, i) => `<button class="src" type="button" data-i="${i}"><b>S${i + 1}</b>${esc(s.doc)} · p.${s.page}</button>`).join("")}</div>` : ""}
    <div class="audit-slot"></div>`;
  foot.querySelector('[data-act="copy"]').onclick = async () => { await navigator.clipboard.writeText(m.content); toast("Copied"); };
  foot.querySelector('[data-act="audit"]')?.addEventListener("click", () => runAudit(el, m));
  $$(".src", foot).forEach((b) => b.addEventListener("click", () => { const s = srcs[+b.dataset.i]; openSource(s.doc, s.page, srcs); }));
  if (m.audit) renderAudit(foot.querySelector(".audit-slot"), m.audit);
}

function renderThread() {
  const th = $("#thread");
  th.innerHTML = "";
  for (const m of chat.messages) th.append(msgEl(m));
  $("#center").classList.toggle("chatting", chat.messages.length > 0);
}

async function ask(question = $("#question").value.trim()) {
  if (running) return;
  if (!question) { $("#question").focus(); return notice("Type a question first."); }
  if (docs.some((d) => d.status === "busy")) return notice("Still reading your files, one moment.");
  notice("");
  $("#question").value = ""; autoGrow();
  const history = chat.messages.slice(-4).map((m) => ({ role: m.role, content: (m.content || "").slice(0, 600) }));
  const user = { role: "user", content: question };
  const bot = { role: "assistant", content: "", sources: [], mode: "" };
  if (!chat.messages.length) chat.title = question.slice(0, 70);
  chat.messages.push(user, bot);
  $("#center").classList.add("chatting");
  $("#thread").append(msgEl(user));
  const el = msgEl(bot); $("#thread").append(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
  running = true; $("#send").disabled = true; $("#send").classList.add("busy"); setPip(pip, "think");
  const started = performance.now(); let frame = 0;
  try {
    const res = await fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, docs: payloadDocs(), history, general: $("#general").checked }),
    });
    if (!res.ok || !res.body) { let msg = `Request failed (HTTP ${res.status}).`; try { msg = (await res.json()).message || msg; } catch {} throw new Error(msg); }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "meta") { bot.mode = ev.mode; bot.sources = ev.sources || []; fillBot(el, bot, true); }
        else if (ev.type === "token") { bot.content += ev.t; if (!frame) frame = requestAnimationFrame(() => { frame = 0; fillBot(el, bot, true); el.scrollIntoView({ block: "end" }); }); }
        else if (ev.type === "error") throw new Error(ev.message);
      }
    }
    if (!bot.content.trim()) throw new Error("The model returned an empty answer.");
    bot.seconds = ((performance.now() - started) / 1000).toFixed(1);
    setPip(pip, "happy"); setTimeout(() => setPip(pip, "idle"), 1600);
  } catch (e) {
    bot.error = e.message || "Something went wrong.";
    setPip(pip, "sad"); setTimeout(() => setPip(pip, "idle"), 2500);
  }
  cancelAnimationFrame(frame);
  fillBot(el, bot);
  running = false; $("#send").disabled = false; $("#send").classList.remove("busy");
  persistChat();
  checkStatus($("#status"));
}

/* ================= audit ================= */
async function runAudit(el, m) {
  const slot = el.querySelector(".audit-slot");
  slot.innerHTML = `<div class="busy-note">Checking each claim against its sources…</div>`;
  try {
    const r = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: m.content, sources: m.sources }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    m.audit = data; persistChat(); renderAudit(slot, data);
  } catch (e) { slot.innerHTML = `<div class="err-note">${esc(e.message)}</div>`; }
}
function renderAudit(slot, a) {
  if (!a.claims?.length) { slot.innerHTML = `<div class="audit"><span>No checkable claims were found in this answer.</span></div>`; return; }
  const pct = Math.round((a.faithfulness ?? 0) * 100);
  slot.innerHTML = `<div class="audit"><div class="audit-top"><div class="dots">${pct}%</div><span>faithfulness · ${a.claims.filter((c) => c.verdict === "supported").length} of ${a.claims.length} claims fully supported</span></div>
    ${a.claims.map((c) => `<div class="claim"><span class="verdict ${c.verdict}">${c.verdict}</span><span>${esc(c.claim)}</span>${c.evidence ? `<em>“${esc(c.evidence)}”${c.document_name ? ` · ${esc(c.document_name)} p.${c.page_number}` : ""}</em>` : ""}</div>`).join("")}</div>`;
}

/* ================= insights ================= */
function renderInsightsSelect() {
  const sel = $("#ins-doc"), cur = sel.value;
  sel.innerHTML = readyDocs().map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("") || `<option value="">Add a document first</option>`;
  if (readyDocs().some((d) => d.id === cur)) sel.value = cur;
}
async function runInsights() {
  const d = readyDocs().find((x) => x.id === $("#ins-doc").value);
  const out = $("#ins-out");
  if (!d) { out.innerHTML = `<div class="err-note">Add a document to the library first.</div>`; return; }
  out.innerHTML = `<div class="busy-note">Reading ${esc(d.name)} and writing a study guide…</div>`;
  $("#ins-run").disabled = true; setPip(pip, "think");
  try {
    const r = await fetch("/api/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: { name: d.name, pages: d.pages } }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    out.innerHTML = `
      ${data.summary ? `<div class="ins-block"><h4>Summary</h4><p>${esc(data.summary)}</p></div>` : ""}
      ${data.faq?.length ? `<div class="ins-block"><h4>Likely questions</h4>${data.faq.map((q) => `<button class="faq-q" type="button">${esc(q)}</button>`).join("")}</div>` : ""}
      ${data.quiz?.length ? `<div class="ins-block"><h4>Quick quiz</h4>${data.quiz.map((q, i) => `<div class="quiz" data-a="${+q.answer_index || 0}"><p>${i + 1}. ${esc(q.question)}</p>${q.options.map((o, j) => `<button type="button" data-j="${j}">${esc(o)}</button>`).join("")}</div>`).join("")}</div>` : ""}`;
    $$(".faq-q", out).forEach((b) => b.addEventListener("click", () => { closeSide(); ask(b.textContent); }));
    $$(".quiz", out).forEach((qz) => $$("button", qz).forEach((b) => b.addEventListener("click", () => {
      const right = +qz.dataset.a;
      $$("button", qz).forEach((x) => { x.disabled = true; if (+x.dataset.j === right) x.classList.add("right"); });
      if (+b.dataset.j !== right) b.classList.add("wrong");
    })));
    setPip(pip, "happy"); setTimeout(() => setPip(pip, "idle"), 1500);
  } catch (e) { out.innerHTML = `<div class="err-note">${esc(e.message)}</div>`; setPip(pip, "idle"); }
  $("#ins-run").disabled = false;
}

/* ================= timeline ================= */
async function runTimeline() {
  const out = $("#tl-out");
  if (!readyDocs().length) { out.innerHTML = `<div class="err-note">Add documents to the library first.</div>`; return; }
  out.innerHTML = `<div class="busy-note">Collecting dated facts from every document…</div>`;
  $("#tl-run").disabled = true; setPip(pip, "think");
  try {
    const r = await fetch("/api/timeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: $("#tl-q").value, docs: payloadDocs() }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    out.innerHTML = data.events?.length
      ? `<div class="ins-block"><h4>${esc(data.title)}</h4></div><div class="tl">${data.events.map((e) => `<div class="tl-e"><b>${esc(e.date)}</b><span>${esc(e.event)}</span>${e.document_name ? `<small>${esc(e.document_name)} · p.${e.page_number}</small>` : ""}</div>`).join("")}</div>`
      : `<p class="empty-note">No dated facts were found for this topic.</p>`;
    setPip(pip, "idle");
  } catch (e) { out.innerHTML = `<div class="err-note">${esc(e.message)}</div>`; setPip(pip, "idle"); }
  $("#tl-run").disabled = false;
}

/* ================= history ================= */
function renderRecent() {
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5.5h16v10H9l-5 4Z"/></svg>';
  $("#recent").innerHTML = chats.slice(0, 8).map((c) => `<li><button type="button" data-id="${c.id}"><span class="r-ic">${ICON}</span>
      <span class="r-t"><b>${esc(c.title)}</b><small>${Math.floor(c.messages.length / 2)} question${c.messages.length > 2 ? "s" : ""} · ${new Date(c.updated).toLocaleDateString()}</small></span>
      <span class="r-dot${c.id === chat?.id ? "" : " idle"}"></span></button></li>`).join("");
  $$("#recent button").forEach((b) => b.addEventListener("click", () => { chat = chats.find((c) => c.id === b.dataset.id); renderThread(); renderRecent(); closeSide(); }));
  $("#recent-empty").hidden = chats.length > 0;
  $("#recent-count").textContent = chats.length;
  $("#hist-count").textContent = chats.length; $("#hist-count").hidden = !chats.length;
}
function exportChat() {
  if (!chat.messages.length) return toast("Nothing to export yet");
  const md = `# ${chat.title}\n\n` + chat.messages.map((m) => m.role === "user" ? `**You:** ${m.content}` : `**RAG.AI:**\n\n${m.content || m.error || ""}`).join("\n\n---\n\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([md], { type: "text/markdown" })), download: "ragai-chat.md" });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ================= voice ================= */
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("#mic-btn");
  if (!SR) { btn.hidden = true; return; }
  let rec = null;
  btn.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = navigator.language || "en-IN"; rec.interimResults = true;
    const base = $("#question").value;
    rec.onresult = (e) => { $("#question").value = (base + " " + [...e.results].map((r) => r[0].transcript).join(" ")).trim(); autoGrow(); };
    rec.onend = () => { btn.classList.remove("on"); rec = null; };
    rec.onerror = () => { toast("Voice input isn't available right now"); };
    btn.classList.add("on"); rec.start();
  });
}

/* ================= chrome ================= */
function openSide() { $("#side").classList.add("open"); $("#scrim").hidden = false; }
function closeSide() { $("#side").classList.remove("open"); $("#scrim").hidden = true; }
function selectTab(name) {
  $$(".tabs [data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  $$("[data-body]").forEach((b) => { b.hidden = b.dataset.body !== name; });
  const navName = ["insights", "timeline", "library"].includes(name) ? name : "chat";
  $$(".side-nav [data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === navName));
}
const q = () => $("#question");
function autoGrow() { const t = q(); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; }

const actions = {
  chat: () => { closeSide(); q().focus(); },
  library: () => { selectTab("library"); $("#rail").scrollIntoView({ behavior: "smooth" }); closeSide(); },
  insights: () => { selectTab("insights"); $("#rail").scrollIntoView({ behavior: "smooth" }); closeSide(); },
  timeline: () => { selectTab("timeline"); $("#rail").scrollIntoView({ behavior: "smooth" }); closeSide(); },
  history: () => { $("#history").scrollIntoView({ behavior: "smooth" }); closeSide(); },
  demo: loadDemo,
  export: exportChat,
  clearlib: () => { docs.forEach((d) => dbDel(d.id)); docs = []; renderDocs(); renderInsightsSelect(); toast("Library cleared"); },
};

async function init() {
  initTheme(); greet();
  checkStatus($("#status")); setInterval(() => checkStatus($("#status")), 60000);
  docs = (await dbAll()).filter((d) => d.status === "ok").sort((a, b) => a.added - b.added);
  chats = loadChats();
  newChat();
  renderDocs(); renderInsightsSelect(); renderRecent(); initVoice();

  $$("[data-nav]").forEach((b) => b.addEventListener("click", (e) => { const fn = actions[b.dataset.nav]; if (fn) { e.preventDefault(); $("#menu").hidden = true; fn(); } }));
  $$(".tabs [data-tab]").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
  $$(".idea").forEach((b) => b.addEventListener("click", async () => {
    if (!readyDocs().length) await loadDemo();
    ask(b.dataset.q);
  }));
  const file = $("#file");
  [$("#add-btn"), $("#add-btn-2")].forEach((b) => b.addEventListener("click", () => file.click()));
  file.addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  $("#send").addEventListener("click", () => ask());
  $("#ins-run").addEventListener("click", runInsights);
  $("#tl-run").addEventListener("click", runTimeline);
  $("#new-btn").addEventListener("click", () => { newChat(); renderRecent(); q().focus(); });
  $("#new-menu").addEventListener("click", (e) => { e.stopPropagation(); const m = $("#menu"); m.hidden = !m.hidden; $("#new-menu").setAttribute("aria-expanded", String(!m.hidden)); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".split-btn")) $("#menu").hidden = true; });
  $("#side-open").addEventListener("click", openSide);
  $("#side-close").addEventListener("click", closeSide);
  $("#scrim").addEventListener("click", closeSide);
  $("#dr-close").addEventListener("click", () => { $("#drawer").hidden = true; });
  q().addEventListener("input", autoGrow);
  q().addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); ask(); } });
  const cmd = $("#cmd");
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $("#cmd-kbd").textContent = "⌘ K";
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); cmd.focus(); }
    if (e.key === "Escape") { closeSide(); $("#menu").hidden = true; $("#drawer").hidden = true; }
  });
  cmd.addEventListener("keydown", (e) => { if (e.key === "Enter" && cmd.value.trim()) { const v = cmd.value.trim(); cmd.value = ""; ask(v); } });
  const comp = $("#composer");
  ["dragenter", "dragover"].forEach((t) => comp.addEventListener(t, (e) => { e.preventDefault(); comp.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => comp.addEventListener(t, (e) => { e.preventDefault(); if (t === "drop" || !comp.contains(e.relatedTarget)) comp.classList.remove("over"); }));
  comp.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
}
init();
