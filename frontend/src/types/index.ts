export interface DocumentSummary {
  document_id: string;
  filename: string;
  file_type: string;
  file_size_formatted: string;
  total_pages: number;
  total_chunks: number;
  uploaded_at: string;
}

export interface ChunkItem {
  chunk_id: string;
  document_id: string;
  filename: string;
  page_number: number;
  chunk_index: number;
  text: string;
  char_start?: number;
  char_end?: number;
  metadata?: Record<string, any>;
}

export interface Citation {
  citation_id: string;
  document_name: string;
  document_id: string;
  page_number: number;
  chunk_index: number;
  excerpt: string;
  similarity_score: number;
  context_snippet?: string;
  semantic_rank?: number | null;
  keyword_rank?: number | null;
  fused_rank?: number | null;
  rerank_score?: number | null;
}

export type AskMode = 'standard' | 'jury' | 'timeline';

export interface AuditClaim {
  claim: string;
  verdict: 'supported' | 'partial' | 'unsupported';
  evidence: string;
  document_name: string | null;
  page_number: number | null;
}

export interface AuditResult {
  claims: AuditClaim[];
  faithfulness: number | null;
  revised_answer: string | null;
}

export interface JuryResult {
  verdicts: { model: string; answer: string; error?: string }[];
  agreement: { agreement: 'high' | 'medium' | 'low'; score: number; consensus: string; differences: string[] } | null;
  citations: Citation[];
}

export interface TimelineEvent {
  date: string;
  sort_key: string;
  event: string;
  document_name: string | null;
  page_number: number | null;
}

export interface TimelineResult {
  title: string;
  events: TimelineEvent[];
  citations: Citation[];
}

export interface QuizItem {
  question: string;
  options: string[];
  answer_index: number;
  page?: number;
}

export interface DocumentInsights {
  status: 'missing' | 'processing' | 'ready' | 'failed';
  document_id: string;
  filename: string;
  summary?: string;
  faq?: string[];
  quiz?: QuizItem[];
  events?: { date: string; event: string; page?: number }[];
}

export interface ConflictSide {
  document_id: string;
  document_name: string;
  page_number: number;
  text: string;
}

export interface Conflict {
  id: string;
  topic: string;
  explanation: string;
  a: ConflictSide;
  b: ConflictSide;
  similarity: number;
}

export interface GraphData {
  nodes: { id: string; label: string; type: string; documents: string[] }[];
  edges: { source: string; target: string; label: string; document: string }[];
}

export interface EvalReport {
  ran_at?: string;
  questions?: number;
  feedback?: { up: number; down: number };
  needs_attention?: string[];
  cache?: { entries: number; hits: number; misses: number; hit_rate: number };
  results?: { candidates: number; use_reranker: boolean; top_k: number; hit_rate: number; mrr: number }[];
  baseline?: { hit_rate: number; mrr: number };
  best?: { candidates: number; use_reranker: boolean; top_k: number; hit_rate: number; mrr: number } | null;
  applied?: boolean;
  history?: { ran_at: string; hit_rate: number; mrr: number; questions: number }[];
  note?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citations?: Citation[];
  processingTime?: number;
  retrievedChunksCount?: number;
  modelUsed?: string;
  error?: boolean;
  cached?: boolean;
  question?: string;
  streaming?: boolean;
  feedback?: 1 | -1;
  audit?: AuditResult;
  auditing?: boolean;
  jury?: JuryResult;
  timeline?: TimelineResult;
}

export interface HealthStatus {
  status: string;
  ollama_configured: boolean;
  active_vector_store: string;
  indexed_documents_count: number;
  indexed_chunks_count: number;
  version: string;
}

export interface QueryRequestPayload {
  question: string;
  top_k?: number;
  document_ids?: string[];
}
