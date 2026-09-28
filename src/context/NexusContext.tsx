"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface RemoteProfile {
  id: string;
  name: string;
  db_path: string;
  body?: string | null;
}

type DiscoveryProgress = {
  percentage: number;
  current: number;
  total: number;
};

interface NexusContextType {
  adbStatus: string;
  deviceInfo: string | null;
  logs: string[];
  addLog: (msg: string) => void;
  clearLogs: () => void;
  isTauri: boolean;
  profiles: RemoteProfile[];
  fetchProfiles: () => Promise<void>;
  discoveryProgress: DiscoveryProgress | null;
  
  // Designer State Persistence
  localProfiles: RemoteProfile[];
  setLocalProfiles: React.Dispatch<React.SetStateAction<RemoteProfile[]>>;
  pendingChanges: Set<string>;
  handleLocalRename: (id: string, newName: string) => void;
  applyChangesToDevice: () => Promise<void>;
  isApplying: boolean;
  
  slots: (string | null)[];
  setSlots: React.Dispatch<React.SetStateAction<(string | null)[]>>;
  profileName: string;
  setProfileName: React.Dispatch<React.SetStateAction<string>>;
  layoutType: number;
  setLayoutType: React.Dispatch<React.SetStateAction<number>>;
  selectedProfileId: string | null;
  setSelectedProfileId: React.Dispatch<React.SetStateAction<string | null>>;
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

const TARGET_FIRMWARE = "1.352.1409.3";

export function NexusProvider({ children }: { children: ReactNode }) {
  const [adbStatus, setAdbStatus] = useState("Disconnected");
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(["Neural Core Initialized...", "Awaiting Device Pulse..."]);
  const [profiles, setProfiles] = useState<RemoteProfile[]>([]);
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress | null>(null);

  // Designer Persistent State
  const [localProfiles, setLocalProfiles] = useState<RemoteProfile[]>([]);
  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [slots, setSlots] = useState<(string | null)[]>(Array(10).fill(null));
  const [profileName, setProfileName] = useState("Nexus Custom Ride");
  const [layoutType, setLayoutType] = useState<number>(6);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const handleLocalRename = (id: string, newName: string) => {
    setLocalProfiles(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
    setPendingChanges(prev => new Set(prev).add(id));
  };

  const applyChangesToDevice = async () => {
    setIsApplying(true);
    addLog("-- INITIALIZING SURGERY BATCH --");
    try {
      for (const id of pendingChanges) {
        const local = localProfiles.find(p => p.id === id);
        const original = profiles.find(p => p.id === id);
        if (local && original) {
          addLog(`Patching ${original.name} -> ${local.name}...`);
          await invoke("rename_profile_on_device", {
            dbPath: original.db_path,
            oldName: original.name,
            newName: local.name
          });
        }
      }
      addLog("-- SUCCESS :: All patches applied. Syncing UI...");
      setPendingChanges(new Set());
      await fetchProfiles();
    } catch (err) {
      addLog(`-- BATCH ERROR :: ${String(err)}`);
    } finally {
      setIsApplying(false);
    }
  };

  // Detect if running inside Tauri desktop app
  const isTauri = React.useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
    () => false,
  );

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

  const isFetchingRef = React.useRef(false);

  const fetchProfiles = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const p = await invoke<RemoteProfile[]>("get_remote_profiles");
      setProfiles(p);
      setLocalProfiles(p);
      addLog(`Discovery Complete: Found ${p.length} profiles.`);
    } catch (e) {
      addLog(`Error: Profile Discovery Failed — ${String(e)}`);
      console.error("Failed to fetch profiles", e);
    } finally {
      isFetchingRef.current = false;
      setTimeout(() => setDiscoveryProgress(null), 2000); // Keep it visible for a moment
    }
  };

  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    
    async function setupListeners() {
      unlisten = await listen("nexus-log", (event) => {
        addLog(event.payload as string);
      });
      unlistenProgress = await listen<DiscoveryProgress>("discovery-progress", (event) => {
        setDiscoveryProgress(event.payload);
      });
    }
    setupListeners();

    let currentStatus = "Disconnected";

    const checkConnection = async () => {
      try {
        const devices = await invoke("check_adb_connection") as string;
        const isOnline = devices.includes("\tdevice");

        if (isOnline) {
          if (currentStatus !== "Online") {
            currentStatus = "Online";
            setAdbStatus("Online");
            setLogs(prev => prev.filter(l => !l.includes("Awaiting Device Pulse...")));
            addLog("Device Detected: HH-KAROO-X — Channel Open");
            
            try {
              const info = await invoke("get_karoo_info") as string;
              setDeviceInfo(info);
              if (info === TARGET_FIRMWARE) {
                addLog("SYSTEM :: Target 1.352.1409.3 Verified — Gold Standard Compliance");
              }
            } catch (e) {}

            if (!isFetchingRef.current) {
              fetchProfiles();
            }
          }
        } else {
          if (currentStatus !== "Disconnected") {
            currentStatus = "Disconnected";
            setAdbStatus("Disconnected");
            setDeviceInfo(null);
            addLog("Warning: Neural Link Severed — Device Absent");
          }
        }
      } catch (e) {
        // Silent fail for polling to avoid noise
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 4000);

    return () => {
      clearInterval(interval);
      if (unlisten) unlisten();
      if (unlistenProgress) unlistenProgress();
    };
  }, [isTauri]);

  const exposedAdbStatus = isTauri ? adbStatus : "Dev Mode";

  return (
    <NexusContext.Provider value={{ 
      adbStatus: exposedAdbStatus, deviceInfo, logs, addLog, clearLogs, isTauri, profiles, fetchProfiles, discoveryProgress,
      localProfiles, setLocalProfiles, pendingChanges, handleLocalRename, applyChangesToDevice, isApplying,
      slots, setSlots, profileName, setProfileName, layoutType, setLayoutType, selectedProfileId, setSelectedProfileId
    }}>
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
