import { useState, useEffect, useRef, useCallback } from "react";
import RosDiagnosticsDashboard from "./RosDiagnosticsDashboard"; 
// ─── Constants ────────────────────────────────────────────────────────────────
const JOINTS = [
  { id: "joint_1", label: "Base Rotation", min: -180, max: 180,  unit: "°", color: "#00D4FF", vizLabel: "Base" },
  { id: "joint_2", label: "Shoulder",      min: -90,  max: 90,   unit: "°", color: "#00FF9D", vizLabel: "Upper Arm" },
  { id: "joint_3", label: "Elbow",         min: -135, max: 135,  unit: "°", color: "#FFB800", vizLabel: "Forearm" },
  { id: "joint_4", label: "Wrist Pitch",   min: -90,  max: 90,   unit: "°", color: "#FF6B35", vizLabel: "Wrist" },
  { id: "joint_5", label: "Wrist Roll",    min: -180, max: 180,  unit: "°", color: "#C77DFF", vizLabel: "Roll" },
  { id: "joint_6", label: "Gripper",       min: 0,    max: 100,  unit: "%", color: "#FF4D6D", vizLabel: "Gripper" },
];

const LIMIT_WARN_ZONE = 5;

const PRESETS = [
  { name: "Home",       icon: "⌂", values: { joint_1: 0,   joint_2: 0,   joint_3: 0,   joint_4: 0,  joint_5: 0, joint_6: 0   } },
  { name: "Grab Ready", icon: "✦", values: { joint_1: 0,   joint_2: 45,  joint_3: -90, joint_4: 45, joint_5: 0, joint_6: 0   } },
  { name: "Release",    icon: "◎", values: { joint_1: 0,   joint_2: 45,  joint_3: -90, joint_4: 45, joint_5: 0, joint_6: 100 } },
  { name: "Stow",       icon: "▣", values: { joint_1: 0,   joint_2: -90, joint_3: 135, joint_4: -45,joint_5: 0, joint_6: 0   } },
];

const SPEED_LEVELS = ["Slow", "Normal", "Fast"];
const JOG_INTERVAL  = [120, 60, 30]; // ms between updates while holding
const JOG_STEP_DEG  = [1, 2, 5];     // degrees to move per tick

const initJoints = () => Object.fromEntries(JOINTS.map((j) => [j.id, 0]));

function nearLimit(value, joint) { return value <= joint.min + LIMIT_WARN_ZONE || value >= joint.max - LIMIT_WARN_ZONE; }
function atLimit(value, joint) { return value <= joint.min || value >= joint.max; }

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg-base:      #080C10;
    --bg-panel:     #0D1117;
    --bg-card:      #111820;
    --bg-hover:     #18222E;
    --border:       #1E2D3D;
    --border-light: #253545;
    --text-primary: #E6EDF3;
    --text-muted:   #8B949E;
    --text-dim:     #3D4E5E;
    --accent:       #00D4FF;
    --accent-dim:   rgba(0,212,255,0.12);
    --danger:       #FF3B3B;
    --danger-dim:   rgba(255,59,59,0.15);
    --success:      #00FF9D;
    --success-dim:  rgba(0,255,157,0.1);
    --warn:         #FFB800;
    --warn-dim:     rgba(255,184,0,0.12);
    --radius:       8px;
    --radius-lg:    12px;
  }

  body {
    background: var(--bg-base); color: var(--text-primary);
    font-family: 'Inter', sans-serif; font-size: 13px;
    line-height: 1.5; min-height: 100vh; overflow-x: hidden;
  }

  .arm-root { display: grid; grid-template-rows: 56px 1fr 32px; min-height: 100vh; }

  /* ── Header ── */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 24px; background: var(--bg-panel); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 100;
  }
  .header-brand { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 14px; letter-spacing: 0.04em; color: var(--accent); }
  .header-brand-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: pulse 2s infinite; }
  .header-brand-dot.offline { background: var(--text-dim); box-shadow: none; animation: none; }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes flash-warn { 0%,100% { border-color: var(--warn); background: var(--warn-dim); } 50% { border-color: #FF6B00; background: rgba(255,107,0,0.2); } }
  @keyframes flash-danger { 0%,100% { border-color: var(--danger); background: var(--danger-dim); } 50% { border-color: #FF0000; background: rgba(255,0,0,0.25); } }

  .header-meta { display: flex; align-items: center; gap: 12px; }

  .conn-badge {
    display: flex; align-items: center; gap: 6px; padding: 4px 12px;
    border-radius: 20px; font-size: 11px; font-weight: 500; font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid transparent; transition: all 0.3s;
  }
  .conn-badge.connected    { color: var(--success); border-color: var(--success); background: var(--success-dim); }
  .conn-badge.disconnected { color: var(--text-muted); border-color: var(--border); }
  .conn-badge.connecting   { color: var(--warn); border-color: var(--warn); background: var(--warn-dim); }
  .conn-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .conn-badge.connected .conn-dot { animation: pulse 1.5s infinite; }

  .estop-btn {
    display: flex; align-items: center; gap: 8px; padding: 6px 18px;
    background: var(--danger-dim); border: 1.5px solid var(--danger);
    border-radius: var(--radius); color: var(--danger); font-family: 'JetBrains Mono', monospace;
    font-size: 12px; font-weight: 600; letter-spacing: 0.08em; cursor: pointer; transition: all 0.15s;
  }
  .estop-btn:hover { background: var(--danger); color: white; }
  .estop-btn:active { transform: scale(0.97); }

/* ── Main Layout ── */
  .main {
  /* Force Update Trigger */
    display: grid;
    /* FLUID WIDTHS: Sidebars take up to 22% of the screen, the center perfectly fills the rest */
    grid-template-columns: minmax(280px, 22vw) 1fr minmax(280px, 22vw); 
    gap: 0; height: calc(100vh - 88px); overflow: hidden;
  }
  .sidebar-left, .sidebar-right { background: var(--bg-panel); overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .sidebar-left  { border-right: 1px solid var(--border); }
  .sidebar-right { border-left:  1px solid var(--border); }

  .center-panel { 
    overflow-y: auto; 
    padding: 24px 3%; /* Dynamic padding so it doesn't crush the center */
    display: flex; flex-direction: column; gap: 24px; 
  }

  /* Side-by-Side Grid inside Center Panel */
.control-grid {
    display: grid;
    grid-template-columns: 1fr 1fr; /* Equal 50/50 split */
    gap: 24px;
    align-items: start;
    min-width: 900px; /* Prevents squishing */
  }

  /* Breakpoints: Stacks the middle columns if you are on a smaller laptop screen */
  @media (max-width: 1400px) { .control-grid { grid-template-columns: 1fr; } }
  @media (max-width: 1024px) { .main { grid-template-columns: 280px 1fr; } .sidebar-right { display: none; } }
  @media (max-width: 768px)  { .main { grid-template-columns: 1fr; } .sidebar-left { display: none; } }
  .section-label {
    font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim); padding: 18px 16px 8px;
  }

  /* ── Card ── */
  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
  .card-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.01); }
  .card-title { font-size: 12px; font-weight: 600; color: var(--text-primary); letter-spacing: 0.02em; text-transform: uppercase; }
  .card-tag { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); background: var(--bg-panel); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); }

  /* ── Joint row ── */
  .joint-row { padding: 14px 16px; border-bottom: 1px solid var(--border); transition: background 0.15s; }
  .joint-row:last-child { border-bottom: none; }
  .joint-row:hover { background: var(--bg-hover); }
  .joint-row.near-limit { animation: flash-warn 1.2s ease-in-out infinite; border-left: 3px solid var(--warn); }
  .joint-row.at-limit { animation: flash-danger 0.7s ease-in-out infinite; border-left: 3px solid var(--danger); }

  .joint-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .joint-name { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; }
  .joint-color-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .joint-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; min-width: 60px; text-align: right; transition: color 0.2s; }
  .joint-value.near-limit { color: var(--warn) !important; }
  .joint-value.at-limit   { color: var(--danger) !important; }

  .limit-badge { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; }
  .limit-badge.near { background: var(--warn-dim); color: var(--warn); border: 1px solid var(--warn); }
  .limit-badge.at   { background: var(--danger-dim); color: var(--danger); border: 1px solid var(--danger); }

  .joint-range { display: flex; align-items: center; gap: 8px; }
  .joint-min, .joint-max { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-dim); width: 32px; }
  .joint-max { text-align: right; }
  .slider-wrap { flex: 1; position: relative; height: 20px; display: flex; align-items: center; }
  .slider-track { position: absolute; left: 0; right: 0; height: 3px; background: var(--border-light); border-radius: 2px; }
  .slider-fill  { position: absolute; left: 50%; height: 3px; border-radius: 2px; transition: width 0.05s, left 0.05s; }

  input[type="range"] { position: relative; width: 100%; height: 20px; appearance: none; background: transparent; cursor: pointer; z-index: 1; }
  input[type="range"]::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--text-primary); border: 2px solid var(--accent); box-shadow: 0 0 6px rgba(0,212,255,0.4); transition: transform 0.1s, box-shadow 0.1s; }
  input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.2); box-shadow: 0 0 12px rgba(0,212,255,0.6); }
  input[type="range"].warn-slider::-webkit-slider-thumb  { border-color: var(--warn);   box-shadow: 0 0 8px rgba(255,184,0,0.5); }
  input[type="range"].limit-slider::-webkit-slider-thumb { border-color: var(--danger); box-shadow: 0 0 8px rgba(255,59,59,0.6); }
  input[type="range"]:disabled::-webkit-slider-thumb { border-color: var(--text-dim); box-shadow: none; }
  input[type="range"]:disabled { cursor: not-allowed; opacity: 0.4; }

  .joint-input { margin-top: 6px; display: flex; align-items: center; gap: 6px; }
  .num-input { width: 70px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 5px; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 4px 8px; text-align: center; outline: none; transition: border-color 0.15s; }
  .num-input:focus { border-color: var(--accent); }
  .num-input.warn-input  { border-color: var(--warn); color: var(--warn); }
  .num-input.limit-input { border-color: var(--danger); color: var(--danger); }
  .num-input:disabled { opacity: 0.4; cursor: not-allowed; }

  .step-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 5px; color: var(--text-muted); cursor: pointer; font-size: 15px; transition: all 0.1s; user-select: none; -webkit-user-select: none; touch-action: none; }
  .step-btn:hover:not([disabled]) { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .step-btn:active:not([disabled]) { transform: scale(0.9); background: var(--accent-dim); }
  .step-btn[disabled] { opacity: 0.3; cursor: not-allowed; }

  /* ── Sidebar Elements ── */
  .preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
  .preset-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-muted); cursor: pointer; font-size: 11px; font-weight: 500; transition: all 0.15s; letter-spacing: 0.03em; }
  .preset-btn:hover:not([disabled]) { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .preset-btn[disabled] { opacity: 0.3; cursor: not-allowed; }
  .preset-btn .icon { font-size: 16px; }

  .speed-selector { display: flex; padding: 12px; gap: 6px; }
  .speed-btn { flex: 1; padding: 6px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-muted); font-size: 11px; font-weight: 500; cursor: pointer; text-align: center; transition: all 0.15s; }
  .speed-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .speed-btn:hover:not(.active) { border-color: var(--border-light); color: var(--text-primary); }

  .action-row { display: flex; gap: 8px; padding: 12px; }
  .btn { flex: 1; padding: 9px 12px; border-radius: var(--radius); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; letter-spacing: 0.03em; border: 1.5px solid transparent; }
  .btn:active { transform: scale(0.97); }
  .btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }
  .btn-primary  { background: var(--success-dim); color: var(--success); border-color: var(--success); }
  .btn-primary:hover:not(:disabled) { background: var(--success); color: var(--bg-base); }
  .btn-ghost    { background: transparent; color: var(--text-muted); border-color: var(--border); }
  .btn-ghost:hover:not(:disabled)  { border-color: var(--danger); color: var(--danger); background: var(--danger-dim); }
  .btn-danger   { background: var(--danger-dim); color: var(--danger); border-color: var(--danger); }
  .btn-danger:hover:not(:disabled) { background: var(--danger); color: white; }
  .btn-success  { background: var(--success-dim); color: var(--success); border-color: var(--success); }
  .btn-success:hover:not(:disabled){ background: var(--success); color: var(--bg-base); }
  
  .btn-outline { background: transparent; color: var(--text-muted); border-color: var(--border); }
  .btn-outline:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

  /* ── Telemetry ── */
  .telem-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); }
  .telem-cell { background: var(--bg-card); padding: 12px 14px; }
  .telem-label { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  .telem-value { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 600; color: var(--text-primary); line-height: 1; }
  .telem-value.ok   { color: var(--success); }
  .telem-value.warn { color: var(--warn); }
  .telem-value.err  { color: var(--danger); }

  /* ── Log ── */
  .log-wrap { padding: 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; max-height: 250px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; display: flex; flex-direction: column-reverse; }
  .log-entry { display: flex; gap: 10px; padding: 5px 14px; border-top: 1px solid var(--border); align-items: baseline; transition: background 0.1s; }
  .log-entry:hover { background: var(--bg-hover); }
  .log-time { color: var(--text-dim); flex-shrink: 0; }
  .log-msg          { color: var(--text-muted); }
  .log-msg.info     { color: var(--accent); }
  .log-msg.success  { color: var(--success); }
  .log-msg.warn     { color: var(--warn); }
  .log-msg.error    { color: var(--danger); }

  /* ── Connection form ── */
  .conn-form { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .field-label { font-size: 11px; color: var(--text-muted); margin-bottom: 5px; font-weight: 500; }
  .field-input { width: 100%; background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 8px 12px; outline: none; transition: all 0.2s; }
  .field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-dim); }

  /* ── Cartesian jog ── */
  .cart-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; padding: 16px; }
  .jog-btn { padding: 12px 6px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-muted); font-size: 11px; font-weight: 600; cursor: pointer; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: all 0.15s; user-select: none; -webkit-user-select: none; touch-action: none; }
  .jog-btn:hover:not([disabled]) { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .jog-btn:active:not([disabled]) { transform: scale(0.92); }
  .jog-btn.center { background: var(--bg-card); color: var(--text-dim); cursor: default; font-size: 10px; }
  .jog-btn[disabled] { opacity: 0.3; cursor: not-allowed; }
  .jog-arrow { font-size: 18px; }

  /* ── Status strip ── */
  .status-strip { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--bg-base); border-top: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-dim); flex-shrink: 0; }
  .status-dot.ok   { background: var(--success); box-shadow: 0 0 5px var(--success); }
  .status-dot.warn { background: var(--warn); }
  .status-dot.err  { background: var(--danger); animation: pulse 0.8s infinite; }

  /* ── E-STOP overlay ── */
  .estop-overlay { position: fixed; inset: 0; background: rgba(255,59,59,0.08); border: 3px solid var(--danger); pointer-events: none; z-index: 999; animation: estop-flash 0.5s ease-in-out infinite alternate; }
  @keyframes estop-flash { from{opacity:0.6} to{opacity:1} }
  .estop-banner { position: fixed; top: 56px; left: 50%; transform: translateX(-50%); background: var(--danger); color: white; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; padding: 8px 28px; border-radius: 0 0 8px 8px; z-index: 1000; display: flex; align-items: center; gap: 8px; }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  @media (max-width: 1150px) { .control-grid { grid-template-columns: 1fr; } }
  @media (max-width: 900px)  { .main { grid-template-columns: 240px 1fr; } .sidebar-right { display: none; } }
  @media (max-width: 680px)  { .main { grid-template-columns: 1fr; }      .sidebar-left  { display: none; } }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ts() { return new Date().toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v))); }

function sliderFill(value, min, max, color) {
  const pct = (v) => ((v - min) / (max - min)) * 100;
  const zeroP = pct(clamp(0, min, max));
  const valP  = pct(value);
  const left  = Math.min(zeroP, valP);
  const width = Math.abs(zeroP - valP);
  return { left: `${left}%`, width: `${width}%`, background: color };
}

// ─── Fixed Long-hold hook (Avoids Stale Closures) ─────────────────────────────
function useLongPress(callback, speed) {
  const callbackRef = useRef(callback);
  const intervalRef = useRef(null);
  const timeoutRef  = useRef(null);

  // Keep the callback fresh so it always has access to the latest state
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const start = useCallback((e) => {
    if (e && e.preventDefault) e.preventDefault();
    callbackRef.current(); // Fire immediately
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        callbackRef.current(); // Fire continuously
      }, JOG_INTERVAL[speed]);
    }, 300);
  }, [speed]);

  const stop = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearInterval(intervalRef.current);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    onMouseDown:   start,
    onMouseUp:     stop,
    onMouseLeave:  stop,
    onTouchStart:  start,
    onTouchEnd:    stop,
  };
}

// ─── 2D Arm Visualizer ───────────────────────────────────────────────────────
function ArmViz({ joints }) {
  const cx = 110, cy = 120;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const shoulderAngle = toRad(joints.joint_2 - 90);
  const elbowAngle    = toRad(joints.joint_2 + joints.joint_3 - 90);
  const wristAngle    = toRad(joints.joint_2 + joints.joint_3 + joints.joint_4 - 90);
  const baseAngle     = toRad(joints.joint_1);
  const L1 = 50, L2 = 36, L3 = 22;

  const x1 = cx + L1 * Math.cos(shoulderAngle);
  const y1 = cy + L1 * Math.sin(shoulderAngle);
  const x2 = x1 + L2 * Math.cos(elbowAngle);
  const y2 = y1 + L2 * Math.sin(elbowAngle);
  const x3 = x2 + L3 * Math.cos(wristAngle);
  const y3 = y2 + L3 * Math.sin(wristAngle);
  const gripOpen = joints.joint_6 / 100;
  const mid = (a, b) => (a + b) / 2;

  return (
    <div style={{ width: "100%", padding: "0 16px" }}>
      <svg viewBox="0 0 220 230" style={{ width: "100%" }}>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20,0L0,0L0,20" fill="none" stroke="#1E2D3D" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="220" height="230" fill="url(#grid)" rx="8" />
        <circle cx={cx} cy={cy} r="95" fill="none" stroke="#1E2D3D" strokeWidth="0.5" strokeDasharray="4 4" />
        <circle cx={cx} cy={cy} r="57" fill="none" stroke="#1E2D3D" strokeWidth="0.5" strokeDasharray="2 6" />

        <line x1={cx} y1={cy} x2={cx + 95 * Math.cos(baseAngle)} y2={cy + 95 * Math.sin(baseAngle)} stroke="#00D4FF" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.25" />
        <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#00D4FF" strokeWidth="8" strokeLinecap="round" opacity="0.08" />
        <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#00D4FF" strokeWidth="4" strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00FF9D" strokeWidth="7" strokeLinecap="round" opacity="0.08" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00FF9D" strokeWidth="3" strokeLinecap="round" />
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#FFB800" strokeWidth="5" strokeLinecap="round" opacity="0.1" />
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#FFB800" strokeWidth="2.5" strokeLinecap="round" />

        <circle cx={cx} cy={cy} r="8" fill="#0D1117" stroke="#00D4FF" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="3" fill="#00D4FF" />
        <circle cx={x1} cy={y1} r="6" fill="#0D1117" stroke="#00FF9D" strokeWidth="1.5" />
        <circle cx={x1} cy={y1} r="2.5" fill="#00FF9D" />
        <circle cx={x2} cy={y2} r="5" fill="#0D1117" stroke="#FFB800" strokeWidth="1.5" />
        <circle cx={x2} cy={y2} r="2" fill="#FFB800" />

        <line x1={x3} y1={y3} x2={x3 + 9 * Math.cos(wristAngle + 0.3 + gripOpen * 0.5)} y2={y3 + 9 * Math.sin(wristAngle + 0.3 + gripOpen * 0.5)} stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round" />
        <line x1={x3} y1={y3} x2={x3 + 9 * Math.cos(wristAngle - 0.3 - gripOpen * 0.5)} y2={y3 + 9 * Math.sin(wristAngle - 0.3 - gripOpen * 0.5)} stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round" />
        <circle cx={x3} cy={y3} r="3" fill="#FF4D6D" />

        <text x={mid(cx, x1) - 6} y={mid(cy, y1) - 7} fontSize="9" fill="#00D4FF" fontFamily="Inter, sans-serif" fontWeight="600">Upper Arm</text>
        <text x={mid(x1, x2) - 6} y={mid(y1, y2) - 7} fontSize="9" fill="#00FF9D" fontFamily="Inter, sans-serif" fontWeight="600">Forearm</text>
        <text x={mid(x2, x3) + 4} y={mid(y2, y3) - 5} fontSize="9" fill="#FFB800" fontFamily="Inter, sans-serif" fontWeight="600">Wrist</text>
        <text x={cx - 12} y={cy + 22} fontSize="9" fill="#00D4FF" fontFamily="Inter, sans-serif">Base</text>
        <text x={x3 + 6} y={y3 + 4} fontSize="9" fill="#FF4D6D" fontFamily="Inter, sans-serif" fontWeight="600">Grip</text>
        <text x="4" y="224" fontSize="8" fill="#3D4E5E" fontFamily="monospace">SIDE VIEW</text>
      </svg>
    </div>
  );
}

// ─── Long-Hold Buttons ────────────────────────────────────────────────────────
function StepBtn({ children, onClick, disabled, speed, title }) {
  const handlers = useLongPress(onClick, speed);
  return (
    <button className="step-btn" disabled={disabled} title={title} {...(disabled ? {} : handlers)}>
      {children}
    </button>
  );
}

function JogBtn({ children, onClick, disabled, speed, className = "" }) {
  const handlers = useLongPress(onClick, speed);
  return (
    <button className={`jog-btn ${className}`} disabled={disabled} {...(disabled ? {} : handlers)}>
      {children}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [connState, setConnState] = useState("disconnected");
  const [estopped,  setEstopped]  = useState(false);
  const [joints,    setJoints]    = useState(initJoints());
  const [feedback,  setFeedback]  = useState(initJoints());
  const [speed,     setSpeed]     = useState(1);
  const [logs,      setLogs]      = useState([]);
  const [wsUrl,     setWsUrl]     = useState(`ws://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:9090`);
  const [pubHz,     setPubHz]     = useState(0);

  const rosRef        = useRef(null);
  const publisherRef  = useRef(null);
  const subscriberRef = useRef(null);
  const pubCountRef   = useRef(0);
  const hzTimerRef    = useRef(null);
  const estoppedRef   = useRef(estopped);

  // Keep a ref of estop so intervals can check it instantly
  useEffect(() => { estoppedRef.current = estopped; }, [estopped]);

  // Logging
  const addLog = useCallback((msg, type = "info") => {
    setLogs((prev) => [{ msg, type, time: ts() }, ...prev.slice(0, 59)]);
  }, []);

  // Hz counter
  useEffect(() => {
    hzTimerRef.current = setInterval(() => {
      setPubHz(pubCountRef.current);
      pubCountRef.current = 0;
    }, 1000);
    return () => clearInterval(hzTimerRef.current);
  }, []);

  // Connect
  const connect = useCallback(() => {
    const ROSLIB = window.ROSLIB;
    if (!ROSLIB) { addLog("roslib.js not loaded", "error"); return; }
    if (rosRef.current) rosRef.current.close();

    setConnState("connecting");
    addLog(`Connecting to ${wsUrl} …`, "warn");
    const ros = new ROSLIB.Ros({ url: wsUrl });
    rosRef.current = ros;

    ros.on("connection", () => {
      setConnState("connected");
      addLog("WebSocket connected — ROS2 bridge online", "success");
      publisherRef.current = new ROSLIB.Topic({ ros, name: "/joint_commands", messageType: "sensor_msgs/JointState" });
      subscriberRef.current = new ROSLIB.Topic({ ros, name: "/joint_states", messageType: "sensor_msgs/JointState" });
      subscriberRef.current.subscribe((msg) => {
        if (msg.name && msg.position) {
          const fb = {};
          msg.name.forEach((n, i) => { fb[n] = (msg.position[i] * 180) / Math.PI; });
          setFeedback((prev) => ({ ...prev, ...fb }));
        }
      });
    });

    ros.on("error", (e) => addLog(`Error: ${e?.message ?? e}`, "error"));
    ros.on("close", () => {
      setConnState("disconnected");
      addLog("Connection closed", "warn");
      publisherRef.current  = null;
      subscriberRef.current = null;
    });
  }, [wsUrl, addLog]);

  const disconnect = useCallback(() => {
    if (rosRef.current) { rosRef.current.close(); rosRef.current = null; }
  }, []);

  // Publish
  const publish = useCallback((overrideJoints) => {
    if (!publisherRef.current || estopped) return;
    const j = overrideJoints ?? joints;
    const speedMult = [0.3, 1.0, 2.0][speed];
    const ROSLIB = window.ROSLIB;
    const msg = new ROSLIB.Message({
      name:     JOINTS.map((jt) => jt.id),
      position: JOINTS.map((jt) => (j[jt.id] * Math.PI) / 180),
      velocity: JOINTS.map(() => speedMult),
      effort:   [],
    });
    publisherRef.current.publish(msg);
    pubCountRef.current += 1;
  }, [joints, estopped, speed]);

  // E-STOP
  const handleEstop = useCallback(() => {
    setEstopped(true);
    addLog("⚠ EMERGENCY STOP ACTIVATED", "error");
    if (publisherRef.current && window.ROSLIB) {
      const msg = new window.ROSLIB.Message({
        name: JOINTS.map((j) => j.id),
        position: JOINTS.map((j) => (joints[j.id] * Math.PI) / 180),
        velocity: JOINTS.map(() => 0), effort: JOINTS.map(() => 0),
      });
      publisherRef.current.publish(msg);
    }
  }, [joints, addLog]);

  const handleResume = useCallback(() => {
    setEstopped(false);
    addLog("EMERGENCY STOP cleared — motion resumed", "success");
  }, [addLog]);

  // Use Functional State Updates to avoid stale closures in hold-to-jog!
  const stepJoint = useCallback((id, delta) => {
    if (estoppedRef.current) return;
    setJoints((prev) => {
      const joint = JOINTS.find((j) => j.id === id);
      const clamped = clamp(prev[id] + delta, joint.min, joint.max);
      return { ...prev, [id]: clamped };
    });
  }, []);

  const setJointAbsolute = useCallback((id, value) => {
    if (estoppedRef.current) return;
    setJoints((prev) => {
      const joint = JOINTS.find((j) => j.id === id);
      return { ...prev, [id]: clamp(value, joint.min, joint.max) };
    });
  }, []);

  // Publish on joint change
  useEffect(() => { if (connState === "connected" && !estopped) publish(joints); }, [joints]); // eslint-disable-line

  const applyPreset = useCallback((preset) => {
    if (estopped) return;
    setJoints(preset.values);
    addLog(`Preset applied: ${preset.name}`, "info");
  }, [estopped, addLog]);

  const resetAll = useCallback(() => {
    setJoints(initJoints());
    addLog("All axes reset to 0°", "info");
  }, [addLog]);

  const maxError = Math.max(...JOINTS.map((j) => Math.abs((joints[j.id] || 0) - (feedback[j.id] || 0))));
  const anyNearLimit = JOINTS.some((j) => nearLimit(joints[j.id], j));

  return (
    <>
      <style>{styles}</style>
      {estopped && (
        <>
          <div className="estop-overlay" />
          <div className="estop-banner">⬛ EMERGENCY STOP ACTIVE — ALL MOTION HALTED</div>
        </>
      )}

      <div className="arm-root">
        {/* Header */}
        <header className="header">
          <div className="header-brand">
            <div className={`header-brand-dot ${connState !== "connected" ? "offline" : ""}`} />
            ARM · CONTROL
          </div>
          <div className="header-meta">
            <div className={`conn-badge ${connState}`}>
              <div className="conn-dot" />
              {connState === "connected" ? "ONLINE" : connState === "connecting" ? "CONNECTING" : "OFFLINE"}
            </div>
            {estopped ? (
              <button className="btn btn-success" style={{ padding: "5px 16px", fontSize: 11 }} onClick={handleResume}>
                CLEAR EMERGENCY
              </button>
            ) : (
              <button className="estop-btn" onClick={handleEstop}>⬛ EMERGENCY STOP</button>
            )}
          </div>
        </header>

        {/* Main */}
        <div className="main">
          {/* Left Sidebar */}
          <aside className="sidebar-left">
            <div className="section-label">Connection</div>
            <div className="conn-form">
              <div>
                <div className="field-label">Robot IP / WebSocket URL</div>
                <input
                  className="field-input" value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  disabled={connState === "connected"} spellCheck={false}
                />
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button 
                  className="btn btn-primary" 
                  onClick={connect} 
                  disabled={connState === "connected" || connState === "connecting"}
                >
                  {connState === "connecting" ? "Connecting…" : "Connect"}
                </button>
                <button 
                  className="btn btn-ghost" 
                  onClick={disconnect} 
                  disabled={connState === "disconnected"}
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="section-label">Speed</div>
            <div className="speed-selector">
              {SPEED_LEVELS.map((s, i) => (
                <button key={s} className={`speed-btn ${speed === i ? "active" : ""}`} onClick={() => setSpeed(i)}>{s}</button>
              ))}
            </div>

            <div className="section-label">Presets</div>
            <div className="preset-grid">
              {PRESETS.map((p) => (
                <button key={p.name} className="preset-btn" onClick={() => applyPreset(p)} disabled={estopped || connState !== "connected"}>
                  <span className="icon">{p.icon}</span> {p.name}
                </button>
              ))}
            </div>

            <div className="section-label">Arm Preview</div>
            <ArmViz joints={joints} />
          </aside>

          {/* Center Panel (Side-by-Side Grid) */}
          <main className="center-panel">
            <div className="control-grid">
              
              {/* Left Column: Joints */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Joint Controls</span>
                  <span className="card-tag">sensor_msgs/JointState</span>
                </div>
                {JOINTS.map((j) => {
                  const val     = joints[j.id];
                  const fill    = sliderFill(val, j.min, j.max, j.color);
                  const isNear  = nearLimit(val, j);
                  const isAt    = atLimit(val, j);
                  const rowCls  = isAt ? "joint-row at-limit" : isNear ? "joint-row near-limit" : "joint-row";
                  const valCls  = isAt ? "joint-value at-limit" : isNear ? "joint-value near-limit" : "joint-value";
                  const sldCls  = isAt ? "limit-slider" : isNear ? "warn-slider" : "";
                  const inpCls  = isAt ? "num-input limit-input" : isNear ? "num-input warn-input" : "num-input";
                  const step    = JOG_STEP_DEG[speed];

                  return (
                    <div className={rowCls} key={j.id}>
                      <div className="joint-header">
                        <div className="joint-name">
                          <div className="joint-color-dot" style={{ background: j.color }} />
                          {j.label}
                          {isAt   && <span className="limit-badge at">AT LIMIT</span>}
                          {!isAt && isNear && <span className="limit-badge near">NEAR LIMIT</span>}
                        </div>
                        <div className={valCls} style={isNear || isAt ? {} : { color: j.color }}>
                          {val.toFixed(1)}{j.unit}
                        </div>
                      </div>

                      <div className="joint-range">
                        <span className="joint-min">{j.min}</span>
                        <div className="slider-wrap">
                          <div className="slider-track" />
                          <div className="slider-fill" style={fill} />
                          <input
                            type="range" className={sldCls}
                            min={j.min} max={j.max} step="0.5" value={val}
                            onChange={(e) => setJointAbsolute(j.id, e.target.value)}
                            disabled={estopped || connState !== "connected"}
                          />
                        </div>
                        <span className="joint-max">{j.max}</span>
                      </div>

                      <div className="joint-input">
                        <StepBtn speed={speed} onClick={() => stepJoint(j.id, -step)} disabled={estopped || connState !== "connected"}>−</StepBtn>
                        <input
                          className={inpCls} type="number" value={val.toFixed(1)}
                          min={j.min} max={j.max} step="0.5"
                          onChange={(e) => setJointAbsolute(j.id, e.target.value)}
                          disabled={estopped || connState !== "connected"}
                        />
                        <StepBtn speed={speed} onClick={() => stepJoint(j.id, step)} disabled={estopped || connState !== "connected"}>+</StepBtn>
                        <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>{j.unit}</span>
                        <button
                          className="step-btn" style={{ marginLeft: "auto" }}
                          onClick={() => setJointAbsolute(j.id, 0)}
                          disabled={estopped || connState !== "connected"} title="Zero this joint"
                        >⊙</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Cartesian & Log */}
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Cartesian Jog</span>
                    <span className="card-tag">Step: {JOG_STEP_DEG[speed]}°</span>
                  </div>
                  {[
                    { axis: "X", label: "Base / Yaw",  color: "#00D4FF", dir: ["←", "→"], mapId: "joint_1" },
                    { axis: "Y", label: "Shoulder",    color: "#00FF9D", dir: ["↓", "↑"], mapId: "joint_2" },
                    { axis: "Z", label: "Elbow",       color: "#FFB800", dir: ["←", "→"], mapId: "joint_3" },
                  ].map(({ axis, label, color, dir, mapId }) => (
                    <div key={axis} style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                        {axis} — {label}
                      </div>
                      <div className="cart-grid">
                        <JogBtn speed={speed} onClick={() => stepJoint(mapId, -JOG_STEP_DEG[speed])} disabled={estopped || connState !== "connected"}>
                          <span className="jog-arrow">{dir[0]}</span> <span>{axis}−</span>
                        </JogBtn>
                        <div className="jog-btn center">{axis}<br />hold = jog</div>
                        <JogBtn speed={speed} onClick={() => stepJoint(mapId, JOG_STEP_DEG[speed])} disabled={estopped || connState !== "connected"}>
                          <span className="jog-arrow">{dir[1]}</span> <span>{axis}+</span>
                        </JogBtn>
                      </div>
                    </div>
                  ))}
                  <div style={{ padding: 12 }}>
                    <button className="btn btn-outline" style={{ width: "100%" }} onClick={resetAll} disabled={estopped || connState !== "connected"}>
                      Zero All Axes
                    </button>
                  </div>
                </div>

                <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <div className="card-header">
                    <span className="card-title">System Log</span>
                    <button className="card-tag" style={{ cursor: "pointer" }} onClick={() => setLogs([])}>Clear</button>
                  </div>
                  <div className="log-wrap" style={{ flex: 1 }}>
                    {logs.length === 0 && (
                      <div className="log-entry"><span className="log-time">{ts()}</span> <span className="log-msg">Waiting for connection…</span></div>
                    )}
                    {logs.map((l, i) => (
                      <div className="log-entry" key={i}><span className="log-time">{l.time}</span> <span className={`log-msg ${l.type}`}>{l.msg}</span></div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <RosDiagnosticsDashboard 
                    rosConnected={connState === "connected"} 
                    rosInstance={rosRef.current} 
                  />
                </div>
              </div>

            </div>
          </main>

          {/* Right Sidebar */}
          <aside className="sidebar-right">
            <div className="section-label">Telemetry</div>
            <div className="card" style={{ margin: "0 12px 12px" }}>
              <div className="telem-grid">
                <div className="telem-cell"><div className="telem-label">Status</div><div className={`telem-value ${connState === "connected" ? "ok" : "err"}`}>{connState === "connected" ? "LIVE" : "OFFLINE"}</div></div>
                <div className="telem-cell"><div className="telem-label">Pub Rate</div><div className="telem-value">{pubHz}<span style={{ fontSize: 11, color: "var(--text-muted)" }}> Hz</span></div></div>
                <div className="telem-cell"><div className="telem-label">Speed</div><div className={`telem-value ${speed === 2 ? "warn" : ""}`}>{SPEED_LEVELS[speed]}</div></div>
                <div className="telem-cell"><div className="telem-label">Max Error</div><div className={`telem-value ${maxError > 5 ? "warn" : "ok"}`}>{maxError.toFixed(1)}<span style={{ fontSize: 11, color: "var(--text-muted)" }}>°</span></div></div>
                <div className="telem-cell"><div className="telem-label">Limits</div><div className={`telem-value ${anyNearLimit ? "warn" : "ok"}`}>{anyNearLimit ? "WARN" : "OK"}</div></div>
                <div className="telem-cell"><div className="telem-label">E-Stop</div><div className={`telem-value ${estopped ? "err" : "ok"}`}>{estopped ? "ACTIVE" : "CLEAR"}</div></div>
              </div>
            </div>

            <div className="section-label">Feedback vs Command</div>
            <div className="card" style={{ margin: "0 12px 12px" }}>
              {JOINTS.map((j) => {
                const cmd = joints[j.id] ?? 0;
                const fb  = feedback[j.id] ?? 0;
                const err = Math.abs(cmd - fb);
                return (
                  <div key={j.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{j.label}</span>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: err > 3 ? "var(--warn)" : "var(--text-dim)" }}>Δ{err.toFixed(1)}{j.unit}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: j.color }}>CMD {cmd.toFixed(1)}{j.unit}</span>
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 12, color: "var(--text-muted)" }}>FB {fb.toFixed(1)}{j.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="section-label">Emergency</div>
            <div style={{ padding: "0 12px 12px" }}>
              <button className="btn btn-danger" style={{ width: "100%", padding: "12px", fontSize: 13 }} onClick={handleEstop} disabled={estopped}>
                ⬛ EMERGENCY STOP
              </button>
            </div>
          </aside>
        </div>

        <div className="status-strip">
          <div className={`status-dot ${connState === "connected" ? "ok" : connState === "connecting" ? "warn" : "err"}`} />
          <span>ros2 bridge</span><span style={{ color: "var(--text-dim)" }}>·</span>
          <span style={{ color: "var(--text-dim)" }}>{wsUrl}</span>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>ARM·CTRL v1.2 · {ts()}</span>
        </div>
      </div>
    </>
  );
}