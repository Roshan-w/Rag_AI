import React from 'react';
import { DocumentSummary, ChunkItem } from '../types';

interface DocumentInspectorModalProps {
  isOpen: boolean;
  document: DocumentSummary | null;
  chunks: ChunkItem[];
  isLoading: boolean;
  onClose: () => void;
}

export const DocumentInspectorModal: React.FC<DocumentInspectorModalProps> = ({
  isOpen,
  document,
  chunks,
  isLoading,
  onClose,
}) => {
  if (!isOpen || !document) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 animate-fade-in">
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div className="bg-card-auralis border border-auralis rounded-3xl w-full max-w-4xl h-[80vh] flex flex-col relative z-10 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-auralis">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[#F7F7F5] rounded-xl flex items-center justify-center border border-auralis">
              <span className="material-symbols-outlined text-primary">article</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-primary truncate max-w-[400px]">{document.filename}</h2>
              <p className="text-xs text-secondary-auralis">
                {document.file_size_formatted} • {document.total_pages} pages • {document.total_chunks} indexed chunks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors duration-200"
          >
            <span className="material-symbols-outlined text-[20px] text-secondary-auralis">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#F7F7F5]/50 custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-secondary-auralis">
              <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4" />
              <p className="text-sm font-medium">Loading document chunks...</p>
            </div>
          ) : chunks.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {chunks.map((chunk, idx) => (
                <div key={chunk.chunk_id} className="bg-white p-5 rounded-2xl border border-auralis shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md uppercase tracking-wide">
                      Chunk {chunk.chunk_index}
                    </span>
                    <span className="text-xs text-secondary-auralis font-medium">Page {chunk.page_number}</span>
                  </div>
                  <p className="text-sm text-primary leading-relaxed font-body whitespace-pre-wrap">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-secondary-auralis">
              <span className="material-symbols-outlined text-4xl mb-2 opacity-50">find_in_page</span>
              <p className="text-sm">No text chunks found for this document.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
