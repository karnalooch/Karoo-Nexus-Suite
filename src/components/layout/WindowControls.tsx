"use client";

import React, { useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/window").then((module) => {
        const win = module.getCurrentWindow();
        setAppWindow(win);
        
        win.isMaximized().then(setIsMaximized);
        const unlisten = win.onResized(() => {
          win.isMaximized().then(setIsMaximized);
        });

        return () => {
          unlisten.then((fn) => fn());
        };
      });
    }
  }, []);

  const handleMinimize = () => appWindow?.minimize();
  const handleMaximize = async () => {
    if (appWindow) {
      await appWindow.toggleMaximize();
      setIsMaximized(await appWindow.isMaximized());
    }
  };
  const handleClose = () => appWindow?.close();

  if (!appWindow) return null;

  return (
    <div className="flex items-center gap-1 bg-black/20 backdrop-blur-md px-3 py-2 rounded-bl-3xl border-l border-b border-white/5 pointer-events-auto">
      <button 
        onClick={handleMinimize}
        className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 hover:text-white"
        title="Minimize"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button 
        onClick={handleMaximize}
        className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 hover:text-white"
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? <Copy className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>
      <button 
        onClick={handleClose}
        className="p-2 hover:bg-red-500/80 rounded-xl transition-colors text-slate-400 hover:text-white"
        title="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
