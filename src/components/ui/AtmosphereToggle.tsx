"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function AtmosphereToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-48 h-14 bg-slate-100 dark:bg-slate-900 rounded-3xl animate-pulse" />;

  const isDark = theme === "dark";

  return (
    <div className="relative group">
      <div className={`absolute inset-0 blur-2xl transition-opacity duration-1000 ${isDark ? 'bg-primary/20 opacity-100' : 'bg-orange-500/10 opacity-0'}`} />
      
      <button
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className="relative w-56 h-16 bg-white/40 dark:bg-slate-900/40 backdrop-blur-3xl border border-white/20 dark:border-slate-800 rounded-3xl p-1.5 flex items-center cursor-pointer shadow-lg overflow-hidden"
      >
        <motion.div
           layout
           transition={{ type: "spring", stiffness: 300, damping: 30 }}
           className={`absolute h-13 w-24 rounded-2xl flex items-center justify-center z-10 shadow-2xl ${isDark ? 'bg-primary left-[calc(100%-6.5rem)]' : 'bg-white left-1.5'}`}
        >
           <AnimatePresence mode="wait">
             {isDark ? (
                <motion.div
                  key="moon"
                  initial={{ rotate: -90, scale: 0 }}
                  animate={{ rotate: 0, scale: 1 }}
                  exit={{ rotate: 90, scale: 0 }}
                >
                   <Moon className="w-6 h-6 text-slate-900 fill-slate-900" />
                </motion.div>
             ) : (
                <motion.div
                  key="sun"
                  initial={{ rotate: 90, scale: 0 }}
                  animate={{ rotate: 0, scale: 1 }}
                  exit={{ rotate: -90, scale: 0 }}
                >
                   <Sun className="w-6 h-6 text-orange-500 fill-orange-500" />
                </motion.div>
             )}
           </AnimatePresence>
        </motion.div>

        <div className="flex-1 flex justify-between px-6 z-0">
           <div className={`flex flex-col items-start transition-opacity duration-500 ${isDark ? 'opacity-30' : 'opacity-100'}`}>
              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-orange-600">Active</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">Solar Hub</span>
           </div>
           
           <div className={`flex flex-col items-end transition-opacity duration-500 ${isDark ? 'opacity-100' : 'opacity-30'}`}>
              <span className="text-[8px] font-black uppercase tracking-[0.3em] text-primary">Active</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-white">Obsidian</span>
           </div>
        </div>
      </button>

      <div className="absolute -bottom-1 left-12 right-12 h-[2px] bg-primary scale-x-0 group-hover:scale-x-100 transition-transform duration-700 origin-center" />
    </div>
  );
}
