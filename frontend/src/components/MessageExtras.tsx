import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage, AuditResult, JuryResult, TimelineResult } from '../types';

/* ── Shared bits ─────────────────────────────────────────────────── */

const ActionButton: React.FC<{
  icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; spinning?: boolean;
}> = ({ icon, label, onClick, active, disabled, spinning }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all border disabled:opacity-40 ${
      active
        ? 'bg-primary text-on-primary border-primary'
        : 'text-secondary-auralis border-transparent hover:border-auralis hover:bg-[#F7F7F5] hover:text-primary'
    }`}
  >
    <span className={`material-symbols-outlined text-[14px] ${spinning ? 'animate-spin' : ''}`}>{spinning ? 'progress_activity' : icon}</span>
    <span className="hidden sm:inline">{label}</span>
  </button>
);

const SourceTag: React.FC<{ doc: string | null; page: number | null }> = ({ doc, page }) =>
  doc ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 whitespace-nowrap">
      <span className="material-symbols-outlined text-[12px]">find_in_page</span>
      {doc.length > 18 ? doc.slice(0, 16) + '…' : doc}{page ? ` p.${page}` : ''}
    </span>
  ) : null;

/** Plain text for speech: drop Markdown symbols and inline citation markers. */
const toSpeech = (md: string) =>
  md.replace(/\[Doc:[^\]]*\]/g, '').replace(/[#*_`>|]/g, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();

/* ── Actions row under an assistant message ──────────────────────── */

export const MessageActions: React.FC<{
  message: ChatMessage;
  onRate: (rating: 1 | -1) => void;
  onAudit: () => void;
  onWhy: () => void;
}> = ({ message, onRate, onAudit, onWhy }) => {
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const toggleSpeak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(toSpeech(message.content));
    // Read Hindi/Marathi answers with an Indian voice when the text is in Devanagari
    if (/[ऀ-ॿ]/.test(message.content)) utterance.lang = 'hi-IN';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const hasSources = !!message.citations?.length;
  const isPlainAnswer = !message.jury && !message.timeline;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-3 -mb-1">
      <ActionButton icon="thumb_up" label="Helpful" active={message.feedback === 1} onClick={() => onRate(1)} />
      <ActionButton icon="thumb_down" label="Not helpful" active={message.feedback === -1} onClick={() => onRate(-1)} />
      <span className="w-px h-4 bg-black/10 mx-1" />
      {isPlainAnswer && (
        <ActionButton icon="fact_check" label={message.audit ? 'Audited' : 'Audit answer'} onClick={onAudit}
          disabled={!hasSources || message.auditing || !!message.audit} spinning={message.auditing} active={!!message.audit} />
      )}
      <ActionButton icon="manage_search" label="Why this answer?" onClick={onWhy} disabled={!hasSources} />
      {canSpeak && message.content && (
        <ActionButton icon={speaking ? 'stop_circle' : 'volume_up'} label={speaking ? 'Stop' : 'Listen'} onClick={toggleSpeak} active={speaking} />
      )}
      {message.cached && (
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-secondary-auralis" title="A near-identical question was answered before; served from the semantic cache">
          <span className="material-symbols-outlined text-[13px]">bolt</span>Cached
        </span>
      )}
      {!message.cached && message.processingTime !== undefined && (
        <span className="ml-auto text-[10px] font-medium text-secondary-auralis">{message.processingTime.toFixed(1)}s</span>
      )}
    </div>
  );
};

/* ── Answer audit ────────────────────────────────────────────────── */

const VERDICT_STYLE: Record<string, { icon: string; cls: string; label: string }> = {
  supported: { icon: 'check_circle', cls: 'text-emerald-600', label: 'Supported' },
  partial: { icon: 'error', cls: 'text-amber-600', label: 'Partial' },
  unsupported: { icon: 'cancel', cls: 'text-red-600', label: 'Unsupported' },
};

export const AuditPanel: React.FC<{ audit: AuditResult; onApplyRevision: () => void }> = ({ audit, onApplyRevision }) => {
  if (!audit.claims.length) {
    return (
      <div className="mt-4 pt-4 border-t border-black/5 text-xs text-secondary-auralis">
        The auditor could not extract factual claims from this answer.
      </div>
    );
  }
  const pct = Math.round((audit.faithfulness ?? 0) * 100);
  const bar = pct >= 85 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const counts = audit.claims.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.verdict]: (acc[c.verdict] || 0) + 1 }), {});

  return (
    <div className="mt-4 pt-4 border-t border-black/5 animate-fade-in">
      <div className="flex items-center justify-between text-[10px] text-secondary-auralis font-semibold tracking-wider uppercase mb-1.5">
        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">fact_check</span>Faithfulness audit</span>
        <span className="text-primary">{pct}%</span>
      </div>
      <div className="h-1.5 bg-black/5 rounded-full overflow-hidden mb-2">
        <div className={`h-full ${bar} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-secondary-auralis mb-3">
        {audit.claims.length} claims checked · {counts.supported || 0} supported · {counts.partial || 0} partial · {counts.unsupported || 0} unsupported
      </p>
      <ul className="space-y-2">
        {audit.claims.map((c, i) => {
          const v = VERDICT_STYLE[c.verdict];
          return (
            <li key={i} className="flex gap-2 items-start bg-[#F7F7F5] border border-auralis rounded-xl p-3">
              <span className={`material-symbols-outlined text-[16px] mt-0.5 ${v.cls}`} title={v.label}>{v.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-primary leading-relaxed">{c.claim}</p>
                {c.evidence && <p className="text-[11px] text-secondary-auralis italic mt-1 line-clamp-2">“{c.evidence}”</p>}
              </div>
              <SourceTag doc={c.document_name} page={c.page_number} />
            </li>
          );
        })}
      </ul>
      {audit.revised_answer && (
        <button
          onClick={onApplyRevision}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-on-primary hover:bg-opacity-90 transition-all shadow-sm"
        >
          <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
          Rewrite using only supported claims
        </button>
      )}
    </div>
  );
};

/* ── Multi-model jury ────────────────────────────────────────────── */

const AGREEMENT_STYLE: Record<string, string> = {
  high: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  low: 'bg-red-500/10 text-red-700 border-red-500/20',
};

export const JuryView: React.FC<{ jury: JuryResult; consensus: string }> = ({ jury, consensus }) => {
  const [open, setOpen] = useState<string | null>(null);
  const a = jury.agreement;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[18px] text-primary">gavel</span>
        <span className="text-xs font-semibold text-primary">Model jury</span>
        {a && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${AGREEMENT_STYLE[a.agreement] || AGREEMENT_STYLE.medium}`}>
            {a.agreement} agreement · {Math.round(a.score)}%
          </span>
        )}
      </div>
      <p className="text-[10px] text-secondary-auralis font-semibold tracking-wider uppercase mb-1">Consensus</p>
      <div className="text-sm leading-relaxed text-primary markdown-content">
        <ReactMarkdown>{consensus}</ReactMarkdown>
      </div>
      {a?.differences && a.differences.length > 0 && (
        <div className="mt-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
          <p className="text-[10px] text-amber-700 font-semibold tracking-wider uppercase mb-1">Where the models disagree</p>
          <ul className="list-disc pl-4 text-xs text-primary space-y-1">
            {a.differences.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {jury.verdicts.map((v) => (
          <button
            key={v.model}
            onClick={() => setOpen(open === v.model ? null : v.model)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
              open === v.model ? 'bg-primary text-on-primary border-primary' : 'bg-white border-auralis text-primary hover:bg-[#F7F7F5]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">{v.error ? 'error' : 'smart_toy'}</span>{v.model}
          </button>
        ))}
      </div>
      {open && (
        <div className="mt-2 bg-[#F7F7F5] border border-auralis rounded-xl p-4 text-xs leading-relaxed markdown-content animate-fade-in">
          <ReactMarkdown>{jury.verdicts.find((v) => v.model === open)?.answer || jury.verdicts.find((v) => v.model === open)?.error || ''}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

/* ── Timeline answer ─────────────────────────────────────────────── */

export const TimelineView: React.FC<{ timeline: TimelineResult }> = ({ timeline }) => (
  <div>
    <div className="flex items-center gap-2 mb-4">
      <span className="material-symbols-outlined text-[18px] text-primary">timeline</span>
      <span className="text-sm font-semibold text-primary">{timeline.title}</span>
    </div>
    <ol className="relative border-l border-black/10 ml-2 space-y-5">
      {timeline.events.map((e, i) => (
        <li key={i} className="ml-5 animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>
          <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-white" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-secondary-auralis">{e.date || e.sort_key}</p>
          <p className="text-sm text-primary leading-relaxed mt-0.5">{e.event}</p>
          <div className="mt-1"><SourceTag doc={e.document_name} page={e.page_number} /></div>
        </li>
      ))}
    </ol>
  </div>
);
