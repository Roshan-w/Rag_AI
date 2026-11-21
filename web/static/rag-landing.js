import { initTheme, checkStatus } from "/static/common.js";

initTheme();
checkStatus(document.getElementById("status"), { online: "Qwen is ready", offline: "Model offline" });

// Reveal on scroll
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { threshold: 0.1 });
document.querySelectorAll(".reveal").forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 60}ms`; io.observe(el); });

// Presentation: video / slides tabs
const tabs = [...document.querySelectorAll("[data-ptab]")];
tabs.forEach((t) => t.addEventListener("click", () => {
  tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
  document.querySelectorAll("[data-pbody]").forEach((b) => { b.hidden = b.dataset.pbody !== t.dataset.ptab; });
  if (t.dataset.ptab === "slides") document.querySelector("video")?.pause();
}));

// Slides viewer
const TOTAL = 11;
let slide = 1;
const img = document.getElementById("slide"), prev = document.getElementById("slPrev"), next = document.getElementById("slNext");
function show(n) {
  slide = Math.min(TOTAL, Math.max(1, n));
  img.src = `/media/slides/slide_${slide}.png`;
  img.alt = `Slide ${slide} of ${TOTAL}`;
  document.getElementById("slCount").textContent = `${slide} / ${TOTAL}`;
  prev.disabled = slide === 1; next.disabled = slide === TOTAL;
}
prev.addEventListener("click", () => show(slide - 1));
next.addEventListener("click", () => show(slide + 1));
document.addEventListener("keydown", (e) => {
  if (document.querySelector('[data-pbody="slides"]').hidden) return;
  if (e.key === "ArrowRight") show(slide + 1);
  if (e.key === "ArrowLeft") show(slide - 1);
});
show(1);
