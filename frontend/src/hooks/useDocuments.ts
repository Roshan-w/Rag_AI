import { useState, useEffect, useCallback } from 'react';
import { DocumentSummary, ChunkItem, HealthStatus } from '../types';
import { api } from '../services/api';

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  // Inspector State
  const [inspectedDoc, setInspectedDoc] = useState<DocumentSummary | null>(null);
  const [docChunks, setDocChunks] = useState<ChunkItem[]>([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.checkHealth();
      setHealth(data);
    } catch (err) {
      console.warn('Failed to fetch backend health status:', err);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    setIsLoadingDocs(true);
    try {
      const docs = await api.listDocuments();
      setDocuments(docs);
      await fetchHealth();
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setIsLoadingDocs(false);
    }
  }, [fetchHealth]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadDocuments = async (files: File[], chunkSize = 800, chunkOverlap = 150) => {
    setIsUploading(true);
    try {
      const responses = await api.uploadDocuments(files, chunkSize, chunkOverlap);
      const failed = responses.filter((r: any) => !r.success);
      if (failed.length > 0) {
        alert('Some documents failed to process:\n' + failed.map((f: any) => f.message).join('\n\n'));
      }
      await fetchDocuments();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to connect to the server. The backend may be offline or timing out.');
      throw err;
    } finally {
      setIsUploading(false);
    }
  };

  const deleteDocument = async (id: string) => {
    try {
      await api.deleteDocument(id);
      await fetchDocuments();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const clearAllDocuments = async () => {
    if (!window.confirm('Are you sure you want to clear all indexed documents from the vector database?')) return;
    try {
      await api.clearAllDocuments();
      await fetchDocuments();
    } catch (err) {
      console.error('Clear all failed:', err);
    }
  };

  const inspectDocumentChunks = async (doc: DocumentSummary) => {
    setInspectedDoc(doc);
    setIsLoadingChunks(true);
    try {
      const chunks = await api.getDocumentChunks(doc.document_id);
      setDocChunks(chunks);
    } catch (err) {
      console.error('Failed to fetch chunks:', err);
      setDocChunks([]);
    } finally {
      setIsLoadingChunks(false);
    }
  };

  const closeChunkInspector = () => {
    setInspectedDoc(null);
    setDocChunks([]);
  };

  return {
    documents,
    isUploading,
    isLoadingDocs,
    health,
    uploadDocuments,
    deleteDocument,
    clearAllDocuments,
    fetchDocuments,
    // Inspector
    inspectedDoc,
    docChunks,
    isLoadingChunks,
    inspectDocumentChunks,
    closeChunkInspector,
  };
}
