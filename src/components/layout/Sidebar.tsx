"use client";

import { motion } from "framer-motion";
import { LayoutDashboard, Smartphone, Activity, Settings, Zap, Terminal, Shield, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtmosphereToggle } from "../ui/AtmosphereToggle";

import { useNexus } from "@/context/NexusContext";

const NAV_ITEMS = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/software", icon: Zap, label: "Software Hub" },
  { href: "/activities", icon: Activity, label: "Activity Pulse" },
  { href: "/investigation", icon: Search, label: "System Analysis" },
  { href: "/intelligence", icon: Shield, label: "About & Legal" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { adbStatus, deviceInfo } = useNexus();

  return (
    <aside className="w-20 lg:w-72 h-screen flex flex-col border-r border-border bg-background/60 backdrop-blur-3xl transition-all duration-300 relative z-50">
      <div className="p-6 flex items-center gap-4">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
          <Terminal className="text-white w-5 h-5" />
        </div>
        <div className="hidden lg:block overflow-hidden">
          <h1 className="text-sm font-bold tracking-tight truncate">
             Karoo Nexus
          </h1>
          <p className="text-[10px] text-slate-500 font-medium tracking-tight">System Information</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex items-center justify-center lg:justify-start gap-3 p-3 rounded-md transition-all relative group cursor-pointer ${
                  isActive ? "bg-white/10 dark:bg-white/5 text-primary" : "text-slate-500 hover:bg-white/10 dark:hover:bg-white/5 hover:text-foreground"
                }`}
              >
                {/* WINDOWS 11 ACTIVE INDICATOR */}
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-bar"
                    className="absolute left-0 w-1 h-4 bg-primary rounded-full"
                  />
                )}
                
                <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : "group-hover:text-foreground transition-colors"}`} />
                <span className={`hidden lg:block font-medium text-sm`}>
                  {item.label}
                </span>
                
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active-bg"
                    className="absolute inset-0 bg-primary/5 rounded-md -z-10"
                  />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 space-y-4 border-t border-border mt-auto">
        <div className={`flex items-center justify-center lg:justify-start gap-4 p-3 rounded-xl transition-all ${
          adbStatus === "Online" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-slate-500/5 text-slate-500"
        }`}>
           <div className="relative">
              <Smartphone className={`w-5 h-5 shrink-0 ${adbStatus === "Online" ? "" : ""}`} />
              {adbStatus === "Online" && <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />}
           </div>
           <div className="hidden lg:block truncate">
              <p className="text-[9px] font-bold uppercase tracking-wider opacity-60">Nexus Link</p>
              <p className="text-[12px] font-semibold truncate leading-none">
                {adbStatus === "Online" ? "Connected" : "Disconnected"}
              </p>
           </div>
        </div>
        
        <div className="flex items-center justify-center lg:justify-start px-2">
           <AtmosphereToggle />
        </div>
      </div>
    </aside>
  );
}
