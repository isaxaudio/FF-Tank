// src/lib/viewport.js — one question the screens ask: is this a phone? Under 760px the sidebar
// becomes a tab bar (App.jsx styles), record pages collapse to header, actions and timeline, and
// the deal board becomes a single column with a stage picker.
import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 760px)";
const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;
const subscribe = cb => { if (!mq) return () => {}; mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); };
const get = () => !!mq && mq.matches;
export function useIsPhone() { return useSyncExternalStore(subscribe, get, () => false); }
