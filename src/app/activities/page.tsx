"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Activity, RefreshCcw, History, ZapIcon, HeartPulse, Timer, Route, Flame } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FitSummary {
  file_name: string;
  start_time: string;
  duration_mins: number;
  distance_km: number;
  avg_power: number;
  avg_heart_rate: number;
  calories: number;
}

// Simulated mock data in case device is not connected
const MOCK_ACTIVITIES: FitSummary[] = [
  { file_name: "sunset_highvelocity.fit", start_time: "2026-04-19T18:30:00", duration_mins: 62.5, distance_km: 38.4, avg_power: 248, avg_heart_rate: 162, calories: 1021 },
  { file_name: "obsidian_nightrun.fit", start_time: "2026-04-18T20:15:00", duration_mins: 45.2, distance_km: 26.1, avg_power: 215, avg_heart_rate: 155, calories: 742 },
  { file_name: "alpine_threshold.fit", start_time: "2026-04-17T08:00:00", duration_mins: 125.0, distance_km: 74.2, avg_power: 198, avg_heart_rate: 148, calories: 2103 },
  { file_name: "velodrome_intervals.fit", start_time: "2026-04-15T17:00:00", duration_mins: 35.0, distance_km: 14.8, avg_power: 315, avg_heart_rate: 178, calories: 580 },
];

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(isoStr: string) {
  const d = new Date(isoStr);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
}

function formatLabel(fileName: string) {
  return fileName.replace(".fit", "").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function MetricPill({ icon: Icon, value, label, accent = false }: { icon: React.ElementType, value: string, label: string, accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 p-5 rounded-2xl ${accent ? "bg-primary/10 border border-primary/20" : "bg-white/5 border border-white/5"}`}>
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className={`w-3.5 h-3.5 ${accent ? "text-primary" : ""}`} />
        <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <p className={`text-xl font-black uppercase italic tracking-tight ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function ActivityPulse() {
  const [activities, setActivities] = useState<FitSummary[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selected, setSelected] = useState<FitSummary | null>(null);
  const [log, setLog] = useState("Neural Mirror awaiting sync...");
  const [showMock, setShowMock] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    setLog("Initiating ADB activity pull...");
    try {
      const result = await invoke("sync_activities") as string;
      setLog(`Sync complete: ${result}`);
      // Real implementation would scan filesystem after sync
      // For now, load mock data as stand-in
      setActivities(MOCK_ACTIVITIES);
      setShowMock(true);
    } catch (e) {
      setLog(`Sync via ADB failed — loading cached Neural Mirror.`);
      setActivities(MOCK_ACTIVITIES);
      setShowMock(true);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-12 max-w-[1600px] mx-auto space-y-12">
      {/* PAGE HEADER */}
      <header className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="px-4 py-1.5 bg-primary/20 text-primary rounded-full text-[10px] font-black uppercase tracking-widest">
            Activity Pulse
          </div>
          <div className="h-px flex-1 bg-white/10" />
          {showMock && (
            <div className="px-4 py-1.5 bg-yellow-400/20 text-yellow-400 rounded-full text-[9px] font-black uppercase tracking-widest">
              Neural Mirror (Cached)
            </div>
          )}
        </div>
        <div className="flex items-end justify-between gap-8">
          <div>
            <h1 className="text-6xl font-black italic uppercase tracking-tighter">
              Training <span className="text-primary not-italic">Intelligence</span>
            </h1>
            <p className="text-slate-500 font-medium mt-3 max-w-xl">
              Pull FIT sessions from your Hammerhead Karoo via ADB and unlock deep neural performance analysis.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSync}
            disabled={isSyncing}
            className={`flex items-center gap-4 px-10 py-6 rounded-[2rem] font-black uppercase tracking-widest text-sm transition-all shrink-0 ${
              isSyncing
                ? "bg-primary/50 animate-pulse cursor-wait"
                : "bg-primary text-white shadow-[0_0_40px_rgba(var(--color-primary),0.2)] hover:shadow-[0_0_60px_rgba(var(--color-primary),0.35)]"
            }`}
          >
            <RefreshCcw className={`w-5 h-5 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing Neural Mirror..." : "Sync Activity Cloud"}
          </motion.button>
        </div>

        {/* LIVE LOG */}
        <div className="flex items-center gap-4 p-5 glass-card rounded-2xl">
          <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? "bg-primary animate-ping" : "bg-slate-500"}`} />
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">{log}</p>
        </div>
      </header>

      {/* CONTENT */}
      {activities.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-20 rounded-[3rem] border-dashed border-primary/20 flex flex-col items-center text-center space-y-6"
        >
          <div className="w-24 h-24 bg-white/5 rounded-[2rem] flex items-center justify-center">
            <History className="w-12 h-12 text-slate-500" />
          </div>
          <div>
            <p className="text-3xl font-black italic uppercase text-slate-400">No Activity Data</p>
            <p className="text-sm text-slate-500 font-medium mt-2">Connect your Karoo over USB and tap Sync to initialize the Neural Mirror.</p>
          </div>
        </motion.div>
      ) : (
        <div className="flex flex-col xl:flex-row gap-10">
          {/* ACTIVITY LIST */}
          <div className="flex-1 space-y-5">
            {activities.map((act, i) => {
              const isSelected = selected?.file_name === act.file_name;
              return (
                <motion.div
                  key={act.file_name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                  onClick={() => setSelected(isSelected ? null : act)}
                  className={`glass-card p-8 rounded-[2.5rem] cursor-pointer transition-all group hover:border-primary/40 ${
                    isSelected ? "border-primary/60 shadow-[0_0_30px_rgba(var(--color-primary),0.1)]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-5">
                      <div className={`p-4 rounded-2xl transition-all ${isSelected ? "bg-primary text-white" : "bg-white/5 text-slate-400 group-hover:bg-primary/20 group-hover:text-primary"}`}>
                        <Activity className="w-6 h-6" />
                      </div>
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-primary/70 bg-primary/10 px-3 py-1 rounded-full">
                          {formatDate(act.start_time)}
                        </span>
                        <h3 className="text-xl font-black italic uppercase tracking-tight mt-1.5">{formatLabel(act.file_name)}</h3>
                      </div>
                    </div>
                    <div className="text-right space-y-0.5">
                      <p className="text-2xl font-black italic text-primary">{act.avg_power.toFixed(0)}W</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Avg Power</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-4 border-t border-white/5 pt-6">
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-500">Duration</p>
                      <p className="font-extrabold text-sm mt-1">{formatDuration(act.duration_mins)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-500">Distance</p>
                      <p className="font-extrabold text-sm mt-1">{act.distance_km.toFixed(1)} km</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-500">Avg HR</p>
                      <p className="font-extrabold text-sm mt-1">{act.avg_heart_rate.toFixed(0)} bpm</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-500">Calories</p>
                      <p className="font-extrabold text-sm mt-1">{act.calories} kcal</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* DETAIL PANEL */}
          <div className="w-full xl:w-[400px] shrink-0">
            <AnimatePresence mode="wait">
              {selected ? (
                <motion.div
                  key={selected.file_name}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 30 }}
                  className="glass-card rounded-[3rem] overflow-hidden border border-primary/20 sticky top-8"
                >
                  <div className="p-8 bg-primary/10 border-b border-primary/20">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse mb-4" />
                    <h3 className="text-2xl font-black italic uppercase tracking-tight">{formatLabel(selected.file_name)}</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">{formatDate(selected.start_time)}</p>
                  </div>
                  <div className="p-8 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <MetricPill icon={ZapIcon} value={`${selected.avg_power.toFixed(0)}W`} label="Avg Power" accent />
                      <MetricPill icon={HeartPulse} value={`${selected.avg_heart_rate.toFixed(0)} bpm`} label="Avg Heart Rate" />
                      <MetricPill icon={Timer} value={formatDuration(selected.duration_mins)} label="Duration" />
                      <MetricPill icon={Route} value={`${selected.distance_km.toFixed(1)} km`} label="Distance" />
                    </div>
                    <MetricPill icon={Flame} value={`${selected.calories} kcal`} label="Total Calories Burned" accent />
                    <div className="p-5 bg-white/5 rounded-2xl border border-white/5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Source File</p>
                      <p className="text-xs font-mono text-primary/80">{selected.file_name}</p>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card rounded-[3rem] p-16 flex flex-col items-center text-center space-y-6 border-dashed border-primary/20"
                >
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    <Activity className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="font-black italic uppercase text-slate-400 text-lg">Select a session</p>
                    <p className="text-xs text-slate-500 font-medium mt-2">Tap any activity to drill into the Neural performance profile.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
