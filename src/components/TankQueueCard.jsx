/**
 * TankQueueCard — Action Queue signal card
 * Built by Claude for Fatfish Media / FF Tank
 *
 * Usage:
 *   import TankQueueCard from './components/TankQueueCard'
 *
 *   <TankQueueCard
 *     opportunity={row}           // opportunity row from DB
 *     isTop={i === 0}             // first card gets extra glow
 *     onDraft={(row) => ...}
 *     onSalesBrief={(row) => ...}
 *     onDismiss={(id) => ...}
 *   />
 *
 * opportunity shape (matches your Supabase opportunities table):
 *   { id, title, company, signal, overall_score, fit_score, urgency_score,
 *     confidence_score, why_this_matters, recommended_angle, recommended_next_step,
 *     estimated_budget_band, estimated_timeline, event_start_date, status }
 */

import React from 'react';

const BUDGET_LABEL = {
  small: '< $25k', mid: '$25k–$75k',
  large: '$75k–$200k', enterprise: '$200k+', unknown: '?',
};

const SIGNAL_COLORS = {
  rfp:        { color: 'var(--orange)', border: 'rgba(255,124,60,0.4)',   bg: 'rgba(255,124,60,0.1)' },
  market:     { color: 'var(--purple)', border: 'rgba(167,139,250,0.3)',  bg: 'rgba(167,139,250,0.08)' },
  venue:      { color: 'var(--teal)',   border: 'rgba(0,220,232,0.28)',   bg: 'rgba(0,220,232,0.07)' },
  competitor: { color: 'var(--coral)',  border: 'rgba(255,107,138,0.3)',  bg: 'rgba(255,107,138,0.07)' },
  funding:    { color: 'var(--green)',  border: 'rgba(0,255,135,0.25)',   bg: 'rgba(0,255,135,0.06)' },
};

function scoreColor(s) {
  if (s == null) return 'var(--t4)';
  if (s >= 70) return 'var(--green)';
  if (s >= 40) return 'var(--yellow)';
  return 'var(--red)';
}
function scoreGlow(s) {
  if (s == null) return 'none';
  if (s >= 70) return '0 0 20px rgba(0,255,135,0.6), 0 0 40px rgba(0,255,135,0.28)';
  if (s >= 40) return '0 0 16px rgba(247,201,72,0.5)';
  return '0 0 14px rgba(255,107,107,0.4)';
}
function tierLabel(s) {
  if (s == null) return '';
  if (s >= 80) return 'T1 · TOP 8%';
  if (s >= 70) return 'T1 · TOP 15%';
  if (s >= 60) return 'T2 · TOP 30%';
  if (s >= 50) return 'T2 · MID';
  return 'T3';
}

function isUrgent(row) {
  if (!row.event_start_date) return false;
  const diff = new Date(row.event_start_date) - new Date();
  return diff > 0 && diff <= 45 * 24 * 60 * 60 * 1000;
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  if (diff <= 0) return null;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export default function TankQueueCard({ opportunity: row, isTop = false, onDraft, onSalesBrief, onDismiss }) {
  if (!row) return null;

  const sig = SIGNAL_COLORS[row.signal] || SIGNAL_COLORS.market;
  const sc  = row.overall_score;
  const urgent = isUrgent(row);
  const days   = daysUntil(row.event_start_date);

  const cardStyle = {
    background: 'rgba(4, 14, 34, 0.62)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${isTop ? 'rgba(0,220,232,0.2)' : 'rgba(0,220,232,0.09)'}`,
    borderRadius: 14,
    display: 'flex', flexDirection: 'column',
    cursor: 'pointer', overflow: 'hidden', position: 'relative',
    boxShadow: isTop
      ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,220,232,0.1), 0 0 40px rgba(0,220,232,0.07), inset 0 1px 0 rgba(255,255,255,0.06)'
      : '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
    transition: 'all 0.2s',
  };

  return (
    <div style={cardStyle}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
    >
      {/* Glass sheen */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(180deg,rgba(255,255,255,0.035) 0%,transparent 100%)', pointerEvents: 'none', borderRadius: '14px 14px 0 0' }} />

      {/* Accent bar */}
      <div style={{ height: 2, background: isTop ? 'linear-gradient(90deg,var(--teal),var(--green))' : 'linear-gradient(90deg,var(--orange),var(--yellow))', flexShrink: 0 }} />

      {/* Body */}
      <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Top: score + meta */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {/* Score column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0, paddingTop: 2 }}>
            <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1, letterSpacing: -2.5, color: scoreColor(sc), textShadow: scoreGlow(sc) }}>
              {sc ?? '—'}
            </div>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, color: scoreColor(sc), opacity: 0.7 }}>
              {tierLabel(sc)}
            </div>
            <div style={{ width: 32, height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
              <div style={{ width: `${Math.min(sc ?? 0, 100)}%`, height: '100%', borderRadius: 2, background: scoreColor(sc), boxShadow: `0 0 8px ${scoreColor(sc)}` }} />
            </div>
          </div>

          {/* Meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 7 }}>
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: '3px 8px', borderRadius: 5, border: `1px solid ${sig.border}`, background: sig.bg, color: sig.color, textTransform: 'uppercase' }}>
                {row.signal?.toUpperCase() || '—'}
              </span>
              {urgent && days && (
                <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(255,124,60,0.3)', background: 'rgba(255,124,60,0.07)', color: 'var(--orange)', textTransform: 'uppercase' }}>
                  URGENT · {days}d
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--tx)', letterSpacing: -0.4, lineHeight: 1.2 }}>
              {row.company || 'Unknown'}
            </div>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--t2)', lineHeight: 1.55, marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {row.title}
            </div>
          </div>
        </div>

        {/* Why this matters */}
        {row.why_this_matters && (
          <div style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.1)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: 'var(--green)', marginBottom: 5, textShadow: '0 0 10px rgba(0,255,135,0.45)' }}>
              WHY IT MATTERS
            </div>
            <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.65 }}>
              {row.why_this_matters}
            </div>
          </div>
        )}

        {/* Metadata chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {row.recommended_next_step && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '4px 9px', borderRadius: 6, background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', flexShrink: 0 }} />
              {row.recommended_next_step}
            </span>
          )}
          {row.estimated_budget_band && row.estimated_budget_band !== 'unknown' && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '4px 9px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--yellow)', flexShrink: 0 }} />
              {BUDGET_LABEL[row.estimated_budget_band] || row.estimated_budget_band}
            </span>
          )}
          {row.estimated_timeline && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '4px 9px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: urgent ? 'var(--orange)' : 'var(--teal)', flexShrink: 0 }} />
              {row.estimated_timeline}
            </span>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(0,0,0,0.15)' }}>
        <button
          onClick={() => onDraft?.(row)}
          style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 700, padding: '7px 14px', borderRadius: 9, cursor: 'pointer', border: '1px solid rgba(0,255,135,0.28)', background: 'rgba(0,255,135,0.07)', color: 'var(--green)', boxShadow: '0 0 14px rgba(0,255,135,0.08)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,255,135,0.15)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(0,255,135,0.18)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,255,135,0.07)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(0,255,135,0.08)'; }}
        >
          Draft Outreach →
        </button>
        <button
          onClick={() => onSalesBrief?.(row)}
          style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 700, padding: '7px 14px', borderRadius: 9, cursor: 'pointer', border: '1px solid rgba(0,220,232,0.22)', background: 'rgba(0,220,232,0.06)', color: 'var(--teal)', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,220,232,0.14)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,220,232,0.06)'; }}
        >
          → Sales Brief
        </button>
        <button
          onClick={() => onDismiss?.(row.id)}
          style={{ fontFamily: 'var(--sans)', fontSize: 9, fontWeight: 600, padding: '7px 10px', borderRadius: 9, cursor: 'pointer', border: '1px solid transparent', background: 'transparent', color: 'var(--t3)', transition: 'all 0.15s', marginLeft: 'auto' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--coral)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
