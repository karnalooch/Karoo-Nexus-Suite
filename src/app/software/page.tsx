"use client";

import { motion } from "framer-motion";
import { Zap, Activity, Search, Download, UploadCloud, Smartphone } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const SOFTWARE_LIBRARY = [
  { id: "ki2", name: "Ki2 Extension", desc: "Shimano Di2 Gear Integration", icon: Zap, version: "v3.1.2", category: "Utility" },
  { id: "headwind", name: "Karoo Headwind", desc: "Real-time Wind & Weather", icon: Activity, version: "v1.4.0", category: "Data Field" },
  { id: "waypoints", name: "K-Waypoints", desc: "POI & Navigation Tools", icon: Search, version: "v2.0.1", category: "Navigation" },
];

export default function SoftwareHub() {
  const [isInstalling, setIsInstalling] = useState<string | null>(null);
  const [adbStatus, setAdbStatus] = useState("Disconnected"); // In real use, this would be global state/context

  const handleInstall = async (appId: string) => {
    setIsInstalling(appId);
    // Mocking the wait for install
    setTimeout(() => {
      setIsInstalling(null);
    }, 2000);
  };

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
        {/* CURATED APKS */}
        <div className="xl:col-span-2 space-y-8">
          <div className="flex items-center justify-between">
             <h2 className="text-2xl font-black italic uppercase tracking-tight">Curated <span className="text-primary not-italic">Extensions</span></h2>
             <span className="text-[10px] font-black uppercase tracking-widest bg-white/5 px-4 py-2 rounded-full border border-white/10">3 APKS Available</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SOFTWARE_LIBRARY.map((app) => (
              <div key={app.id} className="glass-card p-10 rounded-[2.5rem] group hover:border-primary/50 transition-all">
                <div className="flex items-start justify-between mb-8">
                  <div className="p-5 bg-primary/10 rounded-2xl text-primary group-hover:bg-primary group-hover:text-white transition-all">
                    <app.icon className="w-8 h-8" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{app.category}</span>
                </div>
                <h3 className="text-3xl font-black italic uppercase tracking-tight mb-2">{app.name}</h3>
                <p className="text-sm text-slate-500 mb-10 font-medium leading-relaxed">{app.desc}</p>
                
                <div className="flex items-center gap-4">
                   <button 
                     onClick={() => handleInstall(app.id)}
                     disabled={isInstalling === app.id}
                     className={`flex-1 py-5 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-3 ${
                       isInstalling === app.id ? 'bg-primary/50 cursor-wait' : 'bg-primary text-white hover:shadow-2xl hover:translate-y-[-2px]'
                     }`}
                   >
                     {isInstalling === app.id ? <Zap className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                     {isInstalling === app.id ? 'Synchronizing...' : 'Sideload to Karoo'}
                   </button>
                   <div className="px-4 py-5 bg-white/5 rounded-2xl border border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {app.version}
                   </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CUSTOM DEPLOYMENT ZONE */}
        <div className="space-y-8">
          <h2 className="text-2xl font-black italic uppercase tracking-tight">Neural <span className="text-primary not-italic">Flash</span></h2>
          <div className="glass-card p-10 rounded-[3rem] border-dashed border-primary/30 flex flex-col items-center justify-center text-center space-y-8 min-h-[500px] group hover:bg-primary/5 transition-all cursor-pointer">
             <div className="w-24 h-24 bg-primary/10 rounded-[2rem] flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                <UploadCloud className="w-12 h-12" />
             </div>
             <div className="space-y-2">
                <p className="text-xl font-black italic uppercase tracking-tight">Drop Tactical APK</p>
                <p className="text-xs text-slate-500 font-medium px-8">Drag any Android installable file here to initiate instant sideloading to your Karoo device.</p>
             </div>
             <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-primary/50">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Awaiting Data Stream
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
