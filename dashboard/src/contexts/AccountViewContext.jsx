import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useInsforgeAuth } from "./InsforgeAuthContext.jsx";
import {
  getCloudSyncEnabled,
  hasCloudSyncPreference,
  setCloudSyncEnabled,
} from "../lib/cloud-sync-prefs";

const AccountViewContext = createContext(null);

export const CLOUD_SYNC_CHANGE_EVENT = "tt.cloudSyncChanged";

export function AccountViewProvider({ children }) {
  const auth = useInsforgeAuth();
  const signedIn = Boolean(auth?.signedIn);
  const authEnabled = Boolean(auth?.enabled);

  const [cloudSyncOn, setCloudSyncOn] = useState(() => getCloudSyncEnabled());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      const next = getCloudSyncEnabled();
      setCloudSyncOn((prev) => {
        if (prev === next) return prev;
        setRevision((n) => n + 1);
        return next;
      });
    };
    window.addEventListener(CLOUD_SYNC_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CLOUD_SYNC_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!authEnabled || !signedIn) return;
    if (!hasCloudSyncPreference()) {
      setCloudSyncEnabled(true);
      setCloudSyncOn(true);
      setRevision((n) => n + 1);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(CLOUD_SYNC_CHANGE_EVENT));
      }
    }
  }, [authEnabled, signedIn]);

  const effectiveAccountView = Boolean(authEnabled && signedIn && cloudSyncOn);

  const value = useMemo(
    () => ({ accountView: effectiveAccountView, revision }),
    [effectiveAccountView, revision],
  );

  return (
    <AccountViewContext.Provider value={value}>{children}</AccountViewContext.Provider>
  );
}

export function useAccountView() {
  const ctx = useContext(AccountViewContext);
  if (ctx) return ctx;
  return { accountView: false, revision: 0 };
}
