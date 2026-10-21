import React from 'react';

interface EmptyStateProps {
  onSuggestionClick: (q: string) => void;
}

const suggestions = [
  'What are the key findings in my documents?',
  'Compare the main topics across all uploaded files',
  'Summarize the most important data points',
  'What recommendations are mentioned?',
];

export const EmptyState: React.FC<EmptyStateProps> = ({ onSuggestionClick }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 animate-fade-in">
      {/* Glow background */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <div className="w-[600px] h-[600px] rounded-full bg-gradient-to-br from-nexus-accent/5 to-nexus-accent-2/5 blur-[120px] animate-float" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-lg">
        {/* Logo icon */}
        <div className="w-16 h-16 rounded-2xl bg-accent-gradient flex items-center justify-center mb-6 shadow-glow-lg animate-float">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </div>

        <h1 className="text-4xl font-bold gradient-text mb-3">RAG.AI</h1>
        <p className="text-nexus-text-secondary text-base mb-10 leading-relaxed">
          Upload your documents and ask anything.<br />
          Grounded answers with page-level citations.
        </p>

        {/* Suggestion chips */}
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick(s)}
              className="px-4 py-2.5 rounded-2xl text-sm text-nexus-text-secondary bg-nexus-surface-2 border border-nexus-border hover:border-nexus-border-hover hover:text-nexus-text-primary hover:bg-nexus-surface-3 transition-all duration-200 text-left"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
