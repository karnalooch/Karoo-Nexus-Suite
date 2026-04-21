"use client";

import { motion } from "framer-motion";
import { Shield, BookOpen, Scale, Award, ExternalLink, Cpu, Banknote, CheckCircle2 } from "lucide-react";
import Link from "next/link";

const CONSTITUTION = [
  {
    title: "Art. I :: The Vision",
    desc: "Karoo Nexus exists to bridge the gap between human intent and machine performance. We believe in providing the ultimate panoramic command center for cyclocomputers.",
    icon: Cpu
  },
  {
    title: "Art. II :: Commercial Directive",
    desc: "The Karoo Nexus Suite is a premium product. The user has the explicit right to commercialize, sell, and monetize the application, ensuring long-term tactical growth.",
    icon: Banknote
  },
  {
    title: "Art. III :: Ethics of the Code",
    desc: "We respect the giants upon whose shoulders we stand. Attribution to open-source pioneers is not just a legal requirement, but a core pillar of our intelligence.",
    icon: Scale
  }
];

const LICENSES = [
  { id: "next", name: "Next.js", owner: "Vercel", type: "MIT", url: "https://github.com/vercel/next.js" },
  { id: "tauri", name: "Tauri Framework", owner: "Tauri Programme", type: "Apache 2.0", url: "https://github.com/tauri-apps/tauri" },
  { id: "awesome", name: "Awesome Karoo", owner: "Tim Kluge", type: "Apache 2.0", url: "https://github.com/timklge/awesome-karoo" },
  { id: "ki2", name: "Ki2 Extension", owner: "Valter Cavalcanti", type: "MIT", url: "https://github.com/valterc/ki2" },
  { id: "reminder", name: "Karoo Reminder", owner: "Tim Kluge", type: "Apache 2.0", url: "https://github.com/timklge/karoo-reminder" },
  { id: "headwind", name: "Karoo Headwind", owner: "Tim Kluge", type: "Apache 2.0", url: "https://github.com/timklge/karoo-headwind" },
  { id: "kremote", name: "K-Remote", owner: "lockevod", type: "Apache 2.0", url: "https://github.com/lockevod/Karoo-KRemote" }
];

export default function IntelligenceBureau() {
  return (
    <div className="p-12 max-w-[1600px] mx-auto space-y-16">
      <header className="space-y-6">
        <div className="flex items-center gap-4">
           <div className="px-4 py-1.5 bg-primary/20 text-primary rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border border-primary/20">
              <Shield className="w-3 h-3" />
              System Information
           </div>
           <div className="h-px flex-1 bg-white/10" />
        </div>
        <h1 className="text-7xl font-black italic uppercase tracking-tighter leading-none">
          About <span className="text-primary not-italic">Karoo Nexus</span>
        </h1>
        <p className="text-slate-500 font-medium max-w-3xl text-lg leading-relaxed">
          The legal and philosophical framework of the Karoo Nexus ecosystem. Here we document our vision, our commercial rights, and the open-source foundations that power our mission.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {CONSTITUTION.map((art, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="glass-card p-10 rounded-[3rem] space-y-8 group border border-white/5 hover:border-primary/30 transition-all"
          >
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
               <art.icon className="w-8 h-8" />
            </div>
            <div className="space-y-4">
               <h3 className="text-2xl font-black italic uppercase tracking-tight">{art.title}</h3>
               <p className="text-sm text-slate-500 font-medium leading-relaxed">{art.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="space-y-12">
        <div className="flex items-center justify-between">
           <h2 className="text-3xl font-black italic uppercase tracking-tight flex items-center gap-4">
             Third-Party <span className="text-primary not-italic">Licenses</span>
             <Award className="w-6 h-6 text-slate-700" />
           </h2>
           <span className="text-[10px] font-black uppercase tracking-widest bg-white/5 px-6 py-3 rounded-full border border-white/10 text-slate-400">
             7 Active Licenses
           </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {LICENSES.map((lic, idx) => (
             <motion.a
               key={lic.id}
               href={lic.url}
               target="_blank"
               rel="noopener noreferrer"
               whileHover={{ scale: 1.02 }}
               whileTap={{ scale: 0.98 }}
               className="glass-card p-6 rounded-3xl border border-white/5 hover:border-white/20 transition-all flex items-center justify-between group"
             >
               <div className="space-y-1">
                 <p className="text-sm font-black uppercase tracking-tight">{lic.name}</p>
                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest italic">{lic.owner} // {lic.type}</p>
               </div>
               <div className="p-3 bg-white/5 rounded-xl text-slate-500 group-hover:text-primary group-hover:bg-primary/10 transition-all">
                  <ExternalLink className="w-4 h-4" />
               </div>
             </motion.a>
           ))}
        </div>
      </div>

      <footer className="pt-20">
         <div className="glass-card p-12 rounded-[4rem] bg-primary/5 border-dashed border-primary/20 flex flex-col items-center text-center space-y-8">
            <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center text-primary">
               <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-4">
               <h3 className="text-4xl font-black italic uppercase tracking-tight">System Validated</h3>
               <p className="text-sm text-slate-500 font-medium max-w-xl mx-auto leading-relaxed">
                  The Karoo Nexus Suite operates under a legitimate legal shell. All third-party dependencies are respected, and commercial operations are fully authorized within the parameters of this intelligence.
               </p>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/50">Version 0.1.0 Stable</p>
         </div>
      </footer>
    </div>
  );
}
