"use client";

import { motion, AnimatePresence } from "framer-motion";
import { 
  Zap, Activity, Search, Download, UploadCloud, Smartphone, 
  Settings, Terminal, Heart, Globe, Box, CheckCircle2, 
  AlertCircle, ChevronRight, X, Shield, Star, Info,
  Map, Wind, Coffee, ShieldAlert, Cpu, Gauge
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useNexus } from "@/context/NexusContext";

import HUB_DATA from "@/data/hub-data.json";

type HubApp = (typeof HUB_DATA)[number];
type DownloadProgress = { percentage: number; current: number; total: number };

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Training": Gauge,
  "Navigation": Map,
  "System": Settings,
  "Data Field": Box,
  "Safety": ShieldAlert,
  "Lifestyle": Coffee,
  "Health": Activity,
  "Environment": Wind,
  "Utility": Terminal,
};

const CATEGORIES = ["All", ...Array.from(new Set(HUB_DATA.map(app => app.category)))];

export default function SoftwareHub() {
  const [isInstalling, setIsInstalling] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{percentage: number, current: number, total: number} | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedApp, setSelectedApp] = useState<HubApp | null>(null);
  const [installStatus, setInstallStatus] = useState<"idle" | "success" | "error">("idle");
  const { adbStatus } = useNexus();
  const isOffline = adbStatus !== "Online";

  const logInteraction = async (msg: string) => {
    try {
      await invoke("log_interaction", { action: msg });
    } catch (e) {
      console.error("Log failed", e);
    }
  };

  const handleInstall = async (app: HubApp) => {
    setIsInstalling(app.id);
    setDownloadProgress(null);
    logInteraction(`HUB :: Initiating Tactical Deployment for ${app.name}`);
    
    try {
      logInteraction(`HUB :: Searching GitHub Releases for ${app.owner}/${app.repo}...`);
      const apkUrl = await invoke("get_github_release_apk", { owner: app.owner, repo: app.repo }) as string;
      logInteraction(`HUB :: Target found: ${apkUrl}`);

      const fileName = `${app.id}_latest.apk`;
      logInteraction(`HUB :: Streaming package to local cache...`);
      const downloadedPath = await invoke<string>("download_firmware", { url: apkUrl, fileName });

      logInteraction(`HUB :: Injecting package into Karoo neural link...`);
      const res = await invoke("install_package", { path: downloadedPath }) as string;
      logInteraction(`HUB :: Success :: ${res}`);
      
      setDownloadProgress(null);
      setInstallStatus("success");
      setTimeout(() => setInstallStatus("idle"), 5000);
    } catch (e) {
      logInteraction(`HUB :: Error :: ${e}`);
      setInstallStatus("error");
      setTimeout(() => setInstallStatus("idle"), 5000);
    } finally {
      setIsInstalling(null);
    }
  };

  const handleSideload = async (path: string) => {
    setIsInstalling("custom");
    logInteraction(`FLASHER :: Initiating Neural Sideload for ${path}`);
    try {
      const res = await invoke("install_package", { path }) as string;
      logInteraction(`FLASHER :: Success :: ${res}`);
      setInstallStatus("success");
      setTimeout(() => setInstallStatus("idle"), 5000);
    } catch (e) {
      logInteraction(`FLASHER :: Failure :: ${e}`);
      setInstallStatus("error");
      setTimeout(() => setInstallStatus("idle"), 5000);
    } finally {
      setIsInstalling(null);
    }
  };

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Android Package', extensions: ['apk'] }]
    });
    if (selected) {
      handleSideload(selected as string);
    }
  };

  useEffect(() => {
    const unlisten = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        const apk = paths.find((p: string) => p.endsWith(".apk"));
        if (apk) {
          handleSideload(apk);
        }
      }
    });
    const unlistenProgress = listen<DownloadProgress>("firmware-download-progress", (event) => {
      setDownloadProgress(event.payload);
    });

    return () => {
      unlisten.then(f => f());
      unlistenProgress.then(f => f());
    };
  }, []);

  const filteredHub = HUB_DATA.filter(app => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          app.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "All" || app.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const featuredApps = HUB_DATA.filter(app => app.featured);

  return (
    <div className="max-w-[1400px] mx-auto space-y-12 pb-32">
      <header className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 border-b border-border pb-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Software Hub</h1>
            <p className="text-slate-500 font-medium max-w-2xl text-sm leading-relaxed">
              Explore the ultimate collection of Hammerhead Karoo extensions. From performance metrics to tactical navigation, Nexus Hub connects you directly to the community&apos;s best.
            </p>
          </div>
          <div className="relative group max-w-md w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-primary transition-colors" />
            <input 
              type="text" 
              placeholder="Search repository..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-secondary border border-border rounded-md py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-primary/50 transition-all placeholder:text-slate-500"
            />
          </div>
        </div>
      </header>

      {/* CATEGORY NAV */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 no-scrollbar">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-6 py-2 rounded-md text-xs font-semibold transition-all whitespace-nowrap border ${
              activeCategory === cat 
                ? "bg-primary text-white border-primary shadow-sm" 
                : "bg-secondary text-slate-500 border-border hover:border-slate-400"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-12">
        {/* MAIN REPOSITORY GRID */}
        <div className="xl:col-span-3 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
            {filteredHub.map((app) => (
              <motion.div 
                key={app.id}
                layoutId={app.id}
                onClick={() => setSelectedApp(app)}
                className={`glass-card p-6 rounded-lg group hover:border-primary/50 transition-all cursor-pointer flex flex-col justify-between space-y-6 relative overflow-hidden border border-border shadow-sm ${isOffline ? 'opacity-40 grayscale-75' : ''}`}
              >
                <div className="space-y-4">
                   <div className="flex items-start justify-between">
                    <div className={`p-4 rounded-md transition-all ${isInstalling === app.id ? 'bg-primary text-white' : 'bg-secondary text-primary group-hover:bg-primary group-hover:text-white shadow-sm'}`}>
                      {(() => {
                        const Icon = CATEGORY_ICONS[app.category] || Box;
                        return <Icon className="w-6 h-6" />;
                      })()}
                    </div>
                    {app.featured && (
                      <div className="px-2 py-0.5 bg-primary/10 text-primary rounded text-[9px] font-bold uppercase tracking-wider border border-primary/10">
                        Featured
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold tracking-tight text-foreground">{app.name}</h3>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{app.category}</span>
                    </div>
                    <p className="text-[13px] text-slate-500 font-medium leading-relaxed line-clamp-2">
                       {app.description}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-4 border-t border-border">
                   <div className="flex items-center gap-2">
                      <Shield className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] font-semibold tracking-tight text-slate-500">{app.license}</span>
                   </div>
                   <div className="p-1 text-slate-400 group-hover:text-primary transition-all">
                      <ChevronRight className="w-4 h-4" />
                   </div>
                </div>
              </motion.div>
            ))}
          </div>

          {filteredHub.length === 0 && (
            <div className="py-32 text-center glass-card rounded-[4rem] border-dashed border-white/10 space-y-6">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto">
                    <Search className="w-10 h-10 text-slate-800" />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-black italic uppercase text-slate-300">Signal Lost</p>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 italic">No tactical packages match your current filters</p>
                </div>
            </div>
          )}
        </div>

        {/* FAST DEPLOYMENT & STATS SIDEBAR */}
        <div className="space-y-8">
           <div className="glass-card p-10 rounded-[3rem] space-y-10 border border-primary/20 bg-primary/5">
              <div className="space-y-2">
                <h3 className="text-2xl font-black italic uppercase tracking-tight">Nexus <span className="text-primary not-italic">Status</span></h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Neural Sync v1.4.0</p>
              </div>
              
              <div className="space-y-6">
                 <div className="flex justify-between items-center px-2">
                   <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Packages</span>
                   <span className="text-lg font-black text-primary">{HUB_DATA.length}</span>
                 </div>
                 <div className="h-px bg-white/5" />
                 <div className="flex justify-between items-center px-2">
                   <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Active Syncs</span>
                   <span className="text-lg font-black text-emerald-500 tracking-tighter">LIVE</span>
                 </div>
              </div>

              <div className="pt-6">
                <button 
                  onClick={pickFile}
                  disabled={!!isInstalling || isOffline}
                  className={`w-full py-6 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col items-center gap-4 transition-all hover:bg-primary/10 hover:border-primary/40 group ${
                    installStatus === "success" ? "border-emerald-500/50 bg-emerald-500/10" :
                    installStatus === "error" ? "border-red-500/50 bg-red-500/10" : ""
                  } ${isOffline ? 'opacity-30 cursor-not-allowed grayscale' : ''}`}
                >
                   {installStatus === "success" ? <CheckCircle2 className="w-8 h-8 text-emerald-500" /> :
                    installStatus === "error" ? <AlertCircle className="w-8 h-8 text-red-500" /> :
                    <UploadCloud className="w-8 h-8 text-slate-600 group-hover:text-primary transition-all" />}
                   <div className="space-y-1">
                      <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                        installStatus === "success" ? "text-emerald-500" :
                        installStatus === "error" ? "text-red-500" : ""
                      }`}>
                        {installStatus === "success" ? "Sideload Successful" :
                         installStatus === "error" ? "Sideload Failed" :
                         "Manual Sideload"}
                      </p>
                      <p className="text-[8px] font-bold text-slate-600 uppercase">
                        {installStatus === "success" ? "Verified & Active" :
                         installStatus === "error" ? "Check ADB Connection" :
                         "Drag & Drop APK Here"}
                      </p>
                   </div>
                </button>
              </div>
           </div>

           <div className="glass-card p-10 rounded-[3rem] bg-amber-500/5 border-amber-500/20 space-y-4">
              <div className="flex items-center gap-3 text-amber-500">
                <AlertCircle className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Legal Notice</span>
              </div>
              <p className="text-[10px] text-amber-500/60 font-bold leading-relaxed italic">
                 Nexus Hub automates the deployment of community-driven packages. We respect all original authors and their respective open-source licenses. Attribution required for commercial use.
              </p>
           </div>
        </div>
      </div>

      {/* APP DETAILS MODAL */}
      <AnimatePresence>
        {selectedApp && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/40 backdrop-blur-3xl transition-all duration-300">
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="w-full max-w-5xl bg-background border border-border shadow-2xl rounded-lg relative overflow-hidden flex flex-col lg:flex-row"
            >
              <button 
                onClick={() => setSelectedApp(null)}
                className="absolute top-6 right-6 p-2 bg-secondary rounded-md text-slate-500 hover:text-foreground hover:bg-slate-200 dark:hover:bg-white/10 transition-all z-10"
              >
                <X className="w-4 h-4" />
              </button>

              {/* LEFT COLUMN: HERO */}
              <div className="lg:w-2/5 p-12 lg:p-20 bg-primary/5 border-r border-white/5 flex flex-col items-center justify-center space-y-10 text-center">
                 <div className={`w-32 h-32 rounded-[3.5rem] flex items-center justify-center shadow-2xl relative ${isInstalling === selectedApp.id ? 'bg-primary text-white animate-pulse' : 'bg-primary text-white'}`}>
                    {(() => {
                      const Icon = CATEGORY_ICONS[selectedApp.category] || Box;
                      return <Icon className="w-16 h-16" />;
                    })()}
                    <div className="absolute -inset-4 bg-primary/20 blur-3xl -z-10 rounded-full" />
                 </div>
                 <div className="space-y-4">
                    <h2 className="text-5xl font-black italic uppercase tracking-tighter leading-none">{selectedApp.name}</h2>
                    <div className="flex items-center justify-center gap-3">
                       <span className="px-4 py-2 bg-white/5 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-500 border border-white/10">{selectedApp.category}</span>
                       <span className="px-4 py-2 bg-white/5 rounded-full text-[9px] font-black uppercase tracking-widest text-primary border border-primary/20">{selectedApp.license}</span>
                    </div>
                 </div>
                 
                 <button 
                    onClick={() => handleInstall(selectedApp)}
                    disabled={!!isInstalling || isOffline}
                    className={`w-full md:w-56 py-6 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-3 ${
                       isInstalling === selectedApp.id ? 'bg-primary/50 cursor-wait shadow-inner' : 
                       installStatus === "success" && !isInstalling ? 'bg-emerald-500 text-white shadow-[0_0_30px_rgba(16,185,129,0.3)]' :
                       installStatus === "error" && !isInstalling ? 'bg-red-500 text-white' :
                       isOffline ? 'bg-slate-700 text-slate-500 cursor-not-allowed opacity-50 grayscale' :
                       'bg-primary text-white hover:shadow-2xl hover:translate-y-[-2px] active:scale-95'
                     } ${isInstalling && isInstalling !== selectedApp.id ? 'opacity-30 grayscale' : ''}`}
                   >
                     {isInstalling === selectedApp.id ? <Zap className="w-4 h-4 animate-spin text-white" /> : 
                      installStatus === "success" && !isInstalling ? <CheckCircle2 className="w-4 h-4" /> :
                      installStatus === "error" && !isInstalling ? <AlertCircle className="w-4 h-4" /> :
                      isOffline ? <ShieldAlert className="w-4 h-4" /> :
                      <Download className="w-4 h-4" />}
                     {isInstalling === selectedApp.id ? 'INJECTING...' : 
                      installStatus === "success" && !isInstalling ? 'INSTALLED' :
                      installStatus === "error" && !isInstalling ? 'FAILED' :
                      isOffline ? 'LINK REQUIRED' :
                      'SIDELOAD'}
                   </button>

                 {isInstalling === selectedApp.id && downloadProgress && (
                    <div className="w-full space-y-4">
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${downloadProgress.percentage}%` }}
                          className="h-full bg-primary"
                        />
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary">{downloadProgress.percentage.toFixed(1)}% Cached</p>
                    </div>
                 )}
              </div>

              {/* RIGHT COLUMN: CONTENT */}
              <div className="flex-1 p-12 lg:p-20 space-y-16 overflow-y-auto max-h-[85vh] custom-scrollbar">
                 <section className="space-y-8">
                    <div className="flex items-center gap-4">
                       <Info className="w-5 h-5 text-primary" />
                       <h4 className="text-xl font-black italic uppercase tracking-tight">Neural Briefing</h4>
                       <div className="h-px flex-1 bg-white/10" />
                    </div>
                    <p className="text-base text-slate-400 font-medium leading-relaxed">
                       {selectedApp.long_description}
                    </p>
                 </section>

                 <section className="space-y-8">
                    <div className="flex items-center gap-4">
                       <Cpu className="w-5 h-5 text-primary" />
                       <h4 className="text-xl font-black italic uppercase tracking-tight">Package Features</h4>
                       <div className="h-px flex-1 bg-white/10" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {selectedApp.features.map((feature: string, idx: number) => (
                         <div key={idx} className="flex items-center gap-4 p-5 bg-white/5 rounded-3xl border border-white/5">
                            <div className="w-2 h-2 rounded-full bg-primary" />
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-300">{feature}</span>
                         </div>
                       ))}
                    </div>
                 </section>

                 <section className="space-y-8">
                    <div className="flex items-center gap-4">
                       <Terminal className="w-5 h-5 text-primary" />
                       <h4 className="text-xl font-black italic uppercase tracking-tight">Source Metadata</h4>
                       <div className="h-px flex-1 bg-white/10" />
                    </div>
                    <div className="p-8 bg-black/40 rounded-[2.5rem] border border-white/5 space-y-4">
                       <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Repository</span>
                          <span className="text-xs font-mono text-primary">{selectedApp.owner}/{selectedApp.repo}</span>
                       </div>
                       <div className="h-px bg-white/5" />
                       <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">License Model</span>
                          <span className="text-xs font-mono text-slate-300">{selectedApp.license}</span>
                       </div>
                    </div>
                 </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
