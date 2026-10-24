// src/screens/Login.jsx — sign-in gate, styled after Apollo's login: dark sand page, dark fields,
// one sunbeam primary action. Email + password against Supabase Auth via src/lib/auth.js.
import React, { useState } from "react";
import { c as TC, font as TF, sand, sunbeam, rust } from "../tokens.js";
import { auth } from "../lib/auth.js";
import { Eye, EyeOff } from "lucide-react";

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
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

  const field = { width: "100%", padding: "9px 12px", fontSize: 13, lineHeight: "20px", fontFamily: TF.sans, color: sand[4], background: sand[92], border: `1px solid ${sand[80]}`, borderRadius: 8, outline: "none", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 450, lineHeight: "18px", color: sand[30], display: "block", marginBottom: 6 };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: sand[94], fontFamily: TF.sans, padding: 16 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: sunbeam[50], color: sand[94], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 550 }}>FF</div>
          <div style={{ fontSize: 20, fontWeight: 450, color: sand[4] }}>FF Tank</div>
        </div>
        <div>
          <span style={lbl}>Email</span>
          <input style={field} type="email" autoComplete="username" placeholder="Work email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </div>
        <div>
          <span style={lbl}>Password</span>
          <div style={{ position: "relative" }}>
            <input style={{ ...field, paddingRight: 40 }} type={show ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 8, top: 8, background: "none", border: "none", color: sand[40], cursor: "pointer", padding: 4 }}>
              {show ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </div>
        {error && <div style={{ fontSize: 13, lineHeight: "20px", color: rust[30], background: "rgba(209,69,50,0.14)", padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ padding: "9px 14px", fontSize: 13, lineHeight: "20px", fontWeight: 450, fontFamily: TF.sans, color: sand[94], background: busy ? sunbeam[70] : sunbeam[50], border: "none", borderRadius: 8, cursor: busy ? "default" : "pointer" }}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        {!auth.configured() && <div style={{ fontSize: 12, color: sand[40] }}>VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set for this build.</div>}
        <div style={{ fontSize: 12, color: sand[50], textAlign: "center", marginTop: 8 }}>Fatfish internal · {new Date().getFullYear()}</div>
      </form>
    </div>
  );
}
