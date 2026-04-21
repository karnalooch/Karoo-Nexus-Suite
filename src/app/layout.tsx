import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/layout/Sidebar";
import { NexusProvider } from "@/context/NexusContext";
import { WindowControls } from "@/components/layout/WindowControls";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Karoo Nexus | V12 Intelligence Hub",
  description: "Next-gen Hammerhead Karoo management suite.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased min-h-screen bg-background text-foreground transition-all duration-200 overflow-hidden`}>
        {/* WINDOWS 11 MICA BACKGROUND LAYER */}
        <div className="fixed inset-0 pointer-events-none z-[-1] opacity-60 dark:opacity-40">
           <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-primary/5" />
           <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent)]" />
        </div>
        <NexusProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
          <div className="flex h-screen w-full overflow-hidden">
            <Sidebar />
            <main className="flex-1 h-screen overflow-y-auto relative">
               {/* WINDOW CONTROLS */}
               <div className="fixed top-0 right-0 z-[200]">
                 <WindowControls />
               </div>

               {/* CONTENT CONTAINER */}
               <div className="p-10 page-enter">
                 {children}
               </div>
            </main>
          </div>
        </ThemeProvider>
      </NexusProvider>
    </body>
    </html>
  );
}
