"use client";

import { motion } from "framer-motion";
import { Zap, Activity, Search, Download, UploadCloud, Smartphone } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Settings, Terminal, Heart, Globe, Box, CheckCircle2, AlertCircle } from "lucide-react";

import HUB_DATA from "@/data/hub-data.json";

const CATEGORY_ICONS: Record<string, any> = {
  "Groupsets": Zap,
  "Nutrition": Activity,
  "Data Field": Search,
  "Health & Safety": Smartphone,
  "System": Settings,
  "Utility": Terminal,
};

const SOFTWARE_LIBRARY = [
  { id: "ki2", name: "Ki2 Extension", desc: "Shimano Di2 Gear Integration", icon: Zap, version: "v3.1.2", category: "Utility" },
  { id: "headwind", name: "Karoo Headwind", desc: "Real-time Wind & Weather", icon: Activity, version: "v1.4.0", category: "Data Field" },
  { id: "waypoints", name: "K-Waypoints", desc: "POI & Navigation Tools", icon: Search, version: "v2.0.1", category: "Navigation" },
];

export default function SoftwareHub() {
  const [isInstalling, setIsInstalling] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{percentage: number, current: number, total: number} | null>(null);
  const [adbStatus, setAdbStatus] = useState("Disconnected");
  const [searchQuery, setSearchQuery] = useState("");

  const logInteraction = async (msg: string) => {
    try {
      await invoke("log_interaction", { action: msg });
    } catch (e) {
      console.error("Log failed", e);
    }
  };

  const handleInstall = async (app: any) => {
    setIsInstalling(app.id);
    setDownloadProgress(null);
    logInteraction(`HUB :: Initiating Tactical Deployment for ${app.name}`);
    
    try {
      // 1. Get latest APK URL from GitHub
      logInteraction(`HUB :: Searching GitHub Releases for ${app.owner}/${app.repo}...`);
      const apkUrl = await invoke("get_github_release_apk", { owner: app.owner, repo: app.repo }) as string;
      logInteraction(`HUB :: Target found: ${apkUrl}`);

      // 2. Download to local path
      const fileName = `${app.id}_latest.apk`;
      const localPath = `tactical_cache/${fileName}`; // This will be relative to app binary or absolute depending on Tauri setup
      // Note: In real production we'd use appDataDir prefix
      
      logInteraction(`HUB :: Streaming package to local cache...`);
      await invoke("download_firmware", { url: apkUrl, localPath });

      // 3. Sideload via ADB
      logInteraction(`HUB :: Injecting package into Karoo neural link...`);
      const res = await invoke("install_package", { path: localPath }) as string;
      logInteraction(`HUB :: Success :: ${res}`);
      
      setDownloadProgress(null);
    } catch (e) {
      logInteraction(`HUB :: Error :: ${e}`);
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
    } catch (e) {
      logInteraction(`FLASHER :: Failure :: ${e}`);
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
    const unlisten = listen("tauri://drag-drop", (event: any) => {
      // In Tauri v2, the payload structure might differ slightly but paths is common
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        const apk = paths.find((p: string) => p.endsWith(".apk"));
        if (apk) {
          handleSideload(apk);
        } else {
          logInteraction("FLASHER :: Rejected non-APK data stream.");
        }
      }
    });
    const unlistenProgress = listen("firmware-download-progress", (event: any) => {
      setDownloadProgress(event.payload);
    });

    return () => {
      unlisten.then(f => f());
      unlistenProgress.then(f => f());
    };
  }, []);

  const filteredHub = HUB_DATA.filter(app => 
    app.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    app.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    app.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-12 max-w-[1600px] mx-auto space-y-12">
      <header className="space-y-4">
        <div className="flex items-center gap-4">
           <div className="px-4 py-1.5 bg-primary/20 text-primary rounded-full text-[10px] font-black uppercase tracking-widest">
              Software Hub
           </div>
           <div className="h-px flex-1 bg-white/10" />
        </div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter">
          Tactical <span className="text-primary not-italic">Library</span>
        </h1>
        <p className="text-slate-500 font-medium max-w-2xl">
          Curated extensions and system tools for Hammerhead Karoo. Deploy high-performance APKs directly via the Nexus Neural Sync.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-12">
        {/* NEXUS HUB SECTION */}
        <div className="xl:col-span-2 space-y-12">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
             <div className="space-y-1">
                <h2 className="text-3xl font-black italic uppercase tracking-tight">Nexus <span className="text-primary not-italic">Hub</span></h2>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Powered by Awesome-Karoo Community</p>
             </div>
             <div className="relative group max-w-sm w-full">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-primary transition-colors" />
                <input 
                  type="text" 
                  placeholder="SEARCH NEXUS REPOSITORY..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-14 pr-8 text-[10px] font-black uppercase tracking-widest focus:outline-none focus:border-primary/50 transition-all"
                />
             </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
            {filteredHub.map((app) => (
              <div key={app.id} className="glass-card p-8 md:p-10 rounded-[2.5rem] group hover:border-primary/50 transition-all flex flex-col md:flex-row items-center gap-10">
                <div className={`p-8 rounded-[2rem] transition-all shrink-0 ${isInstalling === app.id ? 'bg-primary animate-pulse text-white' : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white'}`}>
                  {(() => {
                    const Icon = CATEGORY_ICONS[app.category] || Box;
                    return <Icon className="w-10 h-10" />;
                  })()}
                </div>
                
                <div className="flex-1 space-y-4 text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-4">
                    <h3 className="text-3xl font-black italic uppercase tracking-tight">{app.name}</h3>
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1 bg-white/5 rounded-full border border-white/10 text-slate-500">{app.category}</span>
                  </div>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-xl">{app.description}</p>
                  
                  {isInstalling === app.id && downloadProgress && (
                    <div className="space-y-3 w-full max-w-md mx-auto md:mx-0">
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${downloadProgress.percentage}%` }}
                          className="h-full bg-primary"
                        />
                      </div>
                      <div className="flex justify-between text-[9px] font-black uppercase tracking-tighter text-slate-500">
                        <span>{downloadProgress.percentage.toFixed(1)}% Downloaded</span>
                        <span>{(downloadProgress.current / 1024 / 1024).toFixed(1)}MB / {(downloadProgress.total / 1024 / 1024).toFixed(1)}MB</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="shrink-0 w-full md:w-auto">
                   <button 
                     onClick={() => handleInstall(app)}
                     disabled={!!isInstalling}
                     className={`w-full md:w-56 py-6 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-3 ${
                       isInstalling === app.id ? 'bg-primary/50 cursor-wait shadow-inner' : 'bg-primary text-white hover:shadow-2xl hover:translate-y-[-2px] active:scale-95'
                     } ${isInstalling && isInstalling !== app.id ? 'opacity-30 grayscale' : ''}`}
                   >
                     {isInstalling === app.id ? <Zap className="w-4 h-4 animate-spin text-white" /> : <Download className="w-4 h-4" />}
                     {isInstalling === app.id ? 'INJECTING...' : 'SIDELOAD'}
                   </button>
                </div>
              </div>
            ))}

            {filteredHub.length === 0 && (
              <div className="py-20 text-center glass-card rounded-[3rem] border-dashed border-white/10 space-y-4">
                 <Search className="w-12 h-12 text-slate-700 mx-auto" />
                 <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">No tactical packages match your search criteria</p>
              </div>
            )}
          </div>
        </div>

        {/* CUSTOM DEPLOYMENT ZONE */}
        <div className="space-y-8">
          <h2 className="text-2xl font-black italic uppercase tracking-tight">Neural <span className="text-primary not-italic">Flash</span></h2>
          <div 
            onClick={pickFile}
            className={`glass-card p-10 rounded-[3rem] border-dashed border-primary/30 flex flex-col items-center justify-center text-center space-y-8 min-h-[500px] group hover:bg-primary/5 transition-all cursor-pointer relative overflow-hidden ${isInstalling ? 'opacity-50 pointer-events-none' : ''}`}
          >
             {isInstalling === "custom" && (
               <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-50">
                 <div className="flex flex-col items-center gap-4">
                   <Zap className="w-12 h-12 text-primary animate-spin" />
                   <p className="text-xs font-black uppercase tracking-widest text-primary animate-pulse">Syncing Tactical Package...</p>
                 </div>
               </div>
             )}
             <div className="w-24 h-24 bg-primary/10 rounded-[2rem] flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                <UploadCloud className="w-12 h-12" />
             </div>
             <div className="space-y-2 text-balance">
                <p className="text-xl font-black italic uppercase tracking-tight">Drop Tactical APK</p>
                <p className="text-xs text-slate-500 font-medium px-8 leading-relaxed">Drag any Android installable file here or click to browse. Nexus will initiate instant sideloading to your Karoo device.</p>
             </div>
             <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-primary/50">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {isInstalling === "custom" ? "Sideloading Progress..." : "Awaiting Data Stream"}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
