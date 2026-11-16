"use client";

/** Small confirmation and error messages (useToast). */
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

type ToastKind = "ok" | "error";

const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            <span className="toast-dot" />
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
