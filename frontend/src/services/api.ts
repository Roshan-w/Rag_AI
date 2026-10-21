import axios from 'axios';
import {
  DocumentSummary, ChunkItem, Citation, HealthStatus, QueryRequestPayload, ChatMessage,
  AuditResult, JuryResult, TimelineResult, DocumentInsights, Conflict, GraphData, EvalReport,
} from '../types';

const API_BASE_URL = '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export const api = {
  /* ── Documents ── */

  async uploadDocuments(files: File[], chunkSize = 800, chunkOverlap = 150): Promise<any> {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const response = await apiClient.post(
      `/documents/upload?chunk_size=${chunkSize}&chunk_overlap=${chunkOverlap}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  },

  async listDocuments(): Promise<DocumentSummary[]> {
    const response = await apiClient.get<DocumentSummary[]>('/documents');
    return response.data;
  },

  async getDocumentChunks(documentId: string): Promise<ChunkItem[]> {
    const response = await apiClient.get<ChunkItem[]>(`/documents/${documentId}/chunks`);
    return response.data;
  },

  async deleteDocument(documentId: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.delete(`/documents/${documentId}`);
    return response.data;
  },

  async clearAllDocuments(): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.delete('/documents');
    return response.data;
  },

  /* ── Query / RAG ── */

  async askQuestion(payload: QueryRequestPayload): Promise<{
    question: string;
    answer: string;
    citations: Citation[];
    retrieved_chunks_count: number;
    processing_time_seconds: number;
    model_used: string;
    vector_store_type: string;
  }> {
    const response = await apiClient.post('/query/ask', payload);
    return response.data;
  },

  /** Streams the answer as NDJSON events: citations → token… → done (or error). */
  async streamQuestion(payload: QueryRequestPayload, onEvent: (event: any) => void): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/query/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok || !response.body) {
      let detail = `Request failed (${response.status})`;
      try { detail = (await response.json()).detail || detail; } catch { /* non-JSON error body */ }
      throw new Error(detail);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onEvent(JSON.parse(line));
      }
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer));
  },

  /* ── Intelligence ── */

  async auditAnswer(answer: string, citations: Citation[]): Promise<AuditResult> {
    return (await apiClient.post('/intel/audit', { answer, citations })).data;
  },

  async askJury(question: string): Promise<JuryResult> {
    return (await apiClient.post('/intel/jury', { question })).data;
  },

  async askTimeline(question: string): Promise<TimelineResult> {
    return (await apiClient.post('/intel/timeline', { question })).data;
  },

  async getInsights(): Promise<DocumentInsights[]> {
    return (await apiClient.get('/intel/insights')).data;
  },

  async getSuggestions(): Promise<string[]> {
    return (await apiClient.get('/intel/suggestions')).data;
  },

  async getConflicts(): Promise<Conflict[]> {
    return (await apiClient.get('/intel/conflicts')).data;
  },

  async getGraph(): Promise<GraphData> {
    return (await apiClient.get('/intel/graph')).data;
  },

  async sendFeedback(payload: { question: string; answer: string; rating: 1 | -1; sources: Citation[] }) {
    const sources = payload.sources.map((c) => ({ document_name: c.document_name, page_number: c.page_number }));
    return (await apiClient.post('/feedback', { ...payload, sources })).data;
  },

  async getEvalReport(): Promise<EvalReport> {
    return (await apiClient.get('/eval/report')).data;
  },

  async runEval(): Promise<EvalReport> {
    return (await apiClient.post('/eval/run')).data;
  },

  async transcribe(audio: Blob): Promise<{ text: string; language: string }> {
    const formData = new FormData();
    formData.append('audio', audio, 'question.webm');
    return (await apiClient.post('/voice/transcribe', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },

  /* ── Health ── */

  async checkHealth(): Promise<HealthStatus> {
    const response = await apiClient.get<HealthStatus>('/health');
    return response.data;
  },

  /* ── Chat History ── */

  async getChatHistory(): Promise<ChatMessage[]> {
    const response = await apiClient.get<ChatMessage[]>('/chat/history');
    return response.data;
  },

  async clearChatHistory(): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.delete('/chat/history');
    return response.data;
  },
};
