import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const JOINTS = [
  { id:"joint_1", label:"Base Rotation", short:"J1", min:-180, max:180,  unit:"°", color:"#00D4FF" },
  { id:"joint_2", label:"Shoulder",      short:"J2", min:-90,  max:90,   unit:"°", color:"#00FF9D" },
  { id:"joint_3", label:"Elbow",         short:"J3", min:-135, max:135,  unit:"°", color:"#FFB800" },
  { id:"joint_4", label:"Wrist Pitch",   short:"J4", min:-90,  max:90,   unit:"°", color:"#FF6B35" },
  { id:"joint_5", label:"Wrist Roll",    short:"J5", min:-180, max:180,  unit:"°", color:"#C77DFF" },
  { id:"joint_6", label:"Gripper",       short:"J6", min:0,    max:100,  unit:"%", color:"#FF4D6D" },
];
const LIMIT_WARN = 5;
const DEFAULT_PRESETS = [
  { name:"Home",       icon:"⌂", values:{joint_1:0,  joint_2:0,   joint_3:0,   joint_4:0,  joint_5:0, joint_6:0  }, builtin:true },
  { name:"Grab Ready", icon:"✦", values:{joint_1:0,  joint_2:45,  joint_3:-90, joint_4:45, joint_5:0, joint_6:0  }, builtin:true },
  { name:"Release",    icon:"◎", values:{joint_1:0,  joint_2:45,  joint_3:-90, joint_4:45, joint_5:0, joint_6:100}, builtin:true },
  { name:"Stow",       icon:"▣", values:{joint_1:0,  joint_2:-90, joint_3:135, joint_4:-45,joint_5:0, joint_6:0  }, builtin:true },
];
const SPEEDS   = ["Slow","Normal","Fast"];
const JOG_MS   = [120, 60, 30];
const JOG_DEG  = [1, 2, 5];
const initJ    = () => Object.fromEntries(JOINTS.map(j=>[j.id,0]));
const nearLim  = (v,j) => v<=j.min+LIMIT_WARN || v>=j.max-LIMIT_WARN;
const atLim    = (v,j) => v<=j.min || v>=j.max;
const ts       = () => new Date().toLocaleTimeString("en-GB",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
const clamp    = (v,a,b) => Math.max(a,Math.min(b,Number(v)));
const fillSt   = (val,min,max,col) => {
  const p=v=>((v-min)/(max-min))*100, z=p(clamp(0,min,max)), vp=p(val);
  return {left:`${Math.min(z,vp)}%`,width:`${Math.abs(z-vp)}%`,background:col};
};
const deltaColor = (err) => err < 1 ? "var(--grn)" : err < 3 ? "var(--amb)" : "var(--red)";
const deltaPct   = (err) => Math.min(100, (err/10)*100);

// ─── localStorage — wrapped safely ────────────────────────────────────────
const safeGet = (key, fallback) => {
  try { const v = window.localStorage.getItem(key); return v !== null ? v : fallback; }
  catch { return fallback; }
};
const safeSet = (key, value) => {
  try { window.localStorage.setItem(key, value); } catch {}
};
const initialUrl = () => {
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return safeGet("armctrl_url", `ws://${host}:9090`);
};
const initialSpeed = () => {
  const n = Number(safeGet("armctrl_speed", "1"));
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : 1;
};
const initialMode = () => {
  const m = safeGet("armctrl_mode", "ros");
  return m === "mock" ? "mock" : "ros";
};
const initialWaypoints = () => {
  try {
    const raw = safeGet("armctrl_waypoints", null);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const stripProto = (s) => String(s).replace(/^wss?:\/\//i,"").replace(/^https?:\/\//i,"");

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080C10;--panel:#0D1117;--card:#111820;--hover:#18222E;
  --b0:#1E2D3D;--b1:#253545;
  --hi:#E6EDF3;--mid:#8B949E;--lo:#3D4E5E;
  --cyan:#00D4FF;--cdim:rgba(0,212,255,.12);
  --red:#FF3B3B;--rdim:rgba(255,59,59,.15);
  --grn:#00FF9D;--gdim:rgba(0,255,157,.1);
  --amb:#FFB800;--adim:rgba(255,184,0,.12);
  --purple:#C77DFF;--pdim:rgba(199,125,255,.12);
  --r:7px;--rl:11px;
  --hdr:48px;--strip:24px;
}
html,body,#root{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--hi);font-family:'Inter',sans-serif;font-size:12px;line-height:1.4}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:var(--b1);border-radius:2px}

/* ── COCKPIT LAYOUT ARCHITECTURE ── */
.shell{display:grid;grid-template-rows:var(--hdr) 1fr var(--strip);width:100vw;height:100vh;overflow:hidden}

.body{
  display:grid;
  grid-template-columns:320px 1fr 280px;
  grid-template-rows:1fr 240px;
  grid-template-areas:
    "left center right"
    "left bottom right";
  background:var(--b0); /* Creates instant 1px borders between panels */
  gap:1px;
  overflow:hidden;
  width:100%;
  height:100%;
}

.panel-left   { grid-area:left;   background:var(--panel); display:flex; flex-direction:column; overflow:hidden; }
.panel-center { grid-area:center; background:#000;         display:flex; flex-direction:column; overflow:hidden; position:relative; }
.panel-right  { grid-area:right;  background:var(--panel); display:flex; flex-direction:column; overflow-y:auto; }
.panel-bottom { grid-area:bottom; background:var(--b0);    display:flex; gap:1px; overflow:hidden; }

.bot-col { background:var(--panel); display:flex; flex-direction:column; overflow:hidden; }
.log-col { flex:1; }
.diag-col { width:260px; }
.test-col { width:300px; }

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:var(--panel);border-bottom:1px solid var(--b0);z-index:100;overflow:hidden}
.brand{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.05em;color:var(--cyan);flex-shrink:0}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes fw{0%,100%{border-color:var(--amb);background:var(--adim)}50%{border-color:#F80;background:rgba(255,120,0,.2)}}
@keyframes fd{0%,100%{border-color:var(--red);background:var(--rdim)}50%{border-color:#F00;background:rgba(255,0,0,.25)}}

.hdr-center{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;min-width:0}
.hdr-r{display:flex;align-items:center;gap:8px;flex-shrink:0}
.hdr-url-wrap{display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);padding:3px 8px;min-width:0;flex:0 1 320px}
.hdr-url-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.hdr-url-input{background:transparent;border:none;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;outline:none;width:100%;min-width:0}
.hdr-url-input:disabled{opacity:.6}

.mode-toggle{padding:4px 10px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid);flex-shrink:0}
.mode-toggle.sim{border-color:var(--amb);color:var(--amb);background:var(--adim)}
.mode-toggle.demo{border-color:var(--purple);color:var(--purple);background:var(--pdim)}
.mode-toggle:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.mode-toggle:disabled{opacity:.4;cursor:not-allowed}

.badge{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;border:1px solid transparent;transition:all .3s;white-space:nowrap}
.badge.connected{color:var(--grn);border-color:var(--grn);background:var(--gdim)}
.badge.disconnected{color:var(--mid);border-color:var(--b0)}
.badge.connecting{color:var(--amb);border-color:var(--amb);background:var(--adim)}
.bdg-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.connected .bdg-dot{animation:blink 1.5s infinite}

.hbtn{padding:4px 12px;border-radius:var(--r);font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;transition:all .15s;border:1.5px solid transparent;white-space:nowrap;flex-shrink:0}
.hbtn:active{transform:scale(.97)}
.hbtn:disabled{opacity:.35;cursor:not-allowed}
.hbtn.conn{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.hbtn.conn:hover:not(:disabled){background:var(--grn);color:var(--bg)}
.hbtn.disc{background:transparent;color:var(--mid);border-color:var(--b1)}
.hbtn.disc:hover:not(:disabled){border-color:var(--red);color:var(--red)}
.hbtn.estop{background:var(--rdim);border-color:var(--red);color:var(--red);padding:4px 16px}
.hbtn.estop:hover:not(:disabled){background:var(--red);color:#fff}
.hbtn.resume{background:var(--gdim);border-color:var(--grn);color:var(--grn)}
.hbtn.resume:hover:not(:disabled){background:var(--grn);color:var(--bg)}

/* ── Panel Shared ── */
.slbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lo);padding:10px 12px 6px;flex-shrink:0;background:rgba(255,255,255,.01)}
.plbl{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--hi);padding:6px 12px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01);flex-shrink:0;display:flex;justify-content:space-between;align-items:center}

/* ── Left Tabs ── */
.left-tabs{display:flex;border-bottom:1px solid var(--b0);flex-shrink:0}
.ltab{flex:1;padding:10px 0;background:transparent;border:none;color:var(--lo);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
.ltab.on{color:var(--cyan);border-bottom-color:var(--cyan);background:var(--cdim)}
.ltab.teach.on{color:var(--purple);border-bottom-color:var(--purple);background:var(--pdim)}
.left-content{flex:1;overflow-y:auto;display:flex;flex-direction:column}

/* ── Controls ── */
.spd-row{display:flex;padding:5px 12px;gap:4px}
.spd{flex:1;padding:6px 2px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:2px}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd-rate{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo)}
.spd.on .spd-rate{color:var(--cyan)}

.pwr-row{display:flex;align-items:center;justify-content:space-between;padding:5px 12px}
.pwr-label{display:flex;flex-direction:column;gap:1px}
.pwr-title{font-size:10px;font-weight:600;color:var(--hi)}
.pwr-sub{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo)}
.tgl{width:38px;height:20px;border-radius:10px;background:var(--b1);position:relative;cursor:pointer;border:none;flex-shrink:0}
.tgl.on{background:var(--grn)}
.tgl-thumb{width:16px;height:16px;border-radius:50%;background:var(--hi);position:absolute;top:2px;left:2px;transition:left .12s}
.tgl.on .tgl-thumb{left:20px;background:#04160D}
.tgl:disabled{opacity:.4;cursor:not-allowed}

/* Joints */
.jrow{padding:8px 12px;border-bottom:1px solid var(--b0);display:flex;flex-direction:column;justify-content:center;transition:background .15s}
.jrow:last-child{border-bottom:none}
.jrow.near{animation:fw 1.2s ease-in-out infinite;border-left:3px solid var(--amb)}
.jrow.at{animation:fd .7s ease-in-out infinite;border-left:3px solid var(--red)}
.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.jname{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600}
.jdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.jval{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;min-width:50px;text-align:right}
.jval.near{color:var(--amb)!important}
.jval.at{color:var(--red)!important}
.lbdg{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.1em;padding:1px 5px;border-radius:3px;text-transform:uppercase}
.lbdg.near{background:var(--adim);color:var(--amb);border:1px solid var(--amb)}
.lbdg.at{background:var(--rdim);color:var(--red);border:1px solid var(--red)}
.jrange{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.jmin,.jmax{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);width:26px}
.jmax{text-align:right}
.swrap{flex:1;position:relative;height:16px;display:flex;align-items:center}
.strk{position:absolute;left:0;right:0;height:3px;background:var(--b1);border-radius:2px}
.sfill{position:absolute;height:3px;border-radius:2px;transition:width .05s,left .05s}
input[type=range]{position:relative;width:100%;height:16px;appearance:none;background:transparent;cursor:pointer;z-index:1}
input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:var(--hi);border:2px solid var(--cyan);box-shadow:0 0 4px rgba(0,212,255,.4)}
input[type=range].ws::-webkit-slider-thumb{border-color:var(--amb)}
input[type=range].ls::-webkit-slider-thumb{border-color:var(--red)}
input[type=range]:disabled{cursor:not-allowed;opacity:.4}
.jinp{display:flex;align-items:center;gap:5px}
.numinp{width:54px;background:var(--card);border:1px solid var(--b0);border-radius:4px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 5px;text-align:center;outline:none}
.numinp.wi{border-color:var(--amb);color:var(--amb)}
.numinp.li{border-color:var(--red);color:var(--red)}
.numinp:disabled{opacity:.4;cursor:not-allowed}
.sbtn{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:var(--card);border:1px solid var(--b0);border-radius:4px;color:var(--mid);cursor:pointer;font-size:14px;flex-shrink:0}
.sbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.sbtn[disabled]{opacity:.3;cursor:not-allowed}
.zero-btn{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);background:transparent;border:1px solid var(--b1);border-radius:4px;padding:4px 8px;cursor:pointer}
.zero-btn:hover:not(:disabled){color:var(--cyan);border-color:var(--cyan)}

/* Jog */
.jax{padding:6px 12px;border-bottom:1px solid var(--b0);flex-shrink:0}
.axlbl{font-size:10px;color:var(--mid);margin-bottom:4px;display:flex;align-items:center;gap:5px;font-weight:600}
.axdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.jog-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px}
.jbtn{padding:8px 3px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
.jbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.jbtn.mid{background:transparent;border-color:transparent;color:var(--lo);cursor:default;font-size:8px;text-transform:uppercase}
.jbtn[disabled]{opacity:.3;cursor:not-allowed}
.jarr{font-size:14px}

/* Teach */
.teach-status{margin:10px 12px;padding:8px 10px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;display:flex;align-items:center;gap:8px;flex-shrink:0}
.teach-status.on{background:var(--pdim);border:1px solid var(--purple);color:var(--purple)}
.teach-status.off{background:var(--gdim);border:1px solid var(--grn);color:var(--grn)}
.record-btn{margin:0 12px 10px;padding:12px;background:var(--rdim);border:1px solid var(--red);border-radius:var(--r);color:var(--red);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.05em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0}
.record-btn:hover:not(:disabled){background:var(--red);color:#fff}
.record-btn:disabled{opacity:.3;cursor:not-allowed}
.record-btn .rdot{width:8px;height:8px;border-radius:50%;background:currentColor}

.wp-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace}
.wp-row:hover{background:var(--hover)}
.wp-name{font-size:10px;font-weight:700;color:var(--hi)}
.wp-vals{font-size:8px;color:var(--lo);margin-top:2px}
.wp-del{background:transparent;border:1px solid var(--b1);border-radius:4px;color:var(--mid);font-size:9px;padding:4px 8px;cursor:pointer}
.wp-del:hover{border-color:var(--red);color:var(--red)}
.wp-empty{padding:20px 12px;text-align:center;font-size:10px;color:var(--lo)}

.play-row{display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid var(--b0);flex-shrink:0}
.pbtn2{flex:1;padding:8px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.pbtn2.primary{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn2.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}
.pbtn2:disabled{opacity:.3;cursor:not-allowed}

.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px 12px}
.pbtn{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 6px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);cursor:pointer;font-size:10px;font-weight:600}
.pbtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn:disabled{opacity:.3;cursor:not-allowed}
.pbtn .ico{font-size:14px}
.pbtn.add{border-style:dashed;color:var(--lo)}
.pbtn.add:hover:not(:disabled){border-color:var(--grn);color:var(--grn);background:var(--gdim)}
.pbtn-del{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:var(--red);color:#fff;font-size:9px;line-height:16px;text-align:center;border:1px solid var(--bg);cursor:pointer}

.act-row{display:flex;gap:4px;padding:5px 12px 10px}
.abtn{flex:1;padding:6px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;transition:all .15s;text-align:center;font-family:'JetBrains Mono',monospace}
.abtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.abtn:disabled{opacity:.3;cursor:not-allowed}

/* ── Center (Foxglove) ── */
.fg-bar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:rgba(13,17,23,0.85);backdrop-filter:blur(5px);border-bottom:1px solid var(--b0);z-index:10}
.fg-tag{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--purple);display:flex;align-items:center;gap:8px}
.fg-tag-dot{width:6px;height:6px;background:var(--purple);border-radius:50%;box-shadow:0 0 6px var(--purple)}
.fg-link{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--hi);text-decoration:none;padding:4px 10px;border:1px solid var(--b1);border-radius:5px;background:var(--card)}
.fg-link:hover{border-color:var(--cyan);color:var(--cyan)}
.fg-frame{width:100%;height:100%;border:none;background:#000}

/* ── Right Panel ── */
.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}
.tcell{background:var(--card);padding:10px 12px}
.tlbl{font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px}
.tval{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:var(--hi);line-height:1}
.tval.ok{color:var(--grn)}
.tval.warn{color:var(--amb)}
.tval.err{color:var(--red)}

.fbrow{padding:8px 12px;border-bottom:1px solid var(--b0);flex-shrink:0}
.fbrow:last-child{border-bottom:none}
.fbtop{display:flex;justify-content:space-between;margin-bottom:2px}
.fbbot{display:flex;justify-content:space-between;margin-bottom:5px}
.fbbar-track{height:4px;background:var(--b1);border-radius:2px;overflow:hidden}
.fbbar-fill{height:100%;border-radius:2px;transition:width .2s,background .2s}

/* ── Bottom Panel ── */
.logwrap{flex:1;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:10px;display:flex;flex-direction:column-reverse;padding-bottom:10px}
.lent{display:flex;gap:10px;padding:6px 12px;border-top:1px solid var(--b0);align-items:baseline;flex-shrink:0}
.lent:hover{background:var(--hover)}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}

.dkpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0);flex-shrink:0}
.dkpi{background:var(--card);padding:8px 12px;display:flex;flex-direction:column}
.dkpi-lbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
.dkpi-val{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:var(--hi)}
.dkpi-val.ok{color:var(--grn)}
.dkpi-val.warn{color:var(--amb)}
.dkpi-val.err{color:var(--red)}

.topic-row{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:10px}
.topic-name{color:var(--cyan)}
.topic-hz{color:var(--grn)}

/* ROS2 Nodes / Topics discovered list (bottom diagnostics column) */
.nodes-block{padding:0;border-top:1px solid var(--b0)}
.nodes-block-title{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--lo);padding:8px 12px 4px}
.node-row{display:flex;align-items:center;gap:5px;padding:3px 12px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.node-row .arrow{color:var(--cyan);flex-shrink:0}
.node-empty{padding:6px 12px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo)}

.rt-row{display:flex;align-items:center;gap:6px;padding:8px 12px;flex-shrink:0}
.rt-select{flex:1;background:var(--card);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px}
.rt-btn{padding:6px 12px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;cursor:pointer;border:1px solid var(--cyan);color:var(--cyan);background:var(--cdim)}
.rt-btn.stop{border-color:var(--red);color:var(--red);background:var(--rdim)}
.rt-btn:disabled{opacity:.3;cursor:not-allowed}
.rt-chart-wrap{flex:1;min-height:0;padding:4px 12px}
.rt-summary{display:flex;gap:12px;padding:8px 12px;border-top:1px solid var(--b0);background:var(--card);font-family:'JetBrains Mono',monospace;font-size:10px;align-items:center}
.rt-summary b{color:var(--hi)}
.rt-csv{margin-left:auto;padding:4px 10px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}

/* ── Strip & Modals ── */
.strip{display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--bg);border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mid)}
.sdot{width:6px;height:6px;border-radius:50%;background:var(--lo);flex-shrink:0}
.sdot.ok{background:var(--grn);box-shadow:0 0 5px var(--grn)}
.sdot.warn{background:var(--amb)}
.sdot.err{background:var(--red)}

.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.07);border:3px solid var(--red);pointer-events:none;z-index:999;animation:ep .5s infinite alternate}
@keyframes ep{from{opacity:.5}to{opacity:1}}
.estop-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--red);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;padding:6px 24px;border-radius:0 0 8px 8px;z-index:1000}
.demo-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--purple);color:#0D1117;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;padding:4px 18px;border-radius:0 0 6px 6px;z-index:998}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000}
.modal{background:var(--panel);border:1px solid var(--b0);border-radius:var(--rl);padding:20px;width:320px}
.modal-title{font-size:14px;font-weight:700;margin-bottom:8px;color:var(--hi)}
.modal-body{font-size:12px;color:var(--mid);margin-bottom:16px;line-height:1.5}
.modal-actions{display:flex;gap:8px}
.modal-btn{flex:1;padding:10px;border-radius:var(--r);font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.modal-btn.confirm{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.modal-btn.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}

/* 2D Preview */
.vizwrap{padding:12px;display:flex;flex-direction:column;align-items:center;border-bottom:1px solid var(--b0)}
.vizleg{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px}
.vli{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--mid)}
.vld{width:10px;height:4px;border-radius:2px}

/* Responsive Tablet */
@media (max-width:1100px){
  .body{grid-template-columns:280px 1fr 240px; grid-template-rows:1fr 200px;}
  .test-col{width:260px;}
}
`;

function TrendChart({ results }) {
  if (!results.length) return null;
  const W=280, H=100, padL=18, padR=10, padT=8, padB=16;
  const n=results.length;
  const maxErr=Math.max(5, ...results.map(r=>r.err))*1.15;
  const x=i=> padL + (n===1?0:(i/(n-1)))*(W-padL-padR);
  const y=v=> H-padB - (v/maxErr)*(H-padT-padB);
  const dot=(err)=> err<1?"#00FF9D":err<3?"#FFB800":"#FF3B3B";
  const pathD=results.map((r,i)=>`${i===0?"M":"L"} ${x(i).toFixed(1)} ${y(r.err).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%"}} preserveAspectRatio="none">
      <line x1={padL} y1={y(1)} x2={W-padR} y2={y(1)} stroke="#00FF9D" strokeWidth=".5" strokeDasharray="2 2" opacity=".35"/>
      <line x1={padL} y1={y(3)} x2={W-padR} y2={y(3)} stroke="#FFB800" strokeWidth=".5" strokeDasharray="2 2" opacity=".35"/>
      <line x1={padL} y1={H-padB} x2={W-padR} y2={H-padB} stroke="#253545" strokeWidth=".6"/>
      <line x1={padL} y1={padT} x2={padL} y2={H-padB} stroke="#253545" strokeWidth=".6"/>
      <path d={pathD} fill="none" stroke="#00D4FF" strokeWidth="1.6"/>
      {results.map((r,i)=><circle key={r.run} cx={x(i)} cy={y(r.err)} r="2.6" fill={dot(r.err)} stroke="#0D1117" strokeWidth=".8"/>)}
      <text x={padL} y={padT-1} fontSize="7" fill="#3D4E5E" fontFamily="monospace">{maxErr.toFixed(0)}°</text>
    </svg>
  );
}

function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button className="modal-btn" onClick={onCancel}>Cancel</button>
          <button className={`modal-btn ${danger?"danger":"confirm"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function useLongPress(cb, speed) {
  const ref=useRef(cb), iv=useRef(null), to=useRef(null);
  useEffect(()=>{ref.current=cb;},[cb]);
  const start=useCallback(e=>{
    if(e?.preventDefault) e.preventDefault();
    ref.current();
    to.current=setTimeout(()=>{iv.current=setInterval(()=>ref.current(),JOG_MS[speed]);},300);
  },[speed]);
  const stop=useCallback(()=>{clearTimeout(to.current);clearInterval(iv.current);},[]);
  useEffect(()=>()=>stop(),[stop]);
  return{onMouseDown:start,onMouseUp:stop,onMouseLeave:stop,onTouchStart:start,onTouchEnd:stop};
}

function SBtn({children,onClick,disabled,speed,title,style}){
  const h=useLongPress(onClick,speed);
  return <button className="sbtn" disabled={disabled} title={title} style={style} {...(disabled?{}:h)}>{children}</button>;
}
function JBtn({children,onClick,disabled,speed,cls=""}){
  const h=useLongPress(onClick,speed);
  return <button className={`jbtn ${cls}`} disabled={disabled} {...(disabled?{}:h)}>{children}</button>;
}

function ArmViz({joints,style}){
  const cx=100,cy=100,R=d=>(d*Math.PI)/180;
  const sa=R(joints.joint_2-90),ea=R(joints.joint_2+joints.joint_3-90);
  const wa=R(joints.joint_2+joints.joint_3+joints.joint_4-90),ba=R(joints.joint_1);
  const L1=44,L2=32,L3=18;
  const x1=cx+L1*Math.cos(sa),y1=cy+L1*Math.sin(sa);
  const x2=x1+L2*Math.cos(ea),y2=y1+L2*Math.sin(ea);
  const x3=x2+L3*Math.cos(wa),y3=y2+L3*Math.sin(wa);
  const g=joints.joint_6/100,m=(a,b)=>(a+b)/2;
  return(
    <div className="vizwrap" style={style}>
      <svg viewBox="0 0 200 200" style={{width:"100%",maxWidth:200}}>
        <defs><pattern id="gp" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0L0,0L0,20" fill="none" stroke="#1E2D3D" strokeWidth=".5"/></pattern></defs>
        <rect width="200" height="200" fill="url(#gp)" rx="8"/>
        <circle cx={cx} cy={cy} r="84" fill="none" stroke="#1E2D3D" strokeWidth=".5" strokeDasharray="4 4"/>
        <circle cx={cx} cy={cy} r="50" fill="none" stroke="#1E2D3D" strokeWidth=".5" strokeDasharray="2 6"/>
        <line x1={cx} y1={cy} x2={cx+84*Math.cos(ba)} y2={cy+84*Math.sin(ba)} stroke="#00D4FF" strokeWidth=".7" strokeDasharray="3 3" opacity=".2"/>
        <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#00D4FF" strokeWidth="7" strokeLinecap="round" opacity=".07"/>
        <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#00D4FF" strokeWidth="3.5" strokeLinecap="round"/>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00FF9D" strokeWidth="6" strokeLinecap="round" opacity=".07"/>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00FF9D" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#FFB800" strokeWidth="5" strokeLinecap="round" opacity=".09"/>
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#FFB800" strokeWidth="2" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="6" fill="#0D1117" stroke="#00D4FF" strokeWidth="2"/><circle cx={cx} cy={cy} r="2.5" fill="#00D4FF"/>
        <circle cx={x1} cy={y1} r="4.5" fill="#0D1117" stroke="#00FF9D" strokeWidth="1.5"/><circle cx={x1} cy={y1} r="2" fill="#00FF9D"/>
        <circle cx={x2} cy={y2} r="3.5" fill="#0D1117" stroke="#FFB800" strokeWidth="1.5"/><circle cx={x2} cy={y2} r="1.5" fill="#FFB800"/>
        <line x1={x3} y1={y3} x2={x3+8*Math.cos(wa+.3+g*.5)} y2={y3+8*Math.sin(wa+.3+g*.5)} stroke="#FF4D6D" strokeWidth="1.8" strokeLinecap="round"/>
        <line x1={x3} y1={y3} x2={x3+8*Math.cos(wa-.3-g*.5)} y2={y3+8*Math.sin(wa-.3-g*.5)} stroke="#FF4D6D" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx={x3} cy={y3} r="2" fill="#FF4D6D"/>
        <text x={cx-8} y={cy+18} fontSize="7" fill="#00D4FF" fontFamily="Inter">Base</text>
        <text x={x3+4} y={y3+3} fontSize="7" fill="#FF4D6D" fontFamily="Inter" fontWeight="600">Grip</text>
        <text x="4" y="195" fontSize="7" fill="#3D4E5E" fontFamily="monospace">SIDE VIEW — 2D</text>
      </svg>
      <div className="vizleg">
        {[["#00D4FF","Base/Upper"],["#00FF9D","Forearm"],["#FFB800","Wrist"],["#FF4D6D","Gripper"]].map(([c,l])=>(
          <div className="vli" key={l}><div className="vld" style={{background:c}}/><span>{l}</span></div>
        ))}
      </div>
    </div>
  );
}

function useDiagnostics(rosConnected, rosInstance){
  const TRACKED=["/joint_states","/cmd_vel"];
  const [tlog,setTlog]=useState(Object.fromEntries(TRACKED.map(t=>[t,{count:0,hz:0,last:"-"}])));
  const [info,setInfo]=useState({topics:[],nodes:[]});
  const lastT=useRef({});

  useEffect(()=>{
    if(!rosConnected||!rosInstance) return;
    const ROSLIB=window.ROSLIB, subs=[];
    const jsSub=new ROSLIB.Topic({ros:rosInstance,name:"/joint_states",messageType:"sensor_msgs/JointState"});
    jsSub.subscribe(()=>bump("/joint_states")); subs.push(jsSub);
    const cvSub=new ROSLIB.Topic({ros:rosInstance,name:"/cmd_vel",messageType:"geometry_msgs/Twist"});
    cvSub.subscribe(()=>bump("/cmd_vel")); subs.push(cvSub);
    try{
      new ROSLIB.Service({ros:rosInstance,name:"/rosapi/topics",serviceType:"rosapi/Topics"}).callService(new ROSLIB.ServiceRequest({}),r=>{ if(r?.topics) setInfo(p=>({...p,topics:r.topics})); });
      new ROSLIB.Service({ros:rosInstance,name:"/rosapi/nodes",serviceType:"rosapi/Nodes"}).callService(new ROSLIB.ServiceRequest({}),r=>{ if(r?.nodes) setInfo(p=>({...p,nodes:r.nodes})); });
    }catch(e){}
    return()=>subs.forEach(s=>s.unsubscribe());
  },[rosConnected,rosInstance]);

  const bump=name=>{
    const now=Date.now();
    setTlog(prev=>{
      const last=lastT.current[name]||now, dt=now-last;
      lastT.current[name]=now;
      const hz=dt>0?Math.round(1000/dt):prev[name].hz;
      return{...prev,[name]:{count:prev[name].count+1,hz:hz||prev[name].hz,last:ts()}};
    });
  };
  return { tlog, info, TRACKED };
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [conn,setConn]   = useState("disconnected");
  const [estp,setEstp]   = useState(false);
  const [joints,setJ]    = useState(initJ());
  const [feed,setFeed]   = useState(initJ());
  const [speed,setSpRaw] = useState(initialSpeed());
  const [logs,setLogs]   = useState([]);
  const [url,setUrlRaw]  = useState(initialUrl());
  const [hz,setHz]       = useState(0);
  const [confirmAction,setConfirmAction] = useState(null);
  
  // Left Panel Tab State
  const [leftTab,setLeftTab] = useState("manual");

  const [mode,setModeRaw] = useState(initialMode());
  const setMode = useCallback(v=>{ setModeRaw(v); safeSet("armctrl_mode", v); }, []);
  const [demoMode,setDemoMode] = useState(false);
  const [presets,setPresets] = useState(DEFAULT_PRESETS);
  const [armPower,setArmPower] = useState(true);
  const [waypoints,setWaypoints] = useState(initialWaypoints());
  const [playing,setPlaying] = useState(false);
  const playCancelRef = useRef(false);

  const [testRunning,setTestRunning] = useState(false);
  const [testResults,setTestResults] = useState([]);
  const [testTarget,setTestTarget] = useState(DEFAULT_PRESETS[1].name);
  const testCancelRef = useRef(false);

  const rosRef=useRef(null), pubRef=useRef(null), subRef=useRef(null), powerRef=useRef(null);
  const cntRef=useRef(0), estRef=useRef(false), feedRef=useRef(initJ());
  const logHistoryRef=useRef([]); 
  const reconnectAttemptRef=useRef(0), reconnectTimerRef=useRef(null), manualDisconnectRef=useRef(false);
  
  useEffect(()=>{estRef.current=estp;},[estp]);
  useEffect(()=>{ safeSet("armctrl_waypoints", JSON.stringify(waypoints)); },[waypoints]);

  const log=useCallback((msg,type="info")=>{
    const entry={msg,type,time:ts(),iso:new Date().toISOString(),joints:{...feedRef.current}};
    logHistoryRef.current.push(entry);
    if(logHistoryRef.current.length>5000) logHistoryRef.current.shift();
    setLogs(p=>[entry,...p.slice(0,99)]);
  },[]);
  useEffect(()=>{const t=setInterval(()=>{setHz(cntRef.current);cntRef.current=0;},1000);return()=>clearInterval(t);},[]);

  const setUrl = useCallback(v=>{ setUrlRaw(v); safeSet("armctrl_url", v); },[]);
  const setSp  = useCallback(v=>{ setSpRaw(v); safeSet("armctrl_speed", String(v)); },[]);

  const dispatchCommand = useCallback((type, payload) => {
    if (mode === "mock") {
      if (type === "JOINT_COMMAND") {
        cntRef.current += 1;
        setTimeout(()=>{ setFeed(p=>{ const merged={...p,...payload.joints}; feedRef.current=merged; return merged; }); }, 50);
      } else if (type === "ARM_POWER") {
        log(`[SIM] arm power → ${payload.on ? "ON" : "OFF"}`, "info");
      } else if (type === "ESTOP") {
        setTimeout(()=>{ setFeed(p=>{ const merged={...p,...payload.joints}; feedRef.current=merged; return merged; }); }, 50);
      }
      return;
    }
    const ROSLIB = window.ROSLIB;
    if (type === "JOINT_COMMAND") {
      if (!pubRef.current || !ROSLIB) return;
      pubRef.current.publish(new ROSLIB.Message({
        name: JOINTS.map(j=>j.id),
        position: JOINTS.map(j=>(payload.joints[j.id]*Math.PI)/180),
        velocity: JOINTS.map(()=>payload.speedMs), effort: [],
      }));
      cntRef.current += 1;
    } else if (type === "ARM_POWER") {
      if (powerRef.current && ROSLIB) powerRef.current.publish(new ROSLIB.Message({data:payload.on}));
    } else if (type === "ESTOP") {
      if (pubRef.current && ROSLIB) pubRef.current.publish(new ROSLIB.Message({
        name: JOINTS.map(j=>j.id),
        position: JOINTS.map(j=>(payload.joints[j.id]*Math.PI)/180),
        velocity: JOINTS.map(()=>0), effort: JOINTS.map(()=>0),
      }));
    }
  }, [mode, log]);

  const connect=useCallback(()=>{
    manualDisconnectRef.current=false;
    clearTimeout(reconnectTimerRef.current);
    if (mode === "mock") {
      setConn("connecting"); log("[SIM] Simulating connection…","warn");
      setTimeout(()=>{ setConn("connected"); log("[SIM] Simulated connection established","success"); }, 400);
      return;
    }
    const ROSLIB=window.ROSLIB;
    if(!ROSLIB){log("roslib.js not loaded","error");return;}
    if(rosRef.current) rosRef.current.close();
    setConn("connecting");
    log(reconnectAttemptRef.current>0 ? `Auto-reconnecting (${reconnectAttemptRef.current}/8) → ${url}` : `Connecting → ${url}`,"warn");
    const ros=new ROSLIB.Ros({url}); rosRef.current=ros;
    ros.on("connection",()=>{
      reconnectAttemptRef.current=0;
      setConn("connected"); log("ROS2 bridge connected","success");
      pubRef.current=new ROSLIB.Topic({ros,name:"/joint_commands",messageType:"sensor_msgs/JointState"});
      subRef.current=new ROSLIB.Topic({ros,name:"/joint_states",  messageType:"sensor_msgs/JointState"});
      powerRef.current=new ROSLIB.Topic({ros,name:"/arm_power_state",messageType:"std_msgs/Bool"});
      subRef.current.subscribe(msg=>{
        if(msg.name&&msg.position){
          const fb={};msg.name.forEach((n,i)=>{fb[n]=(msg.position[i]*180)/Math.PI;});
          setFeed(p=>{ const merged={...p,...fb}; feedRef.current=merged; return merged; });
        }
      });
      log("Subscribed /joint_states","info");
    });
    ros.on("error",e=>{ if(reconnectAttemptRef.current===0) log(`Error: ${e?.message??e}`,"error"); });
    ros.on("close",()=>{
      pubRef.current=null; subRef.current=null;
      if(!manualDisconnectRef.current && mode==="ros" && reconnectAttemptRef.current<8){
        const delay=Math.min(1000*Math.pow(1.5,reconnectAttemptRef.current),5000);
        log(`Connection dropped — retrying in ${(delay/1000).toFixed(1)}s`,"warn");
        reconnectTimerRef.current=setTimeout(()=>{ reconnectAttemptRef.current+=1; connect(); },delay);
      } else {
        if(reconnectAttemptRef.current>=8) log("Auto-reconnect gave up","error");
        else log("Connection closed","warn");
        setConn("disconnected");
        reconnectAttemptRef.current=0;
      }
    });
  },[url,log,mode]);

  const disconnect=useCallback(()=>{
    manualDisconnectRef.current=true;
    clearTimeout(reconnectTimerRef.current);
    reconnectAttemptRef.current=0;
    if (mode === "mock") { setConn("disconnected"); log("[SIM] Connection closed","warn"); return; }
    if(rosRef.current){rosRef.current.close();rosRef.current=null;}
  },[mode,log]);

  const publish=useCallback((ov)=>{
    if(estp) return;
    if(mode==="ros" && !pubRef.current) return;
    const j=ov??joints, sm=[.3,1,2][speed];
    dispatchCommand("JOINT_COMMAND", {joints:j, speedMs:sm});
  },[joints,estp,speed,mode,dispatchCommand]);

  const handleEstop=useCallback(()=>{
    setEstp(true); log("⚠ EMERGENCY STOP ACTIVATED","error");
    dispatchCommand("ESTOP", {joints});
  },[joints,log,dispatchCommand]);

  const handleResume=()=>setConfirmAction({
    title:"Resume motion?", body:"Clears emergency stop.", confirmLabel:"Resume", danger:false,
    run:()=>{ setEstp(false); log("Emergency stop cleared","success"); },
  });

  const confirmOrRun=(opts)=>{
    if(demoMode){ opts.run(); log(`[DEMO] ${opts.title}`,"info"); return; }
    setConfirmAction(opts);
  };

  useEffect(()=>{
    const onKey=(e)=>{
      if(e.code!=="Space") return;
      const tag=document.activeElement?.tagName;
      if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT") return;
      e.preventDefault();
      if(!estRef.current) handleEstop();
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[handleEstop]);

  const stepJ=useCallback((id,delta)=>{
    if(estRef.current) return;
    setJ(prev=>{const j=JOINTS.find(x=>x.id===id);return{...prev,[id]:clamp(prev[id]+delta,j.min,j.max)};});
  },[]);
  const setJabs=useCallback((id,v)=>{
    if(estRef.current) return;
    setJ(prev=>{const j=JOINTS.find(x=>x.id===id);return{...prev,[id]:clamp(v,j.min,j.max)};});
  },[]);

  useEffect(()=>{if(conn==="connected"&&!estp) publish(joints);},[joints]); // eslint-disable-line

  const requestPreset=(p)=>confirmOrRun({
    title:`Move to "${p.name}"?`, body:"Arm will move here.", confirmLabel:"Move Arm", danger:false,
    run:()=>{ setJ(p.values); log(`Preset applied: ${p.name}`,"info"); },
  });
  const requestReset=()=>confirmOrRun({
    title:"Reset all joints?", body:"Moves back to zero.", confirmLabel:"Reset", danger:false,
    run:()=>{ setJ(initJ()); log("All joints → 0°","info"); },
  });

  const addPreset=()=>{
    const name = window.prompt("Name this position:");
    if(!name || !name.trim()) return;
    const trimmed = name.trim();
    if(presets.some(p=>p.name.toLowerCase()===trimmed.toLowerCase())){ log("Name exists","warn"); return; }
    setPresets(p=>[...p, { name:trimmed, icon:"★", values:{...joints}, builtin:false }]);
    log(`Saved "${trimmed}"`,"success");
  };
  const deletePreset=(name)=>confirmOrRun({
    title:`Delete "${name}"?`, body:"Cannot be undone.", confirmLabel:"Delete", danger:true,
    run:()=>{
      setPresets(p=>p.filter(x=>x.name!==name));
      if(testTarget===name) setTestTarget(presets.find(p=>p.builtin&&p.name!=="Home")?.name || "Grab Ready");
      log(`Deleted "${name}"`,"warn");
    },
  });

  const publishPower=(on)=>dispatchCommand("ARM_POWER",{on});
  const requestArmPower=(on)=>confirmOrRun({
    title: on ? "Re-energize motors?" : "Enter Teach Mode?",
    body: on ? "Motors will re-energize." : "Motors de-energize for hand manipulation.",
    confirmLabel: on ? "Re-energize" : "Enter Teach Mode", danger:false,
    run:()=>{
      setArmPower(on); publishPower(on);
      log(on?"Power ON":"Power OFF — Teach Mode", on?"success":"warn");
      if(!on) setLeftTab("teach");
    },
  });

  const recordWaypoint=()=>{
    const snapshot={...feedRef.current};
    setWaypoints(p=>[...p,{id:Date.now(),values:snapshot,label:`Point ${p.length+1}`}]);
    log(`Recorded Point ${waypoints.length+1}`,"success");
  };
  const deleteWaypoint=(id)=>setWaypoints(p=>p.filter(w=>w.id!==id));
  const clearWaypoints=()=>confirmOrRun({
    title:"Clear trajectory?", body:"Cannot be undone.", confirmLabel:"Clear", danger:true,
    run:()=>{ setWaypoints([]); log("Trajectory cleared","warn"); },
  });
  const stopPlayback=()=>{ playCancelRef.current=true; };
  const playTrajectory=()=>{
    if(waypoints.length===0) return;
    confirmOrRun({
      title:"Play trajectory?", body:`Moves through ${waypoints.length} points.`, confirmLabel:"Play", danger:false,
      run: async ()=>{
        if(!armPower){ log("Re-energize first","error"); return; }
        playCancelRef.current=false; setPlaying(true);
        log(`Playing trajectory`,"info");
        for(const wp of waypoints){
          if(playCancelRef.current) break;
          setJ(prev=>({...prev,...wp.values}));
          await new Promise(res=>setTimeout(res,1500));
        }
        setPlaying(false);
        log(playCancelRef.current?"Stopped":"Complete", playCancelRef.current?"warn":"success");
      },
    });
  };

  const exportSystemLogCSV=()=>{
    const hist=logHistoryRef.current;
    if(hist.length===0){ log("No logs","warn"); return; }
    const esc=(s)=>`"${String(s).replace(/"/g,'""')}"`;
    const header=`timestamp_iso,time,type,message,${JOINTS.map(j=>j.short).join(",")}\n`;
    const rows=hist.map(e=>`${e.iso},${e.time},${e.type},${esc(e.msg)},${JOINTS.map(jt=>(e.joints[jt.id]??0).toFixed(2)).join(",")}`).join("\n");
    const blob=new Blob([`# Full log\n${header}${rows}\n`],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`arm_log_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const stopTest=()=>{ testCancelRef.current=true; };
  const exportTestCSV=()=>{
    if(testResults.length===0) return;
    const avg=testResults.reduce((a,r)=>a+r.err,0)/testResults.length;
    const max=Math.max(...testResults.map(r=>r.err));
    const meta=`# target,${testTarget}\n# avg_error,${avg.toFixed(3)}\n# max_error,${max.toFixed(3)}\n`;
    const rows=testResults.map(r=>`${r.run},${r.err.toFixed(3)}`).join("\n");
    const blob=new Blob([`${meta}run,error_deg\n${rows}\n`],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`test_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const runRepeatabilityTest=(targetPreset,cycles=10)=>{
    const home = presets.find(p=>p.name==="Home") || DEFAULT_PRESETS[0];
    confirmOrRun({
      title:"Run test?", body:`Cycles to "${targetPreset.name}" ${cycles} times.`, confirmLabel:"Run Test", danger:false,
      run: async ()=>{
        testCancelRef.current=false; setTestRunning(true); setTestResults([]);
        log(`Test: ${cycles} cycles → "${targetPreset.name}"`,"info");
        for(let i=0;i<cycles;i++){
          if(testCancelRef.current) break;
          setJ(home.values); await new Promise(res=>setTimeout(res,1500));
          setJ(targetPreset.values); await new Promise(res=>setTimeout(res,1500));
          const err=Math.max(...JOINTS.map(j=>Math.abs((targetPreset.values[j.id]||0)-(feedRef.current[j.id]||0))));
          setTestResults(p=>[...p,{run:i+1,err}]);
        }
        setTestRunning(false);
        log(testCancelRef.current?"Test stopped":"Test complete","success");
      },
    });
  };

  const diag = useDiagnostics(conn==="connected" && mode==="ros", rosRef.current);
  const maxErr=Math.max(...JOINTS.map(j=>Math.abs((joints[j.id]||0)-(feed[j.id]||0))));
  const anyNear=JOINTS.some(j=>nearLim(joints[j.id],j));
  const dis=estp||conn!=="connected"||!armPower;
  const testPreset = presets.find(p=>p.name===testTarget) || presets[1];
  const testAvg = testResults.length ? (testResults.reduce((a,r)=>a+r.err,0)/testResults.length) : null;
  const testMax = testResults.length ? Math.max(...testResults.map(r=>r.err)) : null;

  // Foxglove URL Routing
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const fgTarget = `ws://${host}:8765`;
  const fgUrl = `http://${host}/ui/?ds=foxglove-websocket&ds.url=${encodeURIComponent(fgTarget)}`;

  return(
    <>
      <style>{CSS}</style>
      {estp&&<><div className="estop-ov"/><div className="estop-banner">⬛ EMERGENCY STOP — ALL MOTION HALTED</div></>}
      {demoMode&&!estp&&<div className="demo-banner">DEMO MODE — CONFIRMATIONS SKIPPED</div>}
      <ConfirmDialog
        open={!!confirmAction} title={confirmAction?.title} body={confirmAction?.body}
        confirmLabel={confirmAction?.confirmLabel} danger={confirmAction?.danger}
        onConfirm={()=>{ confirmAction?.run?.(); setConfirmAction(null); }}
        onCancel={()=>setConfirmAction(null)}
      />

      <div className="shell">

        {/* ── HEADER ── */}
        <header className="hdr">
          <div className="brand"><div className={`bdot ${conn!=="connected"?"off":""}`}/>ARM · CONTROL</div>
          <div className="hdr-center">
            <div className="hdr-url-wrap">
              <span className="hdr-url-label">ws://</span>
              <input className="hdr-url-input" value={stripProto(url)} onChange={e=>setUrl(e.target.value)} disabled={conn==="connected"||mode==="mock"} spellCheck={false}/>
            </div>
            <button className={`mode-toggle ${mode==="mock"?"sim":""}`} onClick={()=>setMode(mode==="ros"?"mock":"ros")} disabled={conn!=="disconnected"}>{mode==="mock"?"SIM":"LIVE"}</button>
            <button className={`mode-toggle ${demoMode?"demo":""}`} onClick={()=>setDemoMode(d=>!d)}>{demoMode?"DEMO ON":"DEMO OFF"}</button>
            <button className="hbtn conn" onClick={connect} disabled={conn!=="disconnected"}>{conn==="connecting"?"Connecting…":"Connect"}</button>
            <button className="hbtn disc" onClick={disconnect} disabled={conn==="disconnected"}>Disconnect</button>
          </div>
          <div className="hdr-r">
            <div className={`badge ${conn}`}><div className="bdg-dot"/>{conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}</div>
            {estp ? <button className="hbtn resume" onClick={handleResume}>CLEAR EMERGENCY</button> : <button className="hbtn estop" onClick={handleEstop}>⬛ E-STOP</button>}
          </div>
        </header>

        {/* ── COCKPIT BODY ── */}
        <div className="body">

          {/* ── LEFT PANEL (Tabs) ── */}
          <aside className="panel-left">
            <div className="left-tabs">
              <button className={`ltab ${leftTab==="manual"?"on":""}`} onClick={()=>setLeftTab("manual")}>Manual Control</button>
              <button className={`ltab teach ${leftTab==="teach"?"on":""}`} onClick={()=>setLeftTab("teach")}>Teach & Auto</button>
            </div>
            
            <div className="left-content">
              {leftTab === "manual" ? (
                <>
                  <div className="spd-row">
                    {SPEEDS.map((s,i)=>{
                      const rate = (JOG_DEG[i] / (JOG_MS[i]/1000)).toFixed(1);
                      return <button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSp(i)}><div>{s}</div><div className="spd-rate">{rate}°/s</div></button>;
                    })}
                  </div>
                  <div className="pwr-row">
                    <div className="pwr-label"><span className="pwr-title">{armPower?"Energized":"De-energized"}</span><span className="pwr-sub">{armPower?"NORMAL CONTROL":"BACK-DRIVABLE"}</span></div>
                    <button className={`tgl ${armPower?"on":""}`} onClick={()=>requestArmPower(!armPower)} disabled={conn!=="connected"||estp}><div className="tgl-thumb"/></button>
                  </div>
                  <div className="plbl">Joint Sliders <button className="zero-btn" onClick={requestReset} disabled={dis}>Zero All</button></div>
                  <div>
                    {JOINTS.map(j=>{
                      const val=joints[j.id], fill=fillSt(val,j.min,j.max,j.color);
                      const isN=nearLim(val,j), isA=atLim(val,j), step=JOG_DEG[speed];
                      return(
                        <div className={`jrow ${isA?"at":isN?"near":""}`} key={j.id}>
                          <div className="jhdr">
                            <div className="jname"><div className="jdot" style={{background:j.color}}/>{j.label} {isA&&<span className="lbdg at">LIMIT</span>}{!isA&&isN&&<span className="lbdg near">NEAR</span>}</div>
                            <div className={`jval ${isA?"at":isN?"near":""}`} style={isN||isA?{}:{color:j.color}}>{val.toFixed(1)}{j.unit}</div>
                          </div>
                          <div className="jrange">
                            <span className="jmin">{j.min}</span>
                            <div className="swrap">
                              <div className="strk"/><div className="sfill" style={fill}/>
                              <input type="range" className={isA?"ls":isN?"ws":""} min={j.min} max={j.max} step=".5" value={val} onChange={e=>setJabs(j.id,e.target.value)} disabled={dis}/>
                            </div>
                            <span className="jmax">{j.max}</span>
                          </div>
                          <div className="jinp">
                            <SBtn speed={speed} onClick={()=>stepJ(j.id,-step)} disabled={dis}>−</SBtn>
                            <input className={`numinp ${isA?"li":isN?"wi":""}`} type="number" value={val.toFixed(1)} min={j.min} max={j.max} step=".5" onChange={e=>setJabs(j.id,e.target.value)} disabled={dis}/>
                            <SBtn speed={speed} onClick={()=>stepJ(j.id,step)} disabled={dis}>+</SBtn>
                            <button className="sbtn" style={{marginLeft:"auto",width:32}} onClick={()=>setJabs(j.id,0)} disabled={dis}>⊙</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="act-row">
                    <button className="abtn" onClick={requestReset} disabled={dis}>Reset All</button>
                    <button className="abtn" onClick={()=>publish()} disabled={dis}>Publish</button>
                  </div>
                  <div className="plbl">Cartesian Jog</div>
                  <div style={{padding:"6px 0 10px"}}>
                    {[
                      {axis:"X",label:"Base / Yaw",  color:"#00D4FF",id:"joint_1",dir:["←","→"]},
                      {axis:"Y",label:"Shoulder",    color:"#00FF9D",id:"joint_2",dir:["↓","↑"]},
                      {axis:"Z",label:"Elbow",       color:"#FFB800",id:"joint_3",dir:["←","→"]},
                    ].map(({axis,label,color,id,dir})=>(
                      <div className="jax" key={axis}>
                        <div className="axlbl"><div className="axdot" style={{background:color}}/>{axis} — {label}</div>
                        <div className="jog-row">
                          <JBtn speed={speed} onClick={()=>stepJ(id,-JOG_DEG[speed])} disabled={dis}><span className="jarr">{dir[0]}</span><span>{axis}−</span></JBtn>
                          <div className="jbtn mid">{axis}<br/>hold</div>
                          <JBtn speed={speed} onClick={()=>stepJ(id,JOG_DEG[speed])} disabled={dis}><span className="jarr">{dir[1]}</span><span>{axis}+</span></JBtn>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className={`teach-status ${armPower?"off":"on"}`}>
                    {armPower ? "Motors energized — turn Power OFF to teach" : "Arm is free — move it by hand, then record"}
                  </div>
                  <button className="record-btn" onClick={recordWaypoint} disabled={armPower||conn!=="connected"||estp}>
                    <span className="rdot"/>RECORD WAYPOINT
                  </button>
                  <div className="plbl">Trajectory ({waypoints.length})</div>
                  <div className="wp-scroll">
                    {waypoints.length===0
                      ? <div className="wp-empty">No waypoints yet.</div>
                      : waypoints.map(wp=>(
                        <div className="wp-row" key={wp.id}>
                          <div>
                            <div className="wp-name">{wp.label}</div>
                            <div className="wp-vals">{JOINTS.map(j=>`${j.short}:${(wp.values[j.id]??0).toFixed(0)}`).join(" ")}</div>
                          </div>
                          <button className="wp-del" onClick={()=>deleteWaypoint(wp.id)}>DEL</button>
                        </div>
                      ))
                    }
                  </div>
                  <div className="play-row">
                    <button className="pbtn2 primary" onClick={playTrajectory} disabled={waypoints.length===0||playing||!armPower||conn!=="connected"}>▶ PLAY</button>
                    <button className="pbtn2" onClick={stopPlayback} disabled={!playing}>■ STOP</button>
                    <button className="pbtn2 danger" onClick={clearWaypoints} disabled={waypoints.length===0}>CLEAR</button>
                  </div>
                  <div className="plbl">Saved Positions</div>
                  <div className="pgrid">
                    {presets.map(p=>(
                      <button key={p.name} className="pbtn" onClick={()=>requestPreset(p)} disabled={dis}>
                        {!p.builtin && <span className="pbtn-del" onClick={(e)=>{e.stopPropagation();deletePreset(p.name);}}>✕</span>}
                        <span className="ico">{p.icon}</span>{p.name}
                      </button>
                    ))}
                    <button className="pbtn add" onClick={addPreset} disabled={conn!=="connected"}><span className="ico">+</span>Save Current</button>
                  </div>
                </>
              )}
            </div>
          </aside>

          {/* ── CENTER PANEL (Foxglove) ── */}
          <main className="panel-center">
            <div className="fg-bar">
              <span className="fg-tag"><div className="fg-tag-dot"/>FOXGLOVE 3D LIVE</span>
              <a href={fgUrl} target="_blank" rel="noopener noreferrer" className="fg-link">Open in New Tab ↗</a>
            </div>
            <iframe src={fgUrl} title="Foxglove" className="fg-frame"/>
          </main>

          {/* ── RIGHT PANEL ── */}
          <aside className="panel-right">
            <div className="slbl" style={{paddingTop:14}}>Telemetry &amp; Status</div>
            <div style={{padding:"0 12px"}}>
              <div className="tgrid">
                <div className="tcell"><div className="tlbl">Status</div><div className={`tval ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"LIVE":"OFF"}</div></div>
                <div className="tcell"><div className="tlbl">Pub Hz</div><div className="tval">{hz}</div></div>
                <div className="tcell"><div className="tlbl">Max Err</div><div className={`tval ${maxErr>5?"warn":"ok"}`}>{maxErr.toFixed(1)}°</div></div>
                <div className="tcell"><div className="tlbl">Limits</div><div className={`tval ${anyNear?"warn":"ok"}`}>{anyNear?"WARN":"OK"}</div></div>
                <div className="tcell"><div className="tlbl">Speed</div><div className={`tval ${speed===2?"warn":"ok"}`} style={{fontSize:13}}>{SPEEDS[speed]}</div></div>
                <div className="tcell"><div className="tlbl">Emergency</div><div className={`tval ${estp?"err":"ok"}`} style={{fontSize:13}}>{estp?"ACTIVE":"CLEAR"}</div></div>
              </div>
            </div>

            <div className="slbl" style={{marginTop:10}}>Feedback vs CMD</div>
            <div>
              {JOINTS.map(j=>{
                const cmd=joints[j.id]??0, fb=feed[j.id]??0, err=Math.abs(cmd-fb);
                return(
                  <div className="fbrow" key={j.id}>
                    <div className="fbtop">
                      <span style={{fontSize:10,color:"var(--mid)",fontWeight:600}}>{j.short}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:deltaColor(err),fontWeight:700}}>Δ{err.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fbbot">
                      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:j.color}}>CMD {cmd.toFixed(1)}{j.unit}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--hi)"}}>FB {fb.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fbbar-track"><div className="fbbar-fill" style={{width:`${deltaPct(err)}%`,background:deltaColor(err)}}/></div>
                  </div>
                );
              })}
            </div>

            <div style={{marginTop:"auto"}}>
              <div className="slbl" style={{borderTop:"1px solid var(--b0)"}}>2D Fallback View</div>
              <ArmViz joints={armPower?joints:feed}/>
            </div>
          </aside>

          {/* ── BOTTOM PANEL ── */}
          <section className="panel-bottom">
            {/* Log Column */}
            <div className="bot-col log-col">
              <div className="plbl" style={{borderBottom:"none"}}>System Log
                <div style={{display:"flex",gap:6}}>
                  <button className="rt-csv" onClick={exportSystemLogCSV}>Export</button>
                  <button className="rt-csv" onClick={()=>setLogs([])}>Clear</button>
                </div>
              </div>
              <div className="logwrap">
                {logs.length===0&&<div className="lent"><span className="ltm">{ts()}</span><span className="lmsg">Waiting for connection…</span></div>}
                {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
              </div>
            </div>

            {/* Diagnostics Column */}
            <div className="bot-col diag-col" style={{borderLeft:"1px solid var(--b0)"}}>
              <div className="plbl" style={{borderBottom:"none"}}>ROS2 Diagnostics</div>
              <div className="dkpi-grid">
                <div className="dkpi"><div className="dkpi-lbl">Bridge</div><div className={`dkpi-val ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"ONLINE":"OFFLINE"}</div></div>
                <div className="dkpi"><div className="dkpi-lbl">Nodes</div><div className="dkpi-val ok">{diag.info.nodes.length||"–"}</div></div>
                {diag.TRACKED.map(t=>(
                  <div className="dkpi" key={t}><div className="dkpi-lbl" style={{textTransform:"none"}}>{t}</div><div className={`dkpi-val ${diag.tlog[t].hz>0?"ok":"warn"}`}>{diag.tlog[t].hz} Hz</div></div>
                ))}
              </div>
              <div style={{flex:1,overflowY:"auto",borderTop:"1px solid var(--b0)"}}>
                {diag.TRACKED.map(t=>(
                  <div className="topic-row" key={t}><span className="topic-name">{t}</span><span className="topic-hz">{diag.tlog[t].count} msgs</span></div>
                ))}
                <div className="nodes-block">
                  <div className="nodes-block-title">ROS2 Nodes · {diag.info.nodes.length} active</div>
                  {diag.info.nodes.length===0
                    ? <div className="node-empty">{mode==="mock"?"Simulation mode — no ROS nodes":"No nodes yet — connect first"}</div>
                    : diag.info.nodes.map(n=>(
                      <div className="node-row" key={n} title={n}><span className="arrow">▸</span>{n}</div>
                    ))
                  }
                </div>
              </div>
            </div>

            {/* Test Column */}
            <div className="bot-col test-col" style={{borderLeft:"1px solid var(--b0)"}}>
              <div className="plbl" style={{borderBottom:"none"}}>Repeatability Test</div>
              <div className="rt-row">
                <select className="rt-select" value={testTarget} onChange={e=>setTestTarget(e.target.value)} disabled={testRunning}>
                  {presets.filter(p=>p.name!=="Home").map(p=><option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                {!testRunning
                  ? <button className="rt-btn" onClick={()=>runRepeatabilityTest(testPreset,10)} disabled={conn!=="connected"||!armPower}>RUN ×10</button>
                  : <button className="rt-btn stop" onClick={stopTest}>STOP</button>}
              </div>
              <div className="rt-chart-wrap">
                {testResults.length===0 && !testRunning ? <div className="rt-empty">No results yet</div> : <TrendChart results={testResults}/>}
              </div>
              {testResults.length>0 && (
                <div className="rt-summary">
                  <span>Avg <b>{testAvg.toFixed(2)}°</b></span>
                  <span>Max <b>{testMax.toFixed(2)}°</b></span>
                  <button className="rt-csv" onClick={exportTestCSV}>CSV</button>
                </div>
              )}
            </div>
          </section>

        </div>

        {/* ── STATUS STRIP ── */}
        <div className="strip">
          <div className={`sdot ${conn==="connected"?"ok":conn==="connecting"?"warn":"err"}`}/>
          <span>{mode==="mock"?"simulation mode":"ros2 bridge"}</span>
          <span style={{color:"var(--lo)"}}>·</span>
          <span style={{color:"var(--lo)"}}>{mode==="mock"?"no hardware required":url}</span>
          <span style={{marginLeft:"auto",color:"var(--lo)"}}>ARM·CTRL COCKPIT V6.1 · {ts()}</span>
        </div>

      </div>
    </>
  );
}