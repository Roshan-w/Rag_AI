import React, { useEffect, useMemo, useState } from 'react';
import { GraphData } from '../types';

const TYPE_COLORS: Record<string, string> = {
  programme: '#10b981',
  fee: '#f59e0b',
  deadline: '#ef4444',
  department: '#6366f1',
  rule: '#0ea5e9',
  person: '#ec4899',
  organisation: '#8b5cf6',
  document: '#64748b',
  other: '#9ca3af',
};

interface Pos { x: number; y: number }

/** Small force-directed layout (repulsion + springs + centering), run once per graph. */
function layout(data: GraphData, width: number, height: number): Record<string, Pos> {
  const pos: Record<string, Pos & { vx: number; vy: number }> = {};
  data.nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, data.nodes.length)) * Math.PI * 2;
    pos[n.id] = { x: width / 2 + Math.cos(angle) * width * 0.3, y: height / 2 + Math.sin(angle) * height * 0.3, vx: 0, vy: 0 };
  });
  const ids = data.nodes.map((n) => n.id);
  for (let step = 0; step < 300; step++) {
    const cooling = 1 - step / 300;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = 2200 / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    data.edges.forEach((e) => {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 90) * 0.02;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    });
    ids.forEach((id) => {
      const p = pos[id];
      p.vx += (width / 2 - p.x) * 0.004;
      p.vy += (height / 2 - p.y) * 0.004;
      p.x = Math.min(width - 30, Math.max(30, p.x + p.vx * cooling));
      p.y = Math.min(height - 20, Math.max(20, p.y + p.vy * cooling));
      p.vx *= 0.5; p.vy *= 0.5;
    });
  }
  return pos;
}

export const KnowledgeGraph: React.FC<{ data: GraphData; onAsk: (question: string) => void }> = ({ data, onAsk }) => {
  const width = 720, height = 460;
  const positions = useMemo(() => layout(data, width, height), [data]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [data]);

  const degree = useMemo(() => {
    const d: Record<string, number> = {};
    data.edges.forEach((e) => { d[e.source] = (d[e.source] || 0) + 1; d[e.target] = (d[e.target] || 0) + 1; });
    return d;
  }, [data]);

  if (!data.nodes.length) {
    return <p className="text-sm text-secondary-auralis text-center py-12">The graph appears once document insights finish generating.</p>;
  }

  const sel = data.nodes.find((n) => n.id === selected);
  const linked = new Set(data.edges.filter((e) => e.source === selected || e.target === selected).flatMap((e) => [e.source, e.target]));
  const types = [...new Set(data.nodes.map((n) => n.type))];

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-2">
        {types.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-secondary-auralis">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLORS[t] || TYPE_COLORS.other }} />{t}
          </span>
        ))}
      </div>
      <div className="bg-[#F7F7F5] border border-auralis rounded-2xl overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none" onClick={() => setSelected(null)}>
          {data.edges.map((e, i) => {
            const a = positions[e.source], b = positions[e.target];
            if (!a || !b) return null;
            const on = selected && (e.source === selected || e.target === selected);
            return (
              <g key={i} opacity={selected && !on ? 0.12 : 1}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? '#000' : '#d4d4d4'} strokeWidth={on ? 1.5 : 1} />
                {on && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} fontSize="9" textAnchor="middle" fill="#525252">{e.label}</text>
                )}
              </g>
            );
          })}
          {data.nodes.map((n) => {
            const p = positions[n.id];
            const r = 5 + Math.min(9, (degree[n.id] || 0) * 1.5);
            const dim = selected && n.id !== selected && !linked.has(n.id);
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.15 : 1} className="cursor-pointer"
                onClick={(ev) => { ev.stopPropagation(); setSelected(n.id === selected ? null : n.id); }}>
                <circle r={r} fill={TYPE_COLORS[n.type] || TYPE_COLORS.other} stroke="#fff" strokeWidth={2} />
                <text y={r + 11} fontSize="10" textAnchor="middle" fill="#1c1b1b" fontWeight={n.id === selected ? 700 : 500}>
                  {n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {sel && (
        <div className="mt-3 flex items-center justify-between gap-3 bg-white border border-auralis rounded-xl p-3 animate-fade-in">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary truncate">{sel.label}</p>
            <p className="text-[11px] text-secondary-auralis truncate">{sel.type} · in {sel.documents.join(', ')}</p>
          </div>
          <button
            onClick={() => onAsk(`What do the documents say about ${sel.label}?`)}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-on-primary hover:bg-opacity-90"
          >
            <span className="material-symbols-outlined text-[15px]">chat</span>Ask about this
          </button>
        </div>
      )}
    </div>
  );
};
