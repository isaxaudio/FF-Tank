/**
 * TankSidebar — FF Tank navigation sidebar with logo
 * Built by Claude for Fatfish Media / FF Tank
 *
 * Usage:
 *   import TankSidebar from './components/TankSidebar'
 *
 *   <TankSidebar
 *     activeView="signals"          // current active nav item
 *     onNavigate={(id) => setView(id)}
 *     agentStatus={{ name: 'Scout', lastRun: '2h ago', found: 14, live: true }}
 *   />
 *
 * Nav IDs: 'signals' | 'targets' | 'find' | 'pipeline' | 'outreach'
 *          'content' | 'intel' | 'projects' | 'agents'
 */

import React from 'react';

/* ── Inline styles (no CSS file dependency beyond tank-theme.css tokens) ── */
const S = {
  sidebar: {
    width: 208, flexShrink: 0, height: '100vh',
    background: 'rgba(2,10,26,0.75)',
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    borderRight: '1px solid rgba(0,220,232,0.09)',
    boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.02), 4px 0 30px rgba(0,0,0,0.35)',
    display: 'flex', flexDirection: 'column', paddingBottom: 14,
    position: 'relative', zIndex: 10,
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: 11, padding: '20px 16px 24px',
  },
  logoSvg: {
    flexShrink: 0,
    filter: 'drop-shadow(0 0 10px rgba(0,220,232,0.55)) drop-shadow(0 0 24px rgba(0,220,232,0.28))',
  },
  logoName: { fontSize: 16, fontWeight: 800, color: 'var(--tx)', letterSpacing: -0.4, lineHeight: 1 },
  logoSub:  { fontSize: 8, fontWeight: 700, letterSpacing: '2.5px', color: 'var(--t3)', marginTop: 2 },
  sectionLabel: {
    fontSize: 8, fontWeight: 700, letterSpacing: '2px', color: 'var(--t5)',
    padding: '10px 18px 4px', textTransform: 'uppercase',
  },
  navLink: (active) => ({
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '8px 10px', margin: '1px 8px', borderRadius: 10,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    transition: 'all 0.15s', textDecoration: 'none', position: 'relative', overflow: 'hidden',
    color: active ? 'var(--teal)' : 'var(--t2)',
    background: active ? 'rgba(0,220,232,0.10)' : 'transparent',
    boxShadow: active ? 'inset 0 0 0 1px rgba(0,220,232,0.18), 0 0 16px rgba(0,220,232,0.07)' : 'none',
  }),
  navIcon: { width: 15, height: 15, flexShrink: 0, opacity: 0.7 },
  navBadge: {
    marginLeft: 'auto', fontSize: 8, fontWeight: 800,
    background: 'var(--orange)', color: '#fff', padding: '2px 6px', borderRadius: 8,
    boxShadow: '0 0 10px rgba(255,124,60,0.4)',
  },
  navCount: { marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: 'var(--t4)' },
  foot: { marginTop: 'auto', padding: '0 10px' },
  agentPill: {
    background: 'rgba(0,220,232,0.06)', border: '1px solid rgba(0,220,232,0.13)',
    borderRadius: 12, padding: '10px 13px',
    boxShadow: '0 0 20px rgba(0,220,232,0.05), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  apLabel: { fontSize: 8, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--teal)', marginBottom: 6, textShadow: '0 0 10px rgba(0,220,232,0.5)' },
  apRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--t2)' },
  dot: {
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
    background: 'var(--green)',
    boxShadow: '0 0 8px var(--green), 0 0 16px rgba(0,255,135,0.4)',
    animation: 'tankPulse 2s infinite',
  },
};

// Inline SVG icons (stroke-based, 15×15)
const Icon = ({ d, d2, circle, rect, rects, cx, cy, r }) => (
  <svg style={S.navIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    {d  && <path d={d} />}
    {d2 && <path d={d2} />}
    {circle && <circle cx={circle[0]} cy={circle[1]} r={circle[2]} />}
    {rect && <rect {...rect} />}
    {rects && rects.map((r, i) => <rect key={i} {...r} />)}
  </svg>
);

const ICONS = {
  signals:  <Icon circle={[7,7,4.5]} d="M10.5 10.5 L14 14" />,
  targets:  <Icon rects={[{x:2,y:2,width:5,height:5,rx:1},{x:9,y:2,width:5,height:5,rx:1},{x:2,y:9,width:5,height:5,rx:1},{x:9,y:9,width:5,height:5,rx:1}]} />,
  find:     <Icon circle={[7,7,4.5]} d="M10.5 10.5 L14 14" />,
  pipeline: <Icon d="M2 12l4-4 3 3 5-6" />,
  outreach: <Icon d="M2 4h12M4 8h8M6 12h4" />,
  content:  <Icon d="M4 13V8.5M8 13V4M12 13V9.5" />,
  intel:    <Icon circle={[8,8,6]} d="M8 5v3l2 2" />,
  projects: <Icon rect={{x:2,y:3,width:12,height:10,rx:1.5}} d="M5 7h6M5 10h4" />,
  agents:   <Icon circle={[8,8,2.5]} d="M8 2v2M8 12v2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M2 8h2M12 8h2M3.5 12.5L5 11M11 5l1.5-1.5" />,
};

function NavLink({ id, label, badge, count, activeView, onNavigate }) {
  const active = activeView === id;
  return (
    <a
      style={S.navLink(active)}
      onClick={() => onNavigate?.(id)}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(0,220,232,0.06)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Active left accent bar */}
      {active && (
        <div style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
          width: 3, height: '60%', background: 'var(--teal)', borderRadius: '0 2px 2px 0',
          boxShadow: '0 0 10px var(--teal)',
        }} />
      )}
      {ICONS[id] || null}
      {label}
      {badge != null && <span style={S.navBadge}>{badge}</span>}
      {count != null && <span style={S.navCount}>{count}</span>}
    </a>
  );
}

export default function TankSidebar({ activeView = 'signals', onNavigate, agentStatus }) {
  const { name = 'Scout', lastRun = '—', found, live = false } = agentStatus || {};

  return (
    <div style={S.sidebar}>
      {/* Logo */}
      <div style={S.logo}>
        <svg style={S.logoSvg} width="36" height="36" viewBox="0 0 36 36" fill="none">
          <rect x="2" y="8" width="32" height="26" rx="3.5" stroke="rgba(0,220,232,0.7)" strokeWidth="1.5" fill="rgba(0,220,232,0.05)" />
          <path d="M2 14.5 Q8 12.5 14 14.5 Q20 16.5 28 14 Q32 13 34 14V8.2Q32 8 28 8Q20 8 14 8Q8 8 2 8Z" fill="rgba(0,220,232,0.1)" />
          <path d="M3 14.5 Q8.5 12.5 14 14.5 Q20 16.5 27.5 14 L34 13.5" stroke="rgba(0,220,232,0.45)" strokeWidth="0.8" fill="none" strokeLinecap="round" />
          <ellipse cx="17" cy="23" rx="7.5" ry="4.5" fill="rgba(0,220,232,0.85)" />
          <path d="M24.5 23 L31 19.5 L31 26.5 Z" fill="rgba(0,220,232,0.7)" />
          <path d="M16 18.5 Q18.5 16 21 18.5" stroke="rgba(0,220,232,0.55)" strokeWidth="1" fill="none" strokeLinecap="round" />
          <circle cx="13" cy="22" r="1.4" fill="rgba(2,10,26,0.9)" />
          <circle cx="13.5" cy="21.5" r="0.5" fill="rgba(0,220,232,0.55)" />
          <circle cx="19" cy="17" r="1.1" stroke="rgba(0,220,232,0.55)" strokeWidth="0.8" fill="none" />
          <circle cx="17" cy="13.5" r="0.7" stroke="rgba(0,220,232,0.4)" strokeWidth="0.7" fill="none" />
          <circle cx="20.5" cy="11" r="0.5" stroke="rgba(0,220,232,0.28)" strokeWidth="0.6" fill="none" />
          <ellipse cx="10" cy="32" rx="2.5" ry="1" fill="rgba(0,220,232,0.14)" />
          <ellipse cx="17" cy="33" rx="3" ry="1" fill="rgba(0,220,232,0.11)" />
          <ellipse cx="26" cy="32" rx="2" ry="1" fill="rgba(0,220,232,0.09)" />
        </svg>
        <div>
          <div style={S.logoName}>FF Tank</div>
          <div style={S.logoSub}>FATFISH AI</div>
        </div>
      </div>

      {/* Find */}
      <div style={S.sectionLabel}>Find</div>
      <NavLink id="signals"  label="Signals"    badge={3}  activeView={activeView} onNavigate={onNavigate} />
      <NavLink id="targets"  label="Target 100" count={87} activeView={activeView} onNavigate={onNavigate} />
      <NavLink id="find"     label="Find"                  activeView={activeView} onNavigate={onNavigate} />

      {/* Grow */}
      <div style={{ ...S.sectionLabel, marginTop: 8 }}>Grow</div>
      <NavLink id="pipeline" label="Pipeline"   count={28} activeView={activeView} onNavigate={onNavigate} />
      <NavLink id="outreach" label="Outreach"   count={6}  activeView={activeView} onNavigate={onNavigate} />

      {/* Build */}
      <div style={{ ...S.sectionLabel, marginTop: 8 }}>Build</div>
      <NavLink id="content"  label="Content"               activeView={activeView} onNavigate={onNavigate} />
      <NavLink id="intel"    label="Company Intel"         activeView={activeView} onNavigate={onNavigate} />

      {/* Ops */}
      <div style={{ ...S.sectionLabel, marginTop: 8 }}>Ops</div>
      <NavLink id="projects" label="Projects"              activeView={activeView} onNavigate={onNavigate} />
      <NavLink id="agents"   label="Agents"                activeView={activeView} onNavigate={onNavigate} />

      {/* Agent status footer */}
      <div style={S.foot}>
        <div style={S.agentPill}>
          <div style={S.apLabel}>LIVE AGENT</div>
          <div style={S.apRow}>
            {live
              ? <div style={S.dot} />
              : <div style={{ ...S.dot, background: 'var(--t5)', boxShadow: 'none', animation: 'none' }} />
            }
            {name} · {lastRun}{found != null ? ` · ${found} found` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
