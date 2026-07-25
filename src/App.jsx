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
// Strips any accidentally-pasted protocol so the address field always ends
// up correct, instead of just warning the user not to type ws://http://.
const stripProto = (s) => s.replace(/^wss?:\/\//i,"").replace(/^https?:\/\//i,"");
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
const initialRemoteUrl = () => safeGet("armctrl_remote_url", "ws://192.168.137.78:9001");

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

.shell{display:grid;grid-template-rows:var(--hdr) 1fr var(--strip);width:100vw;height:100vh;overflow:hidden}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 14px;background:var(--panel);border-bottom:1px solid var(--b0);z-index:100;overflow:hidden}
.brand{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.05em;color:var(--cyan);flex-shrink:0}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes fw{0%,100%{border-color:var(--amb);background:var(--adim)}50%{border-color:#F80;background:rgba(255,120,0,.2)}}
@keyframes fd{0%,100%{border-color:var(--red);background:var(--rdim)}50%{border-color:#F00;background:rgba(255,0,0,.25)}}
@keyframes remotepulse{0%{box-shadow:0 0 0 0 rgba(0,255,157,.5)}100%{box-shadow:0 0 0 6px rgba(0,255,157,0)}}

.hdr-center{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;min-width:0}
.hdr-r{display:flex;align-items:center;gap:8px;flex-shrink:0}

.hdr-url-wrap{display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);padding:3px 8px;min-width:0;flex:0 1 320px}
.hdr-url-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.hdr-url-input{background:transparent;border:none;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;outline:none;width:100%;min-width:0}
.hdr-url-input:disabled{opacity:.6}

.mode-pill{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.mode-pill.run{background:var(--cdim);color:var(--cyan)}
.mode-pill.teach{background:var(--pdim);color:var(--purple)}

.remote-pill{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--b0);color:var(--lo);background:transparent;flex-shrink:0}
.remote-pill.linked{border-color:var(--grn);color:var(--grn);background:var(--gdim)}
.remote-pill.connecting{border-color:var(--amb);color:var(--amb);background:var(--adim)}
.remote-pill.error{border-color:var(--red);color:var(--red);background:var(--rdim)}
.remote-pill.active{animation:remotepulse .3s ease-out}

.mode-toggle{padding:4px 10px;border-radius:14px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid);flex-shrink:0}
.mode-toggle.sim{border-color:var(--amb);color:var(--amb);background:var(--adim)}
.mode-toggle.demo{border-color:var(--purple);color:var(--purple);background:var(--pdim)}
.mode-toggle.demo:hover:not(:disabled){background:var(--purple);color:#0D1117}
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

/* ── Body ── */
.body{display:grid;grid-template-columns:240px 1fr 220px;overflow:hidden;width:100%;height:100%}
.side{background:var(--panel);overflow:hidden;display:flex;flex-direction:column;min-height:0}
.side-l{border-right:1px solid var(--b0)}
.side-r{border-left:1px solid var(--b0)}
.slbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lo);padding:10px 12px 4px;flex-shrink:0}

.spd-row{display:flex;padding:5px 10px;gap:4px}
.spd{flex:1;padding:5px 2px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd:hover:not(.on){border-color:var(--b1);color:var(--hi)}
.spd-rate{font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--lo)}
.spd.on .spd-rate{color:var(--cyan)}

.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:5px 10px}
.pbtn{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);cursor:pointer;font-size:9px;font-weight:500;transition:all .15s}
.pbtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn:disabled{opacity:.3;cursor:not-allowed}
.pbtn .ico{font-size:12px}
.pbtn.add{border-style:dashed;color:var(--lo)}
.pbtn.add:hover:not(:disabled){border-color:var(--grn);color:var(--grn);background:var(--gdim)}
.pbtn-del{position:absolute;top:-5px;right:-5px;width:14px;height:14px;border-radius:50%;background:var(--red);color:#fff;font-size:8px;line-height:14px;text-align:center;border:1px solid var(--bg);cursor:pointer}

.act-row{display:flex;gap:4px;padding:5px 10px}
.abtn{flex:1;padding:5px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;transition:all .15s;text-align:center}
.abtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.abtn:disabled{opacity:.3;cursor:not-allowed}

.pwr-row{display:flex;align-items:center;justify-content:space-between;padding:6px 10px 8px;gap:8px}
.pwr-label{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.pwr-title{font-size:10px;font-weight:600;color:var(--hi)}
.pwr-sub{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo)}
.tgl{width:38px;height:20px;border-radius:10px;background:var(--b1);position:relative;cursor:pointer;border:none;flex-shrink:0}
.tgl.on{background:var(--grn)}
.tgl-thumb{width:16px;height:16px;border-radius:50%;background:var(--hi);position:absolute;top:2px;left:2px;transition:left .12s}
.tgl.on .tgl-thumb{left:20px;background:#04160D}
.tgl:disabled{opacity:.4;cursor:not-allowed}

.remote-addr-input{background:var(--panel);border:1px solid var(--b0);border-radius:4px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:8px;padding:3px 5px;width:100%;outline:none;margin-top:3px}
.remote-addr-input:focus{border-color:var(--cyan)}
.remote-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:2px}

.vizwrap{flex:1;overflow:hidden;padding:4px 10px 8px;display:flex;flex-direction:column;min-height:0}
.vizleg{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:4px;flex-shrink:0}
.vli{display:flex;align-items:center;gap:3px;font-size:9px;color:var(--mid)}
.vld{width:8px;height:3px;border-radius:2px}

/* ── Center ── */
.center{display:grid;grid-template-rows:1fr 180px;overflow:hidden;min-width:0;min-height:0}
.ctrl-row{display:grid;grid-template-columns:1fr 1fr;overflow:hidden;gap:0;min-height:0}
.ctrl-col{overflow:hidden;display:flex;flex-direction:column;border-right:1px solid var(--b0);min-height:0}
.ctrl-col:last-child{border-right:none}

.col-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01);flex-shrink:0}
.col-title{font-size:10px;font-weight:700;color:var(--hi);letter-spacing:.05em;text-transform:uppercase}
.col-tag{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);background:var(--panel);padding:2px 6px;border-radius:4px;border:1px solid var(--b0)}
.col-tabs{display:flex;gap:3px}
.col-tab{padding:3px 9px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;border:1px solid var(--b0);background:var(--panel);color:var(--mid)}
.col-tab.on{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.col-tab.purple.on{border-color:var(--purple);color:var(--purple);background:var(--pdim)}

.joints-body{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.jrow{flex:1;padding:0 12px;border-bottom:1px solid var(--b0);display:flex;flex-direction:column;justify-content:center;transition:background .15s;min-height:0}
.jrow:last-child{border-bottom:none}
.jrow:hover{background:var(--hover)}
.jrow.near{animation:fw 1.2s ease-in-out infinite;border-left:3px solid var(--amb)}
.jrow.at{animation:fd .7s ease-in-out infinite;border-left:3px solid var(--red)}
.jrow.remote{border-left:3px solid var(--grn)}

.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.jname{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:500}
.jdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.jval{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;min-width:50px;text-align:right;transition:color .2s}
.jval.near{color:var(--amb)!important}
.jval.at{color:var(--red)!important}
.lbdg{font-family:'JetBrains Mono',monospace;font-size:7px;font-weight:700;letter-spacing:.1em;padding:1px 4px;border-radius:3px;text-transform:uppercase}
.lbdg.near{background:var(--adim);color:var(--amb);border:1px solid var(--amb)}
.lbdg.at{background:var(--rdim);color:var(--red);border:1px solid var(--red)}
.lbdg.remote{background:var(--gdim);color:var(--grn);border:1px solid var(--grn)}

.jrange{display:flex;align-items:center;gap:5px;margin-bottom:3px}
.jmin,.jmax{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo);width:24px}
.jmax{text-align:right}
.swrap{flex:1;position:relative;height:16px;display:flex;align-items:center}
.strk{position:absolute;left:0;right:0;height:2px;background:var(--b1);border-radius:2px}
.sfill{position:absolute;height:2px;border-radius:2px;transition:width .05s,left .05s}
input[type=range]{position:relative;width:100%;height:16px;appearance:none;background:transparent;cursor:pointer;z-index:1}
input[type=range]::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:var(--hi);border:2px solid var(--cyan);box-shadow:0 0 4px rgba(0,212,255,.4);transition:transform .1s}
input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.2);box-shadow:0 0 9px rgba(0,212,255,.6)}
input[type=range].ws::-webkit-slider-thumb{border-color:var(--amb);box-shadow:0 0 6px rgba(255,184,0,.5)}
input[type=range].ls::-webkit-slider-thumb{border-color:var(--red);box-shadow:0 0 6px rgba(255,59,59,.6)}
input[type=range]:disabled::-webkit-slider-thumb{border-color:var(--lo);box-shadow:none}
input[type=range]:disabled{cursor:not-allowed;opacity:.4}

.jinp{display:flex;align-items:center;gap:4px}
.numinp{width:54px;background:var(--panel);border:1px solid var(--b0);border-radius:4px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;padding:2px 5px;text-align:center;outline:none;transition:border-color .15s}
.numinp:focus{border-color:var(--cyan)}
.numinp.wi{border-color:var(--amb);color:var(--amb)}
.numinp.li{border-color:var(--red);color:var(--red)}
.numinp:disabled{opacity:.4;cursor:not-allowed}
.sbtn{width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--b0);border-radius:4px;color:var(--mid);cursor:pointer;font-size:13px;transition:all .1s;user-select:none;-webkit-user-select:none;touch-action:none;flex-shrink:0}
.sbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.sbtn:active:not([disabled]){transform:scale(.9)}
.sbtn[disabled]{opacity:.3;cursor:not-allowed}

.right-col-inner{flex:1;display:grid;grid-template-rows:auto 1fr;overflow:hidden;min-height:0}
.cart-body{overflow:hidden;display:flex;flex-direction:column;min-height:0}
.jax{padding:5px 10px;border-bottom:1px solid var(--b0);flex-shrink:0}
.axlbl{font-size:9px;color:var(--mid);margin-bottom:3px;display:flex;align-items:center;gap:4px}
.axdot{width:4px;height:4px;border-radius:50%;flex-shrink:0}
.jog-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px}
.jbtn{padding:6px 3px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:9px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:1px;transition:all .15s;user-select:none;-webkit-user-select:none;touch-action:none}
.jbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.jbtn:active:not([disabled]){transform:scale(.93)}
.jbtn.mid{background:var(--card);color:var(--lo);cursor:default;font-size:8px}
.jbtn[disabled]{opacity:.3;cursor:not-allowed}
.jarr{font-size:13px}
.zero-btn{margin:5px 10px;padding:5px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:9px;font-weight:600;cursor:pointer;transition:all .15s;text-align:center;width:calc(100% - 20px)}
.zero-btn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.zero-btn:disabled{opacity:.3;cursor:not-allowed}

/* ── Teach Mode panel ── */
.teach-body{overflow:hidden;display:flex;flex-direction:column;min-height:0}
.teach-status{margin:6px 10px;padding:6px 8px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:600;display:flex;align-items:center;gap:6px;flex-shrink:0}
.teach-status.on{background:var(--pdim);border:1px solid var(--purple);color:var(--purple)}
.teach-status.off{background:var(--gdim);border:1px solid var(--grn);color:var(--grn)}
.record-btn{margin:0 10px 6px;padding:9px;background:var(--rdim);border:1px solid var(--red);border-radius:var(--r);color:var(--red);font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0}
.record-btn:hover:not(:disabled){background:var(--red);color:#fff}
.record-btn:disabled{opacity:.3;cursor:not-allowed}
.record-btn .rdot{width:8px;height:8px;border-radius:50%;background:currentColor}
.wp-scroll{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;border-top:1px solid var(--b0);min-height:0}
.wp-row{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace}
.wp-row:hover{background:var(--hover)}
.wp-name{font-size:9px;font-weight:700;color:var(--hi)}
.wp-vals{font-size:7px;color:var(--lo);margin-top:1px}
.wp-del{background:transparent;border:1px solid var(--b1);border-radius:4px;color:var(--mid);font-size:8px;padding:3px 7px;cursor:pointer}
.wp-del:hover{border-color:var(--red);color:var(--red)}
.wp-empty{padding:16px 10px;text-align:center;font-size:9px;color:var(--lo)}
.play-row{display:flex;gap:4px;padding:6px 10px;border-top:1px solid var(--b0);flex-shrink:0}
.pbtn2{flex:1;padding:6px;border-radius:var(--r);font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.05em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.pbtn2.primary{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn2.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}
.pbtn2:disabled{opacity:.3;cursor:not-allowed}

.log-section{flex:1;overflow:hidden;display:flex;flex-direction:column;border-top:1px solid var(--b0);min-height:0}
.log-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 11px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01);flex-shrink:0}
.logwrap{flex:1;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:9px;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;display:flex;flex-direction:column-reverse;min-height:0;padding-bottom:8px}
.lent{display:flex;gap:7px;padding:5px 10px;border-top:1px solid var(--b0);align-items:baseline;flex-shrink:0}
.lent:hover{background:var(--hover)}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}

/* ── Diagnostics strip ── */
.diag-strip{display:grid;grid-template-columns:auto 1fr 1fr auto;border-top:2px solid var(--b0);overflow:hidden;height:180px;min-height:0}
.diag-sec{border-right:1px solid var(--b0);overflow:hidden;display:flex;flex-direction:column;min-height:0}
.diag-sec:last-child{border-right:none}
.diag-sec-hdr{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01);flex-shrink:0}
.diag-sec-title{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--lo)}
.diag-kpi{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:1px;background:var(--b0);flex:1;min-height:0;overflow:hidden}
.dkpi{background:var(--card);padding:6px 10px;display:flex;flex-direction:column;justify-content:center;min-height:0;overflow:hidden}
.dkpi-lbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dkpi-val{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--hi);line-height:1;white-space:nowrap}
.dkpi-val.ok{color:var(--grn)}
.dkpi-val.warn{color:var(--amb)}
.dkpi-val.err{color:var(--red)}
.topic-row{display:flex;justify-content:space-between;align-items:center;padding:4px 10px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:9px;flex-shrink:0}
.topic-row:hover{background:var(--hover)}
.topic-name{color:var(--cyan)}
.topic-meta{display:flex;gap:8px}
.topic-hz{color:var(--grn)}
.topic-cnt{color:var(--lo)}
.topic-scroll{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;min-height:0}

.rt-row{display:flex;align-items:center;gap:6px;padding:5px 10px;flex-shrink:0}
.rt-taglabel{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lo);flex-shrink:0}
.rt-select{flex:1;background:var(--panel);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:9px;padding:3px 5px}
.rt-btn{padding:4px 9px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;cursor:pointer;border:1px solid var(--cyan);color:var(--cyan);background:var(--cdim)}
.rt-btn.stop{border-color:var(--red);color:var(--red);background:var(--rdim)}
.rt-btn:disabled{opacity:.3;cursor:not-allowed}
.rt-scroll{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;min-height:0}
.rt-line{display:flex;align-items:center;gap:6px;padding:2px 10px;font-family:'JetBrains Mono',monospace;font-size:8px}
.rt-bar-track{flex:1;height:4px;background:var(--b1);border-radius:2px;overflow:hidden}
.rt-bar-fill{height:100%;border-radius:2px}
.rt-empty{padding:10px;text-align:center;font-size:9px;color:var(--lo)}
.rt-summary{display:flex;gap:10px;padding:5px 10px;border-top:1px solid var(--b0);background:var(--card);flex-shrink:0;font-family:'JetBrains Mono',monospace;font-size:9px;align-items:center}
.rt-summary b{color:var(--hi)}
.rt-summary.warn b{color:var(--amb)}
.rt-summary.ok b{color:var(--grn)}
.rt-chart-wrap{flex:1;min-height:0;padding:4px 8px}
.rt-csv{margin-left:auto;padding:3px 8px;border-radius:5px;font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.04em;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.rt-csv:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.rt-csv:disabled{opacity:.3;cursor:not-allowed}

.nodes-sec{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.fg-link{margin:6px 10px;padding:8px;background:var(--purple);border:1px solid var(--purple);border-radius:6px;color:#04160D;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:800;letter-spacing:.06em;text-align:center;cursor:pointer;text-transform:uppercase;flex-shrink:0;box-shadow:0 0 10px rgba(199,125,255,.35)}
.fg-link:hover{background:#D896FF}
.fg-link:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
.nodes-scroll{flex:1;overflow-y:auto;min-height:0;scrollbar-width:thin;scrollbar-color:var(--b0) transparent}

/* ── Right sidebar ── */
.sr-telem{flex-shrink:0}
.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}
.tcell{background:var(--card);padding:8px 10px}
.tlbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px}
.tval{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--hi);line-height:1}
.tval.ok{color:var(--grn)}
.tval.warn{color:var(--amb)}
.tval.err{color:var(--red)}

.fb-body{flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;scrollbar-width:thin;scrollbar-color:var(--b0) transparent}
.fbrow{padding:6px 10px;border-bottom:1px solid var(--b0);flex-shrink:0}
.fbrow:last-child{border-bottom:none}
.fbtop{display:flex;justify-content:space-between;margin-bottom:1px}
.fbbot{display:flex;justify-content:space-between;margin-bottom:3px}
.fbbar-track{height:3px;background:var(--b1);border-radius:2px;overflow:hidden}
.fbbar-fill{height:100%;border-radius:2px;transition:width .2s,background .2s}

.strip{display:flex;align-items:center;gap:7px;padding:0 12px;background:var(--bg);border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);overflow:hidden}
.sdot{width:5px;height:5px;border-radius:50%;background:var(--lo);flex-shrink:0}
.sdot.ok{background:var(--grn);box-shadow:0 0 5px var(--grn)}
.sdot.warn{background:var(--amb)}
.sdot.err{background:var(--red);animation:blink .8s infinite}

.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.07);border:3px solid var(--red);pointer-events:none;z-index:999;animation:ep .5s ease-in-out infinite alternate}
@keyframes ep{from{opacity:.5}to{opacity:1}}
.estop-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--red);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;padding:5px 22px;border-radius:0 0 8px 8px;z-index:1000}
.demo-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--purple);color:#0D1117;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 16px;border-radius:0 0 6px 6px;z-index:998}

::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-thumb{background:var(--b0);border-radius:2px}

.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000}
.modal{background:var(--panel);border:1px solid var(--b0);border-radius:var(--rl);padding:18px;width:300px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.modal-title{font-size:13px;font-weight:700;margin-bottom:6px;color:var(--hi)}
.modal-body{font-size:11px;color:var(--mid);margin-bottom:14px;line-height:1.5}
.modal-actions{display:flex;gap:6px}
.modal-btn{flex:1;padding:8px;border-radius:var(--r);font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:700;cursor:pointer;border:1px solid var(--b1);background:transparent;color:var(--mid)}
.modal-btn.confirm{border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.modal-btn.danger{border-color:var(--red);color:var(--red);background:var(--rdim)}

.fgmodal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:3000}
.fgmodal{background:var(--panel);border:1px solid var(--purple);border-radius:var(--rl);width:90vw;height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.fgmodal-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--b0);background:var(--card);flex-shrink:0}
.fgmodal-title{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--purple)}
.fgmodal-tab{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--cyan);text-decoration:none;padding:4px 9px;border:1px solid var(--cyan);border-radius:5px}
.fgmodal-tab:hover{background:var(--cdim)}
.fgmodal-close{width:24px;height:24px;border-radius:5px;background:transparent;border:1px solid var(--b1);color:var(--mid);cursor:pointer;font-size:12px}
.fgmodal-close:hover{border-color:var(--red);color:var(--red)}
.fgmodal-frame{flex:1;border:none;width:100%;background:#000}
.fgmodal-note{padding:5px 14px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);border-top:1px solid var(--b0);flex-shrink:0}

@media (max-width:1024px){
  html,body,#root{overflow-y:auto;height:auto}
  .shell{height:auto;min-height:100vh;overflow:visible;grid-template-rows:auto auto auto}
  .body{grid-template-columns:1fr;overflow:visible}
  .side{overflow:visible;min-height:0}
  .side-l{border-right:none;border-bottom:2px solid var(--b0)}
  .side-r{border-left:none;border-top:2px solid var(--b0)}
  .center{grid-template-rows:auto auto;overflow:visible}
  .ctrl-row{grid-template-columns:1fr;overflow:visible}
  .ctrl-col{border-right:none;border-bottom:2px solid var(--b0)}
  .joints-body{overflow:visible}
  .jrow{flex:none;padding:8px 12px}
  .diag-strip{grid-template-columns:1fr 1fr;height:auto}
  .diag-sec{height:240px;border-bottom:1px solid var(--b0)}
  .hdr{flex-wrap:wrap;height:auto;min-height:var(--hdr);padding:8px 10px}
  .hdr-center{order:3;width:100%;justify-content:flex-start;margin-top:6px}
  .hdr-url-wrap{flex:1 1 auto}
  .estop-mushroom,.hbtn,.record-btn,.zero-btn,.rt-btn,.mode-toggle{min-height:44px}
  .sbtn{width:44px;height:44px}
  .jbtn,.pbtn,.pbtn2,.spd{min-height:44px}
  input[type=range]::-webkit-slider-thumb{width:20px;height:20px}
  .cart-body{overflow:visible}
  .wp-scroll,.logwrap,.fb-body,.nodes-scroll,.rt-scroll,.topic-scroll{max-height:260px}
}
`;

// ─── Trend chart ───────────────────────────────────────────────────────────
function TrendChart({ results }) {
  if (!results.length) return null;
  const W=280, H=100, padL=16, padR=8, padT=8, padB=14;
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
      {results.map((r,i)=>(
        <circle key={r.run} cx={x(i)} cy={y(r.err)} r="2.4" fill={dot(r.err)} stroke="#0D1117" strokeWidth=".8"/>
      ))}
      <text x={padL} y={padT-1} fontSize="6" fill="#3D4E5E" fontFamily="monospace">{maxErr.toFixed(0)}°</text>
      <text x={padL} y={H-padB+9} fontSize="6" fill="#3D4E5E" fontFamily="monospace">1</text>
      <text x={W-padR} y={H-padB+9} fontSize="6" fill="#3D4E5E" fontFamily="monospace" textAnchor="end">{n}</text>
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

// Foxglove now connects on 8765 (foxglove_bridge), NOT rosbridge's 9090 —
// the host is derived from the main rosbridge address so both stay in sync
// with whatever network the browser is actually reaching the Pi on.
function FoxgloveModal({ open, url, onClose }) {
  if (!open) return null;
  const host = hostOf(url);
  const fgTarget = `ws://${host}:8765`;
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
        <div className="fgmodal-note">Connects on port 8765 (foxglove_bridge) — separate from rosbridge's 9090. If blank: the bridge may not be launched yet (ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765), or embedding is blocked — use "Open in New Tab".</div>
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
      <svg viewBox="0 0 200 200" style={{width:"100%",flex:1,minHeight:0}}>
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
        <text x="2" y="197" fontSize="6" fill="#3D4E5E" fontFamily="monospace">SIDE VIEW — 2D APPROX</text>
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
    jsSub.subscribe(()=>bump("/joint_states"));
    subs.push(jsSub);
    const cvSub=new ROSLIB.Topic({ros:rosInstance,name:"/cmd_vel",messageType:"geometry_msgs/Twist"});
    cvSub.subscribe(()=>bump("/cmd_vel"));
    subs.push(cvSub);
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
  const [conn,setConn]   = useState("disconnected");
  const [estp,setEstp]   = useState(false);
  const [joints,setJ]    = useState(initJ());
  const [feed,setFeed]   = useState(initJ());
  const [speed,setSpRaw] = useState(initialSpeed());
  const [logs,setLogs]   = useState([]);
  const [url,setUrlRaw]  = useState(initialUrl());
  const [hz,setHz]       = useState(0);
  const [confirmAction,setConfirmAction] = useState(null);
  const [rightTab,setRightTab] = useState("jog");
  const [showFg,setShowFg] = useState(false);

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

  // ── Remote (MQTT) — placeholder joystick+buttons hardware, expected to
  //    change; the plumbing around it (status, gating, config) is the part
  //    meant to stay stable across hardware revisions. ────────────────────
  const [remoteStatus,setRemoteStatus] = useState("idle"); // idle|connecting|linked|offline|error
  const [remoteActive,setRemoteActive] = useState(false);
  const [remoteBrokerUrl,setRemoteBrokerUrlRaw] = useState(initialRemoteUrl());
  const setRemoteBrokerUrl = useCallback(v=>{ setRemoteBrokerUrlRaw(v); safeSet("armctrl_remote_url", v); },[]);
  const remoteActiveJointRef = useRef(null);
  const [remoteActiveJoint,setRemoteActiveJoint] = useState(null);

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

  // URL fields sanitize any pasted protocol prefix — the ws:// stays in the
  // label, the input only ever holds host:port, so "do not type ws://" is
  // enforced by the code instead of relying on the operator to remember.
  const setUrl = useCallback(v=>{ setUrlRaw("ws://"+stripProto(v)); safeSet("armctrl_url", "ws://"+stripProto(v)); },[]);
  const setSp  = useCallback(v=>{ setSpRaw(v); safeSet("armctrl_speed", String(v)); },[]);

  const dispatchCommand = useCallback((type, payload) => {
    if (mode === "mock") {
      if (type === "JOINT_COMMAND") {
        cntRef.current += 1;
        setTimeout(()=>{
          setFeed(p=>{ const merged={...p,...payload.joints}; feedRef.current=merged; return merged; });
        }, 50);
      } else if (type === "ARM_POWER") {
        log(`[SIM] arm power → ${payload.on ? "ON" : "OFF"}`, "info");
      } else if (type === "ESTOP") {
        setTimeout(()=>{
          setFeed(p=>{ const merged={...p,...payload.joints}; feedRef.current=merged; return merged; });
        }, 50);
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
    if(presets.some(p=>p.name.toLowerCase()===trimmed.toLowerCase())){
      log(`A position named "${trimmed}" already exists`,"warn"); return;
    }
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
      if(!on) setRightTab("teach");
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
    const a=document.createElement("a");
    a.href=objUrl;
    a.download=`arm_session_log_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
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
    const a=document.createElement("a");
    a.href=objUrl;
    a.download=`repeatability_${testTarget.replace(/\s+/g,"_")}_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
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

  // dis is only known after everything above — sync it into a ref so the
  // remote-input handler (defined below, but firing async later) always
  // reads the current gating state rather than a stale closed-over value.
  useEffect(()=>{ disRef.current=dis; },[dis]);

  // ─── HARDWARE REMOTE CONTROL (MQTT) ───────────────────────────────────
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
      // Gated behind the SAME conditions the on-screen controls respect —
      // disconnected, e-stopped, or Teach Mode all block remote input too,
      // so the physical remote can never fight Teach Mode or move a
      // de-energized/unreachable arm.
      if (topic !== "remote/data" || estRef.current || disRef.current) return;
      const now = Date.now();
      if (now - lastRemoteCmd.current < 40) return; // ~20Hz cap matches the remote's publish rate
      lastRemoteCmd.current = now;

      try {
        const data = JSON.parse(message.toString());
        const jogAmount = JOG_DEG[speedRef.current];
        // Placeholder deadzone/mapping — expected to change with the hardware.
        const DEADZONE_LOW = 1700, DEADZONE_HIGH = 2400;
        let moved = null;

        if (data.joyX < DEADZONE_LOW)  { stepJ("joint_1", -jogAmount); moved="joint_1"; }
        if (data.joyX > DEADZONE_HIGH) { stepJ("joint_1",  jogAmount); moved="joint_1"; }
        if (data.joyY < DEADZONE_LOW)  { stepJ("joint_2", -jogAmount); moved="joint_2"; }
        if (data.joyY > DEADZONE_HIGH) { stepJ("joint_2",  jogAmount); moved="joint_2"; }
        if (data.btn1 === 0) { stepJ("joint_6",  5); moved="joint_6"; }
        if (data.btn2 === 0) { stepJ("joint_6", -5); moved="joint_6"; }

        if (moved) {
          setRemoteActive(true);
          remoteActiveJointRef.current = moved;
          setRemoteActiveJoint(moved);
          clearTimeout(remoteActiveTimeout.current);
          remoteActiveTimeout.current = setTimeout(()=>{ setRemoteActive(false); setRemoteActiveJoint(null); }, 300);
        }
      } catch (e) {
        console.error("MQTT parsing error", e);
      }
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
      <FoxgloveModal open={showFg} url={url} onClose={()=>setShowFg(false)} />

      <div className="shell">

        {/* ── HEADER ── */}
        <header className="hdr">
          <div className="brand">
            <div className={`bdot ${conn!=="connected"?"off":""}`}/>
            ARM · CONTROL
          </div>

          <div className="hdr-center">
            <div className="hdr-url-wrap">
              <span className="hdr-url-label">ws://</span>
              <input className="hdr-url-input" value={url.replace(/^ws:\/\//,"")} onChange={e=>setUrl(e.target.value)} disabled={conn==="connected"||mode==="mock"} spellCheck={false} placeholder="host:9090"/>
            </div>
            <button
              className={`mode-toggle ${mode==="mock"?"sim":""}`}
              onClick={()=>setMode(mode==="ros"?"mock":"ros")}
              disabled={conn!=="disconnected"}
              title="Local Simulation Mode — test Teach Mode & Repeatability without hardware"
            >
              {mode==="mock"?"SIM":"LIVE"}
            </button>
            <button
              className={`mode-toggle ${demoMode?"demo":""}`}
              onClick={()=>setDemoMode(d=>!d)}
              title="Demo Mode — skips confirmation dialogs for a live presentation. Resume-from-E-stop always still confirms."
            >
              {demoMode?"DEMO ON":"DEMO OFF"}
            </button>
            <button className="hbtn conn" onClick={connect} disabled={conn!=="disconnected"}>{conn==="connecting"?"Connecting…":"Connect"}</button>
            <button className="hbtn disc" onClick={disconnect} disabled={conn==="disconnected"}>Disconnect</button>
          </div>

          <div className="hdr-r">
            <span className={`remote-pill ${remoteStatus} ${remoteActive?"active":""}`} title={remoteBrokerUrl}>
              {remoteStatus==="linked" ? (remoteActive?`REMOTE · ${remoteActiveJoint}`:"REMOTE LINKED")
                : remoteStatus==="connecting" ? "REMOTE…"
                : remoteStatus==="error" ? "REMOTE ERROR"
                : "REMOTE OFFLINE"}
            </span>
            <span className={`mode-pill ${armPower?"run":"teach"}`}>{armPower?"Web Control":"Teach Mode"}</span>
            <div className={`badge ${conn}`}>
              <div className="bdg-dot"/>
              {conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}
            </div>
            {estp
              ?<button className="hbtn resume" onClick={handleResume}>CLEAR EMERGENCY</button>
              :<button className="hbtn estop" onClick={handleEstop} title="Emergency Stop — or press SPACE">⬛ Emergency Stop</button>
            }
          </div>
        </header>

        {/* ── BODY ── */}
        <div className="body">

          {/* ── LEFT SIDEBAR ── */}
          <aside className="side side-l">
            <div className="slbl">Speed</div>
            <div className="spd-row">
              {SPEEDS.map((s,i)=>{
                const rate = (JOG_DEG[i] / (JOG_MS[i]/1000)).toFixed(1);
                return (
                  <button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSp(i)}>
                    <div>{s}</div>
                    <div className="spd-rate">{rate}°/s</div>
                  </button>
                );
              })}
            </div>

            <div className="slbl">Arm Power</div>
            <div className="pwr-row">
              <div className="pwr-label">
                <span className="pwr-title">{armPower?"Energized":"De-energized"}</span>
                <span className="pwr-sub">{armPower?"NORMAL CONTROL":"BACK-DRIVABLE"}</span>
              </div>
              <button className={`tgl ${armPower?"on":""}`} onClick={()=>requestArmPower(!armPower)} disabled={conn!=="connected"||estp}>
                <div className="tgl-thumb"/>
              </button>
            </div>

            <div className="slbl">Remote Link</div>
            <div className="pwr-row">
              <div className="pwr-label">
                <span className="pwr-title">
                  {remoteStatus==="linked"?"Linked":remoteStatus==="connecting"?"Connecting":remoteStatus==="error"?"Error":"Offline"}
                </span>
                <input
                  className="remote-addr-input"
                  value={remoteBrokerUrl.replace(/^ws:\/\//,"")}
                  onChange={e=>setRemoteBrokerUrl("ws://"+stripProto(e.target.value))}
                  spellCheck={false}
                  placeholder="host:9001"
                  title="Mosquitto WebSocket address for the physical remote"
                />
              </div>
              <div className="remote-dot" style={{background:
                remoteStatus==="linked"?"var(--grn)":
                remoteStatus==="error"?"var(--red)":
                remoteStatus==="connecting"?"var(--amb)":"var(--lo)"
              }}/>
            </div>

            <div className="slbl">Saved Positions</div>
            <div className="pgrid">
              {presets.map(p=>(
                <button key={p.name} className="pbtn" onClick={()=>requestPreset(p)} disabled={dis}>
                  {!p.builtin && <span className="pbtn-del" onClick={(e)=>{e.stopPropagation();deletePreset(p.name);}} title="Delete">✕</span>}
                  <span className="ico">{p.icon}</span>{p.name}
                </button>
              ))}
              <button className="pbtn add" onClick={addPreset} disabled={conn!=="connected"}>
                <span className="ico">+</span>Save Current
              </button>
            </div>

            <div className="slbl">Actions</div>
            <div className="act-row">
              <button className="abtn" onClick={requestReset} disabled={dis}>Reset All</button>
              <button className="abtn" onClick={()=>publish()} disabled={dis}>Publish</button>
            </div>

            <div className="slbl">Arm Preview</div>
            <ArmViz joints={armPower?joints:feed}/>
          </aside>

          {/* ── CENTER ── */}
          <main className="center">
            <div className="ctrl-row">

              {/* Joint Controls column */}
              <div className="ctrl-col">
                <div className="col-hdr">
                  <span className="col-title">Joint Controls</span>
                  <span className="col-tag">sensor_msgs/JointState</span>
                </div>
                <div className="joints-body">
                  {JOINTS.map(j=>{
                    const val=joints[j.id], fill=fillSt(val,j.min,j.max,j.color);
                    const isN=nearLim(val,j), isA=atLim(val,j), step=JOG_DEG[speed];
                    const isRemote = remoteActiveJoint===j.id;
                    return(
                      <div className={`jrow ${isA?"at":isN?"near":isRemote?"remote":""}`} key={j.id}>
                        <div className="jhdr">
                          <div className="jname">
                            <div className="jdot" style={{background:j.color}}/>
                            {j.label}
                            {isA&&<span className="lbdg at">AT LIMIT</span>}
                            {!isA&&isN&&<span className="lbdg near">NEAR</span>}
                            {!isA&&!isN&&isRemote&&<span className="lbdg remote">REMOTE</span>}
                          </div>
                          <div className={`jval ${isA?"at":isN?"near":""}`} style={isN||isA?{}:{color:j.color}}>
                            {val.toFixed(1)}{j.unit}
                          </div>
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
                          <span style={{color:"var(--lo)",fontSize:8,marginLeft:3}}>{j.unit}</span>
                          <button className="sbtn" style={{marginLeft:"auto"}} onClick={()=>setJabs(j.id,0)} disabled={dis} title="Zero joint">⊙</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right control column: Jog / Teach tabs + Log */}
              <div className="ctrl-col">
                <div className="col-hdr">
                  <div className="col-tabs">
                    <button className={`col-tab ${rightTab==="jog"?"on":""}`} onClick={()=>setRightTab("jog")}>Cartesian Jog</button>
                    <button className={`col-tab purple ${rightTab==="teach"?"on":""}`} onClick={()=>setRightTab("teach")}>Teach Mode</button>
                  </div>
                  <span className="col-tag">{rightTab==="jog"?`Hold · ${JOG_DEG[speed]}°/tick`:`${waypoints.length} pts`}</span>
                </div>

                <div className="right-col-inner">
                  {rightTab==="jog" ? (
                    <div className="cart-body">
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
                      <button className="zero-btn" onClick={requestReset} disabled={dis}>Zero All Axes</button>
                    </div>
                  ) : (
                    <div className="teach-body">
                      <div className={`teach-status ${armPower?"off":"on"}`}>
                        {armPower ? "Motors energized — turn Arm Power off to teach" : "Arm is free — move it by hand, then record"}
                      </div>
                      <button className="record-btn" onClick={recordWaypoint} disabled={armPower||conn!=="connected"||estp}>
                        <span className="rdot"/>RECORD WAYPOINT
                      </button>
                      <div className="wp-scroll">
                        {waypoints.length===0
                          ? <div className="wp-empty">No waypoints yet.<br/>Turn Arm Power off, then record.</div>
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
                    </div>
                  )}

                  <div className="log-section">
                    <div className="log-hdr">
                      <span style={{fontSize:10,fontWeight:700,color:"var(--hi)",letterSpacing:".04em",textTransform:"uppercase"}}>System Log</span>
                      <div style={{display:"flex",gap:4}}>
                        <button style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)",background:"var(--panel)",padding:"1px 6px",borderRadius:4,border:"1px solid var(--b0)",cursor:"pointer"}} onClick={exportSystemLogCSV} title="Download full session history as CSV">Export</button>
                        <button style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)",background:"var(--panel)",padding:"1px 6px",borderRadius:4,border:"1px solid var(--b0)",cursor:"pointer"}} onClick={()=>setLogs([])}>Clear</button>
                      </div>
                    </div>
                    <div className="logwrap">
                      {logs.length===0&&<div className="lent"><span className="ltm">{ts()}</span><span className="lmsg">Waiting for connection…</span></div>}
                      {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Diagnostics strip */}
            <div style={{flexShrink:0,borderTop:"1px solid var(--b0)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 12px",borderBottom:"1px solid var(--b0)",background:"rgba(255,255,255,.01)"}}>
                <span style={{fontFamily:"JetBrains Mono",fontSize:10,fontWeight:700,color:"var(--hi)",letterSpacing:".05em",textTransform:"uppercase"}}>ROS2 Diagnostics</span>
                <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>{mode==="mock"?"simulated · offline":"rosbridge · live"}</span>
              </div>

              <div className="diag-strip">
                {/* ① Status KPIs */}
                <div className="diag-sec" style={{minWidth:190}}>
                  <div className="diag-sec-hdr">
                    <span className="diag-sec-title">System Status</span>
                    <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:conn==="connected"?"var(--grn)":"var(--red)"}}>{conn==="connected"?"LIVE":"DOWN"}</span>
                  </div>
                  <div className="diag-kpi">
                    <div className="dkpi"><div className="dkpi-lbl">Bridge</div><div className={`dkpi-val ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"ONLINE":"OFFLINE"}</div></div>
                    <div className="dkpi"><div className="dkpi-lbl">ROS Nodes</div><div className="dkpi-val ok">{diag.info.nodes.length||"–"}</div></div>
                    <div className="dkpi"><div className="dkpi-lbl">/joint_states</div><div className={`dkpi-val ${diag.tlog["/joint_states"].hz>0?"ok":"warn"}`}>{diag.tlog["/joint_states"].hz} Hz</div></div>
                    <div className="dkpi"><div className="dkpi-lbl">Pub Hz</div><div className="dkpi-val ok">{hz}</div></div>
                    <div className="dkpi"><div className="dkpi-lbl">Remote</div><div className={`dkpi-val ${remoteStatus==="linked"?"ok":remoteStatus==="error"?"err":"warn"}`}>{remoteStatus.toUpperCase()}</div></div>
                  </div>
                </div>

                {/* ② Topic bus */}
                <div className="diag-sec">
                  <div className="diag-sec-hdr">
                    <span className="diag-sec-title">Topic Bus</span>
                    <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>msgs · hz · last</span>
                  </div>
                  <div className="topic-scroll">
                    {diag.TRACKED.map(t=>(
                      <div className="topic-row" key={t}>
                        <span className="topic-name">{t}</span>
                        <div className="topic-meta">
                          <span className="topic-cnt">{diag.tlog[t].count}</span>
                          <span className="topic-hz">{diag.tlog[t].hz}Hz</span>
                          <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)"}}>{diag.tlog[t].last}</span>
                        </div>
                      </div>
                    ))}
                    {diag.info.topics.slice(0,6).map(t=>(
                      <div className="topic-row" key={t} style={{opacity:.5}}>
                        <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>{t}</span>
                        <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>discovered</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ③ Repeatability Test */}
                <div className="diag-sec">
                  <div className="diag-sec-hdr">
                    <span className="diag-sec-title">Repeatability Test</span>
                    <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>closed-loop accuracy</span>
                  </div>
                  <div className="rt-row">
                    <span className="rt-taglabel">TEST TARGET</span>
                    <select className="rt-select" value={testTarget} onChange={e=>setTestTarget(e.target.value)} disabled={testRunning}>
                      {presets.filter(p=>p.name!=="Home").map(p=><option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                    {!testRunning
                      ? <button className="rt-btn" onClick={()=>runRepeatabilityTest(testPreset,10)} disabled={conn!=="connected"||!armPower}>RUN ×10</button>
                      : <button className="rt-btn stop" onClick={stopTest}>STOP</button>}
                  </div>
                  <div className="rt-chart-wrap">
                    {testResults.length===0 && !testRunning
                      ? <div className="rt-empty">No results yet — motors must be on</div>
                      : <TrendChart results={testResults} />}
                  </div>
                  {testResults.length>0 && (
                    <div className={`rt-summary ${testMax>3?"warn":"ok"}`}>
                      <span>Avg <b>{testAvg.toFixed(2)}°</b></span>
                      <span>Max <b>{testMax.toFixed(2)}°</b></span>
                      <span>Runs <b>{testResults.length}</b></span>
                      <button className="rt-csv" onClick={exportTestCSV}>DOWNLOAD CSV</button>
                    </div>
                  )}
                </div>

                {/* ④ ROS Nodes — Foxglove locked at TOP */}
                <div className="diag-sec nodes-sec" style={{minWidth:190}}>
                  <div className="diag-sec-hdr">
                    <span className="diag-sec-title">ROS2 Nodes</span>
                    <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>{diag.info.nodes.length} active</span>
                  </div>
                  <button
                    className="fg-link"
                    onClick={()=>{ setShowFg(true); log("Opened Foxglove 3D view","info"); }}
                  >
                    OPEN FOXGLOVE 3D VIEW
                  </button>
                  <div className="nodes-scroll">
                    {diag.info.nodes.length===0
                      ?<div style={{fontFamily:"JetBrains Mono",padding:"8px 10px",fontSize:9,color:"var(--lo)"}}>{mode==="mock"?"Simulation mode — no ROS nodes":"No nodes yet — connect first"}</div>
                      :diag.info.nodes.map(n=>(
                        <div key={n} style={{padding:"4px 10px",fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)",borderBottom:"1px solid var(--b0)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={n}>
                          <span style={{color:"var(--cyan)",marginRight:4}}>▸</span>{n}
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            </div>
          </main>

          {/* ── RIGHT SIDEBAR ── */}
          <aside className="side side-r">
            <div className="slbl">Telemetry</div>
            <div className="sr-telem">
              <div className="tgrid">
                <div className="tcell"><div className="tlbl">Status</div><div className={`tval ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"LIVE":"OFF"}</div></div>
                <div className="tcell"><div className="tlbl">Pub Hz</div><div className="tval">{hz}<span style={{fontSize:9,color:"var(--mid)"}}>Hz</span></div></div>
                <div className="tcell"><div className="tlbl">Speed</div><div className={`tval ${speed===2?"warn":""}`}>{SPEEDS[speed]}</div></div>
                <div className="tcell"><div className="tlbl">Max Err</div><div className={`tval ${maxErr>5?"warn":"ok"}`}>{maxErr.toFixed(1)}<span style={{fontSize:9,color:"var(--mid)"}}>°</span></div></div>
                <div className="tcell"><div className="tlbl">Limits</div><div className={`tval ${anyNear?"warn":"ok"}`}>{anyNear?"WARN":"OK"}</div></div>
                <div className="tcell"><div className="tlbl">Emergency</div><div className={`tval ${estp?"err":"ok"}`}>{estp?"ACTIVE":"CLEAR"}</div></div>
              </div>
            </div>

            <div className="slbl">Feedback vs CMD</div>
            <div className="fb-body">
              {JOINTS.map(j=>{
                const cmd=joints[j.id]??0, fb=feed[j.id]??0, err=Math.abs(cmd-fb);
                return(
                  <div className="fbrow" key={j.id}>
                    <div className="fbtop">
                      <span style={{fontSize:9,color:"var(--mid)"}}>{j.label}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:8,color:deltaColor(err)}}>Δ{err.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fbbot">
                      <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:j.color}}>CMD {cmd.toFixed(1)}{j.unit}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:"var(--mid)"}}>FB {fb.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fbbar-track"><div className="fbbar-fill" style={{width:`${deltaPct(err)}%`,background:deltaColor(err)}}/></div>
                  </div>
                );
              })}
            </div>
          </aside>

        </div>

        {/* ── STATUS STRIP ── */}
        <div className="strip">
          <div className={`sdot ${conn==="connected"?"ok":conn==="connecting"?"warn":"err"}`}/>
          <span>{mode==="mock"?"simulation mode":"ros2 bridge"}</span>
          <span style={{color:"var(--lo)"}}>·</span>
          <span style={{color:"var(--lo)"}}>{mode==="mock"?"no hardware required":url}</span>
          <span style={{marginLeft:"auto",color:"var(--lo)"}}>ARM·CTRL v3.3 · {ts()}</span>
        </div>

      </div>
    </>
  );
}