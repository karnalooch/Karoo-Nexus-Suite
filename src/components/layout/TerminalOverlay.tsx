"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, ChevronDown, ChevronUp, Trash2, Maximize2, Minimize2 } from "lucide-react";
import { useNexus } from "@/context/NexusContext";

export function TerminalOverlay() {
  const { logs, clearLogs } = useNexus();
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={`fixed bottom-0 right-10 z-[150] transition-all duration-300 ${isMaximized ? 'left-10' : 'w-[400px]'}`}>
      <div className={`bg-zinc-900/90 backdrop-blur-xl border-x border-t border-white/10 rounded-t-2xl shadow-2xl overflow-hidden flex flex-col ${isOpen ? (isMaximized ? 'h-[400px]' : 'h-[300px]') : 'h-12'}`}>
        {/* HEADER */}
        <div 
          className="px-4 h-12 flex items-center justify-between cursor-pointer border-b border-white/5 hover:bg-white/5 transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center gap-3">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">System Terminal</span>
            {logs.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400 text-[9px] font-mono">
                {logs.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={clearLogs}
              className="p-1.5 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-md transition-colors"
              title="Clear Logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-white rounded-md transition-colors"
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="p-1.5 hover:bg-white/10 text-slate-500 hover:text-white rounded-md transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* LOGS BODY */}
        <AnimatePresence>
          {isOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <div 
                ref={scrollRef}
                className="flex-1 p-4 overflow-y-auto custom-scrollbar font-mono text-[10px] leading-relaxed"
              >
                {logs.map((log, i) => (
                  <div key={i} className="mb-1.5 flex gap-3 group">
                    <span className="text-slate-600 shrink-0 select-none">{logs.length - i}</span>
                    <span className={`break-all ${
                      log.includes("ERROR") ? "text-red-400" :
                      log.includes("SUCCESS") ? "text-emerald-400" :
                      log.includes("SURGERY") ? "text-amber-400 font-bold" :
                      "text-slate-300"
                    }`}>
                      {log}
                    </span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="h-full flex items-center justify-center text-slate-600 italic">
                    No active link streams...
                  </div>
                )}
              </div>
              <div className="px-4 py-1.5 bg-black/50 border-t border-white/5 flex justify-between items-center shrink-0">
                <div className="flex gap-2 items-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Neural Link Active</span>
                </div>
                <span className="text-[9px] text-slate-700 font-mono italic">Nexus Terminal v1.0.4</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
