import React from 'react';
import { useNavigate } from 'react-router-dom';

interface NavbarProps {
  documentCount: number;
  chunkCount: number;
  onUploadClick: () => void;
  onClearChat?: () => void;
  hasMessages?: boolean;
  onInsightsClick?: () => void;
  conflictCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({ documentCount, chunkCount, onUploadClick, onClearChat, hasMessages, onInsightsClick, conflictCount = 0 }) => {
  const navigate = useNavigate();

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-auralis bg-[#F7F7F5]/80 backdrop-blur-md transition-all">
      <div className="max-w-[1280px] mx-auto px-8 flex justify-between items-center h-[72px]">
        {/* Left — Brand */}
        <div className="flex items-center gap-12">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 cursor-pointer">
            <span className="material-symbols-outlined text-primary text-2xl font-bold">bubble_chart</span>
            <span className="text-[20px] font-bold tracking-tighter text-primary font-h1">RAG.AI</span>
          </button>
          
          <div className="hidden md:flex items-center gap-6">
            <span className="text-sm font-medium tracking-tight text-secondary-auralis">Studio Mode</span>
            <span className="text-sm font-medium tracking-tight text-secondary-auralis">Docs: {documentCount}</span>
            <span className="text-sm font-medium tracking-tight text-secondary-auralis">Index: {chunkCount}</span>
          </div>
        </div>

        {/* Right — Actions */}
        <div className="flex items-center gap-4">
          {hasMessages && (
            <button
              onClick={onClearChat}
              className="text-secondary-auralis hover:text-primary transition-colors p-2 flex items-center justify-center"
              title="Clear chat"
            >
              <span className="material-symbols-outlined text-[20px]">delete</span>
            </button>
          )}

          {onInsightsClick && (
            <button
              onClick={onInsightsClick}
              className="relative flex items-center gap-2 bg-white border border-auralis text-primary px-4 py-2 rounded-full font-medium transition-all hover:border-primary text-[14px] font-body-md shadow-sm cursor-pointer"
              title="Summaries, FAQs, quizzes, conflicts, knowledge graph and evaluation"
            >
              <span className="material-symbols-outlined text-[18px]">insights</span>
              <span className="hidden sm:inline">Insights</span>
              {conflictCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center" title={`${conflictCount} conflicting statements between documents`}>
                  {conflictCount}
                </span>
              )}
            </button>
          )}

          <button
            onClick={onUploadClick}
            className="flex items-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-full font-medium transition-all hover:bg-opacity-90 text-[14px] font-body-md shadow-sm cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            <span className="hidden sm:inline">Upload Knowledge</span>
          </button>
        </div>
      </div>
    </nav>
  );
};
