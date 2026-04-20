/**
 * TankOceanBg — animated ocean atmosphere layer
 * Drop this as the FIRST child inside your root app wrapper.
 * It uses position:fixed so it sits behind everything.
 *
 * Built by Claude for Fatfish Media / FF Tank
 *
 * Usage:
 *   import TankOceanBg from './components/TankOceanBg'
 *   // In your root component:
 *   <div style={{ position: 'relative', minHeight: '100vh', background: '#020912' }}>
 *     <TankOceanBg />
 *     <YourApp />
 *   </div>
 */

import React, { useEffect, useRef } from 'react';

const BUBBLES = [
  { size: 10, left: '12%', duration: 16, delay: 0 },
  { size: 16, left: '28%', duration: 22, delay: 4 },
  { size:  7, left: '47%', duration: 14, delay: 8 },
  { size: 12, left: '62%', duration: 19, delay: 2 },
  { size:  9, left: '77%', duration: 17, delay: 7 },
  { size: 18, left: '88%', duration: 24, delay: 12 },
  { size:  6, left: '34%', duration: 13, delay: 9 },
  { size: 14, left: '56%', duration: 21, delay: 15 },
];

const styles = {
  caustic: {
    position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
    background: `
      radial-gradient(ellipse 35% 25% at 25% 35%, rgba(0,220,232,0.05) 0%, transparent 100%),
      radial-gradient(ellipse 25% 20% at 72% 22%, rgba(0,220,232,0.04) 0%, transparent 100%),
      radial-gradient(ellipse 20% 30% at 55% 65%, rgba(120,80,255,0.04) 0%, transparent 100%)
    `,
    animation: 'tankCausticShift 12s ease-in-out infinite alternate',
  },
  bubble: (b) => ({
    position: 'fixed',
    bottom: -20,
    left: b.left,
    width: b.size,
    height: b.size,
    borderRadius: '50%',
    border: '1px solid rgba(0,220,232,0.3)',
    background: 'radial-gradient(circle at 32% 32%, rgba(0,220,232,0.1), rgba(0,220,232,0.02))',
    boxShadow: 'inset 0 -2px 3px rgba(255,255,255,0.05), 0 0 5px rgba(0,220,232,0.12)',
    pointerEvents: 'none',
    zIndex: 0,
    animation: `tankBubble ${b.duration}s ${b.delay}s linear infinite`,
  }),
  fish: {
    position: 'fixed', bottom: '22%', right: -180, opacity: 0.022,
    animation: 'tankFishSwim 50s linear infinite', pointerEvents: 'none', zIndex: 0,
  },
};

export default function TankOceanBg({ showBubbles = true, showCaustic = true, showFish = true }) {
  // Inject keyframes once
  useEffect(() => {
    const id = 'tank-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes tankCausticShift {
        from { transform: translate(0,0) scale(1); }
        to   { transform: translate(3%,4%) scale(1.05); }
      }
      @keyframes tankBubble {
        0%   { transform: translateY(0) translateX(0); opacity: 0; }
        8%   { opacity: 0.55; }
        88%  { opacity: 0.4; }
        100% { transform: translateY(-105vh) translateX(10px); opacity: 0; }
      }
      @keyframes tankFishSwim {
        0%    { right: -180px; transform: scaleX(1); opacity: 0.022; }
        49%   { right: calc(100vw + 180px); transform: scaleX(1); opacity: 0.022; }
        49.9% { opacity: 0; }
        50%   { right: calc(100vw + 180px); transform: scaleX(-1); opacity: 0; }
        50.1% { opacity: 0.022; }
        100%  { right: -180px; transform: scaleX(-1); opacity: 0.022; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  return (
    <>
      {/* Base gradient — layered ocean depth */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 90% 70% at 15% -10%, rgba(0,150,200,0.09) 0%, transparent 55%),
          radial-gradient(ellipse 70% 80% at 85% 20%,  rgba(100,60,200,0.07) 0%, transparent 50%),
          radial-gradient(ellipse 60% 50% at 50% 85%,  rgba(0,80,120,0.07)  0%, transparent 55%),
          linear-gradient(180deg, #030D20 0%, #020912 100%)
        `,
      }} />

      {/* Caustic shimmer */}
      {showCaustic && <div style={styles.caustic} />}

      {/* Bubbles */}
      {showBubbles && BUBBLES.map((b, i) => (
        <div key={i} style={styles.bubble(b)} />
      ))}

      {/* Background fish */}
      {showFish && (
        <svg style={styles.fish} width="180" height="76" viewBox="0 0 180 76" fill="rgba(0,220,232,1)">
          <ellipse cx="79" cy="38" rx="60" ry="28" />
          <path d="M139 38 L176 18 L176 58 Z" />
          <ellipse cx="46" cy="32" rx="6.5" ry="6.5" fill="rgba(2,10,26,0.85)" />
          <ellipse cx="48" cy="30.5" rx="2.5" ry="2.5" fill="rgba(0,220,232,0.4)" />
          <path d="M58 20 Q74 13 90 20" stroke="rgba(2,10,26,0.28)" strokeWidth="1.5" fill="none" />
          <path d="M58 56 Q74 63 90 56" stroke="rgba(2,10,26,0.28)" strokeWidth="1.5" fill="none" />
        </svg>
      )}
    </>
  );
}
