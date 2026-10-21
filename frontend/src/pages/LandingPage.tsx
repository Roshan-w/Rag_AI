import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'video' | 'ppt'>('video');
  const [currentSlide, setCurrentSlide] = useState(1);
  const totalSlides = 10;

  const nextSlide = useCallback(() => {
    setCurrentSlide(prev => (prev < totalSlides ? prev + 1 : prev));
  }, [totalSlides]);

  const prevSlide = useCallback(() => {
    setCurrentSlide(prev => (prev > 1 ? prev - 1 : prev));
  }, []);

  useEffect(() => {
    if (activeTab !== 'ppt') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevSlide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, nextSlide, prevSlide]);

  return (
    <div className="flex-grow pt-[140px] pb-12 bg-[#F7F7F5] min-h-screen text-[#111111] font-body-md">
      {/* HERO SECTION */}
      <section className="max-w-[1280px] mx-auto px-8 mb-[140px]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 flex flex-col gap-8">
            <h1 className="font-h1 text-blue-900 text-h1 text-primary tracking-tight leading-none" style={{ animation: 'stitch-scan-flash 1.5s ease-out' }}>
              Making digital intelligence sound human
            </h1>
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <button
                onClick={() => navigate('/workspace')}
                className="bg-primary text-on-primary px-6 py-3 rounded-full font-medium transition-all hover:bg-opacity-90"
              >
                Open Workspace
              </button>
              <button
                onClick={() => navigate('/workspace')}
                className="bg-transparent border border-outline text-primary px-6 py-3 rounded-full font-medium transition-all hover:bg-surface-variant cursor-pointer"
              >
                Contact sales
              </button>
            </div>
          </div>
          <div className="lg:col-span-4 lg:col-start-9 flex justify-end">
            <p className="font-body-lg text-body-lg text-secondary-auralis max-w-sm text-right lg:text-left pt-4">
              RAG.AI provides grounded, instantaneous answers using local models. Completely secure and incredibly fast.
            </p>
          </div>
        </div>
      </section>

      {/* HERO PRODUCT PANEL */}
      <section className="max-w-[1280px] mx-auto px-8 mb-[180px]">
        <div className="bg-panel-auralis rounded-3xl p-8 flex flex-col relative overflow-hidden border border-auralis min-h-[600px] justify-between">
          {/* Top Tabs */}
          <div className="flex justify-between items-center z-10">
            <div className="flex bg-surface-container-low p-1 rounded-full border border-auralis shadow-sm">
              <button onClick={() => setActiveTab('video')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer ${activeTab === 'video' ? 'bg-surface text-primary shadow-sm' : 'text-secondary-auralis hover:text-primary'}`}>RAG.AI Studio</button>
              <button onClick={() => navigate('/workspace')} className="px-4 py-2 text-secondary-auralis rounded-full text-sm font-medium hover:text-primary transition-colors cursor-pointer">Agents</button>
              <button onClick={() => navigate('/workspace')} className="px-4 py-2 text-secondary-auralis rounded-full text-sm font-medium hover:text-primary transition-colors cursor-pointer">API</button>
              <button onClick={() => setActiveTab('ppt')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer ${activeTab === 'ppt' ? 'bg-surface text-primary shadow-sm' : 'text-secondary-auralis hover:text-primary'}`}>PPT</button>
            </div>
            <div className="bg-surface-container-low px-4 py-2 rounded-full border border-auralis flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-sm font-medium">Local Inference Active</span>
            </div>
          </div>
          
          {/* Center Player */}
          <div className="flex-1 flex items-center justify-center z-0 py-8 w-full max-w-[900px] mx-auto">
            <div className="w-full aspect-video rounded-2xl overflow-hidden shadow-2xl border border-auralis bg-surface-container-lowest relative">
              {activeTab === 'video' ? (
                <video
                  className="w-full h-full object-cover"
                  poster="/ai-video-poster.jpg"
                  controls
                >
                  <source src="/intro-video.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              ) : (
                <div className="relative w-full h-full group bg-[#112423] flex items-center justify-center" id="ppt-container">
                  <img 
                    src={`/slides/slide_${currentSlide}.png`} 
                    alt={`Slide ${currentSlide}`} 
                    className="w-full h-full object-contain"
                  />
                  
                  <button onClick={prevSlide} disabled={currentSlide === 1} className="absolute left-4 p-3 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60 cursor-pointer">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  </button>
                  
                  <button onClick={nextSlide} disabled={currentSlide === totalSlides} className="absolute right-4 p-3 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60 cursor-pointer">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  </button>

                  <button 
                    onClick={() => {
                      const el = document.getElementById('ppt-container');
                      if (el?.requestFullscreen) el.requestFullscreen();
                    }}
                    className="absolute bottom-4 right-4 bg-black/40 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-white hover:bg-black/60 cursor-pointer"
                    title="Full Screen Slideshow"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                  </button>
                  
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/40 px-3 py-1 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Slide {currentSlide} of {totalSlides}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Bottom Bar */}
          <div className="flex justify-between items-center z-10 bg-surface/80 backdrop-blur-md p-4 rounded-2xl border border-auralis">
            <div className="flex gap-6 overflow-x-auto no-scrollbar">
              <span className="text-sm font-medium text-primary">Neural Engine v2.0</span>
              <span className="text-sm font-medium text-secondary-auralis">Document Analysis</span>
              <span className="text-sm font-medium text-secondary-auralis">Information Retrieval</span>
              <span className="text-sm font-medium text-secondary-auralis">Source Citation</span>
            </div>
            <button onClick={() => navigate('/workspace')} className="bg-primary text-on-primary px-6 py-2 rounded-full text-sm font-medium whitespace-nowrap">
              Try Now
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
