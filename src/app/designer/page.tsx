"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Settings, 
  Activity, 
  Zap, 
  Clock, 
  Map, 
  Mountain, 
  RefreshCw, 
  Save, 
  Terminal,
  MousePointerClick,
  Lock,
  Download
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useNexus } from "@/context/NexusContext";

const METRICS = [
  { id: "speed", label: "Speed", unit: "km/h", icon: Activity, color: "text-blue-400", bg: "bg-blue-400/10" },
  { id: "hr", label: "Heart Rate", unit: "bpm", icon: Activity, color: "text-red-400", bg: "bg-red-400/10" },
  { id: "power", label: "Power", unit: "W", icon: Zap, color: "text-purple-400", bg: "bg-purple-400/10" },
  { id: "cadence", label: "Cadence", unit: "rpm", icon: RefreshCw, color: "text-emerald-400", bg: "bg-emerald-400/10" },
  { id: "distance", label: "Distance", unit: "km", icon: Map, color: "text-amber-400", bg: "bg-amber-400/10" },
  { id: "elevation", label: "Elevation", unit: "m", icon: Mountain, color: "text-slate-300", bg: "bg-slate-300/10" },
  { id: "time", label: "Ride Time", unit: "hh:mm", icon: Clock, color: "text-slate-300", bg: "bg-slate-300/10" },
];

export default function DesignerPage() {
  const { 
    adbStatus, profiles, fetchProfiles, discoveryProgress, addLog,
    localProfiles, pendingChanges, handleLocalRename, applyChangesToDevice, isApplying,
    slots, setSlots, profileName, setProfileName, layoutType, setLayoutType, selectedProfileId, setSelectedProfileId
  } = useNexus();
  
  const [draggedMetric, setDraggedMetric] = useState<string | null>(null);
  const [draggedFromSlot, setDraggedFromSlot] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  
  const [isRooting, setIsRooting] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const numFields = layoutType;

  const handleDragStart = (e: React.DragEvent, metricId: string, fromSlot: number | null = null) => {
    setDraggedMetric(metricId);
    setDraggedFromSlot(fromSlot);
    e.dataTransfer.setData("text/plain", metricId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverSlot !== index) {
      setDragOverSlot(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverSlot(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverSlot(null);
    const metricId = e.dataTransfer.getData("text/plain") || draggedMetric;
    
    if (metricId) {
       setSlots(prev => {
          const newSlots = [...prev];
          if (draggedFromSlot !== null) {
            const targetContent = newSlots[index];
            newSlots[draggedFromSlot] = targetContent;
            newSlots[index] = metricId;
          } else {
            newSlots[index] = metricId;
          }
          return newSlots;
       });
    }
    setDraggedMetric(null);
    setDraggedFromSlot(null);
  };

  const clearSlot = (index: number) => {
    setSlots(prev => {
       const newSlots = [...prev];
       newSlots[index] = null;
       return newSlots;
    });
  };

  const handleSlotClick = (index: number) => {
    if (slots[index]) {
        clearSlot(index);
    } else if (selectedMetric) {
        setSlots(prev => {
           const newSlots = [...prev];
           newSlots[index] = selectedMetric;
           return newSlots;
        });
        setSelectedMetric(null);
    }
  };

  const selectRemoteProfile = (profile: { id: string; name: string }) => {
    setSelectedProfileId(profile.id);
    setProfileName(profile.name);
    addLog(`SELECTED :: ${profile.name} (${profile.id})`);
  };

  const handleRoot = async () => {
    setIsRooting(true);
    addLog("ROOT :: Initializing Nexus Ghost strategy...");
    try {
      const result = await invoke<string>("root_karoo_1");
      addLog(`SUCCESS :: ${result}`);
      fetchProfiles();
    } catch (err) {
      addLog(`ERROR :: ${String(err)}`);
    } finally {
      setIsRooting(false);
    }
  };

  const pullFromDevice = async () => {
    setIsPulling(true);
    try {
      addLog("PULL :: Requesting profiles database...");
      const result = await invoke<string>("pull_profiles");
      addLog(`SUCCESS :: ${result}`);
    } catch (err) {
      addLog(`ERROR :: ${String(err)}`);
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="px-8 py-6 border-b border-border bg-background/50 backdrop-blur-md shrink-0 flex justify-between items-center z-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile Configurator</h1>
          <p className="text-sm text-slate-500 mt-1">Design Custom Data Pages. Direct device injection is deferred until a recoverable backend path is validated.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
           <input 
             type="text" 
             value={profileName} 
             onChange={(e) => setProfileName(e.target.value)}
             className="bg-secondary border border-border rounded-md px-3 py-1 text-xs font-bold text-primary outline-none focus:border-primary/50"
             placeholder="Profile Name"
           />
           <div className="flex gap-2">
              {[1, 2, 4, 6, 8, 10].map(n => (
                <button 
                  key={n}
                  onClick={() => setLayoutType(n)}
                  className={`w-8 h-8 rounded-md text-[10px] font-bold transition-all ${layoutType === n ? 'bg-primary text-white' : 'bg-secondary text-slate-500'}`}
                >
                  {n}
                </button>
              ))}
           </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        <div className="w-full lg:w-72 border-r border-border bg-background/30 p-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar shrink-0">
           <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
             <MousePointerClick className="w-4 h-4" />
             Available Metrics
           </h2>
           <div className="space-y-3 mt-4">
              {METRICS.map(metric => {
                  const isSelected = selectedMetric === metric.id;
                  return (
                  <div
                    key={metric.id}
                    draggable
                    onClick={() => setSelectedMetric(isSelected ? null : metric.id)}
                    onDragStart={(e) => handleDragStart(e, metric.id)}
                    className={`flex items-center p-4 rounded-xl border transition-all group cursor-pointer active:cursor-grabbing ${isSelected ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)]' : 'border-border bg-secondary/50 hover:border-primary/50 hover:bg-secondary'}`}
                  >
                     <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${metric.bg}`}>
                        <metric.icon className={`w-5 h-5 ${metric.color}`} />
                     </div>
                     <div className="ml-4">
                        <p className={`text-sm font-semibold transition-colors ${isSelected ? 'text-primary' : 'text-white group-hover:text-primary'}`}>{metric.label}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{metric.unit}</p>
                     </div>
                  </div>
              )})}
           </div>

            <div className="mt-8 pt-6 border-t border-border">
               <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-4">
                 <Terminal className="w-4 h-4" />
                 Device Profiles
               </h2>

               <AnimatePresence>
                 {discoveryProgress && (
                   <motion.div 
                     initial={{ opacity: 0, height: 0 }}
                     animate={{ opacity: 1, height: "auto" }}
                     exit={{ opacity: 0, height: 0 }}
                     className="mb-4 overflow-hidden"
                   >
                     <div className="flex justify-between text-[10px] font-bold text-primary uppercase mb-1">
                       <span>Discovery...</span>
                       <span>{Math.round(discoveryProgress.percentage)}%</span>
                     </div>
                     <div className="h-1 w-full bg-secondary rounded-full overflow-hidden border border-white/5">
                        <motion.div 
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${discoveryProgress.percentage}%` }}
                        />
                     </div>
                   </motion.div>
                 )}
               </AnimatePresence>

               <div className="space-y-2">
                 {localProfiles.length === 0 ? (
                   <p className="text-[10px] text-slate-500 italic">No profiles detected.</p>
                 ) : (
                   localProfiles.map(p => (
                     <div key={p.id} className="flex flex-col gap-1">
                       <button
                         onClick={() => selectRemoteProfile(p)}
                         className={`w-full text-left p-3 rounded-lg border transition-all text-xs font-medium flex justify-between items-center ${selectedProfileId === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/30 text-slate-300 hover:border-primary/30'} ${pendingChanges.has(p.id) ? 'ring-1 ring-amber-500/50' : ''}`}
                       >
                         <div className="flex items-center gap-2 truncate">
                           {pendingChanges.has(p.id) && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />}
                           <span className="truncate">{p.name}</span>
                         </div>
                         <Zap className={`w-3 h-3 shrink-0 ${selectedProfileId === p.id ? 'text-primary' : 'text-slate-600'}`} />
                       </button>
                       {selectedProfileId === p.id && (
                         <div className="px-2 flex flex-col gap-2">
                           <button 
                             onClick={async () => {
                               const newName = prompt("Enter new name for profile:", p.name);
                               if (newName && newName !== p.name) {
                                 handleLocalRename(p.id, newName);
                               }
                             }}
                             className="w-full py-1.5 bg-secondary border border-border rounded-md text-[9px] text-slate-400 hover:text-white hover:border-slate-500 transition-colors uppercase font-bold"
                           >
                             Rename (Local)
                           </button>
                         </div>
                       )}
                     </div>
                   ))
                 )}
                 
                 <div className="grid grid-cols-2 gap-2 mt-4">
                    <button 
                       onClick={fetchProfiles}
                       disabled={isPulling || !!discoveryProgress}
                       className="py-2.5 bg-secondary hover:bg-zinc-800 border border-white/10 rounded-lg text-[10px] font-bold text-slate-400 flex items-center justify-center gap-2 transition-all"
                    >
                      <RefreshCw className={`w-3 h-3 ${!!discoveryProgress ? 'animate-spin text-primary' : ''}`} />
                      Sync
                    </button>
                    
                    <button 
                       onClick={applyChangesToDevice}
                       disabled={pendingChanges.size === 0 || isApplying}
                       className={`py-2.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-2 transition-all border ${pendingChanges.size > 0 ? 'bg-amber-500/20 text-amber-500 border-amber-500/50 hover:bg-amber-500/30' : 'bg-secondary text-slate-600 border-white/5 opacity-50'}`}
                    >
                      <Save className={`w-3 h-3 ${isApplying ? 'animate-bounce' : ''}`} />
                      {isApplying ? 'Apply' : 'Apply'}
                    </button>
                 </div>
               </div>
            </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8 relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-secondary/40 via-background to-background overflow-y-auto">
            <div className="relative w-[320px] h-[520px] bg-black rounded-[40px] border-[14px] border-[#1a1a1a] shadow-2xl flex flex-col overflow-hidden shrink-0">
                <div className="h-6 w-full flex justify-between items-center px-4 shrink-0 bg-black z-20">
                   <div className="text-[9px] font-bold text-white">14:00</div>
                   <div className="flex gap-1 items-center">
                     <div className="w-2 h-2 rounded-full bg-white/80" />
                     <div className="w-2 h-2 rounded-full bg-white/80" />
                     <div className="w-4 h-2 rounded-sm bg-white" />
                   </div>
                </div>

                <div className={`flex-1 w-full bg-zinc-900 grid gap-[2px] p-[2px] ${
                  layoutType === 1 ? 'grid-cols-1 grid-rows-1' : 
                  layoutType === 2 ? 'grid-cols-1 grid-rows-2' :
                  layoutType === 4 ? 'grid-cols-2 grid-rows-2' :
                  layoutType === 6 ? 'grid-cols-2 grid-rows-3' :
                  layoutType === 8 ? 'grid-cols-2 grid-rows-4' :
                  'grid-cols-2 grid-rows-5'
                }`}>
                   {Array(numFields).fill(0).map((_, i) => {
                      const assignedId = slots[i];
                      const metric = METRICS.find(m => m.id === assignedId);
                      return (
                        <div 
                           key={i}
                           draggable={!!assignedId}
                           onDragStart={(e) => assignedId && handleDragStart(e, assignedId, i)}
                           onDragOver={(e) => handleDragOver(e, i)}
                           onDragLeave={handleDragLeave}
                           onDrop={(e) => handleDrop(e, i)}
                           onClick={() => handleSlotClick(i)}
                           className={`bg-black relative flex flex-col items-center justify-center transition-all border-2 ${
                             dragOverSlot === i ? 'border-primary bg-primary/10' : 
                             !assignedId ? (selectedMetric ? 'border-primary border-dashed cursor-pointer hover:bg-primary/5' : 'border-dashed border-zinc-800 hover:border-primary/50') : 
                             'border-transparent cursor-pointer hover:bg-zinc-950'
                           } ${layoutType === 1 ? 'col-span-1' : (layoutType === 2 ? 'col-span-1' : '')}`}
                        >
                           {metric ? (
                              <motion.div 
                                initial={{ scale: 0.8, opacity: 0 }} 
                                animate={{ scale: 1, opacity: 1 }} 
                                className={`flex flex-col items-center w-full transition-opacity ${draggedMetric === assignedId && draggedFromSlot === i ? 'opacity-30' : 'opacity-100'}`}
                              >
                                 <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mb-1">{metric.label}</p>
                                 <div className="flex items-baseline gap-1">
                                    <span className="text-3xl font-bold text-white tracking-tighter">--</span>
                                 </div>
                              </motion.div>
                           ) : (
                              <span className="text-xs text-zinc-700 font-medium text-center px-2">Drop Metric</span>
                           )}
                        </div>
                      )
                   })}
                </div>
            </div>

            <div className="mt-8 w-full max-w-md flex flex-wrap gap-4 justify-center">
               <button 
                  onClick={handleRoot}
                  disabled={isRooting || adbStatus !== "Online"}
                  className={`px-6 h-12 rounded-xl font-bold flex items-center justify-center gap-3 transition-all border ${isRooting ? 'bg-amber-500/20 text-amber-500 border-amber-500/50' : 'bg-secondary text-slate-300 border-white/10 hover:bg-zinc-800'}`}
               >
                  <Lock className={`w-4 h-4 ${isRooting ? 'animate-pulse' : ''}`} />
                  <span className="text-xs">{isRooting ? 'Rooting...' : 'Root'}</span>
               </button>

               <button 
                  onClick={pullFromDevice}
                  disabled={isPulling || adbStatus !== "Online"}
                  className={`px-6 h-12 rounded-xl font-bold flex items-center justify-center gap-3 transition-all border ${isPulling ? 'bg-primary/20 text-primary border-primary/50' : 'bg-secondary text-slate-300 border-white/10 hover:bg-zinc-800'}`}
               >
                  <Download className={`w-4 h-4 ${isPulling ? 'animate-bounce' : ''}`} />
                  <span className="text-xs">{isPulling ? 'Pulling...' : 'Pull'}</span>
               </button>

               <button
                  disabled
                  title="Deferred until profile injection has a validated format, rollback path, and real-device proof"
                  className="flex-1 min-w-[140px] relative h-12 bg-primary text-white font-bold rounded-xl flex items-center justify-center gap-3 overflow-hidden opacity-50 cursor-not-allowed"
               >
                  <Save className="w-4 h-4" />
                  <span className="text-xs text-white">Inject Deferred</span>
               </button>
            </div>
               {adbStatus !== "Online" && (
                 <p className="text-[10px] text-center text-red-400 mt-3 font-medium uppercase tracking-tighter">Device Offline — Connect via ADB</p>
               )}
        </div>
      </div>
    </div>
  );
}
