import { useState, useEffect, useRef, useCallback } from "react";

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
const JOG_INTERVAL = [120, 60, 30];
const JOG_STEP_DEG = [1, 2, 5];

const initJoints = () => Object.fromEntries(JOINTS.map((j) => [j.id, 0]));
function nearLimit(v, j) { return v <= j.min + LIMIT_WARN_ZONE || v >= j.max - LIMIT_WARN_ZONE; }
function atLimit(v, j)   { return v <= j.min || v >= j.max; }
function ts() { return new Date().toLocaleTimeString("en-GB", { hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" }); }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, Number(v))); }
function sliderFill(value, min, max, color) {
  const pct = (v) => ((v-min)/(max-min))*100;
  const z = pct(clamp(0,min,max)), vp = pct(value);
  return { left:`${Math.min(z,vp)}%`, width:`${Math.abs(z-vp)}%`, background:color };
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }

  :root {
    --bg-base:    #080C10;
    --bg-panel:   #0D1117;
    --bg-card:    #111820;
    --bg-hover:   #18222E;
    --border:     #1E2D3D;
    --border-lt:  #253545;
    --text-hi:    #E6EDF3;
    --text-mid:   #8B949E;
    --text-lo:    #3D4E5E;
    --cyan:       #00D4FF;
    --cyan-dim:   rgba(0,212,255,0.12);
    --red:        #FF3B3B;
    --red-dim:    rgba(255,59,59,0.15);
    --green:      #00FF9D;
    --green-dim:  rgba(0,255,157,0.1);
    --amber:      #FFB800;
    --amber-dim:  rgba(255,184,0,0.12);
    --r:          8px;
    --r-lg:       12px;
  }

  body { background:var(--bg-base); color:var(--text-hi); font-family:'Inter',sans-serif; font-size:13px; line-height:1.5; min-height:100vh; overflow-x:hidden; }

  /* ── Root shell ── */
  .shell { display:grid; grid-template-rows:52px 1fr 28px; height:100vh; overflow:hidden; }

  /* ── Header ── */
  .hdr {
    display:flex; align-items:center; justify-content:space-between;
    padding:0 20px; background:var(--bg-panel); border-bottom:1px solid var(--border);
    position:sticky; top:0; z-index:100;
  }
  .hdr-brand { display:flex; align-items:center; gap:8px; font-family:'JetBrains Mono',monospace; font-weight:600; font-size:14px; letter-spacing:.05em; color:var(--cyan); }
  .brand-dot { width:7px; height:7px; border-radius:50%; background:var(--cyan); box-shadow:0 0 7px var(--cyan); animation:blink 2s infinite; }
  .brand-dot.off { background:var(--text-lo); box-shadow:none; animation:none; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes fw { 0%,100%{border-color:var(--amber);background:var(--amber-dim)} 50%{border-color:#FF6B00;background:rgba(255,107,0,.2)} }
  @keyframes fd { 0%,100%{border-color:var(--red);background:var(--red-dim)} 50%{border-color:#F00;background:rgba(255,0,0,.25)} }

  .hdr-right { display:flex; align-items:center; gap:10px; }

  .badge {
    display:flex; align-items:center; gap:5px; padding:3px 11px;
    border-radius:20px; font-size:10px; font-weight:600;
    font-family:'JetBrains Mono',monospace; letter-spacing:.07em; text-transform:uppercase;
    border:1px solid transparent; transition:all .3s;
  }
  .badge.connected    { color:var(--green); border-color:var(--green); background:var(--green-dim); }
  .badge.disconnected { color:var(--text-mid); border-color:var(--border); }
  .badge.connecting   { color:var(--amber); border-color:var(--amber); background:var(--amber-dim); }
  .badge-dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
  .badge.connected .badge-dot { animation:blink 1.5s infinite; }

  .hdr-btn {
    padding:5px 13px; border-radius:var(--r); font-size:11px; font-weight:600;
    font-family:'JetBrains Mono',monospace; letter-spacing:.05em;
    cursor:pointer; transition:all .15s; border:1.5px solid transparent;
  }
  .hdr-btn.disc { background:transparent; color:var(--text-mid); border-color:var(--border-lt); }
  .hdr-btn.disc:hover { border-color:var(--red); color:var(--red); }
  .hdr-btn.estop { background:var(--red-dim); border-color:var(--red); color:var(--red); }
  .hdr-btn.estop:hover { background:var(--red); color:#fff; }
  .hdr-btn.resume { background:var(--green-dim); border-color:var(--green); color:var(--green); }
  .hdr-btn.resume:hover { background:var(--green); color:var(--bg-base); }
  .hdr-btn:active { transform:scale(.97); }

  /* ── Three-column layout ──
     Left sidebar: fixed 220px (tight)
     Center:       flex-fill
     Right sidebar: fixed 220px (tight)                    */
  .body { display:grid; grid-template-columns:220px 1fr 220px; height:100%; overflow:hidden; }

  .side {
    background:var(--bg-panel); overflow-y:auto;
    scrollbar-width:thin; scrollbar-color:var(--border) transparent;
  }
  .side-l { border-right:1px solid var(--border); }
  .side-r { border-left:1px solid var(--border); }

  .center { overflow-y:auto; padding:16px 20px; display:flex; flex-direction:column; gap:16px; }

  /* ── Section label ── */
  .slabel {
    font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700;
    letter-spacing:.16em; text-transform:uppercase; color:var(--text-lo);
    padding:14px 14px 6px;
  }

  /* ── Card ── */
  .card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--r-lg); overflow:hidden; }
  .card + .card { margin-top:0; }
  .card-hdr {
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 14px; border-bottom:1px solid var(--border);
    background:rgba(255,255,255,.01);
  }
  .card-title { font-size:11px; font-weight:700; color:var(--text-hi); letter-spacing:.04em; text-transform:uppercase; }
  .card-tag {
    font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--text-mid);
    background:var(--bg-panel); padding:2px 7px; border-radius:4px; border:1px solid var(--border);
  }

  /* ── Connection form ── */
  .conn-form { padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
  .flabel { font-size:10px; color:var(--text-mid); font-weight:500; margin-bottom:3px; }
  .finput {
    width:100%; background:var(--bg-base); border:1px solid var(--border); border-radius:var(--r);
    color:var(--text-hi); font-family:'JetBrains Mono',monospace; font-size:11px;
    padding:6px 10px; outline:none; transition:all .2s;
  }
  .finput:focus { border-color:var(--cyan); box-shadow:0 0 0 2px var(--cyan-dim); }
  .conn-btns { display:flex; gap:6px; }
  .cbtn {
    flex:1; padding:7px 10px; border-radius:var(--r); font-size:11px; font-weight:600;
    cursor:pointer; transition:all .15s; border:1.5px solid transparent; text-align:center;
  }
  .cbtn:disabled { opacity:.35; cursor:not-allowed; }
  .cbtn.connect    { background:var(--green-dim); color:var(--green); border-color:var(--green); }
  .cbtn.connect:hover:not(:disabled) { background:var(--green); color:var(--bg-base); }
  .cbtn.dcnt       { background:transparent; color:var(--text-mid); border-color:var(--border-lt); }
  .cbtn.dcnt:hover:not(:disabled) { border-color:var(--red); color:var(--red); }

  /* ── Speed ── */
  .speed-row { display:flex; padding:8px 12px; gap:5px; }
  .spd {
    flex:1; padding:5px; background:var(--bg-panel); border:1px solid var(--border);
    border-radius:var(--r); color:var(--text-mid); font-size:10px; font-weight:600;
    cursor:pointer; text-align:center; transition:all .15s;
  }
  .spd.on { background:var(--cyan-dim); border-color:var(--cyan); color:var(--cyan); }
  .spd:hover:not(.on) { border-color:var(--border-lt); color:var(--text-hi); }

  /* ── Presets ── */
  .preset-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; padding:8px 12px; }
  .pbtn {
    display:flex; flex-direction:column; align-items:center; gap:3px;
    padding:8px 6px; background:var(--bg-panel); border:1px solid var(--border);
    border-radius:var(--r); color:var(--text-mid); cursor:pointer;
    font-size:10px; font-weight:500; transition:all .15s;
  }
  .pbtn:hover:not(:disabled) { border-color:var(--cyan); color:var(--cyan); background:var(--cyan-dim); }
  .pbtn:disabled { opacity:.3; cursor:not-allowed; }
  .pbtn .icon { font-size:14px; }

  /* ── Arm viz ── */
  .viz-wrap { padding:10px 12px 12px; }
  .viz-legend { display:flex; flex-wrap:wrap; gap:5px; justify-content:center; margin-top:6px; }
  .vli { display:flex; align-items:center; gap:3px; font-size:9px; color:var(--text-mid); }
  .vld { width:8px; height:3px; border-radius:2px; }

  /* ── Joint controls ── */
  .joint-row { padding:12px 14px; border-bottom:1px solid var(--border); transition:background .15s; }
  .joint-row:last-child { border-bottom:none; }
  .joint-row:hover { background:var(--bg-hover); }
  .joint-row.near { animation:fw 1.2s ease-in-out infinite; border-left:3px solid var(--amber); }
  .joint-row.at   { animation:fd  .7s ease-in-out infinite; border-left:3px solid var(--red); }

  .jhdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; }
  .jname { display:flex; align-items:center; gap:7px; font-size:11px; font-weight:500; }
  .jdot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
  .jval { font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:700; min-width:56px; text-align:right; transition:color .2s; }
  .jval.near { color:var(--amber)!important; }
  .jval.at   { color:var(--red)!important; }

  .lbadge { font-family:'JetBrains Mono',monospace; font-size:8px; font-weight:700; letter-spacing:.1em; padding:1px 5px; border-radius:3px; text-transform:uppercase; }
  .lbadge.near { background:var(--amber-dim); color:var(--amber); border:1px solid var(--amber); }
  .lbadge.at   { background:var(--red-dim);   color:var(--red);   border:1px solid var(--red); }

  .jrange { display:flex; align-items:center; gap:7px; }
  .jmin, .jmax { font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--text-lo); width:28px; }
  .jmax { text-align:right; }
  .swrap { flex:1; position:relative; height:18px; display:flex; align-items:center; }
  .strack { position:absolute; left:0; right:0; height:3px; background:var(--border-lt); border-radius:2px; }
  .sfill  { position:absolute; height:3px; border-radius:2px; transition:width .05s,left .05s; }

  input[type="range"] { position:relative; width:100%; height:18px; appearance:none; background:transparent; cursor:pointer; z-index:1; }
  input[type="range"]::-webkit-slider-thumb { appearance:none; width:13px; height:13px; border-radius:50%; background:var(--text-hi); border:2px solid var(--cyan); box-shadow:0 0 5px rgba(0,212,255,.4); transition:transform .1s,box-shadow .1s; }
  input[type="range"]:hover::-webkit-slider-thumb { transform:scale(1.2); box-shadow:0 0 11px rgba(0,212,255,.6); }
  input[type="range"].ws::-webkit-slider-thumb { border-color:var(--amber); box-shadow:0 0 7px rgba(255,184,0,.5); }
  input[type="range"].ls::-webkit-slider-thumb { border-color:var(--red);   box-shadow:0 0 7px rgba(255,59,59,.6); }
  input[type="range"]:disabled::-webkit-slider-thumb { border-color:var(--text-lo); box-shadow:none; }
  input[type="range"]:disabled { cursor:not-allowed; opacity:.4; }

  .jinput { margin-top:5px; display:flex; align-items:center; gap:5px; }
  .numinp {
    width:62px; background:var(--bg-panel); border:1px solid var(--border); border-radius:5px;
    color:var(--text-hi); font-family:'JetBrains Mono',monospace; font-size:11px;
    padding:3px 6px; text-align:center; outline:none; transition:border-color .15s;
  }
  .numinp:focus { border-color:var(--cyan); }
  .numinp.wi { border-color:var(--amber); color:var(--amber); }
  .numinp.li { border-color:var(--red);   color:var(--red); }
  .numinp:disabled { opacity:.4; cursor:not-allowed; }

  .sbtn {
    width:26px; height:26px; display:flex; align-items:center; justify-content:center;
    background:var(--bg-panel); border:1px solid var(--border); border-radius:5px;
    color:var(--text-mid); cursor:pointer; font-size:14px;
    transition:all .1s; user-select:none; -webkit-user-select:none; touch-action:none;
  }
  .sbtn:hover:not([disabled]) { border-color:var(--cyan); color:var(--cyan); background:var(--cyan-dim); }
  .sbtn:active:not([disabled]) { transform:scale(.9); }
  .sbtn[disabled] { opacity:.3; cursor:not-allowed; }

  /* ── Cartesian jog ── */
  .jog-axis { padding:8px 12px; border-bottom:1px solid var(--border); }
  .jog-axis:last-of-type { border-bottom:none; }
  .axis-label { font-size:10px; color:var(--text-mid); margin-bottom:5px; display:flex; align-items:center; gap:5px; }
  .axis-dot { width:5px; height:5px; border-radius:50%; }
  .jog-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; }
  .jbtn {
    padding:9px 5px; background:var(--bg-panel); border:1px solid var(--border);
    border-radius:var(--r); color:var(--text-mid); font-size:10px; font-weight:600;
    cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:3px;
    transition:all .15s; user-select:none; -webkit-user-select:none; touch-action:none;
  }
  .jbtn:hover:not([disabled]) { border-color:var(--cyan); color:var(--cyan); background:var(--cyan-dim); }
  .jbtn:active:not([disabled]) { transform:scale(.93); }
  .jbtn.mid { background:var(--bg-card); color:var(--text-lo); cursor:default; font-size:9px; }
  .jbtn[disabled] { opacity:.3; cursor:not-allowed; }
  .jarr { font-size:16px; }

  /* ── Log ── */
  .log-wrap {
    font-family:'JetBrains Mono',monospace; font-size:10px;
    max-height:180px; overflow-y:auto;
    scrollbar-width:thin; scrollbar-color:var(--border) transparent;
    display:flex; flex-direction:column-reverse;
  }
  .lentry { display:flex; gap:9px; padding:4px 12px; border-top:1px solid var(--border); align-items:baseline; }
  .lentry:hover { background:var(--bg-hover); }
  .ltime { color:var(--text-lo); flex-shrink:0; }
  .lmsg           { color:var(--text-mid); }
  .lmsg.info      { color:var(--cyan); }
  .lmsg.success   { color:var(--green); }
  .lmsg.warn      { color:var(--amber); }
  .lmsg.error     { color:var(--red); }

  /* ── Telemetry (right sidebar) ── */
  .tgrid { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--border); }
  .tcell { background:var(--bg-card); padding:10px 12px; }
  .tlabel { font-size:9px; font-family:'JetBrains Mono',monospace; color:var(--text-lo); letter-spacing:.1em; text-transform:uppercase; margin-bottom:3px; }
  .tval { font-family:'JetBrains Mono',monospace; font-size:16px; font-weight:700; color:var(--text-hi); line-height:1; }
  .tval.ok   { color:var(--green); }
  .tval.warn { color:var(--amber); }
  .tval.err  { color:var(--red); }

  /* Feedback rows */
  .fb-row { padding:8px 12px; border-bottom:1px solid var(--border); }
  .fb-row:last-child { border-bottom:none; }
  .fb-top { display:flex; justify-content:space-between; margin-bottom:3px; }
  .fb-bot { display:flex; justify-content:space-between; }

  /* ── Right sidebar action btns ── */
  .r-btn {
    width:100%; padding:10px; border-radius:var(--r); font-size:11px; font-weight:700;
    font-family:'JetBrains Mono',monospace; letter-spacing:.05em;
    cursor:pointer; transition:all .15s; border:1.5px solid transparent; text-align:center;
  }
  .r-btn:active { transform:scale(.97); }
  .r-btn:disabled { opacity:.35; cursor:not-allowed; }
  .r-btn.danger  { background:var(--red-dim);   color:var(--red);   border-color:var(--red); }
  .r-btn.danger:hover:not(:disabled)  { background:var(--red);   color:#fff; }
  .r-btn.success { background:var(--green-dim); color:var(--green); border-color:var(--green); }
  .r-btn.success:hover:not(:disabled) { background:var(--green); color:var(--bg-base); }
  .r-btn.ghost   { background:transparent; color:var(--text-mid); border-color:var(--border-lt); }
  .r-btn.ghost:hover:not(:disabled)   { border-color:var(--cyan); color:var(--cyan); }

  /* ── Two-column center grid ── */
  .cgrid { display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
  .cright { display:flex; flex-direction:column; gap:16px; }

  /* ── Status strip ── */
  .strip {
    display:flex; align-items:center; gap:8px; padding:0 14px;
    background:var(--bg-base); border-top:1px solid var(--border);
    font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--text-mid);
  }
  .sdot { width:5px; height:5px; border-radius:50%; background:var(--text-lo); flex-shrink:0; }
  .sdot.ok   { background:var(--green); box-shadow:0 0 5px var(--green); }
  .sdot.warn { background:var(--amber); }
  .sdot.err  { background:var(--red); animation:blink .8s infinite; }

  /* ── E-STOP overlay ── */
  .estop-ov { position:fixed; inset:0; background:rgba(255,59,59,.07); border:3px solid var(--red); pointer-events:none; z-index:999; animation:epulse .5s ease-in-out infinite alternate; }
  @keyframes epulse { from{opacity:.5} to{opacity:1} }
  .estop-banner { position:fixed; top:52px; left:50%; transform:translateX(-50%); background:var(--red); color:#fff; font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:700; letter-spacing:.1em; padding:6px 24px; border-radius:0 0 8px 8px; z-index:1000; }

  ::-webkit-scrollbar { width:3px; }
  ::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }

  /* responsive */
  @media (max-width:1100px) { .cgrid { grid-template-columns:1fr; } }
  @media (max-width:900px)  { .body  { grid-template-columns:200px 1fr; } .side-r { display:none; } }
  @media (max-width:640px)  { .body  { grid-template-columns:1fr; }      .side-l { display:none; } }
`;

// ─── Long-press hook ──────────────────────────────────────────────────────────
function useLongPress(callback, speed) {
  const cbRef  = useRef(callback);
  const ivRef  = useRef(null);
  const toRef  = useRef(null);
  useEffect(() => { cbRef.current = callback; }, [callback]);

  const start = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();
    cbRef.current();
    toRef.current = setTimeout(() => {
      ivRef.current = setInterval(() => cbRef.current(), JOG_INTERVAL[speed]);
    }, 300);
  }, [speed]);

  const stop = useCallback(() => {
    clearTimeout(toRef.current);
    clearInterval(ivRef.current);
  }, []);

  useEffect(() => () => stop(), [stop]);
  return { onMouseDown:start, onMouseUp:stop, onMouseLeave:stop, onTouchStart:start, onTouchEnd:stop };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StepBtn({ children, onClick, disabled, speed, title, style }) {
  const h = useLongPress(onClick, speed);
  return <button className="sbtn" disabled={disabled} title={title} style={style} {...(disabled ? {} : h)}>{children}</button>;
}

function JogBtn({ children, onClick, disabled, speed, cls="" }) {
  const h = useLongPress(onClick, speed);
  return <button className={`jbtn ${cls}`} disabled={disabled} {...(disabled ? {} : h)}>{children}</button>;
}

function ArmViz({ joints }) {
  const cx=110, cy=115, toR=(d)=>(d*Math.PI)/180;
  const sa=toR(joints.joint_2-90), ea=toR(joints.joint_2+joints.joint_3-90);
  const wa=toR(joints.joint_2+joints.joint_3+joints.joint_4-90), ba=toR(joints.joint_1);
  const L1=50,L2=36,L3=21;
  const x1=cx+L1*Math.cos(sa), y1=cy+L1*Math.sin(sa);
  const x2=x1+L2*Math.cos(ea), y2=y1+L2*Math.sin(ea);
  const x3=x2+L3*Math.cos(wa), y3=y2+L3*Math.sin(wa);
  const g=joints.joint_6/100, m=(a,b)=>(a+b)/2;
  return (
    <div className="viz-wrap">
      <svg viewBox="0 0 220 220" style={{width:"100%"}}>
        <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0L0,0L0,20" fill="none" stroke="#1E2D3D" strokeWidth=".5"/></pattern></defs>
        <rect width="220" height="220" fill="url(#g)" rx="8"/>
        <circle cx={cx} cy={cy} r="92" fill="none" stroke="#1E2D3D" strokeWidth=".5" strokeDasharray="4 4"/>
        <circle cx={cx} cy={cy} r="55" fill="none" stroke="#1E2D3D" strokeWidth=".5" strokeDasharray="2 6"/>
        <line x1={cx} y1={cy} x2={cx+92*Math.cos(ba)} y2={cy+92*Math.sin(ba)} stroke="#00D4FF" strokeWidth=".7" strokeDasharray="3 3" opacity=".22"/>
        <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#00D4FF" strokeWidth="8" strokeLinecap="round" opacity=".07"/>
        <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#00D4FF" strokeWidth="4" strokeLinecap="round"/>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00FF9D" strokeWidth="7" strokeLinecap="round" opacity=".07"/>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00FF9D" strokeWidth="3" strokeLinecap="round"/>
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#FFB800" strokeWidth="5" strokeLinecap="round" opacity=".1"/>
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#FFB800" strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="7" fill="#0D1117" stroke="#00D4FF" strokeWidth="2"/><circle cx={cx} cy={cy} r="2.5" fill="#00D4FF"/>
        <circle cx={x1} cy={y1} r="5" fill="#0D1117" stroke="#00FF9D" strokeWidth="1.5"/><circle cx={x1} cy={y1} r="2" fill="#00FF9D"/>
        <circle cx={x2} cy={y2} r="4" fill="#0D1117" stroke="#FFB800" strokeWidth="1.5"/><circle cx={x2} cy={y2} r="1.8" fill="#FFB800"/>
        <line x1={x3} y1={y3} x2={x3+9*Math.cos(wa+.3+g*.5)} y2={y3+9*Math.sin(wa+.3+g*.5)} stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round"/>
        <line x1={x3} y1={y3} x2={x3+9*Math.cos(wa-.3-g*.5)} y2={y3+9*Math.sin(wa-.3-g*.5)} stroke="#FF4D6D" strokeWidth="2" strokeLinecap="round"/>
        <circle cx={x3} cy={y3} r="2.5" fill="#FF4D6D"/>
        <text x={m(cx,x1)-8} y={m(cy,y1)-6} fontSize="8" fill="#00D4FF" fontFamily="Inter,sans-serif" fontWeight="600">Upper Arm</text>
        <text x={m(x1,x2)-6} y={m(y1,y2)-6} fontSize="8" fill="#00FF9D" fontFamily="Inter,sans-serif" fontWeight="600">Forearm</text>
        <text x={m(x2,x3)+3} y={m(y2,y3)-4} fontSize="8" fill="#FFB800" fontFamily="Inter,sans-serif" fontWeight="600">Wrist</text>
        <text x={cx-10} y={cy+20} fontSize="8" fill="#00D4FF" fontFamily="Inter,sans-serif">Base</text>
        <text x={x3+5} y={y3+3} fontSize="8" fill="#FF4D6D" fontFamily="Inter,sans-serif" fontWeight="600">Grip</text>
        <text x="3" y="216" fontSize="7" fill="#3D4E5E" fontFamily="monospace">SIDE VIEW</text>
      </svg>
      <div className="viz-legend">
        {[["#00D4FF","Upper Arm"],["#00FF9D","Forearm"],["#FFB800","Wrist"],["#FF4D6D","Gripper"]].map(([c,l])=>(
          <div className="vli" key={l}><div className="vld" style={{background:c}}/><span>{l}</span></div>
        ))}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [connState, setConnState] = useState("disconnected");
  const [estopped,  setEstopped]  = useState(false);
  const [joints,    setJoints]    = useState(initJoints());
  const [feedback,  setFeedback]  = useState(initJoints());
  const [speed,     setSpeed]     = useState(1);
  const [logs,      setLogs]      = useState([]);
  const [wsUrl,     setWsUrl]     = useState(`ws://${typeof window!=="undefined"?window.location.hostname:"localhost"}:9090`);
  const [pubHz,     setPubHz]     = useState(0);

  const rosRef       = useRef(null);
  const pubRef       = useRef(null);
  const subRef       = useRef(null);
  const cntRef       = useRef(0);
  const estRef       = useRef(false);

  useEffect(()=>{ estRef.current=estopped; },[estopped]);

  const addLog = useCallback((msg,type="info")=>{
    setLogs(p=>[{msg,type,time:ts()},...p.slice(0,59)]);
  },[]);

  useEffect(()=>{
    const t=setInterval(()=>{ setPubHz(cntRef.current); cntRef.current=0; },1000);
    return ()=>clearInterval(t);
  },[]);

  const connect = useCallback(()=>{
    const ROSLIB=window.ROSLIB;
    if(!ROSLIB){ addLog("roslib.js not loaded","error"); return; }
    if(rosRef.current) rosRef.current.close();
    setConnState("connecting");
    addLog(`Connecting to ${wsUrl} …`,"warn");
    const ros=new ROSLIB.Ros({url:wsUrl});
    rosRef.current=ros;
    ros.on("connection",()=>{
      setConnState("connected");
      addLog("ROS2 bridge connected","success");
      pubRef.current=new ROSLIB.Topic({ros,name:"/joint_commands",messageType:"sensor_msgs/JointState"});
      subRef.current=new ROSLIB.Topic({ros,name:"/joint_states",  messageType:"sensor_msgs/JointState"});
      subRef.current.subscribe(msg=>{
        if(msg.name&&msg.position){
          const fb={};
          msg.name.forEach((n,i)=>{ fb[n]=(msg.position[i]*180)/Math.PI; });
          setFeedback(p=>({...p,...fb}));
        }
      });
      addLog("Subscribed /joint_states","info");
    });
    ros.on("error",e=>addLog(`Error: ${e?.message??e}`,"error"));
    ros.on("close",()=>{ setConnState("disconnected"); addLog("Connection closed","warn"); pubRef.current=null; subRef.current=null; });
  },[wsUrl,addLog]);

  const disconnect=useCallback(()=>{ if(rosRef.current){rosRef.current.close();rosRef.current=null;} },[]);

  const publish=useCallback((ov)=>{
    if(!pubRef.current||estopped) return;
    const j=ov??joints; const sm=[.3,1,2][speed];
    const ROSLIB=window.ROSLIB;
    pubRef.current.publish(new ROSLIB.Message({
      name:JOINTS.map(jt=>jt.id),
      position:JOINTS.map(jt=>(j[jt.id]*Math.PI)/180),
      velocity:JOINTS.map(()=>sm), effort:[],
    }));
    cntRef.current+=1;
  },[joints,estopped,speed]);

  const handleEstop=useCallback(()=>{
    setEstopped(true); addLog("⚠ EMERGENCY STOP","error");
    if(pubRef.current&&window.ROSLIB){
      pubRef.current.publish(new window.ROSLIB.Message({
        name:JOINTS.map(j=>j.id),
        position:JOINTS.map(j=>(joints[j.id]*Math.PI)/180),
        velocity:JOINTS.map(()=>0), effort:JOINTS.map(()=>0),
      }));
    }
  },[joints,addLog]);

  const handleResume=useCallback(()=>{ setEstopped(false); addLog("ESTOP cleared","success"); },[addLog]);

  const stepJoint=useCallback((id,delta)=>{
    if(estRef.current) return;
    setJoints(prev=>{
      const j=JOINTS.find(x=>x.id===id);
      return {...prev,[id]:clamp(prev[id]+delta,j.min,j.max)};
    });
  },[]);

  const setJointAbs=useCallback((id,value)=>{
    if(estRef.current) return;
    setJoints(prev=>{
      const j=JOINTS.find(x=>x.id===id);
      return {...prev,[id]:clamp(value,j.min,j.max)};
    });
  },[]);

  useEffect(()=>{ if(connState==="connected"&&!estopped) publish(joints); },[joints]); // eslint-disable-line

  const applyPreset=useCallback((p)=>{ if(estopped) return; setJoints(p.values); addLog(`Preset: ${p.name}`,"info"); },[estopped,addLog]);
  const resetAll=useCallback(()=>{ setJoints(initJoints()); addLog("All axes → 0°","info"); },[addLog]);

  const maxErr=Math.max(...JOINTS.map(j=>Math.abs((joints[j.id]||0)-(feedback[j.id]||0))));
  const anyNear=JOINTS.some(j=>nearLimit(joints[j.id],j));
  const dis=estopped||connState!=="connected";

  return (
    <>
      <style>{styles}</style>
      {estopped&&<><div className="estop-ov"/><div className="estop-banner">⬛ EMERGENCY STOP — ALL MOTION HALTED</div></>}

      <div className="shell">
        {/* ── Header ── */}
        <header className="hdr">
          <div className="hdr-brand">
            <div className={`brand-dot ${connState!=="connected"?"off":""}`}/>
            ARM · CONTROL
          </div>
          <div className="hdr-right">
            <div className={`badge ${connState}`}>
              <div className="badge-dot"/>
              {connState==="connected"?"ONLINE":connState==="connecting"?"CONNECTING":"OFFLINE"}
            </div>
            {connState==="connected"&&<button className="hdr-btn disc" onClick={disconnect}>Disconnect</button>}
            {estopped
              ? <button className="hdr-btn resume" onClick={handleResume}>CLEAR ESTOP</button>
              : <button className="hdr-btn estop"  onClick={handleEstop}>⬛ E-STOP</button>
            }
          </div>
        </header>

        {/* ── Body ── */}
        <div className="body">

          {/* ── LEFT SIDEBAR (slim) ── */}
          <aside className="side side-l">
            <div className="slabel">Connection</div>
            <div className="conn-form">
              <div>
                <div className="flabel">WebSocket URL</div>
                <input className="finput" value={wsUrl} onChange={e=>setWsUrl(e.target.value)} disabled={connState==="connected"} spellCheck={false}/>
              </div>
              <div className="conn-btns">
                <button className="cbtn connect" onClick={connect} disabled={connState!=="disconnected"}>
                  {connState==="connecting"?"…":"Connect"}
                </button>
                <button className="cbtn dcnt" onClick={disconnect} disabled={connState==="disconnected"}>
                  Off
                </button>
              </div>
            </div>

            <div className="slabel">Speed</div>
            <div className="speed-row">
              {SPEED_LEVELS.map((s,i)=>(
                <button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSpeed(i)}>{s}</button>
              ))}
            </div>

            <div className="slabel">Presets</div>
            <div className="preset-grid">
              {PRESETS.map(p=>(
                <button key={p.name} className="pbtn" onClick={()=>applyPreset(p)} disabled={dis}>
                  <span className="icon">{p.icon}</span>{p.name}
                </button>
              ))}
            </div>

            <div className="slabel">Actions</div>
            <div style={{padding:"0 12px 10px",display:"flex",gap:6}}>
              <button className="r-btn ghost" style={{fontSize:10}} onClick={resetAll} disabled={dis}>Reset All</button>
              <button className="r-btn ghost" style={{fontSize:10}} onClick={()=>publish()} disabled={dis}>Publish</button>
            </div>

            <div className="slabel">Arm Preview</div>
            <ArmViz joints={joints}/>
          </aside>

          {/* ── CENTER ── */}
          <main className="center">
            <div className="cgrid">

              {/* Joint Controls */}
              <div className="card">
                <div className="card-hdr">
                  <span className="card-title">Joint Controls</span>
                  <span className="card-tag">sensor_msgs/JointState</span>
                </div>
                {JOINTS.map(j=>{
                  const val=joints[j.id];
                  const fill=sliderFill(val,j.min,j.max,j.color);
                  const isNear=nearLimit(val,j), isAt=atLimit(val,j);
                  const step=JOG_STEP_DEG[speed];
                  return (
                    <div className={`joint-row ${isAt?"at":isNear?"near":""}`} key={j.id}>
                      <div className="jhdr">
                        <div className="jname">
                          <div className="jdot" style={{background:j.color}}/>
                          {j.label}
                          {isAt&&<span className="lbadge at">AT LIMIT</span>}
                          {!isAt&&isNear&&<span className="lbadge near">NEAR</span>}
                        </div>
                        <div className={`jval ${isAt?"at":isNear?"near":""}`} style={isNear||isAt?{}:{color:j.color}}>
                          {val.toFixed(1)}{j.unit}
                        </div>
                      </div>
                      <div className="jrange">
                        <span className="jmin">{j.min}</span>
                        <div className="swrap">
                          <div className="strack"/>
                          <div className="sfill" style={fill}/>
                          <input type="range" className={isAt?"ls":isNear?"ws":""} min={j.min} max={j.max} step=".5" value={val} onChange={e=>setJointAbs(j.id,e.target.value)} disabled={dis}/>
                        </div>
                        <span className="jmax">{j.max}</span>
                      </div>
                      <div className="jinput">
                        <StepBtn speed={speed} onClick={()=>stepJoint(j.id,-step)} disabled={dis}>−</StepBtn>
                        <input className={`numinp ${isAt?"li":isNear?"wi":""}`} type="number" value={val.toFixed(1)} min={j.min} max={j.max} step=".5" onChange={e=>setJointAbs(j.id,e.target.value)} disabled={dis}/>
                        <StepBtn speed={speed} onClick={()=>stepJoint(j.id,step)} disabled={dis}>+</StepBtn>
                        <span style={{color:"var(--text-lo)",fontSize:9,marginLeft:3}}>{j.unit}</span>
                        <button className="sbtn" style={{marginLeft:"auto"}} onClick={()=>setJointAbs(j.id,0)} disabled={dis} title="Zero">⊙</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right column */}
              <div className="cright">

                {/* Cartesian */}
                <div className="card">
                  <div className="card-hdr">
                    <span className="card-title">Cartesian Jog</span>
                    <span className="card-tag">Hold = continuous · {JOG_STEP_DEG[speed]}°/tick</span>
                  </div>
                  {[
                    {axis:"X",label:"Base / Yaw",  color:"#00D4FF",id:"joint_1",dir:["←","→"]},
                    {axis:"Y",label:"Shoulder",    color:"#00FF9D",id:"joint_2",dir:["↓","↑"]},
                    {axis:"Z",label:"Elbow",       color:"#FFB800",id:"joint_3",dir:["←","→"]},
                  ].map(({axis,label,color,id,dir})=>(
                    <div className="jog-axis" key={axis}>
                      <div className="axis-label">
                        <div className="axis-dot" style={{background:color}}/>
                        {axis} — {label}
                      </div>
                      <div className="jog-row">
                        <JogBtn speed={speed} onClick={()=>stepJoint(id,-JOG_STEP_DEG[speed])} disabled={dis}>
                          <span className="jarr">{dir[0]}</span><span>{axis}−</span>
                        </JogBtn>
                        <div className="jbtn mid">{axis}<br/>hold</div>
                        <JogBtn speed={speed} onClick={()=>stepJoint(id,JOG_STEP_DEG[speed])} disabled={dis}>
                          <span className="jarr">{dir[1]}</span><span>{axis}+</span>
                        </JogBtn>
                      </div>
                    </div>
                  ))}
                  <div style={{padding:"10px 12px"}}>
                    <button className="r-btn ghost" onClick={resetAll} disabled={dis}>Zero All Axes</button>
                  </div>
                </div>

                {/* Log */}
                <div className="card">
                  <div className="card-hdr">
                    <span className="card-title">System Log</span>
                    <button className="card-tag" style={{cursor:"pointer"}} onClick={()=>setLogs([])}>Clear</button>
                  </div>
                  <div className="log-wrap">
                    {logs.length===0&&<div className="lentry"><span className="ltime">{ts()}</span><span className="lmsg">Waiting…</span></div>}
                    {logs.map((l,i)=>(
                      <div className="lentry" key={i}>
                        <span className="ltime">{l.time}</span>
                        <span className={`lmsg ${l.type}`}>{l.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          </main>

          {/* ── RIGHT SIDEBAR (slim) ── */}
          <aside className="side side-r">
            <div className="slabel">Telemetry</div>
            <div className="card" style={{margin:"0 10px 10px"}}>
              <div className="tgrid">
                <div className="tcell"><div className="tlabel">Status</div><div className={`tval ${connState==="connected"?"ok":"err"}`}>{connState==="connected"?"LIVE":"OFF"}</div></div>
                <div className="tcell"><div className="tlabel">Pub Hz</div><div className="tval">{pubHz}<span style={{fontSize:10,color:"var(--text-mid)"}}>Hz</span></div></div>
                <div className="tcell"><div className="tlabel">Speed</div><div className={`tval ${speed===2?"warn":""}`}>{SPEED_LEVELS[speed]}</div></div>
                <div className="tcell"><div className="tlabel">Max Err</div><div className={`tval ${maxErr>5?"warn":"ok"}`}>{maxErr.toFixed(1)}<span style={{fontSize:10,color:"var(--text-mid)"}}>°</span></div></div>
                <div className="tcell"><div className="tlabel">Limits</div><div className={`tval ${anyNear?"warn":"ok"}`}>{anyNear?"WARN":"OK"}</div></div>
                <div className="tcell"><div className="tlabel">E-Stop</div><div className={`tval ${estopped?"err":"ok"}`}>{estopped?"ACTV":"CLR"}</div></div>
              </div>
            </div>

            <div className="slabel">Feedback vs CMD</div>
            <div className="card" style={{margin:"0 10px 10px"}}>
              {JOINTS.map(j=>{
                const cmd=joints[j.id]??0, fb=feedback[j.id]??0, err=Math.abs(cmd-fb);
                return (
                  <div className="fb-row" key={j.id}>
                    <div className="fb-top">
                      <span style={{fontSize:10,color:"var(--text-mid)"}}>{j.label}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:err>3?"var(--amber)":"var(--text-lo)"}}>Δ{err.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fb-bot">
                      <span style={{fontFamily:"JetBrains Mono",fontSize:11,color:j.color}}>CMD {cmd.toFixed(1)}{j.unit}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:11,color:"var(--text-mid)"}}>FB {fb.toFixed(1)}{j.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="slabel">Emergency</div>
            <div style={{padding:"0 10px 10px",display:"flex",flexDirection:"column",gap:6}}>
              <button className="r-btn danger" onClick={handleEstop} disabled={estopped}>⬛ EMERGENCY STOP</button>
              {estopped&&<button className="r-btn success" onClick={handleResume}>✓ CLEAR &amp; RESUME</button>}
            </div>
          </aside>
        </div>

        {/* ── Status strip ── */}
        <div className="strip">
          <div className={`sdot ${connState==="connected"?"ok":connState==="connecting"?"warn":"err"}`}/>
          <span>ros2 bridge</span>
          <span style={{color:"var(--text-lo)"}}>·</span>
          <span style={{color:"var(--text-lo)"}}>{wsUrl}</span>
          <span style={{marginLeft:"auto",color:"var(--text-lo)"}}>ARM·CTRL v1.3 · {ts()}</span>
        </div>
      </div>
    </>
  );
}