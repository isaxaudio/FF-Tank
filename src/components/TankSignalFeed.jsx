/**
 * TankSignalFeed — Signal feed table + individual rows
 * Built by Claude for Fatfish Media / FF Tank
 *
 * Usage:
 *   import TankSignalFeed from './components/TankSignalFeed'
 *
 *   <TankSignalFeed
 *     rows={visible}              // filtered/sorted opportunity rows
 *     expandedRow={expandedRow}
 *     onExpand={(id) => setExpandedRow(id === expandedRow ? null : id)}
 *     onDraft={(row) => draftOutreach(row)}
 *     onDismiss={(id) => deleteRow(id)}
 *     onStatusChange={(id, status) => updateStatus(id, status)}
 *     draftLoading={{}}           // { [rowId]: true }
 *     draftError={{}}
 *   />
 */

import React from 'react';

const BUDGET_LABEL = { small:'< $25k', mid:'$25k–$75k', large:'$75k–$200k', enterprise:'$200k+', unknown:'?' };

const SIGNAL_BADGE = {
  rfp:        { color:'var(--orange)', border:'rgba(255,124,60,0.35)',   bg:'rgba(255,124,60,0.08)',   label:'RFP'  },
  market:     { color:'var(--purple)', border:'rgba(167,139,250,0.28)', bg:'rgba(167,139,250,0.07)', label:'MKT'  },
  venue:      { color:'var(--teal)',   border:'rgba(0,220,232,0.25)',   bg:'rgba(0,220,232,0.06)',   label:'VEN'  },
  competitor: { color:'var(--coral)',  border:'rgba(255,107,138,0.28)', bg:'rgba(255,107,138,0.07)', label:'CMP'  },
  funding:    { color:'var(--green)',  border:'rgba(0,255,135,0.25)',   bg:'rgba(0,255,135,0.06)',   label:'FUND' },
};

const NEXT_STYLE = {
  'draft outreach': { color:'var(--green)',  border:'rgba(0,255,135,0.28)',   bg:'rgba(0,255,135,0.07)'   },
  'enrich contact': { color:'var(--purple)', border:'rgba(167,139,250,0.28)', bg:'rgba(167,139,250,0.07)' },
  'add to targets': { color:'var(--teal)',   border:'rgba(0,220,232,0.25)',   bg:'rgba(0,220,232,0.06)'   },
  'send to sales':  { color:'var(--orange)', border:'rgba(255,124,60,0.28)',  bg:'rgba(255,124,60,0.07)'  },
  'watch only':     { color:'var(--t3)',     border:'rgba(255,255,255,0.07)', bg:'transparent'            },
};

function scoreColor(s) {
  if (s == null) return 'var(--t4)';
  if (s >= 70) return 'var(--green)';
  if (s >= 40) return 'var(--yellow)';
  return 'var(--red)';
}
function scoreGlow(s) {
  if (s == null) return 'none';
  if (s >= 70) return '0 0 12px rgba(0,255,135,0.5)';
  if (s >= 40) return '0 0 10px rgba(247,201,72,0.4)';
  return '0 0 10px rgba(255,107,107,0.4)';
}

function isExpired(row) {
  if (row.estimated_timeline === 'past' || row.estimated_timeline === 'completed') return true;
  const d = row.event_end_date || row.event_start_date;
  return d ? new Date(d) < new Date() : false;
}
function isUrgent(row) {
  if (isExpired(row)) return false;
  if (!row.event_start_date) return false;
  const diff = new Date(row.event_start_date) - new Date();
  return diff >= 0 && diff <= 45 * 24 * 60 * 60 * 1000;
}

const COL = '50px 68px 1fr 100px 82px 60px 64px';

const thStyle = { fontSize: 8, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--t4)', textTransform: 'uppercase' };
const tdBase  = { fontSize: 12, color: 'var(--t2)' };

function FeedRow({ row, isExpanded, onExpand, onDraft, onDismiss, draftLoading, draftError }) {
  const sig     = SIGNAL_BADGE[row.signal] || SIGNAL_BADGE.market;
  const next    = NEXT_STYLE[row.recommended_next_step] || NEXT_STYLE['watch only'];
  const expired = isExpired(row);
  const urgent  = isUrgent(row);
  const sc      = row.overall_score;

  return (
    <>
      <div
        onClick={() => onExpand?.(row.id)}
        style={{
          display: 'grid', gridTemplateColumns: COL, alignItems: 'center',
          padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)',
          cursor: 'pointer', transition: 'background 0.1s', opacity: expired ? 0.32 : 1,
          background: isExpanded ? 'rgba(0,220,232,0.05)' : 'transparent',
          borderLeft: isExpanded ? '2px solid rgba(0,220,232,0.4)' : '2px solid transparent',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,220,232,0.04)'; }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Score */}
        <div style={{ fontSize: 14, fontWeight: 800, color: scoreColor(sc), textShadow: scoreGlow(sc) }}>
          {sc ?? '—'}
        </div>

        {/* Type badge */}
        <div>
          <span style={{ display: 'inline-flex', fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: '3px 7px', borderRadius: 5, border: `1px solid ${sig.border}`, background: sig.bg, color: sig.color }}>
            {sig.label}
          </span>
          {urgent && <div style={{ fontSize: 7, color: 'var(--orange)', marginTop: 2, letterSpacing: '0.5px' }}>URGENT</div>}
        </div>

        {/* Company / excerpt */}
        <div style={{ minWidth: 0, paddingRight: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.company || '—'}
            {row.event_type && <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 6 }}>{row.event_type}</span>}
          </div>
          <div style={{ fontSize: 9, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
            {row.title || row.signal || '—'}
          </div>
        </div>

        {/* Next step */}
        <div>
          {expired
            ? <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, color: 'var(--green)', border: '1px solid rgba(0,255,135,0.18)', borderRadius: 5, padding: '3px 7px' }}>REVIEWED</span>
            : row.recommended_next_step
              ? <span style={{ display: 'inline-flex', fontSize: 8, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: `1px solid ${next.border}`, background: next.bg, color: next.color, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 96 }}>
                  {row.recommended_next_step}
                </span>
              : <span style={{ color: 'var(--t4)', fontSize: 9 }}>—</span>
          }
        </div>

        {/* Budget */}
        <div style={{ fontSize: 10, color: 'var(--t2)', fontWeight: 600 }}>
          {row.estimated_budget_band && row.estimated_budget_band !== 'unknown'
            ? BUDGET_LABEL[row.estimated_budget_band] || row.estimated_budget_band
            : '—'}
        </div>

        {/* Date */}
        <div style={{ fontSize: 10, color: 'var(--t3)' }}>
          {row.created_at ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          {draftError?.[row.id] && <span style={{ fontSize: 8, color: 'var(--red)' }} title={draftError[row.id]}>!</span>}
          <button
            onClick={() => onDraft?.(row)}
            disabled={!!draftLoading?.[row.id]}
            style={{ fontFamily: 'var(--sans)', fontSize: 9, fontWeight: 600, padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'var(--t3)', cursor: 'pointer', transition: 'all 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--teal)'; e.currentTarget.style.borderColor = 'rgba(0,220,232,0.28)'; e.currentTarget.style.background = 'rgba(0,220,232,0.07)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {draftLoading?.[row.id] ? '◌' : 'Draft'}
          </button>
          <button
            onClick={() => onDismiss?.(row.id)}
            style={{ fontFamily: 'var(--sans)', fontSize: 9, padding: '4px 7px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: 'var(--t4)', cursor: 'pointer', transition: 'color 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--coral)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t4)'; }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div style={{ background: 'rgba(0,220,232,0.025)', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* Scores */}
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  { label: 'OVERALL',    val: row.overall_score,    color: scoreColor(sc) },
                  { label: 'FIT',        val: row.fit_score,        color: 'var(--purple)' },
                  { label: 'URGENCY',    val: row.urgency_score,    color: 'var(--orange)' },
                  { label: 'CONFIDENCE', val: row.confidence_score, color: 'var(--teal)' },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ background: '#111922', border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 8, padding: '8px 12px', textAlign: 'center', minWidth: 64 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{val ?? '—'}</div>
                    <div style={{ fontSize: 7, color: 'var(--t4)', letterSpacing: '1.5px', marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>

              {row.why_this_matters && (
                <div style={{ background: 'rgba(0,255,135,0.04)', border: '1px solid rgba(0,255,135,0.12)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                  <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: 'var(--green)', marginBottom: 5 }}>WHY THIS MATTERS</div>
                  <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.65 }}>{row.why_this_matters}</div>
                </div>
              )}
              {row.recommended_angle && (
                <div style={{ background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.12)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '2px', color: 'var(--purple)', marginBottom: 5 }}>POSITIONING ANGLE</div>
                  <div style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.65 }}>{row.recommended_angle}</div>
                </div>
              )}
            </div>

            {/* Right metadata */}
            <div style={{ flex: '1 1 200px' }}>
              {[
                { label: 'EVENT TYPE',  val: row.event_type },
                { label: 'BUDGET',      val: BUDGET_LABEL[row.estimated_budget_band] || row.estimated_budget_band },
                { label: 'TIMELINE',    val: row.estimated_timeline },
                { label: 'NEXT STEP',   val: row.recommended_next_step },
                { label: 'CONTACT',     val: row.contact },
                { label: 'EMAIL',       val: row.email, link: row.email ? `mailto:${row.email}` : null },
                { label: 'SOURCE',      val: row.title || row.source, link: row.source },
              ].filter(f => f.val).map(({ label, val, link }) => (
                <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 8, letterSpacing: '1px', color: 'var(--t4)', width: 80, flexShrink: 0 }}>{label}</span>
                  {link
                    ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'var(--teal)', textDecoration: 'none' }}>{val}</a>
                    : <span style={{ fontSize: 10, color: 'var(--t2)' }}>{val}</span>
                  }
                </div>
              ))}

              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={() => onDraft?.(row)}
                  style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(0,255,135,0.3)', background: 'rgba(0,255,135,0.07)', color: 'var(--green)', cursor: 'pointer' }}
                >
                  Draft Outreach →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function TankSignalFeed({ rows = [], expandedRow, onExpand, onDraft, onDismiss, draftLoading, draftError }) {
  return (
    <div style={{ background: 'rgba(3,12,30,0.62)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(0,220,232,0.09)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,220,232,0.025)' }}>
        {['Score','Type','Company / Signal','Next Step','Budget','Date',''].map(h => (
          <div key={h} style={thStyle}>{h}</div>
        ))}
      </div>

      {/* Rows */}
      {rows.length === 0 && (
        <div style={{ padding: '24px 16px', fontSize: 11, color: 'var(--t4)' }}>No signals match the current filter.</div>
      )}
      {rows.map(row => (
        <FeedRow
          key={row.id}
          row={row}
          isExpanded={expandedRow === row.id}
          onExpand={onExpand}
          onDraft={onDraft}
          onDismiss={onDismiss}
          draftLoading={draftLoading}
          draftError={draftError}
        />
      ))}
    </div>
  );
}
