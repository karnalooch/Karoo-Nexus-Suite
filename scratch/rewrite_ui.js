const fs = require('fs');
const path = require('path');

const filePath = path.join('e:', 'Antigravity', 'projekty', 'karoo-nexus', 'src', 'app', 'investigation', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Step 1: Insert otaTarget state
const targetState = `
  // Downloader state
  const [downloaderOpen, setDownloaderOpen] = useState(false);
  const [activeDownloadUrl, setActiveDownloadUrl] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState("");

  // OTA Target Device
  const [otaTarget, setOtaTarget] = useState<"karoo1" | "karoo2" | "karoo3" | "adb">("karoo2");
`;
content = content.replace(
  /\/\/ Downloader state[\s\S]*?const \[activeFileName, setActiveFileName\] = useState\(""\);/,
  targetState.trim()
);

// Step 2: Insert checkLatestFirmware
const insertTarget = "  const filteredPackages = packages.filter(p => {";
const checkFunc = `
  const checkLatestFirmware = async () => {
    logInteraction("INVESTIGATION :: Querying Hammerhead OTA Matrix...");
    try {
      let deviceId = "";
      
      switch (otaTarget) {
        case "karoo1":
           deviceId = "karoo-v1-tactical-id"; 
           break;
        case "karoo2":
           deviceId = "ZD8DOF9PDEEQTKS8"; 
           break;
        case "karoo3":
           deviceId = "karoo-v3-tactical-id";
           break;
        case "adb":
           if (isOffline) throw new Error("Device offline. Cannot pull ID via ADB.");
           const id = await invoke("get_device_id");
           deviceId = id as string;
           if (!deviceId) throw new Error("Received empty device ID from ADB.");
           break;
      }

      logInteraction(\`INVESTIGATION :: Using Device ID: \${deviceId} [Target: \${otaTarget.toUpperCase()}]\`);

      const version = "karoo-1.320.1345.3";
      const url = \`https://api.hammerhead.io/v1/device/update?deviceid=\${deviceId}&version=\${version}&clientVersion=v2\`;
      await fetchAndDownloadOTA(url);
    } catch (e) {
      logInteraction(\`INVESTIGATION :: Latest OTA Query Failed :: \${e}\`);
    }
  };

  const filteredPackages = packages.filter(p => {`;
content = content.replace(insertTarget, checkFunc.trim());

// Step 3: Replace entire layout
const layoutStart = '<div className="max-w-[1400px] mx-auto space-y-10 pb-20">';
const layoutEnd = '{/* FLOATING ACTION LOGS */}';
const startIndex = content.indexOf(layoutStart);
const endIndex = content.indexOf(layoutEnd);

if(startIndex !== -1 && endIndex !== -1) {
  const newLayout = `<div className="max-w-[1600px] mx-auto space-y-8 pb-20 px-2">
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
                  className={\`px-3 py-1.5 border text-xs font-semibold rounded-md transition-all \${
                    filteredPackages.length > 0 && filteredPackages.every(p => selectedIds.has(p.id))
                      ? 'bg-primary text-white border-primary'
                      : 'bg-secondary border-border text-slate-500 hover:border-slate-400'
                  }\`}
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
                       className={\`flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all \${
                         activeTab === tab ? 'bg-primary text-white shadow-sm' : 'bg-background border border-border text-slate-500 hover:bg-secondary'
                       }\`}
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
                        className={\`flex items-center justify-between p-2.5 rounded-md border transition-all cursor-pointer group \${
                          isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary hover:border-slate-300'
                        } \${isOffline ? 'opacity-40 grayscale-75 cursor-not-allowed border-dashed' : ''}\`}
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                           <div className={\`p-1.5 rounded-md transition-all \${isSelected ? 'bg-primary text-white' : 'bg-secondary text-slate-400 group-hover:text-primary'}\`}>
                              <Cpu className="w-3.5 h-3.5" />
                           </div>
                           <div className="overflow-hidden">
                              <div className="flex items-center gap-2">
                                 <p className={\`text-[11px] font-bold truncate \${isSelected ? 'text-primary' : 'text-foreground'}\`}>{pkg.name}</p>
                                 {pkg.isSystem && <span className="px-1 py-0.5 bg-secondary rounded text-[7px] font-bold uppercase tracking-wider text-slate-400 border border-border">Sys</span>}
                              </div>
                              <p className="text-[9px] font-medium text-slate-500 truncate lowercase">{pkg.id}</p>
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pkg.status !== 'idle' && (
                             <div className={\`px-1 py-0.5 rounded text-[8px] font-bold uppercase flex items-center gap-1 \${
                               pkg.status === 'pulling' ? 'text-amber-500 animate-pulse' :
                               pkg.status === 'success' ? 'text-emerald-500' :
                               pkg.status === 'unavailable' ? 'text-slate-400' : 'text-red-500'
                             }\`}>
                                {pkg.status === 'pulling' ? <Zap className="w-2 h-2 animate-spin" /> : 
                                 pkg.status === 'success' ? <ShieldCheck className="w-2 h-2" /> :
                                 pkg.status === 'unavailable' ? <ShieldAlert className="w-2 h-2" /> : <ShieldAlert className="w-2 h-2" />}
                             </div>
                          )}
                          <div className={\`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all \${isSelected ? 'bg-primary border-primary text-white' : 'border-border text-transparent'}\`}>
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
                <option value="karoo2">Target: Karoo 2 (Gen 2 - Recommended)</option>
                <option value="karoo3">Target: Karoo 3 (Gen 3)</option>
                <option value="adb">Target: Connected Device (via ADB)</option>
              </select>

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
                  className={\`w-full py-3 rounded-md font-bold text-xs transition-all flex items-center justify-center gap-2 \${
                    isCapturing || isOffline ? 'bg-secondary text-slate-400 cursor-not-allowed border border-border' : 'bg-primary/20 text-primary hover:bg-primary hover:text-white border border-primary/30'
                  }\`}
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
                            <button onClick={() => fetchAndDownloadOTA(link.match(/https?:\\/\\/[^\\s]+/)?.[0] || link)} className="text-[9px] font-bold bg-primary/10 text-primary px-2 py-1 rounded hover:bg-primary hover:text-white">Archive</button>
                            <button onClick={() => navigator.clipboard.writeText(link.match(/https?:\\/\\/[^\\s]+/)?.[0] || link)} className="text-[9px] font-bold bg-secondary text-slate-500 px-2 py-1 rounded hover:bg-slate-200">Copy</button>
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

      <TacticalDownloader 
        isOpen={downloaderOpen}
        onClose={() => setDownloaderOpen(false)}
        fileName={activeFileName}
        url={activeDownloadUrl || ""}
      />

      {/* FLOATING ACTION LOGS */}`;

  content = content.substring(0, startIndex) + newLayout + content.substring(endIndex + layoutEnd.length);
  fs.writeFileSync(filePath, content);
  console.log("UI Refactored successfully");
} else {
  console.error("Could not find replacement boundaries");
}
