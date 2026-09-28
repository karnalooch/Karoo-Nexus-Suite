"use client";

import { motion } from "framer-motion";
import { Download, X, Zap, HardDrive, CheckCircle2 } from "lucide-react";
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface DownloadProgress {
  current: number;
  total: number;
  percentage: number;
}

interface TacticalDownloaderProps {
  isOpen: boolean;
  onClose: () => void;
  url: string | null;
  fileName: string;
  downloadedPath?: string | null;
}

export function TacticalDownloader({ isOpen, onClose, url, fileName, downloadedPath }: TacticalDownloaderProps) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "complete" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const unlistenProgress = listen("firmware-download-progress", (event) => {
      const payload = event.payload as DownloadProgress;
      setProgress(payload);
      setStatus(payload.percentage >= 100 ? "complete" : "downloading");
      if (payload.percentage >= 100) {
        setStatus("complete");
      }
    });

    const unlistenError = listen("firmware-download-error", (event) => {
      const errorMsg = event.payload as string;
      setError(errorMsg);
      setStatus("error");
    });

    return () => {
      unlistenProgress.then(f => f());
      unlistenError.then(f => f());
    };
  }, [isOpen]);

  const handleClose = () => {
    setProgress(null);
    setStatus("idle");
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl glass-card rounded-[3rem] border border-primary/30 p-12 relative overflow-hidden"
      >
        {/* DECORATIVE BACKGROUND */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full -mr-32 -mt-32" />
        
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-primary/20 rounded-2xl text-primary">
               {status === 'complete' ? <CheckCircle2 className="w-6 h-6" /> : <Download className="w-6 h-6 animate-pulse" />}
            </div>
            <div>
               <h3 className="text-2xl font-black italic uppercase tracking-tight">Tactical <span className="text-primary not-italic">Archive</span></h3>
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">Syncing Firmware Stream</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-slate-500 hover:text-white">
             <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-8">
           <div className="p-6 bg-white/5 border border-white/10 rounded-3xl space-y-4">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                 <span className="text-slate-400">Resource</span>
                 <span className="text-primary truncate ml-8 max-w-[300px]">{fileName}</span>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                 <span className="text-slate-400">Target Cache</span>
                 <span className="text-slate-200">Local Neural Storage</span>
              </div>
           </div>

           <div className="space-y-4">
              <div className="flex items-center justify-between">
                 <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">
                    {status === 'complete' ? 'Archive Verified' : 'Inbound Stream Progress'}
                 </span>
                 <span className="text-2xl font-black italic text-primary">
                    {progress ? Math.round(progress.percentage) : 0}%
                 </span>
              </div>
              
              <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/10 p-0.5">
                 <motion.div 
                   initial={{ width: 0 }}
                   animate={{ width: `${progress?.percentage || 0}%` }}
                   className="h-full bg-primary rounded-full shadow-[0_0_20px_rgba(var(--primary),0.5)]"
                 />
              </div>

              <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-slate-600">
                 <div className="flex items-center gap-2">
                    <HardDrive className="w-3 h-3" />
                    <span>{progress ? (progress.current / 1024 / 1024).toFixed(1) : 0} MB / {progress ? (progress.total / 1024 / 1024).toFixed(1) : 0} MB</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <Zap className="w-3 h-3" />
                    <span>{status === 'complete' ? 'Sync Terminated' : 'Streaming...'}</span>
                 </div>
              </div>
           </div>
        </div>

        {status === 'complete' && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12 p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-3xl flex items-center justify-between"
          >
             <div className="flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Firmware Archive Secured</span>
             </div>
             <div className="flex items-center gap-3">
               {downloadedPath && (
                 <button 
                   onClick={() => invoke("open_folder", { path: downloadedPath }).catch(console.error)}
                   className="px-6 py-2 border border-emerald-500/30 text-emerald-500 text-[10px] font-black uppercase tracking-widest rounded-full hover:bg-emerald-500/10 transition-all"
                 >
                    Show in Folder
                 </button>
               )}
               <button 
                 onClick={handleClose}
                 className="px-6 py-2 bg-emerald-500 text-black text-[10px] font-black uppercase tracking-widest rounded-full hover:shadow-lg transition-all"
               >
                  Close Channel
               </button>
             </div>
          </motion.div>
        )}

        {status === "error" && (
          <div className="mt-12 flex flex-col gap-4">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-200 text-sm">
              <div className="font-bold mb-1 underline">Neural Link Interrupted</div>
              {error}
              {url && (
                <div className="mt-4 pt-4 border-t border-red-500/20">
                  <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1">Manual Coordination Required:</div>
                  <div className="p-2 bg-black/40 rounded border border-white/5 font-mono text-[10px] break-all select-all">
                    {url}
                  </div>
                  <div className="mt-2 text-[9px] text-red-400/60 italic">
                    Note: Try opening this link in a browser where you are logged into Hammerhead Dashboard.
                  </div>
                </div>
              )}
            </div>
            <button
               onClick={handleClose}
               className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold transition-all"
            >
              Reset Hook
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
