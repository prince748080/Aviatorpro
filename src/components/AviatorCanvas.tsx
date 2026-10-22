import React, { useEffect, useRef } from 'react';
import { RoundState, GameRound } from '../types/index.js';
import { AlertCircle, WifiOff } from 'lucide-react';

interface AviatorCanvasProps {
  roundState: RoundState;
  currentMultiplier: number;
  countdownSec: number;
  activeRound: GameRound | null;
  lastCrashMultiplier: number | null;
  connected: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  size: number;
  color: string;
}

export const AviatorCanvas: React.FC<AviatorCanvasProps> = ({
  roundState,
  currentMultiplier,
  countdownSec,
  activeRound,
  lastCrashMultiplier,
  connected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const planeAnimRef = useRef({
    x: 50,
    y: 200,
    angle: 0,
    propellerAngle: 0,
    crashOffset: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      // Handle high-DPI
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // 1. Draw Background Grid & Radar Coordinates
      ctx.fillStyle = '#0e1017';
      ctx.fillRect(0, 0, width, height);

      // Subtle curved runway radial glow
      const bgGrad = ctx.createRadialGradient(width * 0.5, height * 0.9, 20, width * 0.5, height * 0.9, width * 0.8);
      bgGrad.addColorStop(0, 'rgba(180, 20, 30, 0.08)');
      bgGrad.addColorStop(1, 'rgba(10, 12, 18, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;

      const gridSpacingX = width / 8;
      const gridSpacingY = height / 6;

      for (let x = 0; x < width; x += gridSpacingX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      for (let y = 0; y < height; y += gridSpacingY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Origin coordinates
      const startX = 60;
      const startY = height - 50;

      // Draw Axes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(startX, 20);
      ctx.lineTo(startX, startY);
      ctx.lineTo(width - 20, startY);
      ctx.stroke();

      // Axis labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '10px "Chakra Petch", monospace';
      ctx.fillText('1.00x', 20, startY + 4);
      ctx.fillText('1.50x', 20, startY - (startY - 40) * 0.5);
      ctx.fillText('2.00x', 20, 35);

      // 2. State-Specific Rendering
      if (roundState === 'WAITING') {
        // Plane parked at runway start
        planeAnimRef.current.x = startX + 20;
        planeAnimRef.current.y = startY - 15;
        planeAnimRef.current.angle = 0;
        planeAnimRef.current.propellerAngle += 0.1;
        planeAnimRef.current.crashOffset = 0;

        drawPlane(ctx, planeAnimRef.current.x, planeAnimRef.current.y, 0, planeAnimRef.current.propellerAngle, false);
      } else if (roundState === 'RUNNING' || roundState === 'CRASHED') {
        // Multiplier progression curve: from 1.00 to 2.00
        const progress = Math.min(Math.max((currentMultiplier - 1.0) / 1.0, 0), 1.0); // 0.0 to 1.0
        const curveEndX = startX + progress * (width - startX - 120);
        const curveEndY = startY - Math.pow(progress, 0.85) * (startY - 60);

        // Control point for smooth parabolic arc
        const cpX = startX + (curveEndX - startX) * 0.45;
        const cpY = startY;

        // Draw glowing red filled area under curve
        const areaGrad = ctx.createLinearGradient(0, curveEndY, 0, startY);
        areaGrad.addColorStop(0, 'rgba(220, 38, 38, 0.35)');
        areaGrad.addColorStop(0.7, 'rgba(220, 38, 38, 0.08)');
        areaGrad.addColorStop(1, 'rgba(220, 38, 38, 0)');

        ctx.fillStyle = areaGrad;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(cpX, cpY, curveEndX, curveEndY);
        ctx.lineTo(curveEndX, startY);
        ctx.closePath();
        ctx.fill();

        // Draw flight curve trajectory stroke with neon glow
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(cpX, cpY, curveEndX, curveEndY);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Tangent angle
        const t = 1.0;
        const dx = 2 * (1 - t) * (cpX - startX) + 2 * t * (curveEndX - cpX);
        const dy = 2 * (1 - t) * (cpY - startY) + 2 * t * (curveEndY - cpY);
        const tangentAngle = Math.atan2(dy, dx);

        // Spawn exhaust particles
        if (roundState === 'RUNNING' && Math.random() < 0.6) {
          particlesRef.current.push({
            x: curveEndX - Math.cos(tangentAngle) * 20,
            y: curveEndY - Math.sin(tangentAngle) * 20,
            vx: -Math.cos(tangentAngle) * (Math.random() * 2 + 1) + (Math.random() - 0.5),
            vy: -Math.sin(tangentAngle) * (Math.random() * 2 + 1) + (Math.random() - 0.5),
            alpha: 0.8,
            size: Math.random() * 3 + 2,
            color: Math.random() > 0.5 ? '#ef4444' : '#f97316',
          });
        }

        // Draw particles
        for (let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          p.x += p.vx;
          p.y += p.vy;
          p.alpha -= 0.03;
          if (p.alpha <= 0) {
            particlesRef.current.splice(i, 1);
            continue;
          }
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }

        planeAnimRef.current.propellerAngle += 0.35;

        if (roundState === 'RUNNING') {
          planeAnimRef.current.x = curveEndX;
          planeAnimRef.current.y = curveEndY;
          planeAnimRef.current.angle = tangentAngle;
          drawPlane(ctx, curveEndX, curveEndY, tangentAngle, planeAnimRef.current.propellerAngle, false);
        } else {
          // CRASHED: Plane flies away rapidly off-screen to top-right
          planeAnimRef.current.crashOffset += 8;
          const off = planeAnimRef.current.crashOffset;
          const exitX = curveEndX + off * 1.8;
          const exitY = curveEndY - off * 1.2;
          drawPlane(ctx, exitX, exitY, -0.4, planeAnimRef.current.propellerAngle, true);
        }
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      running = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [roundState, currentMultiplier]);

  // Helper to draw iconic red stunt monoplane
  const drawPlane = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    propellerAngle: number,
    isCrashed: boolean
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    if (isCrashed) {
      ctx.globalAlpha = 0.85;
    }

    // Fuselage
    const fuselageGrad = ctx.createLinearGradient(-30, 0, 30, 0);
    fuselageGrad.addColorStop(0, '#991b1b');
    fuselageGrad.addColorStop(0.5, '#dc2626');
    fuselageGrad.addColorStop(1, '#ef4444');

    ctx.fillStyle = fuselageGrad;
    ctx.beginPath();
    ctx.moveTo(25, 0); // nose tip
    ctx.quadraticCurveTo(0, -9, -25, -5); // top fuselage
    ctx.lineTo(-30, -18); // vertical rudder fin
    ctx.lineTo(-24, 0);
    ctx.lineTo(-30, 5); // tail
    ctx.quadraticCurveTo(0, 8, 25, 0); // bottom fuselage
    ctx.closePath();
    ctx.fill();

    // Wings
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(-12, -24);
    ctx.lineTo(-2, -24);
    ctx.lineTo(8, -3);
    ctx.closePath();
    ctx.fill();

    // Cockpit windshield
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(6, -4);
    ctx.quadraticCurveTo(12, -7, 16, -3);
    ctx.lineTo(14, 0);
    ctx.lineTo(4, 0);
    ctx.closePath();
    ctx.fill();

    // Propeller spinner & blades
    ctx.save();
    ctx.translate(26, 0);
    ctx.rotate(propellerAngle);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 12);
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  };

  return (
    <div className="relative w-full h-[320px] sm:h-[400px] md:h-[460px] bg-[#0c0e14] rounded-2xl overflow-hidden border border-[#212534] shadow-2xl flex items-center justify-center select-none">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Disconnected Overlay */}
      {!connected && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30">
          <WifiOff className="w-12 h-12 text-red-500 mb-3 animate-bounce" />
          <h3 className="text-xl font-bold text-white mb-1">Server Connection Lost</h3>
          <p className="text-zinc-400 text-sm max-w-md">
            Real-time link to the authoritative game engine was interrupted. Reconnecting automatically...
          </p>
        </div>
      )}

      {/* Center Dynamic Status Display */}
      {connected && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10">
          {/* WAITING PHASE */}
          {roundState === 'WAITING' && (
            <div className="flex flex-col items-center justify-center text-center animate-fade-in bg-black/40 backdrop-blur-xs px-8 py-5 rounded-3xl border border-white/5">
              <span className="text-xs uppercase tracking-widest text-zinc-400 font-bold mb-1">
                NEXT ROUND IN
              </span>
              <div className="text-5xl sm:text-6xl font-extrabold text-white font-mono tracking-tight drop-shadow-md">
                {countdownSec.toFixed(1)}s
              </div>
              <div className="w-48 sm:w-60 h-2 bg-zinc-800 rounded-full mt-3 overflow-hidden border border-zinc-700/50">
                <div
                  className="h-full bg-gradient-to-r from-red-600 to-amber-500 transition-all duration-300"
                  style={{ width: `${Math.min(Math.max((countdownSec / 5) * 100, 0), 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-zinc-400 mt-2 font-medium">
                Place your demo bets before takeoff
              </span>
            </div>
          )}

          {/* RUNNING PHASE */}
          {roundState === 'RUNNING' && (
            <div className="flex flex-col items-center justify-center text-center drop-shadow-2xl">
              <div className="text-6xl sm:text-7xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-zinc-100 to-zinc-300 font-mono tracking-tighter leading-none filter drop-shadow-[0_8px_16px_rgba(239,68,68,0.35)]">
                {currentMultiplier.toFixed(2)}x
              </div>
              <div className="mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-red-950/70 text-red-300 border border-red-700/40 tracking-wider uppercase animate-pulse">
                Flight in Progress • Capped at 2.00x
              </div>
            </div>
          )}

          {/* CRASHED PHASE */}
          {roundState === 'CRASHED' && (
            <div className="flex flex-col items-center justify-center text-center animate-scale-up">
              <span className="text-lg sm:text-xl font-bold uppercase tracking-widest text-red-500 drop-shadow-md">
                FLEW AWAY!
              </span>
              <div className="text-6xl sm:text-7xl md:text-8xl font-black text-red-500 font-mono tracking-tighter leading-none filter drop-shadow-[0_8px_20px_rgba(239,68,68,0.6)]">
                {(lastCrashMultiplier || currentMultiplier).toFixed(2)}x
              </div>
              <span className="text-xs text-zinc-400 mt-2 font-medium">
                Authoritative server crash point confirmed
              </span>
            </div>
          )}
        </div>
      )}

      {/* Top Left Round Indicator */}
      <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
        <span className="px-2.5 py-1 rounded-md bg-black/60 text-zinc-300 text-[11px] font-mono border border-white/10 backdrop-blur-sm">
          {activeRound ? `ROUND #${activeRound.roundNumber}` : 'INITIALIZING'}
        </span>
      </div>
    </div>
  );
};
