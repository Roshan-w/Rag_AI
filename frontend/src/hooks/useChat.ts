import { useState, useEffect, useCallback } from 'react';
import { ChatMessage, Citation, AskMode } from '../types';
import { api } from '../services/api';

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const errorText = (err: any) =>
  `**Error:** ${err?.response?.data?.detail || err?.message || 'Failed to get a response. Check that the backend and Ollama are running.'}`;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Load history from backend on mount
  useEffect(() => {
    api.getChatHistory().then((history) => {
      // Older history entries do not carry their question; recover it from the preceding user message
      setMessages(history.map((m, i) => (m.sender === 'assistant' && !m.question && history[i - 1]?.sender === 'user'
        ? { ...m, question: history[i - 1].content } : m)));
    }).catch((err) => {
      console.error("Failed to load chat history", err);
    });
  }, []);

  const updateMessage = useCallback((id: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
  }, []);

  const streamAnswer = async (question: string, topK: number) => {
    const assistantId = `assistant-${Date.now()}`;
    let started = false;
    // Create the assistant bubble on the first token, then patch it as tokens stream in
    const patchAssistant = (patch: (msg: ChatMessage) => ChatMessage) => {
      if (!started) {
        started = true;
        setIsLoading(false);
        setMessages((prev) => [...prev, patch({
          id: assistantId, sender: 'assistant', content: '', timestamp: nowTime(), question, streaming: true,
        })]);
        return;
      }
      updateMessage(assistantId, patch);
    };

    await api.streamQuestion({ question, top_k: topK }, (event) => {
      if (event.type === 'token') {
        patchAssistant((m) => ({ ...m, content: m.content + event.text }));
      } else if (event.type === 'replace') {
        patchAssistant((m) => ({ ...m, content: event.text }));
      } else if (event.type === 'done') {
        patchAssistant((m) => ({
          ...m,
          content: event.answer,
          citations: event.citations,
          processingTime: event.processing_time_seconds,
          retrievedChunksCount: event.retrieved_chunks_count,
          modelUsed: event.model_used,
          cached: event.cached,
          streaming: false,
        }));
        if (event.citations?.length > 0) {
          setActiveCitations(event.citations);
        }
      } else if (event.type === 'error') {
        throw new Error(event.detail);
      }
    });
  };

  const sendMessage = async (question: string, mode: AskMode = 'standard', topK = 4) => {
    if (!question.trim()) return;

    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: 'user', content: question, timestamp: nowTime() }]);
    setIsLoading(true);

    try {
      if (mode === 'jury') {
        const jury = await api.askJury(question);
        const consensus = jury.agreement?.consensus || jury.verdicts.find((v) => v.answer)?.answer || 'No model could answer.';
        setMessages((prev) => [...prev, {
          id: `assistant-${Date.now()}`, sender: 'assistant', content: consensus, timestamp: nowTime(),
          question, citations: jury.citations, jury, modelUsed: 'jury',
        }]);
      } else if (mode === 'timeline') {
        const timeline = await api.askTimeline(question);
        setMessages((prev) => [...prev, {
          id: `assistant-${Date.now()}`, sender: 'assistant',
          content: timeline.events.length ? '' : 'No dated facts related to this question were found in the documents.',
          timestamp: nowTime(), question, citations: timeline.citations, timeline, modelUsed: 'timeline',
        }]);
      } else {
        await streamAnswer(question, topK);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`, sender: 'assistant', content: errorText(err), timestamp: nowTime(), error: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const rateMessage = async (message: ChatMessage, rating: 1 | -1) => {
    updateMessage(message.id, (m) => ({ ...m, feedback: rating }));
    try {
      await api.sendFeedback({
        question: message.question || '', answer: message.content, rating, sources: message.citations || [],
      });
    } catch (err) {
      console.error('Failed to send feedback', err);
    }
  };

  const auditMessage = async (message: ChatMessage) => {
    updateMessage(message.id, (m) => ({ ...m, auditing: true }));
    try {
      const audit = await api.auditAnswer(message.content, message.citations || []);
      updateMessage(message.id, (m) => ({ ...m, audit, auditing: false }));
    } catch (err) {
      console.error('Audit failed', err);
      updateMessage(message.id, (m) => ({ ...m, auditing: false }));
    }
  };

  const applyRevision = (message: ChatMessage) => {
    if (!message.audit?.revised_answer) return;
    updateMessage(message.id, (m) => ({
      ...m, content: m.audit!.revised_answer!, audit: { ...m.audit!, revised_answer: null },
    }));
  };

  const openDrawer = (citations: Citation[]) => {
    setActiveCitations(citations);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };

  const clearMessages = async () => {
    try {
      await api.clearChatHistory();
      setMessages([]);
      setActiveCitations([]);
      setIsDrawerOpen(false);
    } catch (err) {
      console.error("Failed to clear chat history", err);
    }
  };

  return {
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
  };
}
