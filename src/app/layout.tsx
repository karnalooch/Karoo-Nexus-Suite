import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/layout/Sidebar";

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
      <body className={`${inter.variable} font-sans antialiased min-h-screen bg-background text-foreground transition-all duration-1000 overflow-hidden`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex h-screen w-full overflow-hidden">
            <Sidebar />
            <main className="flex-1 h-screen overflow-y-auto relative">
               {/* V12 PANORAMIC ATMOSPHERE BACKGROUND */}
               <div className="fixed inset-0 pointer-events-none -z-10">
                 <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
                 <div className="absolute bottom-[10%] right-[-10%] w-[30%] h-[30%] bg-blue-500/10 blur-[100px] rounded-full" />
               </div>
               {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
