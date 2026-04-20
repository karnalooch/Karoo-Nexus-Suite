"use client";

import { motion } from "framer-motion";
import { Smartphone, ShieldCheck, HardDrive, Cpu, Activity, Zap, ArrowRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Link from "next/link";

const TARGET_FIRMWARE = "1.352.1409.3";

function StatCard({ label, value, icon: Icon, accent = false, pulse = false, onClick }: {
  label: string; value: string; icon: React.ElementType; accent?: boolean; pulse?: boolean; onClick?: () => void;
}) {
  return (
    <div 
      onClick={onClick}
      className={`glass-card p-8 rounded-3xl flex items-center gap-6 group transition-all hover:translate-y-[-2px] cursor-pointer ${accent ? "border-primary/30" : ""}`}
    >
      <div className={`p-4 rounded-2xl relative ${accent ? "bg-primary/20 text-primary" : "bg-white/5 text-slate-400"}`}>
        <Icon className="w-7 h-7" />
        {pulse && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />}
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
        <p className="text-2xl font-black uppercase italic tracking-tight mt-0.5">{value}</p>
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  { href: "/software", icon: Zap, label: "Software Hub", desc: "Sideload extensions to your Karoo" },
  { href: "/activities", icon: Activity, label: "Activity Pulse", desc: "Sync and analyze FIT sessions" },
  { href: "/investigation", icon: Search, label: "Tactical Investigation", desc: "Extract APKs and capture OTA links" },
];

export default function Dashboard() {
  const [adbStatus, setAdbStatus] = useState("Disconnected");
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(["Neural Core Initialized...", "Awaiting Device Pulse..."]);

  const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 15));
  
  const logInteraction = (action: string) => addLog(`USER :: ${action}`);

  // Detect if running inside Tauri desktop app
  const isTauri = () => typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setupListener() {
      if (!isTauri()) return;
      unlisten = await listen("nexus-log", (event) => {
        addLog(event.payload as string);
      });
    }

    setupListener();

    if (!isTauri()) {
      setAdbStatus("Dev Mode");
      addLog("Browser env detected — Tauri IPC unavailable");
      addLog("Launch via: cargo tauri dev");
      return;
    }

    const checkConnection = async () => {
      try {
        const devices = await invoke("check_adb_connection") as string;
        if (devices.includes("\tdevice")) {
          if (adbStatus !== "Online") {
            setAdbStatus("Online");
            addLog("Device Detected: HH-KAROO-X — Channel Open");
            const info = await invoke("get_karoo_info") as string;
            setDeviceInfo(info);
            
            if (info === TARGET_FIRMWARE) {
              addLog("SYSTEM :: Target 1.352.1409.3 Verified — Gold Standard Compliance");
            } else {
              addLog(`SYSTEM :: Detected ${info} — Version Drift noted from target 1.352.1409.3`);
            }
          }
        } else {
          if (adbStatus === "Online") addLog("Neural Link Lost — Awaiting Reconnect...");
          setAdbStatus("Disconnected");
          setDeviceInfo(null);
        }
      } catch (e) {
        if (adbStatus !== "Error") addLog("ADB Daemon Error — Check Installation");
        setAdbStatus("Error");
      }
    };
    const interval = setInterval(checkConnection, 3000);
    checkConnection();
    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, [adbStatus]);

  const statusColor = adbStatus === "Online" ? "text-emerald-400" 
    : adbStatus === "Error" ? "text-red-400" 
    : adbStatus === "Dev Mode" ? "text-blue-400"
    : "text-slate-500";
    
  const isCompliant = deviceInfo === TARGET_FIRMWARE;

  return (
    <div className="p-12 max-w-[1600px] mx-auto space-y-12">
      {/* PAGE HEADER */}
      <header className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="px-4 py-1.5 bg-primary/20 text-primary rounded-full text-[10px] font-black uppercase tracking-widest">
            System Overview
          </div>
          <div className="h-px flex-1 bg-white/10" />
          <div className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${statusColor}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${adbStatus === "Online" ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {adbStatus}
          </div>
        </div>
        <h1 className="text-6xl font-black italic uppercase tracking-tighter">
          Nexus <span className="text-primary not-italic">Dashboard</span>
        </h1>
        <p className="text-slate-500 font-medium max-w-2xl">
          Real-time Hammerhead Karoo pulse and system status. Connect via USB to enable the Neural Link.
        </p>
      </header>

      {/* STATUS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          label="Connection Status"
          value={adbStatus}
          icon={Smartphone}
          accent={adbStatus === "Online"}
          pulse={adbStatus === "Online"}
          onClick={() => logInteraction("Checking Connection Pulse")}
        />
        <StatCard 
          label="Active Firmware" 
          value={deviceInfo || "Unidentified"} 
          icon={ShieldCheck} 
          accent 
          onClick={() => logInteraction("Inspecting Firmware Integrity")}
        />
        <StatCard 
          label="System Integrity" 
          value={isCompliant ? "Gold Standard" : (adbStatus === "Online" ? "Neural Drift" : "Inactive")} 
          icon={HardDrive} 
          accent={isCompliant}
          onClick={() => logInteraction("Verifying System Integrity")}
        />
      </div>

      <div className="flex flex-col xl:flex-row gap-12">
        {/* NEURAL PULSE MONITOR */}
        <div className="flex-1 glass-card rounded-[3rem] overflow-hidden border border-primary/20">
          <div className="p-8 bg-primary/10 border-b border-primary/20 flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-widest italic flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
              Neural Pulse Monitor
            </span>
            <div className="text-[8px] font-black px-3 py-1.5 bg-primary/20 rounded-full uppercase tracking-widest text-primary">Live</div>
          </div>
          <div className="p-10 space-y-5 font-mono min-h-[400px] max-h-[500px] overflow-y-auto custom-scrollbar">
            {logs.map((log, i) => (
              <motion.div
                key={`${log}-${i}`}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                className={`text-[10px] uppercase font-bold break-all ${
                  log.includes("EXEC ::") ? "text-emerald-500/80" 
                  : log.includes("USER ::") ? "text-amber-400/80"
                  : log.includes("SYSTEM ::") ? "text-blue-400"
                  : i === 0 ? "text-primary" 
                  : "text-slate-500"
                }`}
              >
                <span className="opacity-40 mr-2">{log.split("] ")[0]}]</span>
                {log.split("] ").slice(1).join("] ")}
              </motion.div>
            ))}
          </div>
          <div className="p-8 bg-black/20 border-t border-white/5 flex items-center gap-4">
            <Cpu className="w-4 h-4 text-slate-600" />
            <p className="text-[9px] font-black uppercase tracking-widest opacity-30 italic">Target: HH-K2-SRAM Neural Core :: 1.352.1409.3</p>
          </div>
        </div>

        {/* QUICK LAUNCH */}
        <div className="w-full xl:w-[380px] space-y-6">
          <h2 className="text-xl font-black italic uppercase tracking-tight">Quick <span className="text-primary not-italic">Launch</span></h2>
          {QUICK_LINKS.map(({ href, icon: Icon, label, desc }) => (
            <Link key={href} href={href} onClick={() => logInteraction(`Navigating to ${label}`)}>
              <motion.div
                whileHover={{ x: 6, scale: 1.01 }}
                className="glass-card p-8 rounded-3xl flex items-center gap-6 group hover:border-primary/40 transition-all cursor-pointer"
              >
                <div className="p-4 bg-primary/10 text-primary rounded-2xl group-hover:bg-primary group-hover:text-white transition-all shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black italic uppercase tracking-tight text-base">{label}</p>
                  <p className="text-[10px] text-slate-500 font-medium mt-0.5 truncate">{desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-primary transition-colors shrink-0" />
              </motion.div>
            </Link>
          ))}

          {/* DEVICE CARD */}
          <div 
            onClick={() => logInteraction("Opening Hardware Details")}
            className={`glass-card p-8 rounded-3xl space-y-4 transition-all cursor-pointer ${adbStatus === "Online" ? (isCompliant ? "border-emerald-500/50" : "border-amber-500/30") : ""}`}
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Target Hardware</p>
            <div className="flex items-center gap-4">
              <div className={`p-4 rounded-2xl ${adbStatus === "Online" ? (isCompliant ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400") : "bg-white/5 text-slate-600"}`}>
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <p className="font-black italic uppercase text-lg tracking-tight">Hammerhead Karoo</p>
                <p className={`text-[10px] font-black uppercase tracking-widest ${statusColor}`}>{adbStatus}</p>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <p className={`text-[9px] font-mono uppercase tracking-widest ${isCompliant ? "text-emerald-500/60" : "text-slate-600"}`}>
              {deviceInfo ? `BUILD :: ${deviceInfo}` : "ADB channel pending..."}
            </p>
            {adbStatus === "Online" && !isCompliant && (
              <p className="text-[8px] font-black uppercase text-amber-500/80 italic">! Version Drift Detected</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
