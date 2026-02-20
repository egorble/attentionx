import React from 'react';
import { Play } from 'lucide-react';

const HeroBanner: React.FC = () => {
  const scrollToGrid = () => {
      window.scrollTo({ top: 500, behavior: 'smooth' });
  };

  return (
    <div className="relative w-full h-auto min-h-[16rem] md:h-64 rounded-2xl overflow-hidden border border-yc-light-border dark:border-yc-dark-border group mb-8 bg-white dark:bg-[#121212]">
      {/* Background - Pattern adapted for themes */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[url('https://picsum.photos/1200/400?grayscale')] opacity-10 bg-cover bg-center"></div>
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-100 via-gray-100/90 to-transparent dark:from-[#050505] dark:via-[#050505]/90"></div>
        
        {/* Decorative Grid Lines */}
        <div className="absolute inset-0 opacity-[0.05] dark:opacity-10" style={{ 
            backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)', 
            backgroundSize: '40px 40px',
        }}></div>
      </div>

      {/* Content */}
      <div className="relative md:absolute inset-0 p-6 md:p-8 flex flex-col justify-center max-w-2xl z-10">
        <div className="inline-flex items-center space-x-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-yc-green animate-pulse-fast"></span>
            <span className="text-yc-green font-mono text-xs uppercase tracking-widest font-bold">Season 4 is Live</span>
        </div>
        
        <h2 className="text-3xl md:text-5xl font-black text-yc-text-primary dark:text-white mb-6 leading-tight tracking-tight">
          BUILD YOUR <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-yc-orange to-red-500 dark:to-white">UNICORN PORTFOLIO</span>
        </h2>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
            <button 
                onClick={scrollToGrid}
                className="w-full sm:w-auto bg-yc-orange hover:bg-orange-600 text-white px-8 py-3 rounded-lg font-bold text-sm uppercase tracking-wide flex items-center justify-center transition-all shadow-lg shadow-orange-500/30 active:scale-95"
            >
                <Play className="w-4 h-4 mr-2 fill-current" />
                Play Now
            </button>
            <button 
                onClick={() => alert("Redirecting to documentation...")}
                className="w-full sm:w-auto bg-white/50 dark:bg-[#1A1A1A] hover:bg-white dark:hover:bg-[#252525] text-yc-text-primary dark:text-white border border-yc-light-border dark:border-yc-dark-border px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wide flex items-center justify-center transition-all active:scale-95"
            >
                Learn More
            </button>
        </div>
      </div>

      {/* 3D Abstract Element - YC Logo Animation - Hidden on Mobile */}
      <div className="absolute right-0 top-0 bottom-0 w-1/3 hidden lg:flex items-center justify-center pointer-events-none">
        {/* Outer Ring */}
        <div className="w-48 h-48 border-[1px] border-gray-300 dark:border-[#333] rounded-full absolute"></div>
        
        {/* Spinning Orange Ring Segment */}
        <div className="w-40 h-40 border-4 border-transparent rounded-full absolute animate-spin-slow border-t-yc-orange border-r-yc-orange/30"></div>
        
        {/* Counter-Spinning Green Ring Segment */}
        <div className="w-32 h-32 border-4 border-transparent rounded-full absolute animate-spin-reverse-slow border-b-yc-green border-l-yc-green/30"></div>
        
        {/* Center Logo */}
         <div className="w-20 h-20 bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] rounded-full absolute flex items-center justify-center z-10 shadow-xl">
            <span className="text-yc-orange font-black text-2xl">YC</span>
         </div>
         
         {/* Pulse Effect behind Logo */}
         <div className="w-20 h-20 bg-yc-orange/10 rounded-full absolute animate-ping opacity-20"></div>
      </div>
    </div>
  );
};

export default HeroBanner;