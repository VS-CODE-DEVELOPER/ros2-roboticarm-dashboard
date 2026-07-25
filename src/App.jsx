import { useState, useEffect, useRef, useCallback } from "react";
import mqtt from "mqtt";

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
const stripProto = (s) => String(s).replace(/^wss?:\/\//i,"").replace(/^https?:\/\//i,"");
const hostOf = (wsUrl) => stripProto(wsUrl).split(":")[0].split("/")[0];
const cleanIp = (s) => stripProto(s).split(":")[0].split("/")[0].trim();

const TABS = [
  { id:"arm",   label:"Robotic Arm" },
  { id:"cart",  label:"Cartesian" },
  { id:"teach", label:"Teach Mode" },
  { id:"diag",  label:"Diagnostics" },
];

// ─── localStorage — wrapped safely ────────────────────────────────────────
const safeGet = (key, fallback) => {
  try { const v = window.localStorage.getItem(key); return v !== null ? v : fallback; }
  catch { return fallback; }
};
const safeSet = (key, value) => {
  try { window.localStorage.setItem(key, value); } catch {}
};
const initialRobotIp = () => {
  const saved = safeGet("armctrl_robot_ip", null);
  if (saved) return saved;
  const oldUrl = safeGet("armctrl_url", null);
  if (oldUrl) return hostOf(oldUrl);
  return typeof window !== "undefined" ? window.location.hostname : "localhost";
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
const initialRemoteLinked = () => safeGet("armctrl_remote_linked","true") !== "false";
const initialRemoteUrl = () => safeGet("armctrl_remote_url", null);

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
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
  --r:7px;--rl:12px;
  --hdr:52px;--tabbar:40px;--strip:24px;
}
html,body,#root{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--hi);font-family:'Inter',sans-serif;font-size:13px;line-height:1.4}
button,input,select{font-family:inherit}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-thumb{background:var(--b1);border-radius:3px}

.shell{display:grid;grid-template-rows:var(--hdr) var(--tabbar) 1fr var(--strip);width:100vw;height:100vh;overflow:hidden}

@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes remotepulse{0%{box-shadow:0 0 0 0 rgba(0,255,157,.5)}100%{box-shadow:0 0 0 6px rgba(0,255,157,0)}}
@keyframes fw{0%,100%{border-color:var(--amb);background:var(--adim)}50%{border-color:#F80;background:rgba(255,120,0,.2)}}
@keyframes fd{0%,100%{border-color:var(--red);background:var(--rdim)}50%{border-color:#F00;background:rgba(255,0,0,.25)}}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:var(--panel);border-bottom:1px solid var(--b0);z-index:100;gap:10px}
.brand{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.05em;color:var(--cyan);flex-shrink:0}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}

.hdr-center{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;min-width:0}
.hdr-r{display:flex;align-items:center;gap:8px;flex-shrink:0}

.ip-wrap{display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);padding:4px 10px;min-width:0;flex:0 1 260px}
.ip-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.ip-input{background:transparent;border:none;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:11px;outline:none;width:100%;min-width:0}
.ip-input:disabled{opacity:.6}
.ip-ports{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo);white-space:nowrap}

.mode-toggle{padding:5px 11px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid);flex-shrink:0}
.mode-toggle.sim{border-color:var(--amb);color:var(--amb);background:var(--adim)}
.mode-toggle.demo{border-color:var(--purple);color:var(--purple);background:var(--pdim)}
.mode-toggle:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.mode-toggle:disabled{opacity:.4;cursor:not-allowed}

.badge{display:flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;border:1px solid transparent}
.badge.connected{color:var(--grn);border-color:var(--grn);background:var(--gdim)}
.badge.disconnected{color:var(--mid);border-color:var(--b0)}
.badge.connecting{color:var(--amb);border-color:var(--amb);background:var(--adim)}
.bdg-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.connected .bdg-dot{animation:blink 1.5s infinite}

.hbtn{padding:5px 13px;border-radius:var(--r);font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;border:1.5px solid transparent;white-space:nowrap;flex-shrink:0}
.hbtn:disabled{opacity:.35;cursor:not-allowed}
.hbtn.conn{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.hbtn.disc{background:transparent;color:var(--mid);border-color:var(--b1)}
.hbtn.estop{background:var(--rdim);border-color:var(--red);color:var(--red);padding:5px 16px}
.hbtn.estop:hover:not(:disabled){background:var(--red);color:#fff}
.hbtn.resume{background:var(--gdim);border-color:var(--grn);color:var(--grn)}

/* ── Tab bar ── */
.tabbar{display:flex;align-items:stretch;background:var(--panel);border-bottom:1px solid var(--b0);padding:0 14px;gap:2px}
.tabbtn{padding:0 18px;border:none;background:transparent;color:var(--lo);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-bottom:2px solid transparent}
.tabbtn:hover{color:var(--hi)}
.tabbtn.on{color:var(--cyan);border-bottom-color:var(--cyan)}
.tabbtn.teachlit{color:var(--purple);border-bottom-color:var(--purple)}

/* ── Page ── */
.page{overflow-y:auto;padding:16px;height:100%}
.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;align-items:start}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}

.card{background:var(--panel);border:1px solid var(--b0);border-radius:var(--rl);margin-bottom:16px;overflow:hidden}
.card-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--b0);background:var(--card)}
.card-title{font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--hi)}
.card-tag{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo)}
.card-body{padding:12px 14px}

/* ── Joint rows ── */
.jrow{padding:10px 0;border-bottom:1px solid var(--b0)}
.jrow:last-child{border-bottom:none}
.jrow.near{background:var(--adim);border-left:3px solid var(--amb);padding-left:8px;margin:0 -14px;padding-right:14px}
.jrow.at{background:var(--rdim);border-left:3px solid var(--red);animation:fd 1s infinite;padding-left:8px;margin:0 -14px;padding-right:14px}
.jrow.remote{border-left:3px solid var(--grn);padding-left:8px;margin:0 -14px;padding-right:14px}
.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.jname{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.jdot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.jval{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;min-width:56px;text-align:right}
.jval.near{color:var(--amb)!important}
.jval.at{color:var(--red)!important}
.lbdg{font-size:8px;font-weight:800;letter-spacing:.04em;padding:2px 5px;border-radius:3px;text-transform:uppercase}
.lbdg.near{background:var(--amb);color:#000}
.lbdg.at{background:var(--red);color:#fff}
.lbdg.remote{background:var(--grn);color:#000}
.jrange{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.jmin,.jmax{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);width:28px}
.jmax{text-align:right}
.swrap{flex:1;position:relative;height:22px;display:flex;align-items:center}
.strk{position:absolute;left:0;right:0;height:4px;background:var(--b1);border-radius:2px}
.sfill{position:absolute;height:4px;border-radius:2px}
input[type=range]{position:relative;width:100%;height:22px;appearance:none;background:transparent;cursor:pointer;z-index:1}
input[type=range]::-webkit-slider-thumb{appearance:none;width:18px;height:18px;border-radius:50%;background:var(--hi);border:2px solid var(--cyan);box-shadow:0 0 4px rgba(0,212,255,.4)}
input[type=range].ws::-webkit-slider-thumb{border-color:var(--amb)}
input[type=range].ls::-webkit-slider-thumb{border-color:var(--red)}
input[type=range]:disabled{cursor:not-allowed;opacity:.4}
.jinp{display:flex;align-items:center;gap:6px}
.numinp{width:64px;background:var(--card);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 6px;text-align:center;outline:none}
.numinp:focus{border-color:var(--cyan)}
.numinp.wi{border-color:var(--amb);color:var(--amb)}
.numinp.li{border-color:var(--red);color:var(--red)}
.numinp:disabled{opacity:.4;cursor:not-allowed}
.sbtn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:var(--card);border:1px solid var(--b0);border-radius:6px;color:var(--mid);cursor:pointer;font-size:15px;user-select:none;flex-shrink:0}
.sbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan)}
.sbtn[disabled]{opacity:.3;cursor:not-allowed}

/* ── Speed / presets ── */
.spd-row{display:flex;gap:6px;margin-bottom:14px}
.spd{flex:1;padding:8px 4px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:11px;font-weight:700;cursor:pointer;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd-rate{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo)}
.spd.on .spd-rate{color:var(--cyan)}

.pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media(max-width:700px){.pgrid{grid-template-columns:repeat(2,1fr)}}
.pbtn{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);cursor:pointer;font-size:10px;font-weight:600}
.pbtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.pbtn:disabled{opacity:.3;cursor:not-allowed}
.pbtn .ico{font-size:15px}
.pbtn.add{border-style:dashed;color:var(--lo)}
.pbtn.add:hover:not(:disabled){border-color:var(--grn);color:var(--grn)}
.pbtn-del{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:var(--red);color:#fff;font-size:9px;line-height:16px;text-align:center;border:1px solid var(--bg);cursor:pointer}
.act-row{display:flex;gap:8px;margin-top:12px}
.abtn{flex:1;padding:9px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:11px;font-weight:600;cursor:pointer}
.abtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.abtn:disabled{opacity:.3;cursor:not-allowed}

.pwr-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pwr-label{display:flex;flex-direction:column;gap:2px}
.pwr-title{font-size:12px;font-weight:700;color:var(--hi)}
.pwr-sub{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo)}
.tgl{width:44px;height:24px;border-radius:12px;background:var(--b1);position:relative;cursor:pointer;border:none;flex-shrink:0}
.tgl.on{background:var(--grn)}
.tgl-thumb{width:18px;height:18px;border-radius:50%;background:var(--hi);position:absolute;top:3px;left:3px;transition:left .12s}
.tgl.on .tgl-thumb{left:23px;background:#04160D}
.tgl:disabled{opacity:.4;cursor:not-allowed}

.teach-status{padding:10px 12px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;display:flex;align-items:center;gap:8px;margin-bottom:12px}
.teach-status.on{background:var(--pdim);border:1px solid var(--purple);color:var(--purple)}
.teach-status.off{background:var(--gdim);border:1px solid var(--grn);color:var(--grn)}
.record-btn{width:100%;padding:12px;background:var(--rdim);border:1px solid var(--red);border-radius:var(--r);color:var(--red);font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.05em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px}
.record-btn:hover:not(:disabled){background:var(--red);color:#fff}
.record-btn:disabled{opacity:.3;cursor:not-allowed}
.record-btn .rdot{width:9px;height:9px;border-radius:50%;background:currentColor}
.wp-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace}
.wp-row:hover{background:var(--hover)}
.wp-name{font-size:11px;font-weight:700;color:var(--hi)}
.wp-vals{font-size:9px;color:var(--lo);margin-top:2px}
.wp-del{background:transparent;border:1px solid var(--b1);border-radius:5px;color:var(--mid);font-size:9px;padding:4px 8px;cursor:pointer}
.wp-del:hover{border-color:var(--red);color:var(--red)}
.wp-empty{padding:30px 12px;text-align:center;font-size:11px;color:var(--lo)}
.play-row{display:flex;gap:8px}
.pbtn2{flex:1;padding:10px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.pbtn2.primary{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn2.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}
.pbtn2:disabled{opacity:.3;cursor:not-allowed}

.jax{padding:14px 0;border-bottom:1px solid var(--b0)}
.jax:last-child{border-bottom:none}
.axlbl{font-size:12px;color:var(--mid);margin-bottom:8px;display:flex;align-items:center;gap:8px;font-weight:600}
.axdot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.jog-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.jbtn{padding:16px 6px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:11px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}
.jbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan)}
.jbtn.mid{background:var(--panel);color:var(--lo);cursor:default;font-size:10px}
.jbtn[disabled]{opacity:.3;cursor:not-allowed}
.jarr{font-size:20px}
.zero-btn{margin-top:14px;padding:10px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:11px;font-weight:600;cursor:pointer;width:100%}
.zero-btn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.zero-btn:disabled{opacity:.3;cursor:not-allowed}

.vizwrap{display:flex;flex-direction:column;align-items:center}
.vizleg{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:10px}
.vli{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mid)}
.vld{width:12px;height:4px;border-radius:2px}

/* ── Diagnostics ── */
.kpigrid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--b0)}
.kpi{background:var(--panel);padding:12px 14px}
.kpi-lbl{font-size:9px;color:var(--lo);letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px;font-weight:700}
.kpi-val{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--hi)}
.kpi-val.ok{color:var(--grn)}
.kpi-val.warn{color:var(--amb)}
.kpi-val.err{color:var(--red)}
.topic-row{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:10px}
.topic-name{color:var(--cyan)}
.topic-meta{display:flex;gap:10px}
.topic-hz{color:var(--grn)}
.topic-cnt{color:var(--lo)}

.rt-row{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.rt-taglabel{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo)}
.rt-select{flex:1;background:var(--card);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:11px;padding:6px 8px}
.rt-btn{padding:7px 14px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;cursor:pointer;border:1px solid var(--cyan);color:var(--cyan);background:var(--cdim)}
.rt-btn.stop{border-color:var(--red);color:var(--red);background:var(--rdim)}
.rt-btn:disabled{opacity:.3;cursor:not-allowed}
.rt-chart-wrap{height:160px;margin-bottom:12px}
.rt-empty{padding:20px;text-align:center;font-size:11px;color:var(--lo)}
.rt-summary{display:flex;gap:14px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:11px;padding-top:10px;border-top:1px solid var(--b0)}
.rt-summary b{color:var(--hi)}
.rt-summary.warn b{color:var(--amb)}
.rt-summary.ok b{color:var(--grn)}
.rt-csv{margin-left:auto;padding:5px 10px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.rt-csv:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.rt-csv:disabled{opacity:.3;cursor:not-allowed}

.fg-link{width:100%;padding:12px;background:var(--purple);border:none;border-radius:var(--r);color:#04160D;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:800;letter-spacing:.05em;cursor:pointer;text-transform:uppercase;margin-bottom:10px}
.fg-link:hover{background:#D896FF}
.node-row{padding:6px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mid);border-bottom:1px solid var(--b0)}

.log-hdr{display:flex;align-items:center;justify-content:space-between}
.logwrap{max-height:260px;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:11px;margin-top:10px}
.lent{display:flex;gap:8px;padding:6px 0;border-top:1px solid var(--b0);align-items:baseline}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}
.clearbtn{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);background:var(--card);padding:5px 10px;border-radius:5px;border:1px solid var(--b0);cursor:pointer}

.fbrow{padding:10px 0;border-bottom:1px solid var(--b0)}
.fbrow:last-child{border-bottom:none}
.fbtop{display:flex;justify-content:space-between;margin-bottom:3px}
.fbbot{display:flex;justify-content:space-between;margin-bottom:5px}
.fbbar-track{height:4px;background:var(--b1);border-radius:2px;overflow:hidden}
.fbbar-fill{height:100%;border-radius:2px}

/* ── Remote link — the ONE place MQTT/remote lives, nowhere else ── */
.remote-card{border-color:var(--b1)}
.remote-status-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.remote-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.remote-dot.linked{background:var(--grn);animation:remotepulse 1.5s infinite}
.remote-dot.connecting{background:var(--amb)}
.remote-dot.error{background:var(--red)}
.remote-dot.offline{background:var(--lo)}
.remote-dot.idle{background:var(--lo)}
.remote-label{font-size:12px;font-weight:700;color:var(--hi)}
.remote-sub{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo)}
.remote-addr-row{display:flex;align-items:center;gap:8px}
.remote-addr-input{flex:1;background:var(--card);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:11px;padding:7px 9px;outline:none}
.remote-addr-input:focus{border-color:var(--cyan)}
.remote-reset{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--cyan);background:var(--cdim);border:1px solid var(--cyan);border-radius:5px;padding:6px 10px;cursor:pointer;white-space:nowrap}
.remote-note{font-size:10px;color:var(--lo);margin-top:10px;line-height:1.5}
.remote-active-tag{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--grn);background:var(--gdim);border:1px solid var(--grn);border-radius:12px;padding:2px 8px}

.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.06);border:3px solid var(--red);pointer-events:none;z-index:999}
.estop-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--red);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;padding:6px 22px;border-radius:0 0 8px 8px;z-index:1000}
.demo-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--purple);color:#0D1117;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 16px;border-radius:0 0 6px 6px;z-index:998}

.strip{display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--panel);border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mid)}
.sdot{width:6px;height:6px;border-radius:50%;background:var(--lo);flex-shrink:0}
.sdot.ok{background:var(--grn)}
.sdot.warn{background:var(--amb)}
.sdot.err{background:var(--red)}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000}
.modal{background:var(--panel);border:1px solid var(--b0);border-radius:var(--rl);padding:20px;width:320px}
.modal-title{font-size:14px;font-weight:700;margin-bottom:8px}
.modal-body{font-size:12px;color:var(--mid);margin-bottom:16px;line-height:1.5}
.modal-actions{display:flex;gap:8px}
.modal-btn{flex:1;padding:10px;border-radius:var(--r);font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.modal-btn.confirm{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.modal-btn.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}

.fgmodal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:3000}
.fgmodal{background:var(--panel);border:1px solid var(--purple);border-radius:var(--rl);width:90vw;height:85vh;display:flex;flex-direction:column;overflow:hidden}
.fgmodal-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--b0);background:var(--card)}
.fgmodal-title{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:var(--purple)}
.fgmodal-tab{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--cyan);text-decoration:none;padding:5px 10px;border:1px solid var(--cyan);border-radius:5px}
.fgmodal-close{width:26px;height:26px;border-radius:5px;background:transparent;border:1px solid var(--b1);color:var(--mid);cursor:pointer}
.fgmodal-close:hover{border-color:var(--red);color:var(--red)}
.fgmodal-frame{flex:1;border:none;width:100%;background:#000}
.fgmodal-note{padding:6px 14px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);border-top:1px solid var(--b0)}

@media(max-width:768px){
  .hdr{flex-wrap:wrap;height:auto;min-height:var(--hdr);padding:8px 10px}
  .hdr-center{order:3;width:100%;margin-top:6px}
  .tabbtn{padding:0 10px;font-size:9px}
  .hbtn,.mode-toggle,.sbtn,.jbtn,.pbtn,.pbtn2{min-height:44px}
}
`;

function TrendChart({ results }) {
  if (!results.length) return null;
  const W=560, H=160, padL=24, padR=12, padT=12, padB=20;
  const n=results.length;
  const maxErr=Math.max(5, ...results.map(r=>r.err))*1.15;
  const x=i=> padL + (n===1?0:(i/(n-1)))*(W-padL-padR);
  const y=v=> H-padB - (v/maxErr)*(H-padT-padB);
  const dot=(err)=> err<1?"#00FF9D":err<3?"#FFB800":"#FF3B3B";
  const pathD=results.map((r,i)=>`${i===0?"M":"L"} ${x(i).toFixed(1)} ${y(r.err).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%"}} preserveAspectRatio="none">
      <line x1={padL} y1={y(1)} x2={W-padR} y2={y(1)} stroke="#00FF9D" strokeWidth=".7" strokeDasharray="3 3" opacity=".35"/>
      <line x1={padL} y1={y(3)} x2={W-padR} y2={y(3)} stroke="#FFB800" strokeWidth=".7" strokeDasharray="3 3" opacity=".35"/>
      <line x1={padL} y1={H-padB} x2={W-padR} y2={H-padB} stroke="#253545" strokeWidth=".8"/>
      <line x1={padL} y1={padT} x2={padL} y2={H-padB} stroke="#253545" strokeWidth=".8"/>
      <path d={pathD} fill="none" stroke="#00D4FF" strokeWidth="2"/>
      {results.map((r,i)=>(
        <circle key={r.run} cx={x(i)} cy={y(r.err)} r="3.5" fill={dot(r.err)} stroke="#0D1117" strokeWidth="1"/>
      ))}
      <text x={padL} y={padT-1} fontSize="9" fill="#3D4E5E" fontFamily="monospace">{maxErr.toFixed(0)}°</text>
      <text x={padL} y={H-padB+13} fontSize="9" fill="#3D4E5E" fontFamily="monospace">run 1</text>
      <text x={W-padR} y={H-padB+13} fontSize="9" fill="#3D4E5E" fontFamily="monospace" textAnchor="end">run {n}</text>
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

function FoxgloveModal({ open, robotIp, onClose }) {
  if (!open) return null;
  const fgTarget = `ws://${robotIp}:8765`;
  const fgUrl = `https://app.foxglove.dev/?ds=foxglove-websocket&ds.url=${encodeURIComponent(fgTarget)}`;
  return (
    <div className="fgmodal-bg" onClick={onClose}>
      <div className="fgmodal" onClick={e=>e.stopPropagation()}>
        <div className="fgmodal-hdr">
          <span className="fgmodal-title">FOXGLOVE 3D VIEW — {fgTarget}</span>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <a href={fgUrl} target="_blank" rel="noopener noreferrer" className="fgmodal-tab">Open in New Tab ↗</a>
            <button className="fgmodal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <iframe src={fgUrl} title="Foxglove" className="fgmodal-frame" />
        <div className="fgmodal-note">Port 8765 (foxglove_bridge), derived from your Robot IP — separate from rosbridge's 9090. If blank: bridge not launched yet, or embedding is blocked — use "Open in New Tab".</div>
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
function SBtn({children,onClick,disabled,speed,title}){
  const h=useLongPress(onClick,speed);
  return <button className="sbtn" disabled={disabled} title={title} {...(disabled?{}:h)}>{children}</button>;
}
function JBtn({children,onClick,disabled,speed}){
  const h=useLongPress(onClick,speed);
  return <button className="jbtn" disabled={disabled} {...(disabled?{}:h)}>{children}</button>;
}

function ArmViz({joints}){
  const cx=100,cy=100,R=d=>(d*Math.PI)/180;
  const sa=R(joints.joint_2-90),ea=R(joints.joint_2+joints.joint_3-90);
  const wa=R(joints.joint_2+joints.joint_3+joints.joint_4-90),ba=R(joints.joint_1);
  const L1=44,L2=32,L3=18;
  const x1=cx+L1*Math.cos(sa),y1=cy+L1*Math.sin(sa);
  const x2=x1+L2*Math.cos(ea),y2=y1+L2*Math.sin(ea);
  const x3=x2+L3*Math.cos(wa),y3=y2+L3*Math.sin(wa);
  const g=joints.joint_6/100,m=(a,b)=>(a+b)/2;
  return(
    <div className="vizwrap">
      <svg viewBox="0 0 200 200" style={{width:"100%",maxWidth:280}}>
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
        <text x={m(cx,x1)-8} y={m(cy,y1)-5} fontSize="7" fill="#00D4FF" fontFamily="Inter" fontWeight="600">Upper Arm</text>
        <text x={m(x1,x2)-5} y={m(y1,y2)-5} fontSize="7" fill="#00FF9D" fontFamily="Inter" fontWeight="600">Forearm</text>
        <text x={m(x2,x3)+3} y={m(y2,y3)-3} fontSize="7" fill="#FFB800" fontFamily="Inter" fontWeight="600">Wrist</text>
        <text x={cx-8} y={cy+18} fontSize="7" fill="#00D4FF" fontFamily="Inter">Base</text>
        <text x={x3+4} y={y3+3} fontSize="7" fill="#FF4D6D" fontFamily="Inter" fontWeight="600">Grip</text>
      </svg>
      <div className="vizleg">
        {[["#00D4FF","Upper Arm"],["#00FF9D","Forearm"],["#FFB800","Wrist"],["#FF4D6D","Gripper"]].map(([c,l])=>(
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
      new ROSLIB.Service({ros:rosInstance,name:"/rosapi/topics",serviceType:"rosapi/Topics"})
        .callService(new ROSLIB.ServiceRequest({}),r=>{ if(r?.topics) setInfo(p=>({...p,topics:r.topics})); });
      new ROSLIB.Service({ros:rosInstance,name:"/rosapi/nodes",serviceType:"rosapi/Nodes"})
        .callService(new ROSLIB.ServiceRequest({}),r=>{ if(r?.nodes) setInfo(p=>({...p,nodes:r.nodes})); });
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
  const [tab,setTab] = useState("arm");
  const [conn,setConn]   = useState("disconnected");
  const [estp,setEstp]   = useState(false);
  const [joints,setJ]    = useState(initJ());
  const [feed,setFeed]   = useState(initJ());
  const [speed,setSpRaw] = useState(initialSpeed());
  const [logs,setLogs]   = useState([]);
  const [hz,setHz]       = useState(0);
  const [confirmAction,setConfirmAction] = useState(null);
  const [showFg,setShowFg] = useState(false);

  const [robotIp,setRobotIpRaw] = useState(initialRobotIp());
  const setRobotIp = useCallback(v=>{ const c=cleanIp(v); setRobotIpRaw(c); safeSet("armctrl_robot_ip", c); },[]);
  const url = `ws://${robotIp}:9090`;

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

  const [remoteIpLinked,setRemoteIpLinked] = useState(initialRemoteLinked());
  const [remoteBrokerUrl,setRemoteBrokerUrlRaw] = useState(()=>initialRemoteUrl() || `ws://${robotIp}:9001`);
  const [remoteStatus,setRemoteStatus] = useState("idle");
  const [remoteActive,setRemoteActive] = useState(false);
  const [remoteActiveJoint,setRemoteActiveJoint] = useState(null);

  useEffect(()=>{
    if(remoteIpLinked){
      const derived = `ws://${robotIp}:9001`;
      setRemoteBrokerUrlRaw(derived);
      safeSet("armctrl_remote_url", derived);
    }
  },[robotIp, remoteIpLinked]);

  const setRemoteBrokerUrl = useCallback(v=>{
    const derived = `ws://${stripProto(v)}`;
    setRemoteBrokerUrlRaw(derived);
    safeSet("armctrl_remote_url", derived);
    setRemoteIpLinked(false);
    safeSet("armctrl_remote_linked","false");
  },[]);
  const resetRemoteToRobotIp = ()=>{ setRemoteIpLinked(true); safeSet("armctrl_remote_linked","true"); };

  const rosRef=useRef(null), pubRef=useRef(null), subRef=useRef(null), powerRef=useRef(null);
  const cntRef=useRef(0), estRef=useRef(false), feedRef=useRef(initJ());
  const logHistoryRef=useRef([]);
  const reconnectAttemptRef=useRef(0), reconnectTimerRef=useRef(null), manualDisconnectRef=useRef(false);
  const speedRef=useRef(speed);
  const disRef=useRef(false);

  useEffect(()=>{estRef.current=estp;},[estp]);
  useEffect(()=>{speedRef.current=speed;},[speed]);
  useEffect(()=>{ safeSet("armctrl_waypoints", JSON.stringify(waypoints)); },[waypoints]);

  const log=useCallback((msg,type="info")=>{
    const entry={msg,type,time:ts(),iso:new Date().toISOString(),joints:{...feedRef.current}};
    logHistoryRef.current.push(entry);
    if(logHistoryRef.current.length>5000) logHistoryRef.current.shift();
    setLogs(p=>[entry,...p.slice(0,99)]);
  },[]);
  useEffect(()=>{const t=setInterval(()=>{setHz(cntRef.current);cntRef.current=0;},1000);return()=>clearInterval(t);},[]);

  const setSp = useCallback(v=>{ setSpRaw(v); safeSet("armctrl_speed", String(v)); },[]);

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
      setTimeout(()=>{ setConn("connected"); log("[SIM] Simulated connection established — no hardware required","success"); }, 400);
      return;
    }
    const ROSLIB=window.ROSLIB;
    if(!ROSLIB){log("roslib.js not loaded — add CDN to index.html","error");return;}
    if(rosRef.current) rosRef.current.close();
    setConn("connecting");
    log(reconnectAttemptRef.current>0 ? `Auto-reconnecting (attempt ${reconnectAttemptRef.current}/8) → ${url}` : `Connecting → ${url}`,"warn");
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
        if(reconnectAttemptRef.current>=8) log("Auto-reconnect gave up after 8 attempts — press Connect to retry manually","error");
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
    if (mode === "mock") { setConn("disconnected"); log("[SIM] Simulated connection closed","warn"); return; }
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
    title:"Resume motion?", body:"Clears the emergency stop and allows the arm to move again. Make sure the area is clear.",
    confirmLabel:"Resume", danger:false,
    run:()=>{ setEstp(false); log("Emergency stop cleared — motion resumed","success"); },
  });

  const confirmOrRun=(opts)=>{
    if(demoMode){ opts.run(); log(`[DEMO] ${opts.title}`,"info"); return; }
    setConfirmAction(opts);
  };

  useEffect(()=>{
    const onKey=(e)=>{
      if(e.code!=="Space") return;
      const tagName=document.activeElement?.tagName;
      if(tagName==="INPUT"||tagName==="TEXTAREA"||tagName==="SELECT") return;
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
    title:`Move to "${p.name}"?`, body:"The arm will move to this saved position. Make sure the area is clear.",
    confirmLabel:"Move Arm", danger:false,
    run:()=>{ setJ(p.values); log(`Preset applied: ${p.name}`,"info"); },
  });
  const requestReset=()=>confirmOrRun({
    title:"Reset all joints to 0°?", body:"This moves every joint back to zero. Make sure the area is clear.",
    confirmLabel:"Reset", danger:false,
    run:()=>{ setJ(initJ()); log("All joints → 0°","info"); },
  });

  const addPreset=()=>{
    const name = window.prompt("Name this position (this is the arm's CURRENT pose):");
    if(!name || !name.trim()) return;
    const trimmed = name.trim();
    if(presets.some(p=>p.name.toLowerCase()===trimmed.toLowerCase())){ log(`A position named "${trimmed}" already exists`,"warn"); return; }
    setPresets(p=>[...p, { name:trimmed, icon:"★", values:{...joints}, builtin:false }]);
    log(`Saved current position as "${trimmed}"`,"success");
  };
  const deletePreset=(name)=>confirmOrRun({
    title:`Delete "${name}"?`, body:"Removes this saved position. This can't be undone.",
    confirmLabel:"Delete", danger:true,
    run:()=>{
      setPresets(p=>p.filter(x=>x.name!==name));
      if(testTarget===name) setTestTarget(presets.find(p=>p.builtin&&p.name!=="Home")?.name || "Grab Ready");
      log(`Deleted position "${name}"`,"warn");
    },
  });

  const publishPower=(on)=>dispatchCommand("ARM_POWER",{on});
  const requestArmPower=(on)=>confirmOrRun({
    title: on ? "Re-energize motors?" : "Enter Teach Mode?",
    body: on
      ? "Motors will re-energize and hold current position. Make sure hands are clear."
      : "Motors de-energize — the arm goes slack and can be moved by hand. Web joint control disables while in Teach Mode.",
    confirmLabel: on ? "Re-energize" : "Enter Teach Mode", danger:false,
    run:()=>{
      setArmPower(on); publishPower(on);
      log(on?"Arm power ON — motors energized":"Arm power OFF — Teach Mode active", on?"success":"warn");
      if(!on) setTab("teach");
    },
  });

  const recordWaypoint=()=>{
    const snapshot={...feedRef.current};
    setWaypoints(p=>[...p,{id:Date.now(),values:snapshot,label:`Point ${p.length+1}`}]);
    log(`Waypoint recorded (Point ${waypoints.length+1})`,"success");
  };
  const deleteWaypoint=(id)=>setWaypoints(p=>p.filter(w=>w.id!==id));
  const clearWaypoints=()=>confirmOrRun({
    title:"Clear all waypoints?", body:"Deletes the entire recorded trajectory. This can't be undone.",
    confirmLabel:"Clear", danger:true,
    run:()=>{ setWaypoints([]); log("Trajectory cleared","warn"); },
  });
  const stopPlayback=()=>{ playCancelRef.current=true; };
  const playTrajectory=()=>{
    if(waypoints.length===0) return;
    confirmOrRun({
      title:"Play recorded trajectory?",
      body:`Moves through ${waypoints.length} waypoint(s) in sequence. Motors must be powered ON. Make sure the area is clear.`,
      confirmLabel:"Play", danger:false,
      run: async ()=>{
        if(!armPower){ log("Playback blocked — re-energize the arm first","error"); return; }
        playCancelRef.current=false; setPlaying(true);
        log(`Playing trajectory (${waypoints.length} points)`,"info");
        for(const wp of waypoints){
          if(playCancelRef.current) break;
          setJ(prev=>({...prev,...wp.values}));
          await new Promise(res=>setTimeout(res,1500));
        }
        setPlaying(false);
        log(playCancelRef.current?"Playback stopped":"Playback complete", playCancelRef.current?"warn":"success");
      },
    });
  };

  const exportSystemLogCSV=()=>{
    const hist=logHistoryRef.current;
    if(hist.length===0){ log("No system log entries to export","warn"); return; }
    const esc=(s)=>`"${String(s).replace(/"/g,'""')}"`;
    const jointCols=JOINTS.map(j=>j.short).join(",");
    const header=`timestamp_iso,time,type,message,${jointCols}\n`;
    const rows=hist.map(e=>{
      const j=e.joints||{};
      const jointVals=JOINTS.map(jt=>(j[jt.id]??0).toFixed(2)).join(",");
      return `${e.iso},${e.time},${e.type},${esc(e.msg)},${jointVals}`;
    }).join("\n");
    const csv=`# ARM Control — full session log\n# exported,${new Date().toISOString()}\n# entries,${hist.length}\n${header}${rows}\n`;
    const blob=new Blob([csv],{type:"text/csv"});
    const objUrl=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=objUrl; a.download=`arm_session_log_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(objUrl);
    log(`Exported full session log (${hist.length} entries) as CSV`,"success");
  };

  const stopTest=()=>{ testCancelRef.current=true; };
  const exportTestCSV=()=>{
    if(testResults.length===0) return;
    const avg=testResults.reduce((a,r)=>a+r.err,0)/testResults.length;
    const max=Math.max(...testResults.map(r=>r.err));
    const meta=`# target,${testTarget}\n# avg_error_deg,${avg.toFixed(3)}\n# max_error_deg,${max.toFixed(3)}\n# runs,${testResults.length}\n# exported,${new Date().toISOString()}\n`;
    const rows=testResults.map(r=>`${r.run},${r.err.toFixed(3)}`).join("\n");
    const csv=`${meta}run,error_deg\n${rows}\n`;
    const blob=new Blob([csv],{type:"text/csv"});
    const objUrl=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=objUrl; a.download=`repeatability_${testTarget.replace(/\s+/g,"_")}_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(objUrl);
    log(`Exported ${testResults.length} test runs as CSV`,"success");
  };

  const runRepeatabilityTest=(targetPreset,cycles=10)=>{
    const home = presets.find(p=>p.name==="Home") || DEFAULT_PRESETS[0];
    confirmOrRun({
      title:"Run repeatability test?",
      body:`Cycles between Home and "${targetPreset.name}" ${cycles} times, logging position error each stop (~${Math.round(cycles*3)}s).`,
      confirmLabel:"Run Test", danger:false,
      run: async ()=>{
        testCancelRef.current=false; setTestRunning(true); setTestResults([]);
        log(`Repeatability test: ${cycles} cycles → "${targetPreset.name}"`,"info");
        for(let i=0;i<cycles;i++){
          if(testCancelRef.current) break;
          setJ(home.values);
          await new Promise(res=>setTimeout(res,1500));
          setJ(targetPreset.values);
          await new Promise(res=>setTimeout(res,1500));
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

  useEffect(()=>{ disRef.current=dis; },[dis]);

  // ─── HARDWARE REMOTE CONTROL (MQTT) — logic lives ONLY here, UI lives
  //     ONLY in the Diagnostics tab's Remote Control Link card ──────────
  const lastRemoteCmd = useRef(0);
  const remoteActiveTimeout = useRef(null);

  useEffect(() => {
    setRemoteStatus("connecting");
    const client = mqtt.connect(remoteBrokerUrl);

    client.on("connect", () => {
      setRemoteStatus("linked");
      client.subscribe("remote/data");
      log(`Hardware remote linked (${remoteBrokerUrl})`,"success");
    });
    client.on("reconnect", () => setRemoteStatus("connecting"));
    client.on("close", () => setRemoteStatus(prev => prev==="error" ? prev : "offline"));
    client.on("error", (e) => { setRemoteStatus("error"); log(`Remote link error: ${e?.message ?? e}`,"error"); });

    client.on("message", (topic, message) => {
      if (topic !== "remote/data" || estRef.current || disRef.current) return;
      const now = Date.now();
      if (now - lastRemoteCmd.current < 40) return;
      lastRemoteCmd.current = now;
      try {
        const data = JSON.parse(message.toString());
        const jogAmount = JOG_DEG[speedRef.current];
        const DEADZONE_LOW = 1700, DEADZONE_HIGH = 2400;
        let moved = null;
        if (data.joyX < DEADZONE_LOW)  { stepJ("joint_1", -jogAmount); moved="joint_1"; }
        if (data.joyX > DEADZONE_HIGH) { stepJ("joint_1",  jogAmount); moved="joint_1"; }
        if (data.joyY < DEADZONE_LOW)  { stepJ("joint_2", -jogAmount); moved="joint_2"; }
        if (data.joyY > DEADZONE_HIGH) { stepJ("joint_2",  jogAmount); moved="joint_2"; }
        if (data.btn1 === 0) { stepJ("joint_6",  5); moved="joint_6"; }
        if (data.btn2 === 0) { stepJ("joint_6", -5); moved="joint_6"; }
        if (moved) {
          setRemoteActive(true); setRemoteActiveJoint(moved);
          clearTimeout(remoteActiveTimeout.current);
          remoteActiveTimeout.current = setTimeout(()=>{ setRemoteActive(false); setRemoteActiveJoint(null); }, 300);
        }
      } catch (e) { console.error("MQTT parsing error", e); }
    });

    return () => { clearTimeout(remoteActiveTimeout.current); client.end(true); };
  }, [stepJ, remoteBrokerUrl, log]);

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
      <FoxgloveModal open={showFg} robotIp={robotIp} onClose={()=>setShowFg(false)} />

      <div className="shell">
        {/* ── HEADER ── */}
        <header className="hdr">
          <div className="brand"><div className={`bdot ${conn!=="connected"?"off":""}`}/>ARM · CONTROL</div>

          <div className="hdr-center">
            <div className="ip-wrap">
              <span className="ip-label">Robot IP</span>
              <input className="ip-input" value={robotIp} onChange={e=>setRobotIp(e.target.value)} disabled={conn==="connected"||mode==="mock"} spellCheck={false} placeholder="192.168.1.50"/>
              <span className="ip-ports">:9090 rosbridge · :8765 foxglove</span>
            </div>
            <button className={`mode-toggle ${mode==="mock"?"sim":""}`} onClick={()=>setMode(mode==="ros"?"mock":"ros")} disabled={conn!=="disconnected"} title="Local Simulation Mode">{mode==="mock"?"SIM":"LIVE"}</button>
            <button className={`mode-toggle ${demoMode?"demo":""}`} onClick={()=>setDemoMode(d=>!d)} title="Demo Mode — skips confirmations; Resume always still confirms">{demoMode?"DEMO ON":"DEMO OFF"}</button>
            <button className="hbtn conn" onClick={connect} disabled={conn!=="disconnected"}>{conn==="connecting"?"Connecting…":"Connect"}</button>
            <button className="hbtn disc" onClick={disconnect} disabled={conn==="disconnected"}>Disconnect</button>
          </div>

          <div className="hdr-r">
            <div className={`badge ${conn}`}><div className="bdg-dot"/>{conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}</div>
            {estp
              ? <button className="hbtn resume" onClick={handleResume}>CLEAR EMERGENCY</button>
              : <button className="hbtn estop" onClick={handleEstop} title="Emergency Stop — or press SPACE">⬛ Emergency Stop</button>}
          </div>
        </header>

        {/* ── TAB BAR ── */}
        <nav className="tabbar">
          {TABS.map(t=>(
            <button key={t.id} className={`tabbtn ${tab===t.id ? (t.id==="teach"&&!armPower?"teachlit":"on") : ""}`} onClick={()=>setTab(t.id)}>
              {t.label}{t.id==="teach"&&!armPower?" ●":""}
            </button>
          ))}
        </nav>

        {/* ══════════════ LAYER 1: ROBOTIC ARM ══════════════ */}
        {tab==="arm" && (
          <div className="page">
            <div className="grid2">
              <div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Speed</span></div>
                  <div className="card-body">
                    <div className="spd-row">
                      {SPEEDS.map((s,i)=>{
                        const rate=(JOG_DEG[i]/(JOG_MS[i]/1000)).toFixed(1);
                        return <button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSp(i)}><div>{s}</div><div className="spd-rate">{rate}°/s</div></button>;
                      })}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-hdr"><span className="card-title">Joint Controls</span><span className="card-tag">sensor_msgs/JointState</span></div>
                  <div className="card-body">
                    {JOINTS.map(j=>{
                      const val=joints[j.id], fill=fillSt(val,j.min,j.max,j.color);
                      const isN=nearLim(val,j), isA=atLim(val,j), step=JOG_DEG[speed];
                      const isRemote = remoteActiveJoint===j.id;
                      return(
                        <div className={`jrow ${isA?"at":isN?"near":isRemote?"remote":""}`} key={j.id}>
                          <div className="jhdr">
                            <div className="jname"><div className="jdot" style={{background:j.color}}/>{j.label}
                              {isA&&<span className="lbdg at">AT LIMIT</span>}
                              {!isA&&isN&&<span className="lbdg near">NEAR</span>}
                              {!isA&&!isN&&isRemote&&<span className="lbdg remote">REMOTE</span>}
                            </div>
                            <div className={`jval ${isA?"at":isN?"near":""}`} style={isN||isA?{}:{color:j.color}}>{val.toFixed(1)}{j.unit}</div>
                          </div>
                          <div className="jrange">
                            <span className="jmin">{j.min}</span>
                            <div className="swrap"><div className="strk"/><div className="sfill" style={fill}/>
                              <input type="range" className={isA?"ls":isN?"ws":""} min={j.min} max={j.max} step=".5" value={val} onChange={e=>setJabs(j.id,e.target.value)} disabled={dis}/>
                            </div>
                            <span className="jmax">{j.max}</span>
                          </div>
                          <div className="jinp">
                            <SBtn speed={speed} onClick={()=>stepJ(j.id,-step)} disabled={dis}>−</SBtn>
                            <input className={`numinp ${isA?"li":isN?"wi":""}`} type="number" value={val.toFixed(1)} min={j.min} max={j.max} step=".5" onChange={e=>setJabs(j.id,e.target.value)} disabled={dis}/>
                            <SBtn speed={speed} onClick={()=>stepJ(j.id,step)} disabled={dis}>+</SBtn>
                            <span style={{color:"var(--lo)",fontSize:10,marginLeft:4}}>{j.unit}</span>
                            <button className="sbtn" style={{marginLeft:"auto"}} onClick={()=>setJabs(j.id,0)} disabled={dis} title="Zero joint">⊙</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Saved Positions</span></div>
                  <div className="card-body">
                    <div className="pgrid">
                      {presets.map(p=>(
                        <button key={p.name} className="pbtn" onClick={()=>requestPreset(p)} disabled={dis}>
                          {!p.builtin && <span className="pbtn-del" onClick={(e)=>{e.stopPropagation();deletePreset(p.name);}} title="Delete">✕</span>}
                          <span className="ico">{p.icon}</span>{p.name}
                        </button>
                      ))}
                      <button className="pbtn add" onClick={addPreset} disabled={conn!=="connected"}><span className="ico">+</span>Save Current</button>
                    </div>
                    <div className="act-row">
                      <button className="abtn" onClick={requestReset} disabled={dis}>Reset All</button>
                      <button className="abtn" onClick={()=>publish()} disabled={dis}>Publish</button>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Arm Preview</span></div>
                  <div className="card-body"><ArmViz joints={armPower?joints:feed}/></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ LAYER 2: CARTESIAN ══════════════ */}
        {tab==="cart" && (
          <div className="page">
            <div className="card" style={{maxWidth:560}}>
              <div className="card-hdr"><span className="card-title">Cartesian Jog</span><span className="card-tag">hold to move · {JOG_DEG[speed]}°/tick</span></div>
              <div className="card-body">
                {[
                  {axis:"X",label:"Base / Yaw", color:"#00D4FF",id:"joint_1",dir:["←","→"]},
                  {axis:"Y",label:"Shoulder",   color:"#00FF9D",id:"joint_2",dir:["↓","↑"]},
                  {axis:"Z",label:"Elbow",      color:"#FFB800",id:"joint_3",dir:["←","→"]},
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
                <button className="zero-btn" onClick={requestReset} disabled={dis}>Zero All Axes</button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ LAYER 3: TEACH MODE ══════════════ */}
        {tab==="teach" && (
          <div className="page">
            <div className="grid2">
              <div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Arm Power</span></div>
                  <div className="card-body">
                    <div className="pwr-row">
                      <div className="pwr-label">
                        <span className="pwr-title">{armPower?"Energized":"De-energized"}</span>
                        <span className="pwr-sub">{armPower?"NORMAL CONTROL":"BACK-DRIVABLE"}</span>
                      </div>
                      <button className={`tgl ${armPower?"on":""}`} onClick={()=>requestArmPower(!armPower)} disabled={conn!=="connected"||estp}><div className="tgl-thumb"/></button>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Record</span></div>
                  <div className="card-body">
                    <div className={`teach-status ${armPower?"off":"on"}`}>
                      {armPower ? "Motors energized — turn Arm Power off to teach" : "Arm is free — move it by hand, then record"}
                    </div>
                    <button className="record-btn" onClick={recordWaypoint} disabled={armPower||conn!=="connected"||estp}><span className="rdot"/>RECORD WAYPOINT</button>
                  </div>
                </div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Arm Preview</span></div>
                  <div className="card-body"><ArmViz joints={feed}/></div>
                </div>
              </div>

              <div className="card" style={{marginBottom:0}}>
                <div className="card-hdr"><span className="card-title">Trajectory</span><span className="card-tag">{waypoints.length} waypoint(s)</span></div>
                <div style={{maxHeight:400,overflowY:"auto"}}>
                  {waypoints.length===0
                    ? <div className="wp-empty">No waypoints recorded yet.<br/>Turn Arm Power off, then record a few points.</div>
                    : waypoints.map(wp=>(
                      <div className="wp-row" key={wp.id}>
                        <div><div className="wp-name">{wp.label}</div><div className="wp-vals">{JOINTS.map(j=>`${j.short}:${(wp.values[j.id]??0).toFixed(0)}${j.unit}`).join("  ")}</div></div>
                        <button className="wp-del" onClick={()=>deleteWaypoint(wp.id)}>Delete</button>
                      </div>
                    ))
                  }
                </div>
                <div className="card-body">
                  <div className="play-row">
                    <button className="pbtn2 primary" onClick={playTrajectory} disabled={waypoints.length===0||playing||!armPower||conn!=="connected"}>▶ Play</button>
                    <button className="pbtn2" onClick={stopPlayback} disabled={!playing}>■ Stop</button>
                    <button className="pbtn2 danger" onClick={clearWaypoints} disabled={waypoints.length===0}>Clear All</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ LAYER 4: DIAGNOSTICS ══════════════ */}
        {tab==="diag" && (
          <div className="page">
            <div className="card">
              <div className="card-hdr"><span className="card-title">System Status</span></div>
              <div className="kpigrid">
                <div className="kpi"><div className="kpi-lbl">Bridge</div><div className={`kpi-val ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"Online":"Offline"}</div></div>
                <div className="kpi"><div className="kpi-lbl">Updates/sec</div><div className="kpi-val">{hz}</div></div>
                <div className="kpi"><div className="kpi-lbl">Max Error</div><div className={`kpi-val ${maxErr>5?"warn":"ok"}`}>{maxErr.toFixed(1)}°</div></div>
                <div className="kpi"><div className="kpi-lbl">ROS Nodes</div><div className="kpi-val ok">{diag.info.nodes.length||"–"}</div></div>
                <div className="kpi"><div className="kpi-lbl">/joint_states</div><div className={`kpi-val ${diag.tlog["/joint_states"].hz>0?"ok":"warn"}`}>{diag.tlog["/joint_states"].hz} Hz</div></div>
                <div className="kpi"><div className="kpi-lbl">Stop State</div><div className={`kpi-val ${estp?"err":"ok"}`}>{estp?"Stopped":"Clear"}</div></div>
              </div>
            </div>

            <div className="grid2">
              <div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">Repeatability Test</span><span className="card-tag">closed-loop accuracy</span></div>
                  <div className="card-body">
                    <div className="rt-row">
                      <span className="rt-taglabel">TARGET</span>
                      <select className="rt-select" value={testTarget} onChange={e=>setTestTarget(e.target.value)} disabled={testRunning}>
                        {presets.filter(p=>p.name!=="Home").map(p=><option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                      {!testRunning
                        ? <button className="rt-btn" onClick={()=>runRepeatabilityTest(testPreset,10)} disabled={conn!=="connected"||!armPower}>RUN ×10</button>
                        : <button className="rt-btn stop" onClick={stopTest}>STOP</button>}
                    </div>
                    <div className="rt-chart-wrap">
                      {testResults.length===0 && !testRunning ? <div className="rt-empty">No results yet — motors must be on</div> : <TrendChart results={testResults} />}
                    </div>
                    {testResults.length>0 && (
                      <div className={`rt-summary ${testMax>3?"warn":"ok"}`}>
                        <span>Avg <b>{testAvg.toFixed(2)}°</b></span>
                        <span>Max <b>{testMax.toFixed(2)}°</b></span>
                        <span>Runs <b>{testResults.length}</b></span>
                        <button className="rt-csv" onClick={exportTestCSV}>Download CSV</button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="card-hdr"><span className="card-title">Topic Bus</span></div>
                  <div>
                    {diag.TRACKED.map(t=>(
                      <div className="topic-row" key={t}><span className="topic-name">{t}</span>
                        <div className="topic-meta"><span className="topic-cnt">{diag.tlog[t].count}</span><span className="topic-hz">{diag.tlog[t].hz}Hz</span></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-hdr"><span className="card-title">System Log</span></div>
                  <div className="card-body">
                    <div className="log-hdr">
                      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>{logs.length} shown · full history exportable</span>
                      <div style={{display:"flex",gap:6}}>
                        <button className="clearbtn" onClick={exportSystemLogCSV}>Export</button>
                        <button className="clearbtn" onClick={()=>setLogs([])}>Clear</button>
                      </div>
                    </div>
                    <div className="logwrap">
                      {logs.length===0 && <div className="lent"><span className="ltm">{ts()}</span><span className="lmsg">Waiting for connection…</span></div>}
                      {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="card">
                  <div className="card-hdr"><span className="card-title">ROS2 Nodes</span><span className="card-tag">{diag.info.nodes.length} active</span></div>
                  <div className="card-body">
                    <button className="fg-link" onClick={()=>{ setShowFg(true); log("Opened Foxglove 3D view","info"); }}>Open Foxglove 3D View</button>
                    <div style={{maxHeight:160,overflowY:"auto"}}>
                      {diag.info.nodes.length===0
                        ? <div style={{fontFamily:"JetBrains Mono",fontSize:10,color:"var(--lo)"}}>{mode==="mock"?"Simulation mode — no ROS nodes":"No nodes yet — connect first"}</div>
                        : diag.info.nodes.map(n=><div className="node-row" key={n}><span style={{color:"var(--cyan)",marginRight:4}}>▸</span>{n}</div>)}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-hdr"><span className="card-title">Feedback vs CMD</span></div>
                  <div className="card-body">
                    {JOINTS.map(j=>{
                      const cmd=joints[j.id]??0, fb=feed[j.id]??0, err=Math.abs(cmd-fb);
                      return(
                        <div className="fbrow" key={j.id}>
                          <div className="fbtop"><span style={{fontSize:11,color:"var(--mid)"}}>{j.label}</span><span style={{fontFamily:"JetBrains Mono",fontSize:10,color:deltaColor(err)}}>Δ{err.toFixed(1)}{j.unit}</span></div>
                          <div className="fbbot"><span style={{fontFamily:"JetBrains Mono",fontSize:11,color:j.color}}>CMD {cmd.toFixed(1)}{j.unit}</span><span style={{fontFamily:"JetBrains Mono",fontSize:11,color:"var(--mid)"}}>FB {fb.toFixed(1)}{j.unit}</span></div>
                          <div className="fbbar-track"><div className="fbbar-fill" style={{width:`${deltaPct(err)}%`,background:deltaColor(err)}}/></div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── THE one and only Remote/MQTT UI in the whole app ── */}
                <div className="card remote-card" style={{marginBottom:0}}>
                  <div className="card-hdr"><span className="card-title">Remote Control Link</span><span className="card-tag">MQTT · placeholder hardware</span></div>
                  <div className="card-body">
                    <div className="remote-status-row">
                      <div className={`remote-dot ${remoteStatus}`}/>
                      <div>
                        <div className="remote-label">
                          {remoteStatus==="linked"?"Linked":remoteStatus==="connecting"?"Connecting":remoteStatus==="error"?"Error":remoteStatus==="idle"?"Idle":"Offline"}
                        </div>
                        <div className="remote-sub">{remoteBrokerUrl}</div>
                      </div>
                      {remoteActive && <span className="remote-active-tag" style={{marginLeft:"auto"}}>{remoteActiveJoint}</span>}
                    </div>
                    <div className="remote-addr-row">
                      <input className="remote-addr-input" value={stripProto(remoteBrokerUrl)} onChange={e=>setRemoteBrokerUrl(e.target.value)} spellCheck={false} placeholder="host:9001"/>
                      {!remoteIpLinked && <button className="remote-reset" onClick={resetRemoteToRobotIp}>Use Robot IP</button>}
                    </div>
                    <div className="remote-note">
                      Auto-follows Robot IP by default (port 9001). Override this only if the remote reaches the Pi via a different address than your browser does — e.g. the ESP32 on a local hotspot IP while the dashboard connects over a VPN IP. Joystick/button mapping is placeholder hardware and expected to change.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STATUS STRIP ── */}
        <div className="strip">
          <div className={`sdot ${conn==="connected"?"ok":conn==="connecting"?"warn":"err"}`}/>
          <span>{mode==="mock"?"simulation mode":"ros2 bridge"}</span>
          <span style={{color:"var(--lo)"}}>·</span>
          <span style={{color:"var(--lo)"}}>{mode==="mock"?"no hardware required":url}</span>
          <span style={{marginLeft:"auto",color:"var(--lo)"}}>ARM·CTRL v4.0 · {ts()}</span>
        </div>
      </div>
    </>
  );
}