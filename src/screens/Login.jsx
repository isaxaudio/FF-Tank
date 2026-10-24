// src/screens/Login.jsx — sign-in gate. Email + password against Supabase Auth via src/lib/auth.js.
import React, { useState } from "react";
import { c as TC, font as TF } from "../tokens.js";
import { auth } from "../lib/auth.js";

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await auth.signIn(email.trim(), password); onSignedIn(); }
    catch (err) { setError(err.message === "Invalid login credentials" ? "Wrong email or password." : err.message); }
    finally { setBusy(false); }
  }

  const input = { width: "100%", padding: "10px 12px", fontSize: 14, fontFamily: TF.sans, color: TC.ink, background: TC.elevated, border: `1px solid ${TC.line}`, borderRadius: 8, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: TC.bg, fontFamily: TF.sans, padding: 16 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12, padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: TC.ink }}>FF Tank</div>
          <div style={{ fontSize: 12, color: TC.sub, marginTop: 2 }}>Sign in to continue</div>
        </div>
        <label style={{ fontSize: 12, color: TC.sub }}>Email
          <input style={{ ...input, marginTop: 4 }} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label style={{ fontSize: 12, color: TC.sub }}>Password
          <input style={{ ...input, marginTop: 4 }} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div style={{ fontSize: 12, color: TC.criticalInk, background: TC.criticalSoft, padding: "8px 10px", borderRadius: 6 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600, fontFamily: TF.sans, color: TC.onInk, background: TC.ink, border: "none", borderRadius: 8, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {!auth.configured() && <div style={{ fontSize: 11, color: TC.warnInk }}>VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set for this build.</div>}
      </form>
    </div>
  );
}
