import React, { useCallback, useEffect, useState } from 'react';
import { Navbar } from '../components/Navbar';
import { PromptBar } from '../components/PromptBar';
import { CitationDrawer } from '../components/CitationDrawer';
import { UploadModal } from '../components/UploadModal';
import { DocumentInspectorModal } from '../components/DocumentInspectorModal';
import { ChatCanvas } from '../components/ChatCanvas';
import { InsightsPanel } from '../components/InsightsPanel';
import { useChat } from '../hooks/useChat';
import { useDocuments } from '../hooks/useDocuments';
import { api } from '../services/api';
import { AskMode } from '../types';

const LOADING_LABELS: Record<AskMode, string> = {
  standard: 'Synthesizing intelligence...',
  jury: 'Convening the model jury...',
  timeline: 'Ordering events in time...',
};

export const WorkspacePage: React.FC = () => {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [lastMode, setLastMode] = useState<AskMode>('standard');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [conflictCount, setConflictCount] = useState(0);

  const {
    messages,
    isLoading,
    activeCitations,
    isDrawerOpen,
    sendMessage,
    rateMessage,
    auditMessage,
    applyRevision,
    openDrawer,
    closeDrawer,
    clearMessages,
  } = useChat();

  const {
    documents,
    isUploading,
    uploadDocuments,
    fetchDocuments,
    deleteDocument,
    inspectedDoc,
    docChunks,
    isLoadingChunks,
    inspectDocumentChunks,
    closeChunkInspector,
  } = useDocuments();

  const totalChunks = documents.reduce((sum, d) => sum + d.total_chunks, 0);
  const hasDocuments = documents.length > 0;

  // Suggestions and the conflict badge come from background insight generation; refresh periodically
  const refreshIntel = useCallback(() => {
    api.getSuggestions().then(setSuggestions).catch(() => {});
    api.getConflicts().then((c) => setConflictCount(c.length)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshIntel();
    const timer = setInterval(refreshIntel, 15000);
    return () => clearInterval(timer);
  }, [refreshIntel, documents.length]);

  const ask = (text: string, mode: AskMode = 'standard') => {
    setLastMode(mode);
    sendMessage(text, mode);
  };

  const handleUpload = async (files: File[]) => {
    try {
      await uploadDocuments(files);
      await fetchDocuments();
    } catch {
      // Error handled in hook
    } finally {
      setIsUploadOpen(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F7F7F5] overflow-hidden relative">
      {/* Navbar (Floating above canvas) */}
      <Navbar
        documentCount={documents.length}
        chunkCount={totalChunks}
        onUploadClick={() => setIsUploadOpen(true)}
        onClearChat={clearMessages}
        hasMessages={messages.length > 0}
        onInsightsClick={() => setIsInsightsOpen(true)}
        conflictCount={conflictCount}
      />

      {/* Main Canvas Area */}
      <main className="flex-1 relative overflow-hidden">
        <ChatCanvas
          messages={messages}
          isLoading={isLoading}
          onCitationClick={openDrawer}
          suggestions={hasDocuments ? suggestions : []}
          onSuggestionClick={(q) => ask(q)}
          onRate={rateMessage}
          onAudit={auditMessage}
          onApplyRevision={applyRevision}
          loadingLabel={LOADING_LABELS[lastMode]}
        />
      </main>

      {/* Floating Prompt Bar */}
      <PromptBar
        onSend={ask}
        isLoading={isLoading}
        disabled={!hasDocuments}
      />

      {/* Slide-out Citation Drawer */}
      <CitationDrawer
        isOpen={isDrawerOpen}
        citations={activeCitations}
        onClose={closeDrawer}
      />

      {/* Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        isUploading={isUploading}
        documents={documents}
        onClose={() => setIsUploadOpen(false)}
        onUpload={handleUpload}
        onDelete={deleteDocument}
        onInspect={inspectDocumentChunks}
      />

      {/* Insights: study guide, conflicts, knowledge graph, evaluation */}
      <InsightsPanel
        isOpen={isInsightsOpen}
        onClose={() => setIsInsightsOpen(false)}
        onAsk={(q) => ask(q)}
      />

      {/* Document Inspector Modal */}
      <DocumentInspectorModal
        isOpen={inspectedDoc !== null}
        document={inspectedDoc}
        chunks={docChunks}
        isLoading={isLoadingChunks}
        onClose={closeChunkInspector}
      />
    </div>
  );
};
