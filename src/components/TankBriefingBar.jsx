/**
 * TankBriefingBar — Top status strip with key daily metrics
 * Built by Claude for Fatfish Media / FF Tank
 *
 * Usage:
 *   import TankBriefingBar from './components/TankBriefingBar'
 *
 *   <TankBriefingBar
 *     newSignals={14}
 *     openRfps={3}
 *     urgentCount={12}
 *     funnelBudget="$375k"
 *     topScore={82}
 *     topCompany="UofU Commuter Svcs"
 *     onRunScout={() => runCron('scout')}
 *     scoutRunning={cronRunning === 'scout'}
 *   />
 */

import React from 'react';

const barStyle = {
  flexShrink: 0,
  height: 37,
  background: 'linear-gradient(90deg, rgba(0,220,232,0.08) 0%, rgba(0,220,232,0.03) 40%, transparent 70%)',
  borderBottom: '1px solid rgba(0,220,232,0.09)',
  display: 'flex',
  alignItems: 'center',
  padding: '0 22px',
  boxShadow: '0 1px 0 rgba(255,255,255,0.02)',
  position: 'relative',
  zIndex: 2,
};

const labelStyle = {
  fontSize: 8, fontWeight: 800, letterSpacing: '2px',
  color: 'var(--teal)', marginRight: 16, flexShrink: 0,
  textShadow: '0 0 12px rgba(0,220,232,0.6)',
};

const itemStyle = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '0 13px', borderRight: '1px solid rgba(255,255,255,0.05)',
  fontSize: 10, color: 'var(--t2)', whiteSpace: 'nowrap',
};

function Item({ value, label, color }) {
  return (
    <div style={itemStyle}>
      <b style={{ fontWeight: 800, color: color || 'var(--t2)' }}>{value}</b>
      {label}
    </div>
  );
}

export default function TankBriefingBar({
  newSignals,
  openRfps,
  urgentCount,
  funnelBudget,
  topScore,
  topCompany,
  onRunScout,
  scoutRunning = false,
}) {
  return (
    <div style={barStyle}>
      <span style={labelStyle}>TODAY</span>

      <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden' }}>
        {newSignals != null && (
          <Item
            value={newSignals}
            label=" new signals"
            color="var(--teal)"
          />
        )}
        {openRfps != null && (
          <Item
            value={openRfps}
            label=" open RFPs"
            color="var(--orange)"
          />
        )}
        {urgentCount != null && (
          <Item
            value={urgentCount}
            label=" urgent"
            color="var(--orange)"
          />
        )}
        {funnelBudget && (
          <Item
            value={funnelBudget}
            label=" in funnel"
            color="var(--green)"
          />
        )}
        {topScore != null && topCompany && (
          <div style={{ ...itemStyle, borderRight: 'none' }}>
            <b style={{ fontWeight: 800, color: 'var(--t2)' }}>Top:</b>
            {topScore} · {topCompany}
          </div>
        )}
      </div>

      <button
        onClick={onRunScout}
        disabled={scoutRunning}
        style={{
          fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 700,
          padding: '5px 14px', borderRadius: 8, cursor: scoutRunning ? 'not-allowed' : 'pointer',
          border: `1px solid ${scoutRunning ? 'rgba(167,139,250,0.3)' : 'rgba(0,220,232,0.3)'}`,
          background: scoutRunning ? 'rgba(167,139,250,0.1)' : 'rgba(0,220,232,0.09)',
          color: scoutRunning ? 'var(--purple)' : 'var(--teal)',
          boxShadow: scoutRunning ? '0 0 14px rgba(167,139,250,0.1)' : '0 0 14px rgba(0,220,232,0.1)',
          transition: 'all 0.15s', flexShrink: 0,
        }}
      >
        {scoutRunning ? '◌ Running…' : 'Run Scout'}
      </button>
    </div>
  );
}
