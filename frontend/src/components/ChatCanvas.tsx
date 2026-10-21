import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage, Citation } from '../types';
import { MessageActions, AuditPanel, JuryView, TimelineView } from './MessageExtras';

interface ChatCanvasProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onCitationClick: (citations: Citation[]) => void;
  suggestions?: string[];
  onSuggestionClick?: (question: string) => void;
  onRate?: (message: ChatMessage, rating: 1 | -1) => void;
  onAudit?: (message: ChatMessage) => void;
  onApplyRevision?: (message: ChatMessage) => void;
  loadingLabel?: string;
}

const CitationBadges: React.FC<{ citations: Citation[]; onClick: () => void }> = ({ citations, onClick }) => {
  if (!citations?.length) return null;
  const uniqueDocs = [...new Set(citations.map((c) => c.document_name))];

  return (
    <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-black/5">
      {uniqueDocs.map((doc, i) => {
        const docCitations = citations.filter((c) => c.document_name === doc);
        const pages = [...new Set(docCitations.map((c) => c.page_number))].sort((a, b) => a - b);
        return (
          <button
            key={i}
            onClick={onClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">find_in_page</span>
            {doc.length > 20 ? doc.slice(0, 18) + '…' : doc}
            {pages.length > 0 && <span className="opacity-70">p.{pages.join(',')}</span>}
          </button>
        );
      })}
    </div>
  );
};

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  messages, isLoading, onCitationClick, suggestions = [], onSuggestionClick, onRate, onAudit, onApplyRevision,
  loadingLabel = 'Synthesizing intelligence...',
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="h-full flex items-center justify-center p-8 mt-[72px]">
        <div className="text-center max-w-lg">
          <span className="material-symbols-outlined text-4xl text-secondary-auralis mb-4">forum</span>
          <h2 className="font-h3 text-h3 text-primary mb-2">How can I help you?</h2>
          <p className="text-secondary-auralis">Ask any question and I will search your uploaded knowledge base to provide a grounded, cited answer.</p>
          {suggestions.length > 0 && (
            <div className="mt-8">
              <p className="text-[10px] text-secondary-auralis font-semibold tracking-wider uppercase mb-3">Suggested from your documents</p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => onSuggestionClick?.(q)}
                    className="px-3 py-1.5 rounded-full text-[12px] text-primary bg-white border border-auralis shadow-sm hover:border-primary transition-all text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 pt-[100px] pb-56 scroll-smooth">
      <div className="max-w-3xl mx-auto space-y-8">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            
            {message.sender === 'user' ? (
              <div className="flex gap-4 items-start flex-row-reverse max-w-[85%]">
                <div className="w-10 h-10 shrink-0 bg-white border border-auralis rounded-full flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined text-primary text-sm">person</span>
                </div>
                <div className="bg-primary text-on-primary px-5 py-3 rounded-2xl rounded-tr-sm text-sm shadow-md">
                  {message.content}
                </div>
              </div>
            ) : (
              <div className="flex gap-4 items-start max-w-[90%]">
                <div className="w-10 h-10 shrink-0 bg-primary rounded-full flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined text-white text-sm">smart_toy</span>
                </div>
                <div className="bg-white border border-auralis p-6 rounded-2xl rounded-tl-sm text-sm shadow-sm flex flex-col w-full">
                  {message.jury ? (
                    <JuryView jury={message.jury} consensus={message.content} />
                  ) : message.timeline && message.timeline.events.length > 0 ? (
                    <TimelineView timeline={message.timeline} />
                  ) : (
                    <div className="text-sm leading-relaxed text-primary markdown-content">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                      {message.streaming && <span className="inline-block w-1.5 h-4 bg-primary/60 align-middle animate-pulse ml-0.5" />}
                    </div>
                  )}
                  {message.citations && message.citations.length > 0 && (
                    <CitationBadges citations={message.citations} onClick={() => onCitationClick(message.citations!)} />
                  )}
                  {message.audit && <AuditPanel audit={message.audit} onApplyRevision={() => onApplyRevision?.(message)} />}
                  {!message.error && !message.streaming && onRate && (
                    <MessageActions
                      message={message}
                      onRate={(r) => onRate(message, r)}
                      onAudit={() => onAudit?.(message)}
                      onWhy={() => onCitationClick(message.citations || [])}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-4 items-start max-w-[90%]">
              <div className="w-10 h-10 shrink-0 bg-primary rounded-full flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-white text-sm">smart_toy</span>
              </div>
              <div className="bg-white border border-auralis px-5 py-4 rounded-2xl rounded-tl-sm text-sm shadow-sm flex items-center gap-3 text-secondary-auralis">
                <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                <span className="font-medium animate-pulse text-sm">{loadingLabel}</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
};
