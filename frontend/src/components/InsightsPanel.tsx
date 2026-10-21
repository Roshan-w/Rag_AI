import React, { useCallback, useEffect, useState } from 'react';
import { DocumentInsights, Conflict, GraphData, EvalReport, QuizItem } from '../types';
import { api } from '../services/api';
import { KnowledgeGraph } from './KnowledgeGraph';

type Tab = 'documents' | 'conflicts' | 'graph' | 'evaluation';

interface InsightsPanelProps {
  isOpen: boolean;
  initialTab?: Tab;
  onClose: () => void;
  onAsk: (question: string) => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'documents', label: 'Study', icon: 'school' },
  { id: 'conflicts', label: 'Conflicts', icon: 'compare_arrows' },
  { id: 'graph', label: 'Knowledge Graph', icon: 'hub' },
  { id: 'evaluation', label: 'Evaluation', icon: 'monitoring' },
];

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white border border-auralis rounded-2xl p-5 shadow-sm ${className}`}>{children}</div>
);

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="bg-[#F7F7F5] border border-auralis rounded-xl p-3">
    <p className="text-[10px] text-secondary-auralis font-semibold uppercase tracking-wider">{label}</p>
    <p className="text-xl font-bold text-primary mt-0.5">{value}</p>
    {hint && <p className="text-[10px] text-secondary-auralis mt-0.5">{hint}</p>}
  </div>
);

/* ── Quiz ── */

const Quiz: React.FC<{ items: QuizItem[] }> = ({ items }) => {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const score = Object.entries(answers).filter(([q, a]) => items[+q].answer_index === a).length;
  return (
    <div className="space-y-4">
      {items.map((q, qi) => (
        <div key={qi}>
          <p className="text-xs font-semibold text-primary mb-2">{qi + 1}. {q.question}{q.page ? <span className="text-secondary-auralis font-normal"> · p.{q.page}</span> : null}</p>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {q.options.map((opt, oi) => {
              const picked = answers[qi] === oi;
              const revealed = answers[qi] !== undefined;
              const correct = oi === q.answer_index;
              return (
                <button
                  key={oi}
                  disabled={revealed}
                  onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                  className={`text-left text-xs px-3 py-2 rounded-lg border transition-all ${
                    revealed && correct ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800'
                      : revealed && picked ? 'bg-red-500/10 border-red-500/30 text-red-700'
                      : 'bg-[#F7F7F5] border-auralis text-primary hover:border-primary'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {Object.keys(answers).length === items.length && (
        <p className="text-sm font-semibold text-primary">Score: {score} / {items.length}</p>
      )}
    </div>
  );
};

/* ── Panel ── */

export const InsightsPanel: React.FC<InsightsPanelProps> = ({ isOpen, initialTab = 'documents', onClose, onAsk }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [insights, setInsights] = useState<DocumentInsights[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [report, setReport] = useState<EvalReport>({});
  const [running, setRunning] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [showQuiz, setShowQuiz] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ins, con, gr, rep] = await Promise.allSettled([
      api.getInsights(), api.getConflicts(), api.getGraph(), api.getEvalReport(),
    ]);
    if (ins.status === 'fulfilled') setInsights(ins.value);
    if (con.status === 'fulfilled') setConflicts(con.value);
    if (gr.status === 'fulfilled') setGraph(gr.value);
    if (rep.status === 'fulfilled') setReport(rep.value);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
    load();
    // Keep polling while insights are still being generated in the background
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [isOpen, initialTab, load]);

  if (!isOpen) return null;

  const ask = (q: string) => { onAsk(q); onClose(); };
  const pending = insights.filter((i) => i.status === 'processing' || i.status === 'missing').length;

  const runEval = async () => {
    setRunning(true);
    try { setReport(await api.runEval()); } finally { setRunning(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-card-auralis border border-auralis rounded-3xl w-full max-w-4xl h-[85vh] relative z-10 shadow-2xl animate-slide-up flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-primary">Document Intelligence</h2>
            <p className="text-xs text-secondary-auralis mt-0.5">
              Generated locally from your documents{pending ? ` · ${pending} still processing…` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors">
            <span className="material-symbols-outlined text-[20px] text-secondary-auralis">close</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pb-3 border-b border-auralis flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-all ${
                tab === t.id ? 'bg-primary text-on-primary' : 'text-secondary-auralis hover:text-primary hover:bg-black/5'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{t.icon}</span>{t.label}
              {t.id === 'conflicts' && conflicts.length > 0 && (
                <span className={`ml-0.5 text-[10px] font-bold px-1.5 rounded-full ${tab === t.id ? 'bg-white text-primary' : 'bg-red-500 text-white'}`}>{conflicts.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Study: summary, FAQ, quiz per document */}
          {tab === 'documents' && (insights.length === 0 ? (
            <p className="text-sm text-secondary-auralis text-center py-12">Upload documents to generate summaries, FAQs and quizzes.</p>
          ) : insights.map((ins) => (
            <Card key={ins.document_id}>
              <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpenDoc(openDoc === ins.document_id ? null : ins.document_id)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 shrink-0 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                    <span className="material-symbols-outlined text-emerald-600 text-[16px]">description</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{ins.filename}</p>
                    <p className="text-[10px] text-secondary-auralis font-medium uppercase tracking-wider">
                      {ins.status === 'ready' ? `${ins.faq?.length || 0} FAQs · ${ins.quiz?.length || 0} quiz questions`
                        : ins.status === 'failed' ? 'Generation failed' : 'Generating insights…'}
                    </p>
                  </div>
                </div>
                {ins.status === 'ready'
                  ? <span className="material-symbols-outlined text-secondary-auralis">{openDoc === ins.document_id ? 'expand_less' : 'expand_more'}</span>
                  : ins.status !== 'failed' && <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />}
              </button>
              {ins.status === 'ready' && openDoc === ins.document_id && (
                <div className="mt-4 space-y-4 animate-fade-in">
                  {ins.summary && <p className="text-sm text-secondary-auralis leading-relaxed bg-[#F7F7F5] rounded-xl p-4 border border-auralis">{ins.summary}</p>}
                  {!!ins.faq?.length && (
                    <div>
                      <p className="text-[10px] text-secondary-auralis font-semibold uppercase tracking-wider mb-2">Frequently asked</p>
                      <div className="flex flex-wrap gap-2">
                        {ins.faq.map((q) => (
                          <button key={q} onClick={() => ask(q)} className="px-3 py-1.5 rounded-full text-[12px] text-primary bg-white border border-auralis hover:border-primary transition-all text-left">{q}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!ins.quiz?.length && (
                    <div>
                      <button onClick={() => setShowQuiz(showQuiz === ins.document_id ? null : ins.document_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-primary text-on-primary hover:bg-opacity-90">
                        <span className="material-symbols-outlined text-[16px]">quiz</span>{showQuiz === ins.document_id ? 'Hide quiz' : 'Take the quiz'}
                      </button>
                      {showQuiz === ins.document_id && <div className="mt-4"><Quiz items={ins.quiz} /></div>}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )))}

          {/* Conflicts between documents */}
          {tab === 'conflicts' && (conflicts.length === 0 ? (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-4xl text-emerald-600">verified</span>
              <p className="text-sm text-primary font-semibold mt-2">No contradictions detected</p>
              <p className="text-xs text-secondary-auralis mt-1">Each new upload is compared against every other document for clashing amounts, dates and rules.</p>
            </div>
          ) : conflicts.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-red-500 text-[18px]">warning</span>
                <p className="text-sm font-semibold text-primary">{c.topic || 'Conflicting information'}</p>
              </div>
              <p className="text-xs text-secondary-auralis mb-3">{c.explanation}</p>
              <div className="grid md:grid-cols-2 gap-3">
                {[c.a, c.b].map((side, i) => (
                  <div key={i} className="bg-[#F7F7F5] border border-auralis rounded-xl p-3">
                    <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">{side.document_name} · p.{side.page_number}</p>
                    <p className="text-xs text-secondary-auralis leading-relaxed line-clamp-6">“{side.text}”</p>
                  </div>
                ))}
              </div>
              <button onClick={() => ask(`Compare what ${c.a.document_name} and ${c.b.document_name} say about ${c.topic || 'this topic'}.`)}
                className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                <span className="material-symbols-outlined text-[15px]">chat</span>Ask the assistant to compare
              </button>
            </Card>
          )))}

          {/* Knowledge graph */}
          {tab === 'graph' && <KnowledgeGraph data={graph} onAsk={ask} />}

          {/* Evaluation & self-tuning */}
          {tab === 'evaluation' && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-secondary-auralis max-w-lg">
                  Auto-generated FAQs and 👍-rated answers form a test set. Each run scores retrieval settings and keeps the best one. Runs nightly, or on demand.
                </p>
                <button onClick={runEval} disabled={running}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-on-primary hover:bg-opacity-90 disabled:opacity-50 shadow-sm">
                  <span className={`material-symbols-outlined text-[16px] ${running ? 'animate-spin' : ''}`}>{running ? 'progress_activity' : 'play_arrow'}</span>
                  {running ? 'Evaluating…' : 'Run evaluation'}
                </button>
              </div>
              {!report.ran_at ? (
                <p className="text-sm text-secondary-auralis text-center py-10">No evaluation has run yet.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Hit rate" value={report.best ? `${Math.round(Math.max(report.best.hit_rate, report.baseline?.hit_rate || 0) * 100)}%` : '—'} hint="right document in top results" />
                    <Stat label="MRR" value={report.best ? Math.max(report.best.mrr, report.baseline?.mrr || 0).toFixed(2) : '—'} hint="how high it ranks" />
                    <Stat label="Feedback" value={`${report.feedback?.up || 0} 👍 / ${report.feedback?.down || 0} 👎`} />
                    <Stat label="Cache hits" value={`${Math.round((report.cache?.hit_rate || 0) * 100)}%`} hint={`${report.cache?.hits || 0} instant answers`} />
                  </div>
                  {report.note && <p className="text-xs text-secondary-auralis">{report.note}</p>}
                  {report.best && (
                    <Card>
                      <p className="text-sm font-semibold text-primary mb-1">
                        {report.applied ? 'Tuned: new retrieval settings applied' : 'Current settings are already the best tested'}
                      </p>
                      <p className="text-xs text-secondary-auralis mb-4">
                        {report.questions} test questions · last run {report.ran_at}
                        {report.baseline && ` · before ${Math.round(report.baseline.hit_rate * 100)}% → best ${Math.round(report.best.hit_rate * 100)}%`}
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-secondary-auralis">
                              <th className="py-1.5">Candidates</th><th>Reranker</th><th>Top-k</th><th>Hit rate</th><th>MRR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.results?.map((r, i) => {
                              const best = report.best && r.candidates === report.best.candidates && r.use_reranker === report.best.use_reranker && r.top_k === report.best.top_k;
                              return (
                                <tr key={i} className={`border-t border-black/5 ${best ? 'font-bold text-primary' : 'text-secondary-auralis'}`}>
                                  <td className="py-1.5">{r.candidates}</td><td>{r.use_reranker ? 'on' : 'off'}</td><td>{r.top_k}</td>
                                  <td>
                                    <div className="flex items-center gap-2">
                                      <div className="w-16 h-1.5 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${r.hit_rate * 100}%` }} /></div>
                                      {Math.round(r.hit_rate * 100)}%
                                    </div>
                                  </td>
                                  <td>{r.mrr.toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                  {!!report.needs_attention?.length && (
                    <Card>
                      <p className="text-sm font-semibold text-primary mb-2">Questions users marked 👎</p>
                      <ul className="space-y-1">
                        {report.needs_attention.map((q, i) => (
                          <li key={i}><button onClick={() => ask(q)} className="text-xs text-secondary-auralis hover:text-primary text-left">• {q}</button></li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
