import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ApiError, getCurrentUser, loginAccount, logoutAccount, registerAccount, setUnauthorizedHandler,
  type AccountUser, type AccountCredentials, type AccountRegistration } from "@workspace/api-client-react";

type Phase = "loading" | "ready" | "error";
type AuthContextValue = {
  user: AccountUser | null;
  phase: Phase;
  retry: () => void;
  login: (data: AccountCredentials) => Promise<void>;
  register: (data: AccountRegistration) => Promise<void>;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
  logoutError: string | null;
};
const AuthContext = createContext<AuthContextValue | null>(null);

/** Only known workspace routes may be used after authentication. */
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin ||
      !/^(\/|\/requests(?:\/[1-9]\d*)?|\/approvals|\/invoices|\/recommendations|\/settings|\/tools)$/.test(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [isLoggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const epoch = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const busy = useRef(false);
  const currentAccountId = useRef<number | null>(null);

  const clearWorkspace = useCallback(() => {
    void client.cancelQueries();
    client.clear();
  }, [client]);

  const signedOut = useCallback(() => {
    epoch.current++;
    currentAccountId.current = null;
    setUser(null);
    setPhase("ready");
    setLogoutError(null);
    clearWorkspace();
  }, [clearWorkspace]);

  const checkSession = useCallback(async () => {
    if (busy.current) return;
    const current = ++epoch.current;
    try {
      const account = await getCurrentUser();
      if (current !== epoch.current) return;
      if (currentAccountId.current !== null && currentAccountId.current !== account.id) clearWorkspace();
      currentAccountId.current = account.id;
      setUser(account);
      setPhase("ready");
    } catch (error) {
      if (current !== epoch.current) return;
      if (error instanceof ApiError && error.status === 401) signedOut();
      else setPhase("error");
    }
  }, [clearWorkspace, signedOut]);

  useEffect(() => {
    // Install before mounting protected queries; the shell stays absent until me resolves.
    setUnauthorizedHandler(signedOut);
    void checkSession();
    const focus = () => { void checkSession(); };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    const broadcast = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("procureflow-session") : null;
    channel.current = broadcast;
    if (broadcast) broadcast.onmessage = (event) => {
      // Immediately remove any old data before checking a change in another tab.
      if (event.data === "changed") {
        if (busy.current) return;
        epoch.current++;
        currentAccountId.current = null;
        setUser(null);
        setPhase("loading");
        clearWorkspace();
        void checkSession();
      }
    };
    return () => {
      epoch.current++;
      setUnauthorizedHandler(null);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
      broadcast?.close();
      channel.current = null;
    };
  }, [checkSession, signedOut, clearWorkspace]);

  useEffect(() => {
    if (!user || phase !== "ready") return;
    const timer = window.setInterval(() => { void checkSession(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [user, phase, checkSession]);

  const authenticate = async (action: () => Promise<AccountUser>) => {
    const destination = safeReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
    epoch.current++;
    busy.current = true;
    try {
      const account = await action();
      clearWorkspace();
      currentAccountId.current = account.id;
      setUser(account);
      setPhase("ready");
      setLogoutError(null);
      channel.current?.postMessage("changed");
      navigate(destination, { replace: true });
    } finally { busy.current = false; }
  };

  const logout = async () => {
    if (busy.current) return;
    busy.current = true;
    epoch.current++;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logoutAccount();
      signedOut();
      channel.current?.postMessage("changed");
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("Could not sign out. Check your connection and try again.");
    } finally { busy.current = false; setLoggingOut(false); }
  };

  return <AuthContext.Provider value={{
    user, phase, retry: () => { setPhase("loading"); void checkSession(); },
    login: data => authenticate(() => loginAccount(data)),
    register: data => authenticate(() => registerAccount(data)),
    logout, isLoggingOut, logoutError,
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Authentication provider is missing.");
  return value;
}
