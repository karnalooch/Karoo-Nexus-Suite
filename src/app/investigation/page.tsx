"use client";

import { motion } from "framer-motion";
import { Search, Download, Zap, Terminal, ShieldAlert, Cpu, HardDriveDownload, Network } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { TacticalDownloader } from "@/components/TacticalDownloader";

export default function InvestigationPage() {
  const [packages, setPackages] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [capturedLinks, setCapturedLinks] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  
  // Downloader state
  const [downloaderOpen, setDownloaderOpen] = useState(false);
  const [activeDownloadUrl, setActiveDownloadUrl] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState("");

  const logInteraction = async (msg: string) => {
    try {
      await invoke("log_interaction", { action: msg });
    } catch (e) {
      console.error("Log failed", e);
    }
  };

  const fetchAndDownloadOTA = async (url: string) => {
     logInteraction(`INVESTIGATION :: Interrogating OTA Metadata Channel...`);
     try {
       // 1. Fetch metadata
       const metadata: any = await invoke("fetch_ota_metadata", { url });
       console.log("OTA Metadata received:", metadata);
       
       if (metadata.Message) {
         throw new Error(`Server returned error: ${metadata.Message}`);
       }

       logInteraction(`INVESTIGATION :: Metadata Channel Response: Update Found`);
       
       // Handle different possible structures from Hammerhead API
       let downloadUrl = "";
       let version = "karoo-tactical-update";

       if (metadata.updates && metadata.updates.length > 0) {
         downloadUrl = metadata.updates[0].url;
         version = metadata.updates[0].version;
       } else if (metadata.url) {
         downloadUrl = metadata.url;
         version = metadata.version || version;
       } else if (metadata.download_url) {
         downloadUrl = metadata.download_url;
         version = metadata.build_number || version;
       } else if (metadata.bucket || metadata.key) {
         // S3 Discovery Matrix - Cycle through regional shards
         const path = metadata.key || metadata.bucket;
         const candidateBases = [
           "https://karoo-repo.s3.us-east-1.amazonaws.com",
           "https://com.hammerhead.karoo-updates.s3.us-east-1.amazonaws.com",
           "https://s3.amazonaws.com/karoo-repo",
           "https://s3.amazonaws.com/com.hammerhead.karoo-updates"
         ];

         // Force regional us-east-1 for the first attempt as it is the most documented SRAM shard
         downloadUrl = `${candidateBases[0]}/${path}`;
         version = metadata.version || version;
       }
       
       if (!downloadUrl) {
         console.error("Payload structure unknown:", metadata);
         throw new Error("Could not extract download URL from metadata structure.");
       }

       logInteraction(`INVESTIGATION :: Extracted Download URL: ${downloadUrl}`);
       
       // 2. Open Downloader UI
       setActiveDownloadUrl(downloadUrl);
       setActiveFileName(`${version}.zip`);
       setDownloaderOpen(true);

       // 3. Initiate actual download with AUTO-DISCOVERY retry
       const localPath = `${version}.zip`;
       const path = metadata.key || metadata.bucket;
       
       if (metadata.bucket || metadata.key) {
         const candidateBases = [
           "https://karoo-repo.s3.us-east-1.amazonaws.com",
           "https://com.hammerhead.karoo-updates.s3.us-east-1.amazonaws.com",
           "https://s3.amazonaws.com/karoo-repo",
           "https://s3.amazonaws.com/com.hammerhead.karoo-updates",
           "https://s3.amazonaws.com/hammerhead-ota",
           "https://s3.amazonaws.com/hammerhead-karoo-ota-production"
         ];

         for (const base of candidateBases) {
           const attemptUrl = `${base}/${path}`;
           setActiveDownloadUrl(attemptUrl);
           logInteraction(`INVESTIGATION :: S3 SHARD PROBE :: ${base}`);
           try {
             await invoke("download_firmware", { url: attemptUrl, localPath });
             logInteraction(`INVESTIGATION :: NEURAL MATCH :: Found on ${base}`);
             return; 
           } catch (e) {
             console.error(`Shard failed: ${base}`, e);
             // If this was the last attempt, we don't throw (to avoid React crash)
             // The component already knows there was an error via the event listener
             if (base === candidateBases[candidateBases.length - 1]) {
                logInteraction(`INVESTIGATION :: ALL SHARDS FAILED :: Neural Link Severed`);
             }
           }
         }
       } else {
         await invoke("download_firmware", { url: downloadUrl, localPath });
       }

     } catch (e) {
        logInteraction(`INVESTIGATION :: OTA Channel Failure :: ${e}`);
        // Removed system alert and auto-close to keep the manual recovery link visible
     }
  };

  const scanAPKs = async () => {
    setIsScanning(true);
    logInteraction("INVESTIGATION :: Scanning device for installed packages");
    try {
      const list = await invoke("list_packages") as string[];
      setPackages(list);
      logInteraction(`INVESTIGATION :: Found ${list.length} packages`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Scan Failed :: ${e}`);
    } finally {
      setIsScanning(false);
    }
  };

  const extractAPK = async (pkgLine: string) => {
    // pkgLine format: package:/data/app/.../base.apk=com.example.name
    const parts = pkgLine.replace("package:", "").split("=");
    const remotePath = parts[0];
    const pkgName = parts[1] || "unknown_package";
    
    logInteraction(`INVESTIGATION :: Requesting extraction for ${pkgName}`);

    const savePath = await save({
      title: `Extract ${pkgName}`,
      defaultPath: `${pkgName}.apk`,
      filters: [{ name: "Android Package", extensions: ["apk"] }],
    });

    if (savePath) {
      try {
        logInteraction(`INVESTIGATION :: Pulling ${remotePath} to local filesystem`);
        const res = await invoke("pull_file", { remotePath, localPath: savePath }) as string;
        logInteraction(`INVESTIGATION :: SUCCESS :: ${res}`);
      } catch (e) {
        logInteraction(`INVESTIGATION :: Pull Failed :: ${e}`);
      }
    }
  };

  const captureOTA = async () => {
    setIsCapturing(true);
    logInteraction("INVESTIGATION :: Initializing real-time OTA capture...");
    try {
      const links = await invoke("capture_ota_logcat") as string[];
      if (links.length > 0) {
        // Filter out duplicates
        setCapturedLinks(prev => Array.from(new Set([...links, ...prev])));
      }
    } catch (e) {
      logInteraction(`INVESTIGATION :: OTA Capture Error :: ${e}`);
    } finally {
      setIsCapturing(false);
    }
  };

  const testOTA = async () => {
    // Current SRAM standard for legacy support uses v2 telemetry
    const deviceId = "ZD8DOF9PDEEQTKS8";
    const version = "karoo-1.320.1345.3";
    const testUrl = `https://api.hammerhead.io/v1/device/update?deviceid=${deviceId}&version=${version}&clientVersion=v2`;
    logInteraction(`INVESTIGATION :: SIMULATION :: Injecting v2 Tactical Query [ID: ${deviceId}]`);
    setCapturedLinks(prev => Array.from(new Set([testUrl, ...prev])));
  };

  const filteredPackages = packages.filter(p => p.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="p-12 max-w-[1600px] mx-auto space-y-12">
      <header className="space-y-4">
        <div className="flex items-center gap-4">
           <div className="px-4 py-1.5 bg-primary/20 text-primary rounded-full text-[10px] font-black uppercase tracking-widest">
              Tactical Investigation
           </div>
           <div className="h-px flex-1 bg-white/10" />
        </div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter">
          Forensic <span className="text-primary not-italic">Intel</span>
        </h1>
        <p className="text-slate-500 font-medium max-w-2xl">
          Extract tactical APKs from system partitions and intercept OTA update streams. Root is not required for APK extraction.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
        {/* APK EXTRACTOR */}
        <div className="glass-card rounded-[3rem] overflow-hidden flex flex-col border border-primary/20 min-h-[700px]">
          <div className="p-8 bg-primary/10 border-b border-primary/20 flex items-center justify-between">
            <div className="flex items-center gap-4">
               <div className="p-3 bg-primary/20 rounded-xl text-primary">
                  <HardDriveDownload className="w-5 h-5" />
               </div>
               <span className="text-sm font-black uppercase tracking-widest italic">Tactical APK Extractor</span>
            </div>
            <button 
              onClick={scanAPKs}
              disabled={isScanning}
              className="px-6 py-2 bg-primary text-white text-[10px] font-black uppercase tracking-widest rounded-full hover:shadow-lg transition-all disabled:opacity-50"
            >
              {isScanning ? "Scanning..." : "Scan Device"}
            </button>
          </div>

          <div className="p-6 border-b border-white/5 bg-black/20">
             <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Filter by package name or path..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-sm text-white focus:border-primary/50 outline-none transition-all placeholder:text-slate-600"
                />
             </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
             {filteredPackages.length > 0 ? filteredPackages.map((pkg, i) => (
               <motion.div 
                 key={i}
                 initial={{ opacity: 0, x: -10 }}
                 animate={{ opacity: 1, x: 0 }}
                 transition={{ delay: i * 0.01 }}
                 className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-primary/30 transition-all group"
               >
                  <div className="min-w-0 flex-1 pr-4">
                     <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 break-all truncate">
                        {pkg.split("=")[1]}
                     </p>
                     <p className="text-[8px] font-mono text-slate-700 break-all truncate mt-1">
                        {pkg.split("=")[0].replace("package:", "")}
                     </p>
                  </div>
                  <button 
                    onClick={() => extractAPK(pkg)}
                    className="p-3 bg-white/5 text-slate-400 rounded-xl hover:bg-primary hover:text-white transition-all shrink-0"
                  >
                    <Download className="w-4 h-4" />
                  </button>
               </motion.div>
             )) : (
               <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
                  <Cpu className="w-12 h-12 opacity-20" />
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-40 italic">Neural Scan Required</p>
               </div>
             )}
          </div>
        </div>

        {/* OTA CAPTURER */}
        <div className="space-y-12">
          <div className="glass-card rounded-[3rem] overflow-hidden border border-amber-500/20 bg-amber-500/5">
            <div className="p-8 border-b border-amber-500/20 flex items-center justify-between">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-amber-500/20 rounded-xl text-amber-500">
                     <Network className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-widest italic">OTA Link Interceptor</span>
               </div>
               <div className="flex gap-2">
                 <button 
                   onClick={testOTA}
                   className="px-6 py-2 bg-white/5 border border-white/10 text-slate-400 text-[10px] font-black uppercase tracking-widest rounded-full hover:border-primary/50 hover:text-white transition-all"
                 >
                    Test OTA Engine
                 </button>
                 <button 
                   onClick={captureOTA}
                   disabled={isCapturing}
                   className="px-6 py-2 bg-amber-500 text-black text-[10px] font-black uppercase tracking-widest rounded-full hover:shadow-lg transition-all"
                 >
                   {isCapturing ? "Capturing..." : "Intercept OTA"}
                 </button>
               </div>
            </div>
            <div className="p-10 space-y-6">
               <div className="p-6 bg-amber-500/10 rounded-2xl border border-amber-500/20 flex items-start gap-4">
                  <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                     <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">How to intercept:</p>
                     <p className="text-xs text-amber-500/80 font-medium">Click "Intercept OTA" and then immediately press "Check for Updates" in the Karoo settings. Nexus will scan the internal debug stream for system update URLs.</p>
                  </div>
               </div>

               <div className="space-y-4 min-h-[250px]">
                  {capturedLinks.length > 0 ? capturedLinks.map((link, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-6 bg-black/40 border border-amber-500/30 rounded-3xl space-y-3 relative overflow-hidden group"
                    >
                       <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500/60 italic">Detected Stream :: URL</span>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => fetchAndDownloadOTA(link.match(/https?:\/\/[^\s]+/)?.[0] || link)}
                              className="text-[8px] font-black uppercase tracking-widest bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full hover:bg-emerald-500 hover:text-black transition-all"
                            >
                               Fetch & Archive
                            </button>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(link.match(/https?:\/\/[^\s]+/)?.[0] || link);
                                logInteraction("Copied OTA link to clipboard");
                              }}
                              className="text-[8px] font-black uppercase tracking-widest bg-amber-500/20 text-amber-500 px-3 py-1 rounded-full hover:bg-amber-500 hover:text-black transition-all"
                            >
                               Copy Link
                            </button>
                          </div>
                       </div>
                       <p className="text-[10px] font-mono text-amber-200/90 break-all leading-relaxed bg-white/5 p-4 rounded-xl">
                          {link}
                       </p>
                    </motion.div>
                  )) : (
                    <div className="h-[250px] flex flex-col items-center justify-center text-amber-500/30 space-y-4">
                       <Terminal className="w-12 h-12 opacity-20 animate-pulse" />
                       <p className="text-[10px] font-black uppercase tracking-widest opacity-40 italic">Awaiting OTA Signal...</p>
                    </div>
                  )}
               </div>
            </div>
          </div>

          <TacticalDownloader 
            isOpen={downloaderOpen}
            onClose={() => setDownloaderOpen(false)}
            fileName={activeFileName}
            url={activeDownloadUrl}
          />

          {/* SYSTEM INFO STACK */}
          <div className="glass-card p-10 rounded-[3rem] space-y-6">
             <h3 className="text-xl font-black italic uppercase tracking-tight">Investigation <span className="text-primary not-italic">Status</span></h3>
             <div className="space-y-4">
                <div className="flex justify-between items-center px-4">
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Root Access</span>
                   <span className="text-[10px] font-black uppercase tracking-widest text-red-400">Denied (Production)</span>
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center px-4">
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Data Channel</span>
                   <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">High Bandwidth</span>
                </div>
                <div className="h-px bg-white/5" />
                <div className="flex justify-between items-center px-4">
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">OTA Sensitivity</span>
                   <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Tactical Grade</span>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
