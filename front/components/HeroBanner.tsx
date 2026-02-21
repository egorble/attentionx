import React from 'react';
import Interactive3DCards from './Interactive3DCards';

const HeroBanner: React.FC = () => {
  return (
    <div className="relative w-full h-auto min-h-[24rem] md:min-h-[30rem] rounded-2xl border border-yc-light-border dark:border-yc-dark-border group mb-4 md:mb-8 bg-white dark:bg-[#030014] overflow-hidden">
      {/* Background - Pattern adapted for themes */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://picsum.photos/1200/400?grayscale')] opacity-5 bg-cover bg-center"></div>
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-100 via-gray-100/90 to-transparent dark:from-[#030014] dark:via-[#030014]/90"></div>

        {/* Decorative Grid Lines */}
        <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}></div>
      </div>

      {/* Left Aligned Header */}
      <div className="absolute top-6 left-6 md:top-8 md:left-8 z-20 pointer-events-none">
        <div className="flex flex-col items-start text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/60 dark:bg-white/10 border border-gray-200/50 dark:border-white/10 backdrop-blur-md shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-yc-purple animate-pulse"></span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-gray-800 dark:text-gray-200">Season 1: Live</span>
          </div>
        </div>
      </div>

      {/* 3D Interactive Cards */}
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center pt-8 pb-4">
        <Interactive3DCards />
      </div>
    </div>
  );
};

export default HeroBanner;