import React from 'react';
import { Citation } from '../types';

interface CitationDrawerProps {
  isOpen: boolean;
  citations: Citation[];
  onClose: () => void;
}

export const CitationDrawer: React.FC<CitationDrawerProps> = ({ isOpen, citations, onClose }) => {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/10 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm bg-card-auralis border-l border-auralis shadow-2xl animate-slide-left overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-auralis bg-[#F7F7F5]">
          <div>
            <h2 className="text-sm font-semibold text-primary">Source Citations</h2>
            <p className="text-xs text-secondary-auralis mt-0.5">
              {citations.length} source{citations.length !== 1 ? 's' : ''} · hybrid search + reranking
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors duration-200"
          >
            <span className="material-symbols-outlined text-[20px] text-secondary-auralis">close</span>
          </button>
        </div>

        {/* Citation cards */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-card-auralis">
          {citations.map((citation, idx) => (
            <div
              key={citation.citation_id}
              className="bg-white border border-auralis rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow animate-slide-up"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                    <span className="material-symbols-outlined text-emerald-600 text-[16px]">description</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-primary truncate max-w-[180px]">
                      {citation.document_name}
                    </p>
                    <p className="text-[10px] text-secondary-auralis font-medium uppercase tracking-wider mt-0.5">Page {citation.page_number}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-500/15 px-2 py-1 rounded-md border border-emerald-500/20">
                  #{idx + 1}
                </span>
              </div>

              {/* Relevance bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-[10px] text-secondary-auralis font-semibold tracking-wider uppercase mb-1.5">
                  <span>Relevance</span>
                  <span>{Math.round(citation.similarity_score * 100)}%</span>
                </div>
                <div className="h-1.5 bg-black/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round(citation.similarity_score * 100)}%` }}
                  />
                </div>
              </div>

              {/* Why this source? — how each retriever ranked it */}
              {(citation.semantic_rank || citation.keyword_rank || citation.rerank_score != null) && (
                <div className="grid grid-cols-3 gap-1.5 mb-4">
                  {[
                    { label: 'Semantic', value: citation.semantic_rank ? `#${citation.semantic_rank}` : '—', icon: 'hub', tip: 'Rank by embedding (meaning) similarity' },
                    { label: 'Keyword', value: citation.keyword_rank ? `#${citation.keyword_rank}` : '—', icon: 'text_fields', tip: 'Rank by BM25 exact-term match' },
                    { label: 'Reranker', value: citation.rerank_score != null ? `${Math.round(citation.rerank_score * 100)}%` : 'off', icon: 'sort', tip: 'Cross-encoder relevance to the question' },
                  ].map((m) => (
                    <div key={m.label} title={m.tip} className="bg-[#F7F7F5] border border-auralis rounded-lg px-2 py-1.5 text-center">
                      <p className="text-[9px] text-secondary-auralis font-semibold uppercase tracking-wider flex items-center justify-center gap-0.5">
                        <span className="material-symbols-outlined text-[11px]">{m.icon}</span>{m.label}
                      </p>
                      <p className="text-xs font-bold text-primary mt-0.5">{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Excerpt */}
              <div className="text-sm text-secondary-auralis leading-relaxed bg-[#F7F7F5] rounded-xl p-4 border border-auralis">
                <p className="line-clamp-[12] font-body-md">"{citation.context_snippet || citation.excerpt}"</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
