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
const stripProto = (s) => String(s).replace(/^wss?:\/\//i,"").replace(/^https?:\/\//i,"");
const hostOf = (wsUrl) => stripProto(wsUrl).split(":")[0].split("/")[0];

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
const initialRemoteLinked = () => safeGet("armctrl_remote_linked","true") !== "false";
const initialRemoteUrl = () => safeGet("armctrl_remote_url", null);

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
  --hdr:52px;--logbar:30px;
}
html,body,#root{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--hi);font-family:'Inter',sans-serif;font-size:12px;line-height:1.4}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:var(--b1);border-radius:3px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes remotepulse{0%{box-shadow:0 0 0 0 rgba(0,255,157,.5)}100%{box-shadow:0 0 0 6px rgba(0,255,157,0)}}
@keyframes fd{0%,100%{border-color:var(--red);background:var(--rdim)}50%{border-color:#F00;background:rgba(255,0,0,.25)}}

.shell{display:grid;grid-template-rows:var(--hdr) 1fr;width:100vw;height:100vh;overflow:hidden}

/* ══════════════ TOP NAV BAR — fixed ══════════════ */
.hdr{display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--panel);border-bottom:1px solid var(--b0);z-index:200;flex-wrap:wrap;min-height:var(--hdr);position:relative}
.brand{display:flex;align-items:center;gap:7px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.05em;color:var(--cyan);flex-shrink:0}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}
.hdr-url-wrap{display:flex;align-items:center;gap:5px;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);padding:4px 9px;min-width:0;flex:0 1 240px}
.hdr-url-label{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo);letter-spacing:.1em;text-transform:uppercase}
.hdr-url-input{background:transparent;border:none;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;outline:none;width:100%;min-width:0}
.hdr-url-input:disabled{opacity:.6}
.mode-toggle{padding:5px 10px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid);flex-shrink:0}
.mode-toggle.sim{border-color:var(--amb);color:var(--amb);background:var(--adim)}
.mode-toggle.demo{border-color:var(--purple);color:var(--purple);background:var(--pdim)}
.mode-toggle:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.mode-toggle:disabled{opacity:.4;cursor:not-allowed}
.badge{display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:9px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;border:1px solid transparent;flex-shrink:0}
.badge.connected{color:var(--grn);border-color:var(--grn);background:var(--gdim)}
.badge.disconnected{color:var(--mid);border-color:var(--b0)}
.badge.connecting{color:var(--amb);border-color:var(--amb);background:var(--adim)}
.bdg-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.connected .bdg-dot{animation:blink 1.5s infinite}
.hbtn{padding:5px 12px;border-radius:var(--r);font-size:9px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;border:1.5px solid transparent;flex-shrink:0}
.hbtn:disabled{opacity:.35;cursor:not-allowed}
.hbtn.conn{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.hbtn.disc{background:transparent;color:var(--mid);border-color:var(--b1)}
.hbtn.estop{background:var(--rdim);border-color:var(--red);color:var(--red);padding:6px 16px;font-weight:800}
.hbtn.estop:hover:not(:disabled){background:var(--red);color:#fff}
.hbtn.resume{background:var(--gdim);border-color:var(--grn);color:var(--grn);font-weight:800}

.speed-wrap{position:relative;flex-shrink:0}
.speed-btn{padding:5px 10px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.05em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid);display:flex;align-items:center;gap:5px}
.speed-btn:hover{border-color:var(--cyan);color:var(--cyan)}
.speed-pop{position:absolute;top:110%;left:0;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);padding:6px;display:flex;gap:5px;z-index:300;box-shadow:0 8px 20px rgba(0,0,0,.4)}
.spd{padding:8px 10px;background:var(--panel);border:1px solid var(--b0);border-radius:6px;color:var(--mid);font-size:10px;font-weight:700;cursor:pointer;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px;white-space:nowrap}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd-rate{font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--lo)}
.spd.on .spd-rate{color:var(--cyan)}

.pwr-hdr{display:flex;align-items:center;gap:7px;padding:4px 10px;border-radius:var(--r);border:1px solid var(--b0);background:var(--bg);flex-shrink:0}
.pwr-hdr-label{display:flex;flex-direction:column;gap:0}
.pwr-hdr-title{font-size:9px;font-weight:700;color:var(--hi)}
.pwr-hdr-sub{font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--lo)}
.tgl{width:34px;height:18px;border-radius:9px;background:var(--b1);position:relative;cursor:pointer;border:none;flex-shrink:0}
.tgl.on{background:var(--grn)}
.tgl-thumb{width:14px;height:14px;border-radius:50%;background:var(--hi);position:absolute;top:2px;left:2px;transition:left .12s}
.tgl.on .tgl-thumb{left:18px;background:#04160D}
.tgl:disabled{opacity:.4;cursor:not-allowed}

.hdr-spacer{flex:1;min-width:8px}

/* ══════════════ BODY: holy-grail grid ══════════════ */
.holygrail{display:grid;grid-template-columns:270px 1fr 270px;grid-template-rows:1fr var(--logbar);grid-template-areas:"left center right" "logbar logbar logbar";height:100%;overflow:hidden}
.spoke-l{grid-area:left;background:var(--panel);border-right:1px solid var(--b0);overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}
.spoke-r{grid-area:right;background:var(--panel);border-left:1px solid var(--b0);overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}
.hub{grid-area:center;display:grid;grid-template-rows:auto 1fr;overflow:hidden;background:#000}
.hub-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--panel);border-bottom:1px solid var(--b0)}
.hub-tag{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--purple);background:var(--pdim);border:1px solid var(--purple);border-radius:14px;padding:4px 12px}
.hub-tab{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--purple);text-decoration:none;padding:4px 10px;border:1px solid var(--purple);border-radius:6px}
.hub-tab:hover{background:var(--pdim)}
.hub-frame{width:100%;height:100%;border:none;background:#000}

.slbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lo);padding:11px 12px 5px;flex-shrink:0}

.ltab-row{display:flex;border-bottom:1px solid var(--b0);flex-shrink:0}
.ltab{flex:1;padding:11px 0;background:transparent;border:none;color:var(--lo);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-bottom:2px solid transparent}
.ltab.on{color:var(--cyan);border-bottom-color:var(--cyan)}
.ltab.teach.on{color:var(--purple);border-bottom-color:var(--purple)}

.jax{padding:8px 12px;border-bottom:1px solid var(--b0)}
.axlbl{font-size:10px;color:var(--mid);margin-bottom:5px;display:flex;align-items:center;gap:5px;font-weight:600}
.axdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.jog-row{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.jbtn{padding:7px 3px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px}
.jbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan)}
.jbtn[disabled]{opacity:.3;cursor:not-allowed}

.jrow{padding:9px 12px;border-bottom:1px solid var(--b0)}
.jrow.near{background:var(--adim);border-left:3px solid var(--amb)}
.jrow.at{background:var(--rdim);border-left:3px solid var(--red);animation:fd 1s infinite}
.jrow.remote{border-left:3px solid var(--grn)}
.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.jname{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600}
.jdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.jval{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;min-width:50px;text-align:right}
.jval.near{color:var(--amb)!important}
.jval.at{color:var(--red)!important}
.jrange{display:flex;align-items:center;gap:6px}
.swrap{flex:1;position:relative;height:18px;display:flex;align-items:center}
.strk{position:absolute;left:0;right:0;height:3px;background:var(--b1);border-radius:2px}
.sfill{position:absolute;height:3px;border-radius:2px}
input[type=range]{position:relative;width:100%;height:18px;appearance:none;background:transparent;cursor:pointer;z-index:1}
input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:var(--hi);border:2px solid var(--cyan)}
input[type=range]:disabled{cursor:not-allowed;opacity:.4}
.sbtn{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:var(--card);border:1px solid var(--b0);border-radius:6px;color:var(--mid);cursor:pointer;font-size:13px;flex-shrink:0}
.sbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan)}
.sbtn[disabled]{opacity:.3;cursor:not-allowed}

.acc{border-top:1px solid var(--b0)}
.acc-hdr{width:100%;display:flex;align-items:center;justify-content:space-between;padding:11px 12px;background:var(--card);border:none;cursor:pointer;text-align:left}
.acc-title{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mid)}
.acc-meta{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo)}
.acc-body{padding:10px 12px}

.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pbtn{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;background:var(--card);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);cursor:pointer;font-size:10px;font-weight:600}
.pbtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.pbtn:disabled{opacity:.3;cursor:not-allowed}
.pbtn.add{border-style:dashed;color:var(--lo)}
.pbtn-del{position:absolute;top:-5px;right:-5px;width:14px;height:14px;border-radius:50%;background:var(--red);color:#fff;font-size:8px;line-height:14px;text-align:center;border:1px solid var(--bg);cursor:pointer}
.act-row{display:flex;gap:6px;margin-top:8px}
.abtn{flex:1;padding:7px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer}
.abtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.abtn:disabled{opacity:.3;cursor:not-allowed}

.teach-status{margin:8px 12px;padding:8px 10px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600}
.teach-status.on{background:var(--pdim);border:1px solid var(--purple);color:var(--purple)}
.teach-status.off{background:var(--gdim);border:1px solid var(--grn);color:var(--grn)}
.record-btn{margin:0 12px 8px;padding:10px;background:var(--rdim);border:1px solid var(--red);border-radius:var(--r);color:var(--red);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;width:calc(100% - 24px)}
.record-btn:disabled{opacity:.3;cursor:not-allowed}
.record-btn .rdot{width:8px;height:8px;border-radius:50%;background:currentColor}
.wp-row{display:flex;align-items:center;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace}
.wp-name{font-size:10px;font-weight:700;color:var(--hi)}
.wp-vals{font-size:8px;color:var(--lo);margin-top:1px}
.wp-del{background:transparent;border:1px solid var(--b1);border-radius:4px;color:var(--mid);font-size:8px;padding:3px 7px;cursor:pointer}
.wp-empty{padding:20px 12px;text-align:center;font-size:10px;color:var(--lo)}
.play-row{display:flex;gap:6px;padding:8px 12px}
.pbtn2{flex:1;padding:8px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.pbtn2.primary{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn2.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}
.pbtn2:disabled{opacity:.3;cursor:not-allowed}

.tgrid2{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0);margin:0 12px 10px;border-radius:var(--r);overflow:hidden}
.tcell{background:var(--card);padding:9px 11px}
.tlbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
.tval{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--hi)}
.tval.ok{color:var(--grn)}
.tval.warn{color:var(--amb)}
.tval.err{color:var(--red)}
.jtrow{display:flex;align-items:center;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:11px}
.jtname{color:var(--mid)}
.jtdelta{font-weight:700}

.rt-row{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.rt-select{flex:1;background:var(--card);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;padding:5px 6px}
.rt-btn{padding:6px 10px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;cursor:pointer;border:1px solid var(--cyan);color:var(--cyan);background:var(--cdim)}
.rt-btn.stop{border-color:var(--red);color:var(--red);background:var(--rdim)}
.rt-btn:disabled{opacity:.3;cursor:not-allowed}
.rt-chart-wrap{height:100px;margin-bottom:8px}
.rt-empty{padding:14px;text-align:center;font-size:10px;color:var(--lo)}
.rt-summary{display:flex;gap:10px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px}
.rt-summary b{color:var(--hi)}
.rt-csv{margin-left:auto;padding:4px 8px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.diag-block{margin-bottom:14px}
.diag-block:last-child{margin-bottom:0}
.diag-block-title{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--lo);margin-bottom:7px}
.topic-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:10px}
.topic-name{color:var(--cyan)}
.topic-hz{color:var(--grn)}
.node-row{padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mid);border-bottom:1px solid var(--b0)}
.remote-status-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.remote-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.remote-dot.linked{background:var(--grn);animation:remotepulse 1.5s infinite}
.remote-dot.connecting{background:var(--amb)}
.remote-dot.error{background:var(--red)}
.remote-dot.offline,.remote-dot.idle{background:var(--lo)}
.remote-addr-row{display:flex;gap:6px}
.remote-addr-input{flex:1;background:var(--card);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;padding:6px 8px}
.remote-reset{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--cyan);background:var(--cdim);border:1px solid var(--cyan);border-radius:5px;padding:5px 8px;cursor:pointer;white-space:nowrap}
.remote-note{font-size:9px;color:var(--lo);margin-top:8px;line-height:1.5}

.logbar{grid-area:logbar;background:var(--panel);border-top:1px solid var(--b0);overflow:hidden;display:flex;flex-direction:column}
.logbar-row{display:flex;align-items:center;gap:8px;padding:0 12px;height:var(--logbar);flex-shrink:0;cursor:pointer}
.logbar-latest{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.logbar-latest .lt{color:var(--lo);margin-right:6px}
.logbar-toggle{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);flex-shrink:0}
.logbar-expand{border-top:1px solid var(--b0);max-height:220px;overflow-y:auto;padding:6px 12px;background:var(--bg)}
.logbar-expand-hdr{display:flex;justify-content:flex-end;gap:6px;padding-bottom:6px}
.clearbtn{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);background:var(--card);padding:4px 8px;border-radius:5px;border:1px solid var(--b0);cursor:pointer}
.lent{display:flex;gap:8px;padding:4px 0;border-top:1px solid var(--b0);align-items:baseline;font-family:'JetBrains Mono',monospace;font-size:10px}
.lent:first-child{border-top:none}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}

.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.06);border:3px solid var(--red);pointer-events:none;z-index:999}
.estop-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--red);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;padding:6px 22px;border-radius:0 0 8px 8px;z-index:1000}
.demo-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--purple);color:#0D1117;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 16px;border-radius:0 0 6px 6px;z-index:998}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000}
.modal{background:var(--panel);border:1px solid var(--b0);border-radius:var(--rl);padding:20px;width:320px}
.modal-title{font-size:14px;font-weight:700;margin-bottom:8px}
.modal-body{font-size:12px;color:var(--mid);margin-bottom:16px;line-height:1.5}
.modal-actions{display:flex;gap:8px}
.modal-btn{flex:1;padding:10px;border-radius:var(--r);font-size:11px;font-family:'JetBrains Mono',monospace;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.modal-btn.confirm{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.modal-btn.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}
`;

function TrendChart({ results }) {
  if (!results.length) return null;
  const W=250, H=90, padL=18, padR=8, padT=8, padB=14;
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
      <path d={pathD} fill="none" stroke="#00D4FF" strokeWidth="1.4"/>
      {results.map((r,i)=><circle key={r.run} cx={x(i)} cy={y(r.err)} r="2.4" fill={dot(r.err)} stroke="#0D1117" strokeWidth=".8"/>)}
      <text x={padL} y={padT-1} fontSize="6" fill="#3D4E5E" fontFamily="monospace">{maxErr.toFixed(0)}°</text>
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

function Accordion({ title, tag, defaultOpen=false, children }){
  const [open,setOpen] = useState(defaultOpen);
  return (
    <div className="acc">
      <button className="acc-hdr" onClick={()=>setOpen(o=>!o)}>
        <span className="acc-title">{title}</span>
        <span className="acc-meta">{tag} {open?"▾":"▸"}</span>
      </button>
      {open && <div className="acc-body">{children}</div>}
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
  const [leftTab,setLeftTab] = useState("control");
  const [speedOpen,setSpeedOpen] = useState(false);
  const [logOpen,setLogOpen] = useState(false);
  const [conn,setConn]   = useState("disconnected");
  const [estp,setEstp]   = useState(false);
  const [joints,setJ]    = useState(initJ());
  const [feed,setFeed]   = useState(initJ());
  const [speed,setSpRaw] = useState(initialSpeed());
  const [logs,setLogs]   = useState([]);
  const [url,setUrlRaw]  = useState(initialUrl());
  const [hz,setHz]       = useState(0);
  const [confirmAction,setConfirmAction] = useState(null);

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
  const [remoteBrokerUrl,setRemoteBrokerUrlRaw] = useState(()=>initialRemoteUrl() || `ws://${hostOf(initialUrl())}:9001`);
  const [remoteStatus,setRemoteStatus] = useState("idle");
  const [remoteActive,setRemoteActive] = useState(false);
  const [remoteActiveJoint,setRemoteActiveJoint] = useState(null);

  useEffect(()=>{
    if(remoteIpLinked){
      const derived = `ws://${hostOf(url)}:9001`;
      setRemoteBrokerUrlRaw(derived);
      safeSet("armctrl_remote_url", derived);
    }
  },[url, remoteIpLinked]);

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

  const setUrl = useCallback(v=>{ const clean="ws://"+stripProto(v); setUrlRaw(clean); safeSet("armctrl_url", clean); },[]);
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
      if(!on) setLeftTab("teach");
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

  const host = hostOf(url);
  const fgTarget = `ws://${host}:8765`;
  const fgUrl = `http://${host}/ui/?ds=foxglove-websocket&ds.url=${encodeURIComponent(fgTarget)}`;
  const latestLog = logs[0];

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
        <header className="hdr">
          <div className="brand"><div className={`bdot ${conn!=="connected"?"off":""}`}/>ARM · CONTROL</div>

          <div className="hdr-url-wrap">
            <span className="hdr-url-label">ws://</span>
            <input className="hdr-url-input" value={stripProto(url)} onChange={e=>setUrl(e.target.value)} disabled={conn==="connected"||mode==="mock"} spellCheck={false}/>
          </div>

          <button className="hbtn conn" onClick={connect} disabled={conn!=="disconnected"}>{conn==="connecting"?"Connecting…":"Connect"}</button>
          <button className="hbtn disc" onClick={disconnect} disabled={conn==="disconnected"}>Disconnect</button>
          <div className={`badge ${conn}`}><div className="bdg-dot"/>{conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}</div>

          <button className={`mode-toggle ${mode==="mock"?"sim":""}`} onClick={()=>setMode(mode==="ros"?"mock":"ros")} disabled={conn!=="disconnected"} title="Local Simulation Mode">{mode==="mock"?"SIM":"LIVE"}</button>
          <button className={`mode-toggle ${demoMode?"demo":""}`} onClick={()=>setDemoMode(d=>!d)} title="Demo Mode — skips confirmations; Resume always still confirms">{demoMode?"DEMO ON":"DEMO OFF"}</button>

          <div className="speed-wrap">
            <button className="speed-btn" onClick={()=>setSpeedOpen(o=>!o)}>SPEED: {SPEEDS[speed].toUpperCase()} {speedOpen?"▾":"▸"}</button>
            {speedOpen && (
              <div className="speed-pop">
                {SPEEDS.map((s,i)=>{
                  const rate=(JOG_DEG[i]/(JOG_MS[i]/1000)).toFixed(1);
                  return <button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>{setSp(i);setSpeedOpen(false);}}><div>{s}</div><div className="spd-rate">{rate}°/t</div></button>;
                })}
              </div>
            )}
          </div>

          <div className="pwr-hdr">
            <div className="pwr-hdr-label">
              <span className="pwr-hdr-title">{armPower?"Energized":"De-energized"}</span>
              <span className="pwr-hdr-sub">{armPower?"NORMAL":"BACK-DRIVABLE"}</span>
            </div>
            <button className={`tgl ${armPower?"on":""}`} onClick={()=>requestArmPower(!armPower)} disabled={conn!=="connected"||estp}><div className="tgl-thumb"/></button>
          </div>

          <div className="hdr-spacer"/>

          {estp
            ? <button className="hbtn resume" onClick={handleResume}>CLEAR EMERGENCY</button>
            : <button className="hbtn estop" onClick={handleEstop} title="Emergency Stop — or press SPACE">⬛ E-STOP</button>}
        </header>

        <div className="holygrail">
          <aside className="spoke-l">
            <div className="ltab-row">
              <button className={`ltab ${leftTab==="control"?"on":""}`} onClick={()=>setLeftTab("control")}>Control</button>
              <button className={`ltab teach ${leftTab==="teach"?"on":""}`} onClick={()=>setLeftTab("teach")}>Teach</button>
            </div>

            {leftTab==="control" ? (
              <>
                <div className="slbl">Cartesian Jog</div>
                {[
                  {axis:"X",label:"Base",     color:"#00D4FF",id:"joint_1",dir:["←","→"]},
                  {axis:"Y",label:"Shoulder", color:"#00FF9D",id:"joint_2",dir:["↓","↑"]},
                  {axis:"Z",label:"Elbow",    color:"#FFB800",id:"joint_3",dir:["←","→"]},
                ].map(({axis,label,color,id,dir})=>(
                  <div className="jax" key={axis}>
                    <div className="axlbl"><div className="axdot" style={{background:color}}/>{axis} {label}</div>
                    <div className="jog-row">
                      <JBtn speed={speed} onClick={()=>stepJ(id,-JOG_DEG[speed])} disabled={dis}>{dir[0]} {axis}−</JBtn>
                      <JBtn speed={speed} onClick={()=>stepJ(id,JOG_DEG[speed])} disabled={dis}>{dir[1]} {axis}+</JBtn>
                    </div>
                  </div>
                ))}

                <div className="slbl">Joint Controls</div>
                {JOINTS.map(j=>{
                  const val=joints[j.id], fill=fillSt(val,j.min,j.max,j.color);
                  const isN=nearLim(val,j), isA=atLim(val,j);
                  const isRemote = remoteActiveJoint===j.id;
                  return(
                    <div className={`jrow ${isA?"at":isN?"near":isRemote?"remote":""}`} key={j.id}>
                      <div className="jhdr">
                        <div className="jname"><div className="jdot" style={{background:j.color}}/>{j.label}</div>
                        <div className={`jval ${isA?"at":isN?"near":""}`} style={isN||isA?{}:{color:j.color}}>{val.toFixed(1)}{j.unit}</div>
                      </div>
                      <div className="jrange">
                        <div className="swrap"><div className="strk"/><div className="sfill" style={fill}/>
                          <input type="range" min={j.min} max={j.max} step=".5" value={val} onChange={e=>setJabs(j.id,e.target.value)} disabled={dis}/>
                        </div>
                        <SBtn speed={speed} onClick={()=>setJabs(j.id,0)} disabled={dis} title="Zero">⊙</SBtn>
                      </div>
                    </div>
                  );
                })}
                <div style={{padding:"8px 12px"}}>
                  <button className="abtn" style={{width:"100%"}} onClick={()=>publish()} disabled={dis}>Publish</button>
                </div>

                <Accordion title="Saved Positions" tag={`${presets.length}`}>
                  <div className="pgrid">
                    {presets.map(p=>(
                      <button key={p.name} className="pbtn" onClick={()=>requestPreset(p)} disabled={dis}>
                        {!p.builtin && <span className="pbtn-del" onClick={(e)=>{e.stopPropagation();deletePreset(p.name);}}>✕</span>}
                        <span>{p.icon}</span>{p.name}
                      </button>
                    ))}
                    <button className="pbtn add" onClick={addPreset} disabled={conn!=="connected"}>+ Save</button>
                  </div>
                  <div className="act-row"><button className="abtn" onClick={requestReset} disabled={dis}>Reset All</button></div>
                </Accordion>
              </>
            ) : (
              <>
                <div className="teach-status" style={{margin:"10px 12px"}}>
                  {armPower ? "Motors energized — toggle Arm Power in the top bar to teach" : "Arm is free — move it by hand, then record"}
                </div>
                <button className="record-btn" onClick={recordWaypoint} disabled={armPower||conn!=="connected"||estp}><span className="rdot"/>RECORD WAYPOINT</button>

                <div className="slbl">Trajectory ({waypoints.length})</div>
                <div style={{maxHeight:320,overflowY:"auto"}}>
                  {waypoints.length===0
                    ? <div className="wp-empty">No waypoints yet.</div>
                    : waypoints.map(wp=>(
                      <div className="wp-row" key={wp.id}>
                        <div><div className="wp-name">{wp.label}</div><div className="wp-vals">{JOINTS.map(j=>`${j.short}:${(wp.values[j.id]??0).toFixed(0)}`).join(" ")}</div></div>
                        <button className="wp-del" onClick={()=>deleteWaypoint(wp.id)}>DEL</button>
                      </div>
                    ))}
                </div>
                <div className="play-row">
                  <button className="pbtn2 primary" onClick={playTrajectory} disabled={waypoints.length===0||playing||!armPower||conn!=="connected"}>▶ Play</button>
                  <button className="pbtn2" onClick={stopPlayback} disabled={!playing}>■ Stop</button>
                  <button className="pbtn2 danger" onClick={clearWaypoints} disabled={waypoints.length===0}>Clear</button>
                </div>
              </>
            )}
          </aside>

          <main className="hub">
            <div className="hub-bar">
              <span className="hub-tag">FOXGLOVE 3D — HUB</span>
              <a href={fgUrl} target="_blank" rel="noopener noreferrer" className="hub-tab">Open in New Tab ↗</a>
            </div>
            <iframe src={fgUrl} title="Foxglove" className="hub-frame"/>
          </main>

          <aside className="spoke-r">
            <div className="slbl">Telemetry &amp; Status</div>
            <div className="tgrid2">
              <div className="tcell"><div className="tlbl">Remote Link</div><div className={`tval ${remoteStatus==="linked"?"ok":remoteStatus==="error"?"err":"warn"}`}>{remoteStatus.toUpperCase()}</div></div>
              <div className="tcell"><div className="tlbl">Active Input</div><div className="tval" style={{color:remoteActive?"var(--grn)":"var(--cyan)"}}>{remoteActive?"REMOTE":"WEB UI"}</div></div>
              <div className="tcell"><div className="tlbl">Max Error</div><div className={`tval ${maxErr>5?"warn":"ok"}`}>{maxErr.toFixed(1)}°</div></div>
              <div className="tcell"><div className="tlbl">Limits</div><div className={`tval ${anyNear?"warn":"ok"}`}>{anyNear?"WARN":"OK"}</div></div>
            </div>

            <div className="slbl">Joint Tracking</div>
            <div>
              {JOINTS.map(j=>{
                const err=Math.abs((joints[j.id]||0)-(feed[j.id]||0));
                return(
                  <div className="jtrow" key={j.id}>
                    <span className="jtname">{j.short}</span>
                    <span className="jtdelta" style={{color:deltaColor(err)}}>Δ{err.toFixed(1)}{j.unit}</span>
                  </div>
                );
              })}
            </div>

            <Accordion title="ROS Diagnostics" tag="advanced" defaultOpen={false}>
              <div className="diag-block">
                <div className="diag-block-title">System Status</div>
                <div className="tgrid2" style={{margin:0}}>
                  <div className="tcell"><div className="tlbl">Bridge</div><div className={`tval ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"ONLINE":"OFFLINE"}</div></div>
                  <div className="tcell"><div className="tlbl">Pub Hz</div><div className="tval">{hz}</div></div>
                  <div className="tcell"><div className="tlbl">ROS Nodes</div><div className="tval ok">{diag.info.nodes.length||"–"}</div></div>
                  <div className="tcell"><div className="tlbl">/joint_states</div><div className={`tval ${diag.tlog["/joint_states"].hz>0?"ok":"warn"}`}>{diag.tlog["/joint_states"].hz} Hz</div></div>
                </div>
              </div>

              <div className="diag-block">
                <div className="diag-block-title">Repeatability Test</div>
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

              <div className="diag-block">
                <div className="diag-block-title">Topic Bus</div>
                {diag.TRACKED.map(t=>(
                  <div className="topic-row" key={t}><span className="topic-name">{t}</span>
                    <span className="topic-hz">{diag.tlog[t].count} · {diag.tlog[t].hz}Hz</span>
                  </div>
                ))}
              </div>

              <div className="diag-block">
                <div className="diag-block-title">ROS2 Nodes ({diag.info.nodes.length})</div>
                <div style={{maxHeight:110,overflowY:"auto"}}>
                  {diag.info.nodes.length===0
                    ? <div style={{fontFamily:"JetBrains Mono",fontSize:10,color:"var(--lo)"}}>{mode==="mock"?"Simulation mode":"No nodes yet"}</div>
                    : diag.info.nodes.map(n=><div className="node-row" key={n}>▸ {n}</div>)}
                </div>
              </div>

              <div className="diag-block">
                <div className="diag-block-title">Remote Control Link</div>
                <div className="remote-status-row">
                  <div className={`remote-dot ${remoteStatus}`}/>
                  <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:"var(--lo)"}}>{remoteBrokerUrl}</span>
                </div>
                <div className="remote-addr-row">
                  <input className="remote-addr-input" value={stripProto(remoteBrokerUrl)} onChange={e=>setRemoteBrokerUrl(e.target.value)} spellCheck={false}/>
                  {!remoteIpLinked && <button className="remote-reset" onClick={resetRemoteToRobotIp}>Use ROS IP</button>}
                </div>
                <div className="remote-note">Auto-follows the rosbridge host by default (port 9001). Override only if the remote reaches the Pi via a different address than your browser does.</div>
              </div>
            </Accordion>
          </aside>

          <div className="logbar">
            <div className="logbar-row" onClick={()=>setLogOpen(o=>!o)}>
              <div style={{background: estp?"var(--red)":"var(--grn)", width:6, height:6, borderRadius:"50%", flexShrink:0}}/>
              <div className="logbar-latest">
                {latestLog ? <><span className="lt">{latestLog.time}</span>{latestLog.msg}</> : "System log — waiting for activity…"}
              </div>
              <span className="logbar-toggle">{logs.length} entries {logOpen?"▾":"▸"}</span>
            </div>
            {logOpen && (
              <div className="logbar-expand">
                <div className="logbar-expand-hdr">
                  <button className="clearbtn" onClick={exportSystemLogCSV}>Export Full History</button>
                  <button className="clearbtn" onClick={()=>setLogs([])}>Clear</button>
                </div>
                {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}