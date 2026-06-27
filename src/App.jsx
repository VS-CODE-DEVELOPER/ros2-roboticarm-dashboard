import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const JOINTS = [
  { id:"joint_1", label:"Base Rotation", min:-180, max:180,  unit:"°", color:"#00D4FF" },
  { id:"joint_2", label:"Shoulder",      min:-90,  max:90,   unit:"°", color:"#00FF9D" },
  { id:"joint_3", label:"Elbow",         min:-135, max:135,  unit:"°", color:"#FFB800" },
  { id:"joint_4", label:"Wrist Pitch",   min:-90,  max:90,   unit:"°", color:"#FF6B35" },
  { id:"joint_5", label:"Wrist Roll",    min:-180, max:180,  unit:"°", color:"#C77DFF" },
  { id:"joint_6", label:"Gripper",       min:0,    max:100,  unit:"%", color:"#FF4D6D" },
];
const LIMIT_WARN = 5;
const PRESETS = [
  { name:"Home",       icon:"⌂", values:{joint_1:0,  joint_2:0,   joint_3:0,   joint_4:0,  joint_5:0, joint_6:0  }},
  { name:"Grab Ready", icon:"✦", values:{joint_1:0,  joint_2:45,  joint_3:-90, joint_4:45, joint_5:0, joint_6:0  }},
  { name:"Release",    icon:"◎", values:{joint_1:0,  joint_2:45,  joint_3:-90, joint_4:45, joint_5:0, joint_6:100}},
  { name:"Stow",       icon:"▣", values:{joint_1:0,  joint_2:-90, joint_3:135, joint_4:-45,joint_5:0, joint_6:0  }},
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
  --r:7px;--rl:11px;
  --hdr:48px;--strip:24px;
}
html,body,#root{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--hi);font-family:'Inter',sans-serif;font-size:12px;line-height:1.4}

/* ══════════════════════════════════════════════════════
   SHELL — fixed 3-row grid, never scrolls
══════════════════════════════════════════════════════ */
.shell{
  display:grid;
  grid-template-rows:var(--hdr) 1fr var(--strip);
  width:100vw;height:100vh;
  overflow:hidden;
}

/* ── Header ── */
.hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 14px;background:var(--panel);border-bottom:1px solid var(--b0);
  z-index:100;overflow:hidden;
}
.brand{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.05em;color:var(--cyan);flex-shrink:0}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes fw{0%,100%{border-color:var(--amb);background:var(--adim)}50%{border-color:#F80;background:rgba(255,120,0,.2)}}
@keyframes fd{0%,100%{border-color:var(--red);background:var(--rdim)}50%{border-color:#F00;background:rgba(255,0,0,.25)}}

.hdr-center{display:flex;align-items:center;gap:8px;flex:1;justify-content:center}
.hdr-r{display:flex;align-items:center;gap:8px;flex-shrink:0}

/* Connection URL inline in header */
.hdr-url-wrap{display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);padding:3px 8px}
.hdr-url-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.hdr-url-input{background:transparent;border:none;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;outline:none;width:220px}
.hdr-url-input:disabled{opacity:.6}

.badge{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;border:1px solid transparent;transition:all .3s;white-space:nowrap}
.badge.connected{color:var(--grn);border-color:var(--grn);background:var(--gdim)}
.badge.disconnected{color:var(--mid);border-color:var(--b0)}
.badge.connecting{color:var(--amb);border-color:var(--amb);background:var(--adim)}
.bdg-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.connected .bdg-dot{animation:blink 1.5s infinite}

.hbtn{padding:4px 12px;border-radius:var(--r);font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;transition:all .15s;border:1.5px solid transparent;white-space:nowrap}
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

/* ══════════════════════════════════════════════════════
   BODY — 3 columns, each is a fixed-height non-scrolling column
   Left sidebar:  240px
   Center:        1fr  (fills remaining space)
   Right sidebar: 220px
══════════════════════════════════════════════════════ */
.body{
  display:grid;
  grid-template-columns:240px 1fr 220px;
  overflow:hidden;width:100%;height:100%;
}

/* Each side is itself a grid of sections that fill height exactly */
.side{background:var(--panel);overflow:hidden;display:flex;flex-direction:column}
.side-l{border-right:1px solid var(--b0)}
.side-r{border-left:1px solid var(--b0)}

/* Section label */
.slbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lo);padding:10px 12px 4px;flex-shrink:0}

/* ── Left sidebar sections ── */
.sl-speed{flex-shrink:0}
.sl-presets{flex-shrink:0}
.sl-actions{flex-shrink:0}
.sl-viz{flex:1;overflow:hidden;display:flex;flex-direction:column}

/* ── Speed ── */
.spd-row{display:flex;padding:5px 10px;gap:4px}
.spd{flex:1;padding:4px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd:hover:not(.on){border-color:var(--b1);color:var(--hi)}

/* ── Presets ── */
.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:5px 10px}
.pbtn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);cursor:pointer;font-size:9px;font-weight:500;transition:all .15s}
.pbtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn:disabled{opacity:.3;cursor:not-allowed}
.pbtn .ico{font-size:12px}

/* ── Action row ── */
.act-row{display:flex;gap:4px;padding:5px 10px}
.abtn{flex:1;padding:5px;background:transparent;border:1px solid var(--b1);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;transition:all .15s;text-align:center}
.abtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}
.abtn:disabled{opacity:.3;cursor:not-allowed}

/* ── Arm viz fills remaining left sidebar space ── */
.vizwrap{flex:1;overflow:hidden;padding:4px 10px 8px;display:flex;flex-direction:column}
.vizleg{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:4px;flex-shrink:0}
.vli{display:flex;align-items:center;gap:3px;font-size:9px;color:var(--mid)}
.vld{width:8px;height:3px;border-radius:2px}

/* ══════════════════════════════════════════════════════
   CENTER — two rows: controls (fills) + diagnostics bar (fixed)
══════════════════════════════════════════════════════ */
.center{
  display:grid;
  grid-template-rows:1fr 180px;
  overflow:hidden;min-width:0;
}

/* Controls row: joint col + right col side by side, NO scroll */
.ctrl-row{
  display:grid;
  grid-template-columns:1fr 1fr;
  overflow:hidden;
  gap:0;
}

/* Each control column is fixed, no overflow */
.ctrl-col{
  overflow:hidden;
  display:flex;
  flex-direction:column;
  border-right:1px solid var(--b0);
}
.ctrl-col:last-child{border-right:none}

/* Col header */
.col-hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 12px;border-bottom:1px solid var(--b0);
  background:rgba(255,255,255,.01);flex-shrink:0;
}
.col-title{font-size:10px;font-weight:700;color:var(--hi);letter-spacing:.05em;text-transform:uppercase}
.col-tag{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);background:var(--panel);padding:2px 6px;border-radius:4px;border:1px solid var(--b0)}

/* Joint rows fill available height evenly */
.joints-body{flex:1;display:flex;flex-direction:column;overflow:hidden}
.jrow{
  flex:1;
  padding:0 12px;
  border-bottom:1px solid var(--b0);
  display:flex;flex-direction:column;justify-content:center;
  transition:background .15s;min-height:0;
}
.jrow:last-child{border-bottom:none}
.jrow:hover{background:var(--hover)}
.jrow.near{animation:fw 1.2s ease-in-out infinite;border-left:3px solid var(--amb)}
.jrow.at{animation:fd .7s ease-in-out infinite;border-left:3px solid var(--red)}

.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.jname{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:500}
.jdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.jval{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;min-width:50px;text-align:right;transition:color .2s}
.jval.near{color:var(--amb)!important}
.jval.at{color:var(--red)!important}
.lbdg{font-family:'JetBrains Mono',monospace;font-size:7px;font-weight:700;letter-spacing:.1em;padding:1px 4px;border-radius:3px;text-transform:uppercase}
.lbdg.near{background:var(--adim);color:var(--amb);border:1px solid var(--amb)}
.lbdg.at{background:var(--rdim);color:var(--red);border:1px solid var(--red)}

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

/* Right control col: cartesian + log stacked, filling height */
.right-col-inner{flex:1;display:grid;grid-template-rows:auto 1fr;overflow:hidden}

/* Cartesian section */
.cart-body{overflow:hidden;display:flex;flex-direction:column}
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

/* Log fills remaining right col space */
.log-section{flex:1;overflow:hidden;display:flex;flex-direction:column;border-top:1px solid var(--b0)}
.log-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 11px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01);flex-shrink:0}
.logwrap{flex:1;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:9px;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;display:flex;flex-direction:column-reverse}
.lent{display:flex;gap:7px;padding:3px 10px;border-top:1px solid var(--b0);align-items:baseline;flex-shrink:0}
.lent:hover{background:var(--hover)}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}

/* ── Diagnostics strip (fixed height bottom of center) ── */
.diag-strip{
  display:grid;
  grid-template-columns:auto 1fr 1fr auto;
  border-top:2px solid var(--b0);
  overflow:hidden;
  height:180px;
}
.diag-sec{border-right:1px solid var(--b0);overflow:hidden;display:flex;flex-direction:column}
.diag-sec:last-child{border-right:none}
.diag-sec-hdr{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01);flex-shrink:0}
.diag-sec-title{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--lo)}
.diag-kpi{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0);flex:1}
.dkpi{background:var(--card);padding:6px 10px;display:flex;flex-direction:column;justify-content:center}
.dkpi-lbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:1px}
.dkpi-val{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--hi);line-height:1}
.dkpi-val.ok{color:var(--grn)}
.dkpi-val.warn{color:var(--amb)}
.dkpi-val.err{color:var(--red)}
.topic-row{display:flex;justify-content:space-between;align-items:center;padding:4px 10px;border-bottom:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:9px;flex-shrink:0}
.topic-row:hover{background:var(--hover)}
.topic-name{color:var(--cyan)}
.topic-meta{display:flex;gap:8px}
.topic-hz{color:var(--grn)}
.topic-cnt{color:var(--lo)}
.topic-scroll{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b0) transparent}

/* ── Right sidebar: all sections fill height exactly ── */
.sr-telem{flex-shrink:0}
.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}
.tcell{background:var(--card);padding:8px 10px}
.tlbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px}
.tval{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:var(--hi);line-height:1}
.tval.ok{color:var(--grn)}
.tval.warn{color:var(--amb)}
.tval.err{color:var(--red)}

.sr-fb{flex:1;overflow:hidden;display:flex;flex-direction:column}
.fb-body{flex:1;overflow:hidden;display:flex;flex-direction:column}
.fbrow{flex:1;padding:0 10px;border-bottom:1px solid var(--b0);display:flex;flex-direction:column;justify-content:center;min-height:0}
.fbrow:last-child{border-bottom:none}
.fbtop{display:flex;justify-content:space-between;margin-bottom:1px}
.fbbot{display:flex;justify-content:space-between}

.sr-emg{flex-shrink:0;padding:8px 10px;display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--b0)}
.emg-btn{padding:10px;border-radius:var(--r);font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;transition:all .15s;border:1.5px solid transparent;text-align:center}
.emg-btn:active{transform:scale(.97)}
.emg-btn:disabled{opacity:.35;cursor:not-allowed}
.emg-btn.danger{background:var(--rdim);color:var(--red);border-color:var(--red)}
.emg-btn.danger:hover:not(:disabled){background:var(--red);color:#fff}
.emg-btn.resume{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.emg-btn.resume:hover:not(:disabled){background:var(--grn);color:var(--bg)}

/* ── Status strip ── */
.strip{display:flex;align-items:center;gap:7px;padding:0 12px;background:var(--bg);border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);overflow:hidden}
.sdot{width:5px;height:5px;border-radius:50%;background:var(--lo);flex-shrink:0}
.sdot.ok{background:var(--grn);box-shadow:0 0 5px var(--grn)}
.sdot.warn{background:var(--amb)}
.sdot.err{background:var(--red);animation:blink .8s infinite}

/* ── Emergency overlay ── */
.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.07);border:3px solid var(--red);pointer-events:none;z-index:999;animation:ep .5s ease-in-out infinite alternate}
@keyframes ep{from{opacity:.5}to{opacity:1}}
.estop-banner{position:fixed;top:var(--hdr);left:50%;transform:translateX(-50%);background:var(--red);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;padding:5px 22px;border-radius:0 0 8px 8px;z-index:1000}

::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-thumb{background:var(--b0);border-radius:2px}

/* future Foxglove 3D panel placeholder */
.foxglove-placeholder{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100%;background:var(--card);border-radius:var(--rl);
  border:1px dashed var(--b1);color:var(--lo);gap:6px;
  font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.08em;
}
.foxglove-placeholder .fg-icon{font-size:28px;opacity:.4}
`;

// ─── Long-press hook ──────────────────────────────────────────────────────────
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

// ─── Arm 2D Viz ───────────────────────────────────────────────────────────────
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

// ─── Diagnostics strip ────────────────────────────────────────────────────────
function DiagPanel({rosConnected, rosInstance}){
  const TRACKED=["/joint_states","/cmd_vel"];
  const [tlog,setTlog]=useState(Object.fromEntries(TRACKED.map(t=>[t,{count:0,hz:0,last:"-"}])));
  const [vel,setVel]=useState({linear:0,angular:0});
  const [info,setInfo]=useState({topics:[],nodes:[]});
  const lastT=useRef({});
  const canvasRef=useRef(null);

  useEffect(()=>{
    if(!rosConnected||!rosInstance) return;
    const ROSLIB=window.ROSLIB, subs=[];
    const jsSub=new ROSLIB.Topic({ros:rosInstance,name:"/joint_states",messageType:"sensor_msgs/JointState"});
    jsSub.subscribe(()=>bump("/joint_states"));
    subs.push(jsSub);
    const cvSub=new ROSLIB.Topic({ros:rosInstance,name:"/cmd_vel",messageType:"geometry_msgs/Twist"});
    cvSub.subscribe(msg=>{
      bump("/cmd_vel");
      if(msg?.linear&&msg?.angular) setVel({linear:msg.linear.x,angular:msg.angular.z});
    });
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

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d"), W=canvas.width, H=canvas.height, cx=W/2, cy=H/2;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#111820"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#1E2D3D"; ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,cy);ctx.lineTo(W,cy);ctx.moveTo(cx,0);ctx.lineTo(cx,H);ctx.stroke();
    ctx.strokeStyle="#253545";ctx.beginPath();ctx.arc(cx,cy,Math.min(cx,cy)-3,0,Math.PI*2);ctx.stroke();
    const len=vel.linear*55, ang=vel.angular;
    const tx=cx+len*Math.sin(ang), ty=cy-len*Math.cos(ang);
    ctx.strokeStyle="#00D4FF";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(tx,ty);ctx.stroke();
    if(Math.abs(len)>4){
      const a=Math.atan2(ty-cy,tx-cx);
      ctx.beginPath();ctx.moveTo(tx,ty);
      ctx.lineTo(tx-7*Math.cos(a-.4),ty-7*Math.sin(a-.4));
      ctx.lineTo(tx-7*Math.cos(a+.4),ty-7*Math.sin(a+.4));
      ctx.closePath();ctx.fillStyle="#00D4FF";ctx.fill();
    }
    ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fillStyle="#00FF9D";ctx.fill();
  },[vel]);

  const M={fontFamily:"JetBrains Mono",monospace:true};

  return(
    <div className="diag-strip">

      {/* ① Status KPIs */}
      <div className="diag-sec" style={{minWidth:190}}>
        <div className="diag-sec-hdr">
          <span className="diag-sec-title">System Status</span>
          <span style={{...M,fontSize:9,color:rosConnected?"var(--grn)":"var(--red)"}}>{rosConnected?"LIVE":"DOWN"}</span>
        </div>
        <div className="diag-kpi">
          <div className="dkpi"><div className="dkpi-lbl">Bridge</div><div className={`dkpi-val ${rosConnected?"ok":"err"}`}>{rosConnected?"ONLINE":"OFFLINE"}</div></div>
          <div className="dkpi"><div className="dkpi-lbl">ROS Nodes</div><div className="dkpi-val ok">{info.nodes.length||"–"}</div></div>
          <div className="dkpi"><div className="dkpi-lbl">/joint_states</div><div className={`dkpi-val ${tlog["/joint_states"].hz>0?"ok":"warn"}`}>{tlog["/joint_states"].hz} Hz</div></div>
          <div className="dkpi"><div className="dkpi-lbl">/cmd_vel</div><div className={`dkpi-val ${tlog["/cmd_vel"].hz>0?"ok":"warn"}`}>{tlog["/cmd_vel"].hz} Hz</div></div>
        </div>
      </div>

      {/* ② Topic bus */}
      <div className="diag-sec">
        <div className="diag-sec-hdr">
          <span className="diag-sec-title">Topic Bus</span>
          <span style={{...M,fontSize:9,color:"var(--lo)"}}>msgs · hz · last</span>
        </div>
        <div className="topic-scroll">
          {TRACKED.map(t=>(
            <div className="topic-row" key={t}>
              <span className="topic-name">{t}</span>
              <div className="topic-meta">
                <span className="topic-cnt">{tlog[t].count}</span>
                <span className="topic-hz">{tlog[t].hz}Hz</span>
                <span style={{...M,fontSize:9,color:"var(--mid)"}}>{tlog[t].last}</span>
              </div>
            </div>
          ))}
          {info.topics.slice(0,8).map(t=>(
            <div className="topic-row" key={t} style={{opacity:.5}}>
              <span style={{...M,fontSize:9,color:"var(--lo)"}}>{t}</span>
              <span style={{...M,fontSize:9,color:"var(--lo)"}}>discovered</span>
            </div>
          ))}
        </div>
      </div>

      {/* ③ Velocity vector */}
      <div className="diag-sec">
        <div className="diag-sec-hdr">
          <span className="diag-sec-title">Velocity Vector</span>
          <span style={{...M,fontSize:9,color:"var(--lo)"}}>/cmd_vel</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14,padding:"8px 12px",flex:1}}>
          <canvas ref={canvasRef} width={90} height={90} style={{borderRadius:6,flexShrink:0}}/>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div>
              <div style={{...M,fontSize:8,color:"var(--lo)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:2}}>Linear</div>
              <span style={{...M,fontSize:15,fontWeight:700,color:"var(--cyan)"}}>{vel.linear.toFixed(3)}</span>
              <span style={{...M,fontSize:8,color:"var(--lo)"}}> m/s</span>
            </div>
            <div>
              <div style={{...M,fontSize:8,color:"var(--lo)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:2}}>Angular</div>
              <span style={{...M,fontSize:15,fontWeight:700,color:"var(--amb)"}}>{vel.angular.toFixed(3)}</span>
              <span style={{...M,fontSize:8,color:"var(--lo)"}}> rad/s</span>
            </div>
          </div>
        </div>
      </div>

      {/* ④ ROS Nodes + Foxglove note */}
      <div className="diag-sec" style={{minWidth:190}}>
        <div className="diag-sec-hdr">
          <span className="diag-sec-title">ROS2 Nodes</span>
          <span style={{...M,fontSize:9,color:"var(--lo)"}}>{info.nodes.length} active</span>
        </div>
        <div style={{flex:1,overflow:"hidden auto"}}>
          {info.nodes.length===0
            ?<div style={{...M,padding:"8px 10px",fontSize:9,color:"var(--lo)"}}>No nodes yet — connect first</div>
            :info.nodes.map(n=>(
              <div key={n} style={{padding:"4px 10px",fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)",borderBottom:"1px solid var(--b0)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={n}>
                <span style={{color:"var(--cyan)",marginRight:4}}>▸</span>{n}
              </div>
            ))
          }
        </div>
        {/* Foxglove 3D hook placeholder */}
        <div style={{padding:"4px 10px 5px",borderTop:"1px solid var(--b0)",fontFamily:"JetBrains Mono",fontSize:8,color:"var(--lo)",letterSpacing:".06em"}}>
          🔮 FOXGLOVE 3D — coming soon
        </div>
      </div>

    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [conn,setConn]   = useState("disconnected");
  const [estp,setEstp]   = useState(false);
  const [joints,setJ]    = useState(initJ());
  const [feed,setFeed]   = useState(initJ());
  const [speed,setSp]    = useState(1);
  const [logs,setLogs]   = useState([]);
  const [url,setUrl]     = useState(`ws://${typeof window!=="undefined"?window.location.hostname:"localhost"}:9090`);
  const [hz,setHz]       = useState(0);

  const rosRef=useRef(null), pubRef=useRef(null), subRef=useRef(null);
  const cntRef=useRef(0), estRef=useRef(false);
  useEffect(()=>{estRef.current=estp;},[estp]);

  const log=useCallback((msg,type="info")=>{setLogs(p=>[{msg,type,time:ts()},...p.slice(0,99)]);},[]);
  useEffect(()=>{const t=setInterval(()=>{setHz(cntRef.current);cntRef.current=0;},1000);return()=>clearInterval(t);},[]);

  const connect=useCallback(()=>{
    const ROSLIB=window.ROSLIB;
    if(!ROSLIB){log("roslib.js not loaded — add CDN to index.html","error");return;}
    if(rosRef.current) rosRef.current.close();
    setConn("connecting"); log(`Connecting → ${url}`,"warn");
    const ros=new ROSLIB.Ros({url}); rosRef.current=ros;
    ros.on("connection",()=>{
      setConn("connected"); log("ROS2 bridge connected","success");
      pubRef.current=new ROSLIB.Topic({ros,name:"/joint_commands",messageType:"sensor_msgs/JointState"});
      subRef.current=new ROSLIB.Topic({ros,name:"/joint_states",  messageType:"sensor_msgs/JointState"});
      subRef.current.subscribe(msg=>{
        if(msg.name&&msg.position){
          const fb={};msg.name.forEach((n,i)=>{fb[n]=(msg.position[i]*180)/Math.PI;});
          setFeed(p=>({...p,...fb}));
        }
      });
      log("Subscribed /joint_states","info");
    });
    ros.on("error",e=>log(`Error: ${e?.message??e}`,"error"));
    ros.on("close",()=>{setConn("disconnected");log("Connection closed","warn");pubRef.current=null;subRef.current=null;});
  },[url,log]);

  const disconnect=useCallback(()=>{if(rosRef.current){rosRef.current.close();rosRef.current=null;}},[]);

  const publish=useCallback((ov)=>{
    if(!pubRef.current||estp) return;
    const j=ov??joints, sm=[.3,1,2][speed], ROSLIB=window.ROSLIB;
    pubRef.current.publish(new ROSLIB.Message({
      name:JOINTS.map(jt=>jt.id),
      position:JOINTS.map(jt=>(j[jt.id]*Math.PI)/180),
      velocity:JOINTS.map(()=>sm),effort:[],
    }));
    cntRef.current+=1;
  },[joints,estp,speed]);

  const handleEstop=useCallback(()=>{
    setEstp(true); log("⚠ EMERGENCY STOP ACTIVATED","error");
    if(pubRef.current&&window.ROSLIB){
      pubRef.current.publish(new window.ROSLIB.Message({
        name:JOINTS.map(j=>j.id),
        position:JOINTS.map(j=>(joints[j.id]*Math.PI)/180),
        velocity:JOINTS.map(()=>0),effort:JOINTS.map(()=>0),
      }));
    }
  },[joints,log]);

  const handleResume=useCallback(()=>{setEstp(false);log("Emergency stop cleared — motion resumed","success");},[log]);

  const stepJ=useCallback((id,delta)=>{
    if(estRef.current) return;
    setJ(prev=>{const j=JOINTS.find(x=>x.id===id);return{...prev,[id]:clamp(prev[id]+delta,j.min,j.max)};});
  },[]);
  const setJabs=useCallback((id,v)=>{
    if(estRef.current) return;
    setJ(prev=>{const j=JOINTS.find(x=>x.id===id);return{...prev,[id]:clamp(v,j.min,j.max)};});
  },[]);

  useEffect(()=>{if(conn==="connected"&&!estp) publish(joints);},[joints]); // eslint-disable-line

  const applyP=useCallback((p)=>{if(estp)return;setJ(p.values);log(`Preset applied: ${p.name}`,"info");},[estp,log]);
  const resetAll=useCallback(()=>{setJ(initJ());log("All joints → 0°","info");},[log]);

  const maxErr=Math.max(...JOINTS.map(j=>Math.abs((joints[j.id]||0)-(feed[j.id]||0))));
  const anyNear=JOINTS.some(j=>nearLim(joints[j.id],j));
  const dis=estp||conn!=="connected";

  return(
    <>
      <style>{CSS}</style>
      {estp&&<><div className="estop-ov"/><div className="estop-banner">⬛ EMERGENCY STOP — ALL MOTION HALTED</div></>}

      <div className="shell">

        {/* ── HEADER ── */}
        <header className="hdr">
          <div className="brand">
            <div className={`bdot ${conn!=="connected"?"off":""}`}/>
            ARM · CONTROL
          </div>

          {/* URL input centred in header — no sidebar needed */}
          <div className="hdr-center">
            <div className="hdr-url-wrap">
              <span className="hdr-url-label">ws://</span>
              <input
                className="hdr-url-input"
                value={url.replace(/^ws:\/\//,"")}
                onChange={e=>setUrl("ws://"+e.target.value)}
                disabled={conn==="connected"}
                spellCheck={false}
              />
            </div>
            <button className="hbtn conn" onClick={connect} disabled={conn!=="disconnected"}>
              {conn==="connecting"?"Connecting…":"Connect"}
            </button>
            <button className="hbtn disc" onClick={disconnect} disabled={conn==="disconnected"}>
              Disconnect
            </button>
          </div>

          <div className="hdr-r">
            <div className={`badge ${conn}`}>
              <div className="bdg-dot"/>
              {conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}
            </div>
            {estp
              ?<button className="hbtn resume" onClick={handleResume}>CLEAR EMERGENCY</button>
              :<button className="hbtn estop" onClick={handleEstop}>⬛ Emergency Stop</button>
            }
          </div>
        </header>

        {/* ── BODY ── */}
        <div className="body">

          {/* ── LEFT SIDEBAR ── */}
          <aside className="side side-l">
            <div className="slbl">Speed</div>
            <div className="spd-row">
              {SPEEDS.map((s,i)=><button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSp(i)}>{s}</button>)}
            </div>

            <div className="slbl">Presets</div>
            <div className="pgrid">
              {PRESETS.map(p=>(
                <button key={p.name} className="pbtn" onClick={()=>applyP(p)} disabled={dis}>
                  <span className="ico">{p.icon}</span>{p.name}
                </button>
              ))}
            </div>

            <div className="slbl">Actions</div>
            <div className="act-row">
              <button className="abtn" onClick={resetAll} disabled={dis}>Reset All</button>
              <button className="abtn" onClick={()=>publish()} disabled={dis}>Publish</button>
            </div>

            <div className="slbl">Arm Preview</div>
            <ArmViz joints={joints}/>
          </aside>

          {/* ── CENTER ── */}
          <main className="center">

            {/* Controls row */}
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
                    return(
                      <div className={`jrow ${isA?"at":isN?"near":""}`} key={j.id}>
                        <div className="jhdr">
                          <div className="jname">
                            <div className="jdot" style={{background:j.color}}/>
                            {j.label}
                            {isA&&<span className="lbdg at">AT LIMIT</span>}
                            {!isA&&isN&&<span className="lbdg near">NEAR</span>}
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

              {/* Right control column: Cartesian + Log */}
              <div className="ctrl-col">
                <div className="col-hdr">
                  <span className="col-title">Cartesian Jog</span>
                  <span className="col-tag">Hold = continuous · {JOG_DEG[speed]}°/tick</span>
                </div>
                <div className="right-col-inner">
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
                    <button className="zero-btn" onClick={resetAll} disabled={dis}>Zero All Axes</button>
                  </div>

                  <div className="log-section">
                    <div className="log-hdr">
                      <span style={{fontSize:10,fontWeight:700,color:"var(--hi)",letterSpacing:".04em",textTransform:"uppercase"}}>System Log</span>
                      <button style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)",background:"var(--panel)",padding:"1px 6px",borderRadius:4,border:"1px solid var(--b0)",cursor:"pointer"}} onClick={()=>setLogs([])}>Clear</button>
                    </div>
                    <div className="logwrap">
                      {logs.length===0&&<div className="lent"><span className="ltm">{ts()}</span><span className="lmsg">Waiting for connection…</span></div>}
                      {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Diagnostics strip — pinned to bottom of center */}
            <div style={{flexShrink:0,borderTop:"1px solid var(--b0)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 12px",borderBottom:"1px solid var(--b0)",background:"rgba(255,255,255,.01)"}}>
                <span style={{fontFamily:"JetBrains Mono",fontSize:10,fontWeight:700,color:"var(--hi)",letterSpacing:".05em",textTransform:"uppercase"}}>ROS2 Diagnostics</span>
                <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>rosbridge · live</span>
              </div>
              <DiagPanel rosConnected={conn==="connected"} rosInstance={rosRef.current}/>
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

            <div className="slbl sr-fb">Feedback vs CMD</div>
            <div className="fb-body">
              {JOINTS.map(j=>{
                const cmd=joints[j.id]??0, fb=feed[j.id]??0, err=Math.abs(cmd-fb);
                return(
                  <div className="fbrow" key={j.id}>
                    <div className="fbtop">
                      <span style={{fontSize:9,color:"var(--mid)"}}>{j.label}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:8,color:err>3?"var(--amb)":"var(--lo)"}}>Δ{err.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fbbot">
                      <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:j.color}}>CMD {cmd.toFixed(1)}{j.unit}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:"var(--mid)"}}>FB {fb.toFixed(1)}{j.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sr-emg">
              <div style={{fontFamily:"JetBrains Mono",fontSize:9,fontWeight:700,letterSpacing:".14em",textTransform:"uppercase",color:"var(--lo)",marginBottom:2}}>Emergency</div>
              <button className="emg-btn danger" onClick={handleEstop} disabled={estp}>⬛ Emergency Stop</button>
              {estp&&<button className="emg-btn resume" onClick={handleResume}>✓ Clear &amp; Resume</button>}
            </div>
          </aside>

        </div>

        {/* ── STATUS STRIP ── */}
        <div className="strip">
          <div className={`sdot ${conn==="connected"?"ok":conn==="connecting"?"warn":"err"}`}/>
          <span>ros2 bridge</span>
          <span style={{color:"var(--lo)"}}>·</span>
          <span style={{color:"var(--lo)"}}>{url}</span>
          <span style={{marginLeft:"auto",color:"var(--lo)"}}>ARM·CTRL v2.0 · {ts()}</span>
        </div>

      </div>
    </>
  );
}