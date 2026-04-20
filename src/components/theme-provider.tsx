"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { motion, AnimatePresence } from "framer-motion"

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <AtmosphereWrapper>
        {children}
      </AtmosphereWrapper>
    </NextThemesProvider>
  )
}

function AtmosphereWrapper({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  React.useEffect(() => {
    setIsTransitioning(true);
    const timer = setTimeout(() => setIsTransitioning(false), 1200);
    return () => clearTimeout(timer);
  }, [theme]);

  return (
    <>
      {children}
      <AnimatePresence>
        {isTransitioning && (
          <motion.div
             key="atmosphere-transition"
             initial={{ opacity: 0, scale: 0 }}
             animate={{ opacity: 1, scale: 2 }}
             exit={{ opacity: 0 }}
             transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
             className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
          >
             <div className={`w-[200vw] h-[200vw] rounded-full ${theme === 'dark' ? 'bg-primary/20' : 'bg-white/40'} blur-[150px]`} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
