"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface NexusContextType {
  adbStatus: string;
  deviceInfo: string | null;
  logs: string[];
  addLog: (msg: string) => void;
  clearLogs: () => void;
  isTauri: boolean;
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

const TARGET_FIRMWARE = "1.352.1409.3";

export function NexusProvider({ children }: { children: ReactNode }) {
  const [adbStatus, setAdbStatus] = useState("Disconnected");
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(["Neural Core Initialized...", "Awaiting Device Pulse..."]);

  // Detect if running inside Tauri desktop app
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

  const addLog = (msg: string) => {
    setLogs(prev => {
      if (prev.length > 0) {
        const last = prev[0];
        const lastMsgClean = last.split("] ").slice(1).join("] ").replace(/\s\(x\d+\)$/, "");
        if (lastMsgClean === msg) {
          const match = last.match(/\(x(\d+)\)$/);
          const count = match ? parseInt(match[1]) + 1 : 2;
          const newEntry = `[${new Date().toLocaleTimeString()}] ${msg} (x${count})`;
          return [newEntry, ...prev.slice(1)];
        }
      }
      return [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50);
    });
  };

  const clearLogs = () => setLogs(["Neural Core Reset...", "Awaiting Device Pulse..."]);

  useEffect(() => {
    if (!isTauri) {
      setAdbStatus("Dev Mode");
      return;
    }

    let unlisten: (() => void) | undefined;
    async function setupListener() {
      unlisten = await listen("nexus-log", (event) => {
        addLog(event.payload as string);
      });
    }
    setupListener();

    const checkConnection = async () => {
      try {
        const devices = await invoke("check_adb_connection") as string;
        if (devices.includes("\tdevice")) {
          if (adbStatus !== "Online") {
            setAdbStatus("Online");
            setLogs(prev => prev.filter(l => !l.includes("Awaiting Device Pulse...")));
            addLog("Device Detected: HH-KAROO-X — Channel Open");
            const info = await invoke("get_karoo_info") as string;
            setDeviceInfo(info);
            if (info === TARGET_FIRMWARE) {
              addLog("SYSTEM :: Target 1.352.1409.3 Verified — Gold Standard Compliance");
            }
          }
        } else {
          if (adbStatus !== "Disconnected") {
            setAdbStatus("Disconnected");
            setDeviceInfo(null);
            addLog("Warning: Neural Link Severed — Device Absent");
          }
        }
      } catch (e) {
        setAdbStatus("Disconnected");
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 3000);

    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, [isTauri, adbStatus]);

  return (
    <NexusContext.Provider value={{ adbStatus, deviceInfo, logs, addLog, clearLogs, isTauri }}>
      {children}
    </NexusContext.Provider>
  );
}

export function useNexus() {
  const context = useContext(NexusContext);
  if (context === undefined) {
    throw new Error("useNexus must be used within a NexusProvider");
  }
  return context;
}
