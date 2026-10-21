import React, { useState, useRef, useEffect } from 'react';
import { AskMode } from '../types';
import { api } from '../services/api';

interface PromptBarProps {
  onSend: (text: string, mode: AskMode) => void;
  isLoading: boolean;
  disabled?: boolean;
}

const MODES: { id: AskMode; label: string; icon: string; tip: string }[] = [
  { id: 'standard', label: 'Answer', icon: 'chat', tip: 'Grounded answer with citations (streamed)' },
  { id: 'jury', label: 'Jury', icon: 'gavel', tip: 'Several models answer; shows where they agree and disagree' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline', tip: 'Dated facts in chronological order' },
];

const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export const PromptBar: React.FC<PromptBarProps> = ({ onSend, isLoading, disabled }) => {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<AskMode>('standard');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      const computed = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = `${computed}px`;
    }
  }, [text]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (text.trim() && !isLoading && !disabled) {
      onSend(text.trim(), mode);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'inherit';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Voice question: record in the browser, transcribe locally on the server (Whisper)
  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!canRecord) {
      // Browsers only expose the microphone on HTTPS (or localhost) pages
      alert('Voice input needs a secure (https://) connection. Open RAG.AI through its https:// link to use the microphone.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const parts: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        try {
          const { text: spoken } = await api.transcribe(new Blob(parts, { type: recorder.mimeType || 'audio/webm' }));
          if (spoken) setText((prev) => (prev ? `${prev} ${spoken}` : spoken));
          textareaRef.current?.focus();
        } catch (err) {
          console.error('Transcription failed', err);
          alert('Could not transcribe the recording. Please try again.');
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      alert('Microphone access is needed for voice questions.');
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F7F7F5] via-[#F7F7F5]/90 to-transparent z-40">
      <div className="max-w-3xl mx-auto">
        {/* Mode toolbar */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1 bg-white border border-auralis rounded-full p-0.5 shadow-sm">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.tip}
                onClick={() => setMode(m.id)}
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-medium transition-all ${
                  mode === m.id ? 'bg-primary text-on-primary' : 'text-secondary-auralis hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{m.icon}</span>{m.label}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="relative flex items-end bg-white border border-auralis shadow-sm rounded-xl overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all"
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled ? "Upload documents to begin..."
                : recording ? "Listening… tap the mic again to stop"
                : transcribing ? "Transcribing…"
                : mode === 'timeline' ? "e.g. How have fee deadlines changed over the years?"
                : mode === 'jury' ? "Ask a question for the model jury..."
                : "Ask RAG.AI about your documents..."
            }
            disabled={disabled || isLoading}
            rows={1}
            className={`w-full max-h-[200px] py-4 pl-5 pr-24 bg-transparent text-primary placeholder:text-secondary-auralis resize-none focus:outline-none disabled:opacity-50 text-sm leading-relaxed`}
          />
          {(
            <button
              type="button"
              onClick={toggleRecording}
              disabled={disabled || isLoading || transcribing}
              title={recording ? 'Stop recording' : canRecord ? 'Ask by voice (English, हिंदी, मराठी)' : 'Voice input needs the https:// link'}
              className={`absolute right-14 bottom-2 w-10 h-10 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 ${
                recording ? 'bg-red-500 text-white animate-pulse' : 'text-secondary-auralis hover:text-primary hover:bg-[#F7F7F5]'
              }`}
            >
              <span className={`material-symbols-outlined text-[20px] ${transcribing ? 'animate-spin' : ''}`}>
                {transcribing ? 'progress_activity' : recording ? 'stop' : 'mic'}
              </span>
            </button>
          )}
          <button
            type="submit"
            disabled={!text.trim() || isLoading || disabled}
            className="absolute right-2 bottom-2 w-10 h-10 flex items-center justify-center rounded-lg bg-primary text-on-primary disabled:opacity-30 disabled:bg-surface-variant disabled:text-secondary-auralis transition-colors shadow-sm"
          >
            {isLoading ? (
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-sm">arrow_upward</span>
            )}
          </button>
        </form>
        <div className="text-center mt-3">
          <span className="text-[11px] text-secondary-auralis font-medium">RAG.AI can make mistakes. Use “Audit answer” to verify each claim against its source.</span>
        </div>
      </div>
    </div>
  );
};
