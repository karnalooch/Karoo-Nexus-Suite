"use client";

import React, { useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<TauriWindow | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/window").then(async (module) => {
      const win = module.getCurrentWindow();
      if (disposed) return;

      setAppWindow(win);
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
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
