"use client";

import { motion } from "framer-motion";
import { Smartphone, ShieldCheck, HardDrive, Cpu, Activity, Zap, ArrowRight, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Link from "next/link";
import { useNexus } from "@/context/NexusContext";

const TARGET_FIRMWARE = "1.352.1409.3";

function StatCard({ label, value, icon: Icon, accent = false, pulse = false, onClick, disabled = false }: {
  label: string; value: string; icon: React.ElementType; accent?: boolean; pulse?: boolean; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <div 
      onClick={!disabled ? onClick : undefined}
      className={`glass-card p-6 rounded-lg flex items-center gap-4 transition-all relative overflow-hidden ${
        accent && !disabled ? "border-primary/50" : "border-border shadow-sm"
      } ${disabled ? "opacity-50 grayscale cursor-not-allowed" : "hover:bg-white/10 cursor-pointer active:scale-[0.98]"}`}
    >
      <div className={`p-3 rounded-md ${accent && !disabled ? "bg-primary text-white" : "bg-secondary text-slate-500"}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className="text-lg font-bold tracking-tight">{value}</p>
      </div>
      {disabled && (
        <div className="absolute inset-0 bg-background/20 backdrop-blur-[1px] flex items-center justify-center">
           <ShieldAlert className="w-4 h-4 text-slate-500/50" />
        </div>
      )}
    </div>
  );
}

const QUICK_LINKS = [
  { href: "/software", icon: Zap, label: "Software Hub", desc: "Sideload extensions to your Karoo" },
  { href: "/activities", icon: Activity, label: "Activity Pulse", desc: "Sync and analyze FIT sessions" },
  { href: "/investigation", icon: Search, label: "System Analysis", desc: "Extract APKs and capture system links" },
];

export default function Dashboard() {
  const { adbStatus, deviceInfo, logs, clearLogs } = useNexus();
  const isOffline = adbStatus !== "Online";

  const logInteraction = async (action: string) => {
    try {
      await invoke("log_interaction", { action: `USER :: ${action}` });
    } catch (e) {}
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-10">
      <header className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">
          System <span className="text-primary">Status</span>
        </h1>
        <p className="text-slate-500 font-medium max-w-2xl text-sm leading-relaxed">
          Real-time telemetry and bridge system. Verify your Hammerhead Karoo connection and monitor the neural link for secure data management.
        </p>
      </header>

      {/* STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="Connection Status" 
          value={adbStatus === "Online" ? "ONLINE" : "OFFLINE"} 
          icon={Smartphone} 
          accent 
          pulse={adbStatus === "Online"}
        />
        <StatCard 
          label="Hardware Target" 
          value={deviceInfo ? "HH-KAROO-X" : "NO TARGET"} 
          icon={Cpu} 
          disabled={isOffline}
        />
        <StatCard 
          label="Security Link" 
          value={adbStatus === "Online" ? "ENCRYPTED" : "SEVERED"} 
          icon={ShieldCheck} 
          disabled={isOffline}
        />
        <StatCard 
          label="Firmware Compliance" 
          value={deviceInfo === TARGET_FIRMWARE ? "VERIFIED" : (deviceInfo ? "DRIFT" : "N/A")} 
          icon={HardDrive} 
          disabled={isOffline}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* QUICK ACTIONS */}
        <div className="xl:col-span-2 space-y-6">
           <h2 className="text-xl font-bold tracking-tight">System Tools</h2>
           <div className="grid grid-cols-1 gap-2">
              {QUICK_LINKS.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => logInteraction(`Navigating to ${link.label}`)}>
                  <div className={`glass-card p-4 rounded-lg group transition-all flex items-center gap-6 relative overflow-hidden ${isOffline ? 'opacity-30 grayscale cursor-not-allowed pointer-events-none' : 'hover:bg-white/10 border-border cursor-pointer active:scale-[0.99]'}`}>
                    <div className={`p-4 rounded-md transition-all ${isOffline ? 'bg-slate-500/10 text-slate-500' : 'bg-primary/5 text-primary group-hover:bg-primary group-hover:text-white'}`}>
                      <link.icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                       <div className="flex items-center gap-4">
                         <h3 className="text-base font-bold tracking-tight">{link.label}</h3>
                         {isOffline && (
                           <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-red-500/10 text-red-500 rounded-md border border-red-500/10">Offline</span>
                         )}
                       </div>
                       <p className="text-xs text-slate-500 font-medium">{link.desc}</p>
                    </div>
                    <ArrowRight className={`w-5 h-5 transition-all ${isOffline ? 'text-slate-300' : 'text-slate-400 group-hover:text-primary group-hover:translate-x-1'}`} />
                  </div>
                </Link>
              ))}
           </div>
        </div>

        {/* SYSTEM LOG */}
        <div className="space-y-6">
           <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight">System Log</h2>
              <button 
                onClick={() => { clearLogs(); logInteraction("Logs Cleared"); }}
                className="px-3 py-1 bg-secondary border border-border rounded-md text-[10px] font-bold tracking-tight text-slate-500 hover:text-primary transition-all"
              >
                Clear
              </button>
           </div>
           <div className="glass-card h-[500px] rounded-lg p-6 font-mono text-[12px] overflow-y-auto space-y-2 custom-scrollbar bg-white/5 dark:bg-black/20 border-border">
              {logs.map((log, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={i} 
                  className={`border-l-2 pl-4 py-0.5 transition-colors ${
                    log.includes("Warning") ? "border-red-500/50 text-red-400" : 
                    log.includes("Success") || log.includes("Verified") ? "border-emerald-500/50 text-emerald-400" :
                    log.includes("USER ::") ? "border-primary/50 text-primary-foreground/70" :
                    "border-border text-slate-400"
                  }`}
                >
                  <span className="opacity-30 mr-2 text-[10px]">{log.includes("] ") ? log.split("] ")[0] + "]" : ""}</span>
                  <span className="font-medium tracking-tight text-foreground/80">{log.includes("] ") ? log.split("] ").slice(1).join("] ") : log}</span>
                </motion.div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
}
