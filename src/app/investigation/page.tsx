"use client";

import { motion } from "framer-motion";
import { Search, Download, Zap, Terminal, ShieldAlert, Cpu, HardDriveDownload, Network, ShieldCheck, Map, Settings, Unlock, Lock } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useNexus } from "@/context/NexusContext";

import { TacticalDownloader } from "@/components/TacticalDownloader";
import { generateCloudFrontUrl } from "@/utils/cloudfront";

interface AppInfo {
  id: string;
  name: string;
  path: string;
  isSystem: boolean;
  status: 'idle' | 'pulling' | 'success' | 'error' | 'unavailable';
}

const sanitizeFilename = (name: string): string => {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
};

const prettifyPackageName = (id: string): string => {
  if (!id || id === "unknown.package" || id === "unknown") return "Service Package";
  if (id === "android") return "Android System";
  
  // High-priority Karoo branding
  if (id.includes("io.hammerhead")) {
    const sub = id.replace("io.hammerhead.", "");
    if (sub === "profileconfiguratorapp") return "Profile Configurator";
    if (sub === "karoo.companion") return "Karoo Companion";
    if (sub === "settings.extensions") return "Settings Extensions";
    if (sub === "shell") return "Nexus Shell";
    if (sub.includes("service")) return sub.split('.').pop()?.replace("service", " Service") || "Karoo Service";
  }

  // Handle common android namespaces more gracefully
  let name = id;
  if (id.includes(".providers.")) name = id.split(".providers.").pop() || id;
  else if (id.includes(".services.")) name = id.split(".services.").pop() || id;
  else if (id.includes(".inputmethod.")) name = id.split(".inputmethod.").pop() || id;
  else {
    name = id.replace(/^(com|io|net|org|android)\.(android|google|hammerhead|karoo|mediatek|qualcomm|sunmi|zx|skylite|tinyroom|vending|chrome)\./, "");
  }
  
  if (name.includes(".")) {
    name = name.split(".").pop() || name;
  }

  name = name.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  
  const finalName = name.split(" ").map(word => {
    if (word.length === 0) return "";
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ").trim();

  if (!finalName || finalName.length < 2) {
    const segments = id.split(".");
    const lastSegment = segments[segments.length - 1];
    return lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1);
  }

  return finalName;
};

export default function InvestigationPage() {
  const [packages, setPackages] = useState<AppInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'all' | 'user' | 'system'>('all');
  const [filter, setFilter] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [capturedLinks, setCapturedLinks] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const { adbStatus } = useNexus();
  const isOffline = adbStatus !== "Online";
  
  // Security Lock
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState(false);
  
  // Downloader state
  const [downloaderOpen, setDownloaderOpen] = useState(false);
  const [activeDownloadUrl, setActiveDownloadUrl] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState("");
  const [activeDownloadedPath, setActiveDownloadedPath] = useState<string | null>(null);

  // OTA Target Device
  const [otaTarget, setOtaTarget] = useState<"karoo1" | "karoo2" | "karoo3" | "adb">("karoo1");
  const [manualDeviceId, setManualDeviceId] = useState("");

  const [logs, setLogs] = useState<{id: number, msg: string, time: Date}[]>([]);

  useEffect(() => {
    let unlisten: any;
    const setupListener = async () => {
      unlisten = await listen<string>("log_entry", (event) => {
        setLogs(prev => {
          const next = [...prev, { id: Date.now() + Math.random(), msg: event.payload, time: new Date() }];
          return next.slice(-5); // Keep last 5
        });
      });
    };
    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (logs.length > 0) {
      const timer = setTimeout(() => {
        setLogs(prev => prev.slice(1));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [logs]);

  const logInteraction = async (msg: string) => {
    try {
      setLogs(prev => [...prev, { id: Date.now() + Math.random(), msg, time: new Date() }].slice(-5));
      await invoke("log_interaction", { action: msg });
    } catch (e) {
      console.error("Log failed", e);
    }
  };

  const fetchAndDownloadOTA = async (url: string) => {
     logInteraction(`INVESTIGATION :: Interrogating OTA Metadata Channel...`);
     try {
       const metadata: any = await invoke("fetch_ota_metadata", { url });
       console.log("OTA Metadata received:", metadata);
       
       if (metadata.Message) {
         throw new Error(`Server returned error: ${metadata.Message}`);
       }

       logInteraction(`INVESTIGATION :: Metadata Channel Response: Update Found`);
       
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
         const path = metadata.key || metadata.bucket;
         const candidateBases = [
           "https://karoo-repo.s3.us-east-1.amazonaws.com",
           "https://com.hammerhead.karoo-updates.s3.us-east-1.amazonaws.com",
           "https://s3.amazonaws.com/karoo-repo",
           "https://s3.amazonaws.com/com.hammerhead.karoo-updates"
         ];

         downloadUrl = `${candidateBases[0]}/${path}`;
         version = metadata.version || version;
       }
       
       if (!downloadUrl) {
         console.error("Payload structure unknown:", metadata);
         throw new Error("Could not extract download URL from metadata structure.");
       }

       logInteraction(`INVESTIGATION :: Extracted Download URL: ${downloadUrl}`);
       
       setActiveDownloadUrl(downloadUrl);
       setActiveFileName(`${version}.zip`);
       setActiveDownloadedPath(null);
       setDownloaderOpen(true);

       const localPath = `${version}.zip`;
       const path = metadata.key || metadata.bucket;
       
       if (metadata.key) {
         try {
           const signedUrl = await generateCloudFrontUrl(metadata.key);
           setActiveDownloadUrl(signedUrl);
           logInteraction(`INVESTIGATION :: AUTHENTICATED :: Generated Pre-Signed CloudFront URL`);
           const absPath = await invoke<string>("download_firmware", { url: signedUrl, localPath });
           setActiveDownloadedPath(absPath);
           logInteraction(`INVESTIGATION :: SECURE TRANSFER :: Download Complete`);
         } catch (e) {
           console.error("CloudFront Signer failed:", e);
           logInteraction(`INVESTIGATION :: CLOUDFRONT FAILURE :: ${e}`);
           emit("firmware-download-error", e);
         }
       } else {
         try {
           await invoke("download_firmware", { url: downloadUrl, localPath });
         } catch (e) {
           emit("firmware-download-error", e);
         }
       }

     } catch (e) {
        logInteraction(`INVESTIGATION :: OTA Channel Failure :: ${e}`);
     }
  };

  const checkLatestFirmware = async () => {
    logInteraction("INVESTIGATION :: Querying Hammerhead OTA Matrix...");
    try {
      let deviceId = "";
      let version = "karoo-1.320.1345.3";
      
      switch (otaTarget) {
        case "karoo1":
           deviceId = "karoo-v1-tactical-id"; 
           version = "karoo-1.320.1345.3";
           break;
        case "karoo2":
           if (!manualDeviceId.trim()) throw new Error("Karoo 2 requires a valid Device ID.");
           deviceId = manualDeviceId.trim(); 
           version = "karoo-2.0.0.0";
           break;
        case "karoo3":
           if (!manualDeviceId.trim()) throw new Error("Karoo 3 requires a valid Device ID.");
           deviceId = manualDeviceId.trim();
           version = "karoo-3.0.0.0";
           break;
        case "adb":
           if (isOffline) throw new Error("Device offline. Cannot pull ID via ADB.");
           const id = await invoke("get_device_id");
           deviceId = id as string;
           if (!deviceId) throw new Error("Received empty device ID from ADB.");
           version = "latest";
           break;
      }

      logInteraction(`INVESTIGATION :: Using Device ID: ${deviceId} [Target: ${otaTarget.toUpperCase()}]`);

      const url = `https://api.hammerhead.io/v1/device/update?deviceid=${deviceId}&version=${version}&clientVersion=v2`;
      await fetchAndDownloadOTA(url);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Latest OTA Query Failed :: ${e}`);
    }
  };

  const scanAPKs = async () => {
    setIsScanning(true);
    setSelectedIds(new Set());
    logInteraction("INVESTIGATION :: Scanning device for installed packages");
    try {
      const list = await invoke("list_packages") as string[];
      const parsed: AppInfo[] = list
        .filter(line => line.includes("package:")) 
        .map(pkgLine => {
          const lastEq = pkgLine.lastIndexOf("=");
          
          if (lastEq === -1) {
             const id = pkgLine.replace("package:", "");
             return { id, name: prettifyPackageName(id), path: "", isSystem: true, status: 'unavailable' };
          }
          
          const path = pkgLine.substring(0, lastEq).replace("package:", "");
          const id = pkgLine.substring(lastEq + 1) || "unknown.package";
          
          const name = prettifyPackageName(id);
          const isSystem = !path.includes("/data/app/");

          return { id, name, path, isSystem, status: 'idle' };
        });
      setPackages(parsed);
      logInteraction(`INVESTIGATION :: Found ${parsed.length} packages (${parsed.filter(p => !p.isSystem).length} user apps)`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Scan Failed :: ${e}`);
    } finally {
      setIsScanning(false);
    }
  };

  const extractSelected = async () => {
    if (selectedIds.size === 0) return;
    
    logInteraction(`INVESTIGATION :: Initiating Batch Extraction [${selectedIds.size} Targets]`);
    
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Select Extraction Target Directory"
    });

    if (!dir) {
      logInteraction("INVESTIGATION :: Extraction Cancelled :: No target directory selected");
      return;
    }

    const targets = packages.filter(p => selectedIds.has(p.id));
    
    for (const target of targets) {
      if (!target.path) {
        setPackages(prev => prev.map(p => p.id === target.id ? { ...p, status: 'unavailable' } : p));
        logInteraction(`INVESTIGATION :: SKIPPING :: ${target.id} :: No physical path found`);
        continue;
      }

      setPackages(prev => prev.map(p => p.id === target.id ? { ...p, status: 'pulling' } : p));
      
      const safeName = sanitizeFilename(target.name);
      const safeId = sanitizeFilename(target.id);
      const fileName = `${safeName}_${safeId}.apk`;
      
      const cleanDir = dir.replace(/\\/g, '/').replace(/\/$/, '');
      const localPath = `${cleanDir}/${fileName}`;
      
      try {
        logInteraction(`INVESTIGATION :: Pulling ${target.id} -> ${fileName}`);
        await invoke("pull_file", { remotePath: target.path, localPath });
        setPackages(prev => prev.map(p => p.id === target.id ? { ...p, status: 'success' } : p));
      } catch (e) {
        logInteraction(`INVESTIGATION :: FAILED :: ${target.id} :: ${e}`);
        setPackages(prev => prev.map(p => p.id === target.id ? { ...p, status: 'error' } : p));
      }
    }
    
    logInteraction("INVESTIGATION :: Batch Extraction Complete");
  };

  const launchAndroidComponent = async (component: string, name: string) => {
    try {
      await invoke("launch_intent", { component });
      logInteraction(`INVESTIGATION :: SUCCESS :: Launched ${name}`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: FAILED :: Could not launch ${name}. Ensure screen is unlocked.`);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const filteredPackages = packages.filter(p => {
    const matchesFilter = p.id.toLowerCase().includes(filter.toLowerCase()) || p.name.toLowerCase().includes(filter.toLowerCase());
    const matchesTab = activeTab === 'all' || (activeTab === 'user' && !p.isSystem) || (activeTab === 'system' && p.isSystem);
    return matchesFilter && matchesTab;
  });

  const toggleSelectAll = () => {
    const visibleIds = filteredPackages.map(p => p.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    
    if (allVisibleSelected) {
       const next = new Set(selectedIds);
       visibleIds.forEach(id => next.delete(id));
       setSelectedIds(next);
       logInteraction(`INVESTIGATION :: Deselected ${visibleIds.length} visible items`);
    } else {
       const next = new Set(selectedIds);
       visibleIds.forEach(id => next.add(id));
       setSelectedIds(next);
       logInteraction(`INVESTIGATION :: Selected All Visible Items [${visibleIds.length}]`);
    }
  };

  const captureOTA = async () => {
    setIsCapturing(true);
    logInteraction("INVESTIGATION :: Initializing real-time OTA capture...");
    try {
      const links = await invoke("capture_ota_logcat") as string[];
      if (links.length > 0) {
        setCapturedLinks(prev => Array.from(new Set([...links, ...prev])));
      }
    } catch (e) {
      logInteraction(`INVESTIGATION :: OTA Capture Error :: ${e}`);
    } finally {
      setIsCapturing(false);
    }
  };

  const testOTA = async () => {
    const deviceId = "ZD8DOF9PDEEQTKS8";
    const version = "karoo-1.320.1345.3";
    const testUrl = `https://api.hammerhead.io/v1/device/update?deviceid=${deviceId}&version=${version}&clientVersion=v2`;
    logInteraction(`INVESTIGATION :: SIMULATION :: Injecting v2 Tactical Query [ID: ${deviceId}]`);
    setCapturedLinks(prev => Array.from(new Set([testUrl, ...prev])));
  };

  const injectCustomMap = async () => {
    if (isOffline) return;
    try {
      const file = await open({
        multiple: false,
        title: "Select Custom Map Package (.zip / .sqlite / .map)",
        filters: [{ name: "Map Data", extensions: ["zip", "sqlite", "map", "mbtiles"] }]
      });
      if (!file) return;
      logInteraction(`INVESTIGATION :: Selected Map Package: ${file}`);
      const res = await invoke("inject_custom_map", { localPath: file });
      logInteraction(`INVESTIGATION :: Map Injection Result: ${res}`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Map Injection Failed :: ${e}`);
    }
  };

  const sideloadCustomOta = async () => {
    if (isOffline) return;
    try {
      const file = await open({
        multiple: false,
        title: "Select OTA Update Package (.zip)",
        filters: [{ name: "OTA Zip", extensions: ["zip"] }]
      });
      if (!file) return;
      logInteraction(`INVESTIGATION :: Selected OTA Package: ${file}`);
      logInteraction(`INVESTIGATION :: Pushing and sideloading OTA... This may take several minutes.`);
      const res = await invoke("sideload_custom_ota", { localPath: file });
      logInteraction(`INVESTIGATION :: OTA Sideload Result: ${res}`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: OTA Sideload Failed :: ${e}`);
    }
  };

  const disarmRootDetection = async () => {
    if (isOffline) return;
    try {
      logInteraction(`INVESTIGATION :: Attempting to disarm Bugsnag Root Detection & Telemetry...`);
      const res = await invoke("disarm_root_detection");
      logInteraction(`INVESTIGATION :: Disarm Result: ${res}`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Disarm Failed :: ${e}`);
    }
  };

  const [isProxyRunning, setIsProxyRunning] = useState(false);

  const startMapProxy = async () => {
    if (isOffline) return;
    try {
      const file = await open({
        multiple: false,
        title: "Select Tactical Map Payload (.zip / .mbtiles)",
        filters: [{ name: "Map Data", extensions: ["zip", "mbtiles"] }]
      });
      if (!file) return;
      logInteraction(`INVESTIGATION :: Starting Proxy for Map: ${file}`);
      const res = await invoke("start_map_proxy", { localPath: file });
      logInteraction(`INVESTIGATION :: Proxy Started :: ${res}`);
      setIsProxyRunning(true);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Proxy Start Failed :: ${e}`);
    }
  };

  const stopMapProxy = async () => {
    if (isOffline) return;
    try {
      logInteraction(`INVESTIGATION :: Stopping Proxy...`);
      const res = await invoke("stop_map_proxy");
      logInteraction(`INVESTIGATION :: Proxy Stopped :: ${res}`);
      setIsProxyRunning(false);
    } catch (e) {
      logInteraction(`INVESTIGATION :: Proxy Stop Failed :: ${e}`);
    }
  };

  const generateCaCert = async () => {
    if (isOffline) return;
    try {
      logInteraction(`INVESTIGATION :: Generating and pushing CA Certificate...`);
      const res = await invoke("generate_ca_cert");
      logInteraction(`INVESTIGATION :: CA Cert Generation Result: ${res}`);
    } catch (e) {
      logInteraction(`INVESTIGATION :: CA Cert Generation Failed :: ${e}`);
    }
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === "1234") {
      setIsUnlocked(true);
      setPasscodeError(false);
      logInteraction("INVESTIGATION :: Security Bypass Successful");
    } else {
      setPasscodeError(true);
      setPasscode("");
      logInteraction("INVESTIGATION :: Security Bypass Failed");
    }
  };

  if (!isUnlocked) {
    return (
      <div className="max-w-[800px] mx-auto mt-20 p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-background/40 backdrop-blur-3xl p-10 rounded-2xl border border-border shadow-2xl flex flex-col items-center text-center space-y-6 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 via-orange-500 to-red-500" />
          
          <div className="p-4 bg-red-500/10 rounded-full border border-red-500/20">
             <Lock className="w-8 h-8 text-red-500" />
          </div>

          <div className="space-y-2">
             <h2 className="text-2xl font-bold tracking-tight text-foreground">Restricted Area</h2>
             <p className="text-sm text-slate-500 font-medium max-w-md mx-auto">
               System Analysis & Engineering Core contains low-level device manipulation tools. Authorized personnel only.
             </p>
          </div>

          <form onSubmit={handleUnlock} className="w-full max-w-xs space-y-4 pt-4">
             <div className="space-y-2">
               <input 
                 type="password"
                 value={passcode}
                 onChange={e => setPasscode(e.target.value)}
                 placeholder="Enter Passcode"
                 className={`w-full bg-secondary border ${passcodeError ? 'border-red-500 text-red-500' : 'border-border'} rounded-lg p-3 text-center tracking-widest font-mono text-lg focus:border-primary outline-none transition-all`}
                 autoFocus
               />
               {passcodeError && (
                 <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider animate-pulse">Access Denied</p>
               )}
             </div>
             
             <button type="submit" className="w-full py-3 bg-foreground text-background font-bold rounded-lg hover:opacity-90 transition-all shadow-lg flex items-center justify-center gap-2">
                <Unlock className="w-4 h-4" />
                Authenticate
             </button>
          </form>
        </motion.div>

        {/* Floating Logs on Lock Screen */}
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 w-80 pointer-events-none">
          {logs.map(log => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: 20, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-secondary border border-border text-foreground p-3 rounded-md shadow-2xl flex flex-col pointer-events-auto"
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-bold text-primary tracking-wider">SYSTEM EVENT</span>
                <span className="text-[10px] text-slate-500">{log.time.toLocaleTimeString()}</span>
              </div>
              <p className="text-xs break-words leading-relaxed">{log.msg.replace('INVESTIGATION :: ', '')}</p>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-20 px-2">
      <header className="space-y-3 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">System Analysis</h1>
        <p className="text-slate-500 font-medium max-w-2xl text-sm leading-relaxed">
          Tactical control centers for OTA manipulation, Map injection, and System package extraction.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* === COLUMN 1: APK & SYSTEM OPS === */}
        <div className="space-y-6">
          <div className="bg-background/40 backdrop-blur-3xl rounded-lg overflow-hidden flex flex-col border border-border shadow-lg h-[500px]">
            <div className="p-4 bg-secondary border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-primary/10 rounded-md text-primary">
                    <HardDriveDownload className="w-4 h-4" />
                 </div>
                 <span className="text-sm font-bold tracking-tight">Package Extractor</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={toggleSelectAll}
                  disabled={isScanning || packages.length === 0}
                  className={`px-3 py-1.5 border text-xs font-semibold rounded-md transition-all ${
                    filteredPackages.length > 0 && filteredPackages.every(p => selectedIds.has(p.id))
                      ? 'bg-primary text-white border-primary'
                      : 'bg-secondary border-border text-slate-500 hover:border-slate-400'
                  }`}
                >
                   All
                </button>
                <button 
                  onClick={scanAPKs}
                  disabled={isScanning || isOffline}
                  className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:opacity-90 transition-all disabled:opacity-50 shadow-sm shadow-primary/20"
                >
                  {isScanning ? "Scanning..." : "Scan"}
                </button>
              </div>
            </div>

            <div className="p-3 border-b border-border bg-secondary/50 space-y-3">
               <div className="flex gap-2">
                  {(['all', 'user', 'system'] as const).map(tab => (
                     <button
                       key={tab}
                       onClick={() => setActiveTab(tab)}
                       className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                         activeTab === tab ? 'bg-primary text-white shadow-sm' : 'bg-background border border-border text-slate-500 hover:bg-secondary'
                       }`}
                     >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                     </button>
                  ))}
               </div>
               <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input 
                    type="text" 
                    placeholder="Filter by package..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full bg-background border border-border rounded-md py-2 pl-10 pr-4 text-xs focus:border-primary/50 outline-none transition-all placeholder:text-slate-500"
                  />
               </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 relative min-h-0">
               {selectedIds.size > 0 && (
                  <motion.div 
                     initial={{ y: 20, opacity: 0 }}
                     animate={{ y: 0, opacity: 1 }}
                     className="sticky bottom-0 left-0 right-0 z-50 p-3 bg-background border-t border-border shadow-2xl flex items-center justify-between"
                  >
                     <span className="text-xs font-bold text-foreground">{selectedIds.size} Targets</span>
                     <div className="flex gap-2">
                       <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 bg-secondary text-slate-600 text-[10px] font-bold rounded hover:bg-slate-200">Cancel</button>
                       <button onClick={extractSelected} className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded shadow-sm hover:opacity-90">Acquire</button>
                     </div>
                  </motion.div>
               )}

               {filteredPackages.length > 0 ? filteredPackages.map((pkg, idx) => {
                    const isSelected = selectedIds.has(pkg.id);
                    return (
                      <motion.div 
                        key={idx} 
                        onClick={() => !isOffline && toggleSelect(pkg.id)}
                        className={`flex items-center justify-between p-2.5 rounded-md border transition-all cursor-pointer group ${
                          isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary hover:border-slate-300'
                        } ${isOffline ? 'opacity-40 grayscale-75 cursor-not-allowed border-dashed' : ''}`}
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                           <div className={`p-1.5 rounded-md transition-all ${isSelected ? 'bg-primary text-white' : 'bg-secondary text-slate-400 group-hover:text-primary'}`}>
                              <Cpu className="w-3.5 h-3.5" />
                           </div>
                           <div className="overflow-hidden">
                              <div className="flex items-center gap-2">
                                 <p className={`text-[11px] font-bold truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}>{pkg.name}</p>
                                 {pkg.isSystem && <span className="px-1 py-0.5 bg-secondary rounded text-[7px] font-bold uppercase tracking-wider text-slate-400 border border-border">Sys</span>}
                              </div>
                              <p className="text-[9px] font-medium text-slate-500 truncate lowercase">{pkg.id}</p>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pkg.status !== 'idle' && (
                             <div className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase flex items-center gap-1 ${
                               pkg.status === 'pulling' ? 'text-amber-500 animate-pulse' :
                               pkg.status === 'success' ? 'text-emerald-500' :
                               pkg.status === 'unavailable' ? 'text-slate-400' : 'text-red-500'
                             }`}>
                                {pkg.status === 'pulling' ? <Zap className="w-2 h-2 animate-spin" /> : 
                                 pkg.status === 'success' ? <ShieldCheck className="w-2 h-2" /> :
                                 pkg.status === 'unavailable' ? <ShieldAlert className="w-2 h-2" /> : <ShieldAlert className="w-2 h-2" />}
                             </div>
                          )}
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-primary border-primary text-white' : 'border-border text-transparent'}`}>
                             <ShieldCheck className="w-2 h-2" />
                          </div>
                        </div>
                      </motion.div>
                    );
                  }) : (
                 <div className="h-full flex flex-col items-center justify-center text-slate-600 p-10 space-y-3">
                    <Cpu className="w-8 h-8 opacity-20" />
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Scan Required</p>
                 </div>
               )}
            </div>
          </div>

          <div className="bg-background/40 backdrop-blur-3xl p-5 rounded-lg border border-border shadow-md space-y-4">
             <div className="flex items-center gap-3 border-b border-border pb-3 mb-2">
                <div className="p-2 bg-primary/10 rounded-md text-primary">
                   <Settings className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold tracking-tight">System Operations</span>
             </div>
             
             <div className="space-y-2">
                <button onClick={() => launchAndroidComponent("com.android.settings/.DevelopmentSettings", "Developer Options")} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <Unlock className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Bootloader / OEM Unlock</p>
                         <p className="text-[9px] text-slate-500">Android Developer Settings</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>

                <button onClick={() => launchAndroidComponent("com.mediatek.engineermode/.EngineerMode", "Engineer Mode")} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <Terminal className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Root Privilege Escalation</p>
                         <p className="text-[9px] text-slate-500">Mediatek user2root Menu</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>

                <button onClick={disarmRootDetection} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <ShieldCheck className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Disarm Root Detection</p>
                         <p className="text-[9px] text-slate-500">Disable Bugsnag telemetry</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
             </div>
          </div>
        </div>

        {/* === COLUMN 2: UPDATE MONITOR === */}
        <div className="space-y-6">
          <div className="bg-background/40 backdrop-blur-3xl p-5 rounded-lg border border-border shadow-md space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3 mb-2">
               <div className="p-2 bg-primary/10 rounded-md text-primary">
                  <Download className="w-4 h-4" />
               </div>
               <span className="text-sm font-bold tracking-tight">OTA Intelligence</span>
            </div>
            
            <div className="space-y-2">
              <select 
                value={otaTarget}
                onChange={(e) => setOtaTarget(e.target.value as any)}
                className="w-full bg-background border border-border rounded-md p-3 text-xs focus:border-primary outline-none transition-all"
              >
                <option value="karoo1">Target: Karoo 1 (Gen 1)</option>
                <option value="karoo2">Target: Karoo 2 (Gen 2)</option>
                <option value="karoo3">Target: Karoo 3 (Gen 3)</option>
                <option value="adb">Target: Connected Device (via ADB)</option>
              </select>

              <div className="text-[10px] text-slate-500 font-medium px-1 flex justify-between">
                 <span>{otaTarget === 'karoo1' ? 'Latest known: ~1.320.1345.3' : (otaTarget === 'karoo2' || otaTarget === 'karoo3' ? 'Latest known: 1.628.2410' : '')}</span>
                 {otaTarget === 'karoo1' && <span className="text-red-400">Support Ended</span>}
              </div>

              {(otaTarget === "karoo2" || otaTarget === "karoo3") && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-1">
                   <input 
                     type="text"
                     value={manualDeviceId}
                     onChange={(e) => setManualDeviceId(e.target.value)}
                     placeholder={`Enter ${otaTarget === "karoo2" ? "Karoo 2" : "Karoo 3"} Device ID (Serial Number)`}
                     className="w-full bg-secondary border border-border rounded-md p-3 text-xs focus:border-primary outline-none transition-all font-mono"
                   />
                   <p className="text-[9px] text-red-400 font-medium px-1">Hardware-specific Firmware requires a valid Device ID.</p>
                </motion.div>
              )}

              <button 
                onClick={checkLatestFirmware}
                disabled={isOffline && otaTarget === "adb"}
                className="w-full py-4 bg-primary text-white text-sm font-bold tracking-wide rounded-md hover:opacity-90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Zap className="w-4 h-4 fill-white" />
                Download Latest Firmware
              </button>
            </div>

            <div className="space-y-2 pt-2">
                <button onClick={() => launchAndroidComponent("com.mediatek.systemupdate/.Main", "System Update Core")} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <Network className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Force OTA Sync</p>
                         <p className="text-[9px] text-slate-500">Bypass phased rollouts via MTK</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>

                <button onClick={sideloadCustomOta} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <HardDriveDownload className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Sideload Custom OTA</p>
                         <p className="text-[9px] text-slate-500">Push & install local .zip via Intent</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
            </div>
          </div>

          <div className="bg-background/40 backdrop-blur-3xl rounded-lg overflow-hidden border border-border shadow-lg">
            <div className="p-4 border-b border-border bg-secondary flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-md text-primary">
                     <Network className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-bold tracking-tight">Logcat Monitor</span>
               </div>
               <button onClick={testOTA} className="px-3 py-1 bg-background border border-border text-slate-500 text-[10px] font-bold rounded hover:bg-secondary transition-all">Test</button>
            </div>
            <div className="p-5 space-y-4">
               <button 
                  onClick={captureOTA}
                  disabled={isCapturing || isOffline}
                  className={`w-full py-3 rounded-md font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                    isCapturing || isOffline ? 'bg-secondary text-slate-400 cursor-not-allowed border border-border' : 'bg-primary/20 text-primary hover:bg-primary hover:text-white border border-primary/30'
                  }`}
                >
                  {isCapturing ? <Terminal className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  {isCapturing ? "Awaiting Data..." : "Start Stream Interception"}
                </button>

               <div className="space-y-3 min-h-[200px] max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                  {capturedLinks.length > 0 ? capturedLinks.map((link, i) => (
                    <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-3 bg-background border border-border rounded-lg space-y-2 shadow-sm">
                       <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-primary uppercase tracking-wider">Detected Link</span>
                          <div className="flex gap-2">
                            <button onClick={() => fetchAndDownloadOTA(link.match(/https?:\/\/[^\s]+/)?.[0] || link)} className="text-[9px] font-bold bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary hover:text-white">Archive</button>
                            <button onClick={() => navigator.clipboard.writeText(link.match(/https?:\/\/[^\s]+/)?.[0] || link)} className="text-[9px] font-bold bg-secondary text-slate-500 px-2 py-1 rounded hover:bg-slate-200">Copy</button>
                          </div>
                       </div>
                       <p className="text-[10px] font-mono text-slate-500 break-all bg-secondary/50 p-2 rounded-md leading-relaxed">{link}</p>
                    </motion.div>
                  )) : (
                    <div className="h-[200px] flex flex-col items-center justify-center text-slate-400 space-y-3 border border-dashed border-border rounded-lg">
                       <Terminal className="w-8 h-8 opacity-20" />
                       <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 italic">Awaiting Logcat Signal</p>
                    </div>
                  )}
               </div>
            </div>
          </div>
        </div>

        {/* === COLUMN 3: MAP MANAGEMENT === */}
        <div className="space-y-6">
          <div className="bg-background/40 backdrop-blur-3xl p-5 rounded-lg border border-border shadow-md space-y-5">
            <div className="flex items-center gap-3 border-b border-border pb-3">
               <div className="p-2 bg-primary/10 rounded-md text-primary">
                  <Map className="w-4 h-4" />
               </div>
               <span className="text-sm font-bold tracking-tight">Map Management</span>
            </div>
            
            <div className="space-y-2">
                <button onClick={injectCustomMap} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <Map className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Custom Map Injector</p>
                         <p className="text-[9px] text-slate-500">SQLite Patcher (Root Req)</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
            </div>

            <div className="pt-5 border-t border-border space-y-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Proxy Operations (Non-Root)</span>
                
                <div className="p-3 bg-primary/5 rounded-md border border-primary/10 flex items-start gap-3">
                    <ShieldAlert className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                       Proxy forces device traffic through PC to intercept map downloads. Requires custom CA certificate for strict HTTPS.
                    </p>
                </div>

                <div className="flex gap-3">
                    {!isProxyRunning ? (
                      <button onClick={startMapProxy} disabled={isOffline} className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary text-white text-xs font-bold rounded-md hover:opacity-90 transition-all disabled:opacity-50 shadow-md shadow-primary/20">
                        <Map className="w-4 h-4" /> Start Proxy
                      </button>
                    ) : (
                      <button onClick={stopMapProxy} disabled={isOffline} className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500 text-white text-xs font-bold rounded-md hover:bg-red-600 transition-all shadow-md shadow-red-500/20">
                        <ShieldAlert className="w-4 h-4" /> Stop Proxy
                      </button>
                    )}
                </div>

                <button onClick={generateCaCert} disabled={isOffline} className="w-full flex items-center justify-between p-3 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-all group disabled:opacity-50">
                   <div className="flex items-center gap-3 text-left">
                      <ShieldCheck className="w-4 h-4 text-slate-500 group-hover:text-primary" />
                      <div>
                         <p className="text-xs font-bold text-foreground">Push Root CA</p>
                         <p className="text-[9px] text-slate-500">Bypass HTTPS certificate pinning</p>
                      </div>
                   </div>
                   <Zap className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
            </div>
          </div>
        </div>

      </div>

      {/* MODALS */}
      <TacticalDownloader 
        isOpen={downloaderOpen}
        onClose={() => setDownloaderOpen(false)}
        fileName={activeFileName}
        url={activeDownloadUrl || ""}
        downloadedPath={activeDownloadedPath}
      />

      {/* FLOATING ACTION LOGS */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 w-80 pointer-events-none">
        {logs.map(log => (
          <motion.div
            key={log.id}
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-secondary border border-border text-foreground p-3 rounded-md shadow-2xl flex flex-col pointer-events-auto"
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-bold text-primary tracking-wider">SYSTEM EVENT</span>
              <span className="text-[10px] text-slate-500">{log.time.toLocaleTimeString()}</span>
            </div>
            <p className="text-xs break-words leading-relaxed">{log.msg.replace('INVESTIGATION :: ', '')}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
