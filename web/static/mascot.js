// "Pip" — an original animated robot mascot drawn in SVG. States: idle | think | happy | sad.
let uid = 0;

function svg(id) {
  return `
<svg class="pip-svg" viewBox="0 0 260 230" role="img" aria-label="Pip, the comparison assistant">
  <defs>
    <radialGradient id="body${id}" cx="35%" cy="28%" r="80%">
      <stop offset="0" stop-color="#fde6e4"/><stop offset=".45" stop-color="#efb9b8"/><stop offset="1" stop-color="#c98a90"/>
    </radialGradient>
    <radialGradient id="limb${id}" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="#fbe0de"/><stop offset=".6" stop-color="#e9acad"/><stop offset="1" stop-color="#c3858c"/>
    </radialGradient>
    <linearGradient id="rim${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".5" stop-color="#c9b6ff" stop-opacity=".55"/><stop offset="1" stop-color="#a98bff" stop-opacity=".6"/>
    </linearGradient>
    <linearGradient id="screen${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a1d22"/><stop offset="1" stop-color="#140e10"/>
    </linearGradient>
    <pattern id="dots${id}" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.35" fill="#fff"/>
    </pattern>
    <pattern id="grid${id}" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r=".55" fill="#ffffff" opacity=".09"/>
    </pattern>
    <mask id="px${id}"><rect width="260" height="230" fill="url(#dots${id})"/></mask>
    <filter id="glow${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <g class="pip-arm pip-arm-l">
    <ellipse cx="44" cy="92" rx="21" ry="40" transform="rotate(-24 44 92)" fill="url(#limb${id})" stroke="url(#rim${id})" stroke-width="1.5"/>
  </g>
  <g class="pip-arm pip-arm-r">
    <ellipse cx="218" cy="150" rx="19" ry="36" transform="rotate(14 218 150)" fill="url(#limb${id})" stroke="url(#rim${id})" stroke-width="1.5"/>
  </g>

  <path d="M84 52 L96 20 Q99 13 104 20 L120 44 Z" fill="url(#limb${id})" stroke="url(#rim${id})" stroke-width="1.2"/>
  <path d="M176 52 L164 20 Q161 13 156 20 L140 44 Z" fill="url(#limb${id})" stroke="url(#rim${id})" stroke-width="1.2"/>

  <rect x="58" y="38" width="144" height="156" rx="64" fill="url(#body${id})" stroke="url(#rim${id})" stroke-width="2"/>
  <ellipse cx="96" cy="62" rx="30" ry="12" fill="#fff" opacity=".45" transform="rotate(-18 96 62)"/>
  <circle cx="70" cy="126" r="8" fill="#c98a90" opacity=".55"/><circle cx="190" cy="126" r="8" fill="#c98a90" opacity=".55"/>

  <rect x="76" y="76" width="108" height="84" rx="28" fill="url(#screen${id})"/>
  <rect x="76" y="76" width="108" height="84" rx="28" fill="url(#grid${id})"/>
  <path d="M86 86 Q130 74 172 88" stroke="#fff" stroke-opacity=".08" stroke-width="8" fill="none" stroke-linecap="round"/>

  <g class="pip-face" filter="url(#glow${id})">
    <g mask="url(#px${id})" fill="#d9c8ff" stroke="#d9c8ff">
      <g class="pip-eyes">
        <g class="pip-happy">
          <path d="M98 117 Q108 100 118 117" fill="none" stroke-width="8" stroke-linecap="round"/>
          <path d="M142 117 Q152 100 162 117" fill="none" stroke-width="8" stroke-linecap="round"/>
        </g>
        <g class="pip-flat">
          <path d="M98 113 H118 M142 113 H162" fill="none" stroke-width="7" stroke-linecap="round"/>
        </g>
        <g class="pip-think" stroke="none">
          <circle class="d1" cx="112" cy="114" r="6"/><circle class="d2" cx="130" cy="114" r="6"/><circle class="d3" cx="148" cy="114" r="6"/>
        </g>
      </g>
      <path class="pip-mouth" d="M121 131 H139 Q139 142 130 142 Q121 142 121 131 Z" stroke="none"/>
      <path class="pip-mouth-sad" d="M120 142 Q130 132 140 142" fill="none" stroke-width="5" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;
}

export function mountPip(el) {
  el.classList.add("pip");
  el.innerHTML = svg(++uid);
  return el;
}

export function setPip(el, state) {
  if (!el) return;
  el.classList.remove("is-think", "is-happy", "is-sad");
  if (state && state !== "idle") el.classList.add("is-" + state);
}

document.querySelectorAll("[data-pip]").forEach(mountPip);
