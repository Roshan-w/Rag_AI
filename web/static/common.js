// Theme switching (moon / sun) and the live model status, shared by both pages.
const KEY = "compare-theme";

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  apply(saved || (prefersDark ? "dark" : "light"));
  document.querySelectorAll("[data-theme-set]").forEach((b) =>
    b.addEventListener("click", () => {
      apply(b.dataset.themeSet);
      try { localStorage.setItem(KEY, b.dataset.themeSet); } catch {}
    }));
}

function apply(mode) {
  document.documentElement.dataset.theme = mode;
  document.querySelectorAll("[data-theme-set]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode)));
}

export async function checkStatus(el, { online = "Qwen is ready", offline = "Model offline" } = {}) {
  if (!el) return false;
  const text = el.querySelector(".status-text");
  try {
    const h = await (await fetch("/api/health", { cache: "no-store" })).json();
    el.classList.toggle("ok", !!h.ok);
    el.classList.toggle("down", !h.ok);
    text.textContent = h.ok ? online : offline;
    el.title = h.ok ? "Qwen 2.5 14B is reachable" : (h.error || "Model server unavailable");
    return !!h.ok;
  } catch {
    el.classList.add("down");
    text.textContent = offline;
    return false;
  }
}

export const icons = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

document.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ""; });
