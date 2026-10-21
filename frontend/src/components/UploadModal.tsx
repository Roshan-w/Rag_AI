import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { DocumentSummary } from '../types';

interface UploadModalProps {
  isOpen: boolean;
  isUploading: boolean;
  documents?: DocumentSummary[];
  onClose: () => void;
  onUpload: (files: File[]) => void;
  onDelete?: (id: string) => void;
  onInspect?: (doc: DocumentSummary) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  isUploading,
  documents = [],
  onClose,
  onUpload,
  onDelete,
  onInspect,
}) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    }
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 animate-fade-in">
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={!isUploading ? onClose : undefined}
      />
      
      <div className="bg-card-auralis border border-auralis rounded-3xl w-full max-w-lg p-8 relative z-10 shadow-2xl animate-slide-up">
        {!isUploading && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors duration-200"
          >
            <span className="material-symbols-outlined text-[20px] text-secondary-auralis">close</span>
          </button>
        )}

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#F7F7F5] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-auralis">
            <span className="material-symbols-outlined text-3xl text-primary">cloud_upload</span>
          </div>
          <h2 className="font-h3 text-[24px] font-bold text-primary mb-2">Upload Knowledge</h2>
          <p className="text-sm text-secondary-auralis">
            Add PDF, TXT, DOCX files, or a photo of a notice, to your local RAG index.
          </p>
        </div>

        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200
            ${isDragActive 
              ? 'border-emerald-500 bg-emerald-500/5' 
              : 'border-auralis hover:border-primary hover:bg-[#F7F7F5]'
            }
            ${isUploading ? 'opacity-50 pointer-events-none' : ''}
          `}
        >
          <input {...getInputProps()} />
          
          <span className={`material-symbols-outlined text-4xl mb-3 transition-colors ${isDragActive ? 'text-emerald-500' : 'text-secondary-auralis'}`}>
            {isDragActive ? 'file_download' : 'note_add'}
          </span>
          
          <p className="text-sm font-medium text-primary mb-1">
            {isDragActive ? 'Drop files here' : 'Click or drag files to upload'}
          </p>
          <p className="text-xs text-secondary-auralis font-medium uppercase tracking-wider">
            PDF, TXT, DOCX, images · scanned pages are OCR'd (Max 50MB)
          </p>
        </div>

        {isUploading && (
          <div className="mt-6 text-center">
            <div className="inline-flex items-center gap-3 bg-emerald-500/10 px-4 py-2 rounded-full border border-emerald-500/20">
              <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
              <span className="text-sm font-bold text-emerald-700 tracking-wide uppercase">Indexing Documents...</span>
            </div>
          </div>
        )}

        {documents.length > 0 && (
          <div className="mt-8 border-t border-auralis pt-6">
            <h3 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider">Indexed Documents</h3>
            <div className="max-h-48 overflow-y-auto pr-2 flex flex-col gap-2">
              {documents.map((doc) => (
                <div 
                  key={doc.document_id} 
                  className={`flex items-center justify-between p-3 bg-[#F7F7F5] rounded-xl border border-auralis group ${onInspect ? 'cursor-pointer hover:bg-black/5' : ''}`}
                  onClick={() => onInspect && onInspect(doc)}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="material-symbols-outlined text-secondary-auralis">description</span>
                    <div className="flex flex-col truncate">
                      <span className="text-sm font-medium text-primary truncate">{doc.filename}</span>
                      <span className="text-xs text-secondary-auralis">{doc.file_size_formatted} • {doc.total_chunks} chunks</span>
                    </div>
                  </div>
                  {onDelete && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(doc.document_id); }}
                      className="text-secondary-auralis hover:text-rose-500 transition-colors p-2 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      title="Delete document"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
