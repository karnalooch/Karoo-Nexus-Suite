"use client";

import { motion } from "framer-motion";
import { LayoutDashboard, Smartphone, Activity, Settings, Zap, Terminal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtmosphereToggle } from "../ui/AtmosphereToggle";

const NAV_ITEMS = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/software", icon: Zap, label: "Software Hub" },
  { href: "/activities", icon: Activity, label: "Activity Pulse" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-24 lg:w-72 h-screen flex flex-col border-r border-white/10 glass-card transition-all duration-cinema relative z-50">
      <div className="p-8 flex items-center justify-center lg:justify-start gap-4">
        <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30 shrink-0">
          <Terminal className="text-primary w-6 h-6" />
        </div>
        <div className="hidden lg:block overflow-hidden">
          <h1 className="text-xl font-black tracking-tighter uppercase italic truncate">
            Karoo <span className="text-primary">Nexus</span>
          </h1>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Suite V12</p>
        </div>
      </div>

      <nav className="flex-1 px-4 lg:px-6 py-8 space-y-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <motion.div
                whileHover={{ x: 4 }}
                className={`flex items-center justify-center lg:justify-start gap-4 p-4 rounded-2xl transition-all relative group ${
                  isActive ? "bg-primary text-white" : "text-slate-500 hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <item.icon className={`w-6 h-6 ${isActive ? "text-white" : "group-hover:text-primary transition-colors"}`} />
                <span className={`hidden lg:block font-black uppercase tracking-widest text-[11px] italic`}>
                  {item.label}
                </span>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-primary rounded-2xl -z-10 shadow-[0_0_20px_rgba(var(--color-primary),0.3)]"
                  />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      <div className="p-6 space-y-4 border-t border-white/5">
        <div className="flex items-center justify-center lg:justify-start gap-4 p-4 rounded-2xl bg-slate-500/5 text-slate-500">
           <Smartphone className="w-5 h-5 shrink-0" />
           <div className="hidden lg:block truncate">
              <p className="text-[9px] font-black uppercase tracking-widest">Device Target</p>
              <p className="text-[10px] font-bold text-foreground truncate uppercase italic">HH-K2-SRAM</p>
           </div>
        </div>
        <div className="flex items-center justify-center lg:justify-start px-2 py-4">
           <AtmosphereToggle />
        </div>
      </div>
    </aside>
  );
}
