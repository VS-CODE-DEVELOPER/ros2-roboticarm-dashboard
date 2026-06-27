import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const JOINTS = [
  { id: "joint_1", label: "Base Rotation", min: -180, max: 180,  unit: "°", color: "#00D4FF" },
  { id: "joint_2", label: "Shoulder",      min: -90,  max: 90,   unit: "°", color: "#00FF9D" },
  { id: "joint_3", label: "Elbow",         min: -135, max: 135,  unit: "°", color: "#FFB800" },
  { id: "joint_4", label: "Wrist Pitch",   min: -90,  max: 90,   unit: "°", color: "#FF6B35" },
  { id: "joint_5", label: "Wrist Roll",    min: -180, max: 180,  unit: "°", color: "#C77DFF" },
  { id: "joint_6", label: "Gripper",       min: 0,    max: 100,  unit: "%", color: "#FF4D6D" },
];
const LIMIT_WARN = 5;
const PRESETS = [
  { name:"Home",       icon:"⌂", values:{joint_1:0,  joint_2:0,  joint_3:0,   joint_4:0,  joint_5:0,joint_6:0  }},
  { name:"Grab Ready", icon:"✦", values:{joint_1:0,  joint_2:45, joint_3:-90, joint_4:45, joint_5:0,joint_6:0  }},
  { name:"Release",    icon:"◎", values:{joint_1:0,  joint_2:45, joint_3:-90, joint_4:45, joint_5:0,joint_6:100}},
  { name:"Stow",       icon:"▣", values:{joint_1:0,  joint_2:-90,joint_3:135, joint_4:-45,joint_5:0,joint_6:0  }},
];
const SPEEDS    = ["Slow","Normal","Fast"];
const JOG_MS    = [120, 60, 30];
const JOG_DEG   = [1, 2, 5];
const initJ     = () => Object.fromEntries(JOINTS.map(j=>[j.id,0]));
const nearLim   = (v,j) => v<=j.min+LIMIT_WARN || v>=j.max-LIMIT_WARN;
const atLim     = (v,j) => v<=j.min || v>=j.max;
const ts        = () => new Date().toLocaleTimeString("en-GB",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
const clamp     = (v,a,b) => Math.max(a,Math.min(b,Number(v)));
const fillStyle = (val,min,max,col) => {
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
  --r:8px;--rl:12px;
}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--hi);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5}
#root{width:100%;height:100%}

/* ── Shell: 3 rows, full viewport ── */
.shell{display:grid;grid-template-rows:52px 1fr 26px;width:100vw;height:100vh;overflow:hidden}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--b0);z-index:100}
.brand{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:14px;letter-spacing:.05em;color:var(--cyan)}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes fw{0%,100%{border-color:var(--amb);background:var(--adim)}50%{border-color:#F80;background:rgba(255,120,0,.2)}}
@keyframes fd{0%,100%{border-color:var(--red);background:var(--rdim)}50%{border-color:#F00;background:rgba(255,0,0,.25)}}
.hdr-r{display:flex;align-items:center;gap:8px}
.badge{display:flex;align-items:center;gap:5px;padding:3px 11px;border-radius:20px;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;border:1px solid transparent;transition:all .3s}
.badge.connected{color:var(--grn);border-color:var(--grn);background:var(--gdim)}
.badge.disconnected{color:var(--mid);border-color:var(--b0)}
.badge.connecting{color:var(--amb);border-color:var(--amb);background:var(--adim)}
.bdg-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.badge.connected .bdg-dot{animation:blink 1.5s infinite}
.hbtn{padding:4px 13px;border-radius:var(--r);font-size:11px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;transition:all .15s;border:1.5px solid transparent}
.hbtn:active{transform:scale(.97)}
.hbtn.disc{background:transparent;color:var(--mid);border-color:var(--b1)}
.hbtn.disc:hover{border-color:var(--red);color:var(--red)}
.hbtn.estop{background:var(--rdim);border-color:var(--red);color:var(--red)}
.hbtn.estop:hover{background:var(--red);color:#fff}
.hbtn.resume{background:var(--gdim);border-color:var(--grn);color:var(--grn)}
.hbtn.resume:hover{background:var(--grn);color:var(--bg)}

/* ── Body: 3 columns FULL WIDTH ── */
.body{display:grid;grid-template-columns:210px 1fr 230px;width:100%;height:100%;overflow:hidden;min-width:0}
.side{background:var(--panel);overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;min-width:0}
.side-l{border-right:1px solid var(--b0)}
.side-r{border-left:1px solid var(--b0)}
.center{overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px;min-width:0}

/* ── Sidebar labels ── */
.slbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lo);padding:12px 12px 5px}

/* ── Card ── */
.card{background:var(--card);border:1px solid var(--b0);border-radius:var(--rl);overflow:hidden}
.chdr{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid var(--b0);background:rgba(255,255,255,.01)}
.ctitle{font-size:11px;font-weight:700;color:var(--hi);letter-spacing:.04em;text-transform:uppercase}
.ctag{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mid);background:var(--panel);padding:2px 7px;border-radius:4px;border:1px solid var(--b0)}

/* ── Connection ── */
.cform{padding:9px 11px;display:flex;flex-direction:column;gap:7px}
.flbl{font-size:10px;color:var(--mid);font-weight:500;margin-bottom:2px}
.finput{width:100%;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:11px;padding:6px 9px;outline:none;transition:all .2s}
.finput:focus{border-color:var(--cyan);box-shadow:0 0 0 2px var(--cdim)}
.cbtns{display:flex;gap:5px}
.cbtn{flex:1;padding:6px;border-radius:var(--r);font-size:11px;font-weight:600;cursor:pointer;border:1.5px solid transparent;transition:all .15s;text-align:center}
.cbtn:disabled{opacity:.35;cursor:not-allowed}
.cbtn.on{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.cbtn.on:hover:not(:disabled){background:var(--grn);color:var(--bg)}
.cbtn.off{background:transparent;color:var(--mid);border-color:var(--b1)}
.cbtn.off:hover:not(:disabled){border-color:var(--red);color:var(--red)}

/* ── Speed ── */
.spd-row{display:flex;padding:7px 11px;gap:5px}
.spd{flex:1;padding:5px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;text-align:center;transition:all .15s}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd:hover:not(.on){border-color:var(--b1);color:var(--hi)}

/* ── Presets ── */
.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:7px 11px}
.pbtn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 5px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);cursor:pointer;font-size:10px;font-weight:500;transition:all .15s}
.pbtn:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.pbtn:disabled{opacity:.3;cursor:not-allowed}
.pbtn .ico{font-size:13px}

/* ── Arm viz ── */
.vizwrap{padding:8px 11px 11px}
.vizleg{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:5px}
.vli{display:flex;align-items:center;gap:3px;font-size:9px;color:var(--mid)}
.vld{width:8px;height:3px;border-radius:2px}

/* ── Joint rows ── */
.jrow{padding:11px 13px;border-bottom:1px solid var(--b0);transition:background .15s}
.jrow:last-child{border-bottom:none}
.jrow:hover{background:var(--hover)}
.jrow.near{animation:fw 1.2s ease-in-out infinite;border-left:3px solid var(--amb)}
.jrow.at{animation:fd .7s ease-in-out infinite;border-left:3px solid var(--red)}
.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.jname{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:500}
.jdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.jval{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;min-width:54px;text-align:right;transition:color .2s}
.jval.near{color:var(--amb)!important}
.jval.at{color:var(--red)!important}
.lbdg{font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.1em;padding:1px 5px;border-radius:3px;text-transform:uppercase}
.lbdg.near{background:var(--adim);color:var(--amb);border:1px solid var(--amb)}
.lbdg.at{background:var(--rdim);color:var(--red);border:1px solid var(--red)}
.jrange{display:flex;align-items:center;gap:6px}
.jmin,.jmax{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);width:26px}
.jmax{text-align:right}
.swrap{flex:1;position:relative;height:18px;display:flex;align-items:center}
.strk{position:absolute;left:0;right:0;height:3px;background:var(--b1);border-radius:2px}
.sfill{position:absolute;height:3px;border-radius:2px;transition:width .05s,left .05s}
input[type=range]{position:relative;width:100%;height:18px;appearance:none;background:transparent;cursor:pointer;z-index:1}
input[type=range]::-webkit-slider-thumb{appearance:none;width:13px;height:13px;border-radius:50%;background:var(--hi);border:2px solid var(--cyan);box-shadow:0 0 5px rgba(0,212,255,.4);transition:transform .1s}
input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.2);box-shadow:0 0 10px rgba(0,212,255,.6)}
input[type=range].ws::-webkit-slider-thumb{border-color:var(--amb);box-shadow:0 0 7px rgba(255,184,0,.5)}
input[type=range].ls::-webkit-slider-thumb{border-color:var(--red);box-shadow:0 0 7px rgba(255,59,59,.6)}
input[type=range]:disabled::-webkit-slider-thumb{border-color:var(--lo);box-shadow:none}
input[type=range]:disabled{cursor:not-allowed;opacity:.4}
.jinp{margin-top:4px;display:flex;align-items:center;gap:4px}
.numinp{width:60px;background:var(--panel);border:1px solid var(--b0);border-radius:5px;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:11px;padding:3px 6px;text-align:center;outline:none;transition:border-color .15s}
.numinp:focus{border-color:var(--cyan)}
.numinp.wi{border-color:var(--amb);color:var(--amb)}
.numinp.li{border-color:var(--red);color:var(--red)}
.numinp:disabled{opacity:.4;cursor:not-allowed}
.sbtn{width:25px;height:25px;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--b0);border-radius:5px;color:var(--mid);cursor:pointer;font-size:14px;transition:all .1s;user-select:none;-webkit-user-select:none;touch-action:none}
.sbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.sbtn:active:not([disabled]){transform:scale(.9)}
.sbtn[disabled]{opacity:.3;cursor:not-allowed}

/* ── Cartesian ── */
.jax{padding:7px 11px;border-bottom:1px solid var(--b0)}
.jax:last-of-type{border-bottom:none}
.axlbl{font-size:10px;color:var(--mid);margin-bottom:4px;display:flex;align-items:center;gap:5px}
.axdot{width:5px;height:5px;border-radius:50%}
.jog-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px}
.jbtn{padding:8px 4px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;transition:all .15s;user-select:none;-webkit-user-select:none;touch-action:none}
.jbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan);background:var(--cdim)}
.jbtn:active:not([disabled]){transform:scale(.93)}
.jbtn.mid{background:var(--card);color:var(--lo);cursor:default;font-size:9px}
.jbtn[disabled]{opacity:.3;cursor:not-allowed}
.jarr{font-size:15px}

/* ── Log ── */
.logwrap{font-family:'JetBrains Mono',monospace;font-size:10px;max-height:160px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--b0) transparent;display:flex;flex-direction:column-reverse}
.lent{display:flex;gap:8px;padding:4px 11px;border-top:1px solid var(--b0);align-items:baseline}
.lent:hover{background:var(--hover)}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}

/* ── Diagnostics ── */
.diag-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}
.diag-cell{background:var(--card);padding:9px 11px}
.diag-lbl{font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px}
.diag-val{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:var(--hi)}
.diag-val.ok{color:var(--grn)}
.diag-val.warn{color:var(--amb)}
.diag-val.err{color:var(--red)}
.topic-row{display:flex;justify-content:space-between;align-items:center;padding:5px 11px;border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:9px}
.topic-row:hover{background:var(--hover)}
.topic-name{color:var(--cyan)}
.topic-meta{display:flex;gap:10px}
.topic-hz{color:var(--grn)}
.topic-cnt{color:var(--lo)}
.topic-time{color:var(--mid)}
.vec-canvas-wrap{padding:10px 11px;display:flex;gap:12px;align-items:center}
.vec-stats{display:flex;flex-direction:column;gap:4px}
.vstat{font-family:'JetBrains Mono',monospace;font-size:10px}
.vstat-lbl{color:var(--lo);font-size:9px;margin-bottom:1px}

/* ── Telemetry right ── */
.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}
.tcell{background:var(--card);padding:9px 11px}
.tlbl{font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
.tval{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:var(--hi);line-height:1}
.tval.ok{color:var(--grn)}
.tval.warn{color:var(--amb)}
.tval.err{color:var(--red)}
.fbrow{padding:7px 11px;border-bottom:1px solid var(--b0)}
.fbrow:last-child{border-bottom:none}
.fbtop{display:flex;justify-content:space-between;margin-bottom:2px}
.fbbot{display:flex;justify-content:space-between}

/* ── Right action btns ── */
.rbtn{width:100%;padding:9px;border-radius:var(--r);font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;transition:all .15s;border:1.5px solid transparent;text-align:center}
.rbtn:active{transform:scale(.97)}
.rbtn:disabled{opacity:.35;cursor:not-allowed}
.rbtn.danger{background:var(--rdim);color:var(--red);border-color:var(--red)}
.rbtn.danger:hover:not(:disabled){background:var(--red);color:#fff}
.rbtn.success{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.rbtn.success:hover:not(:disabled){background:var(--grn);color:var(--bg)}
.rbtn.ghost{background:transparent;color:var(--mid);border-color:var(--b1)}
.rbtn.ghost:hover:not(:disabled){border-color:var(--cyan);color:var(--cyan)}

/* ── Center 2-col grid ── */
.cgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.cright{display:flex;flex-direction:column;gap:14px}

/* ── Status strip ── */
.strip{display:flex;align-items:center;gap:7px;padding:0 14px;background:var(--bg);border-top:1px solid var(--b0);font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--mid)}
.sdot{width:5px;height:5px;border-radius:50%;background:var(--lo);flex-shrink:0}
.sdot.ok{background:var(--grn);box-shadow:0 0 5px var(--grn)}
.sdot.warn{background:var(--amb)}
.sdot.err{background:var(--red);animation:blink .8s infinite}

/* ── E-STOP overlay ── */
.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.07);border:3px solid var(--red);pointer-events:none;z-index:999;animation:ep .5s ease-in-out infinite alternate}
@keyframes ep{from{opacity:.5}to{opacity:1}}
.estop-banner{position:fixed;top:52px;left:50%;transform:translateX(-50%);background:var(--red);color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;padding:5px 22px;border-radius:0 0 8px 8px;z-index:1000}

::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-thumb{background:var(--b0);border-radius:2px}

/* responsive */
@media(max-width:1100px){.cgrid{grid-template-columns:1fr}}
@media(max-width:900px){.body{grid-template-columns:200px 1fr}.side-r{display:none}}
@media(max-width:640px){.body{grid-template-columns:1fr}.side-l{display:none}}
`;

// ─── Long-press ───────────────────────────────────────────────────────────────
function useLongPress(cb, speed) {
  const ref = useRef(cb);
  const iv  = useRef(null);
  const to  = useRef(null);
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

// ─── Diagnostics Panel ────────────────────────────────────────────────────────
function DiagnosticsPanel({rosConnected, rosInstance}){
  const TOPICS=["/joint_commands","/joint_states","/cmd_vel","/diagnostics"];
  const [tlog,setTlog]=useState(Object.fromEntries(TOPICS.map(t=>[t,{count:0,hz:0,last:"-"}])));
  const [vel,setVel]=useState({linear:0,angular:0});
  const [rosInfo,setRosInfo]=useState({topics:[],nodes:[]});
  const lastT=useRef({});
  const canvasRef=useRef(null);

  useEffect(()=>{
    if(!rosConnected||!rosInstance) return;
    const ROSLIB=window.ROSLIB;
    const subs=[];

    // Subscribe to joint_states for diagnostics freq tracking
    const jsSub=new ROSLIB.Topic({ros:rosInstance,name:"/joint_states",messageType:"sensor_msgs/JointState"});
    jsSub.subscribe(()=>bump("/joint_states"));
    subs.push(jsSub);

    // Subscribe to cmd_vel if available
    const cvSub=new ROSLIB.Topic({ros:rosInstance,name:"/cmd_vel",messageType:"geometry_msgs/Twist"});
    cvSub.subscribe(msg=>{
      bump("/cmd_vel");
      if(msg?.linear&&msg?.angular) setVel({linear:msg.linear.x,angular:msg.angular.z});
    });
    subs.push(cvSub);

    // Get node & topic list via rosapi
    try{
      const topicsSrv=new ROSLIB.Service({ros:rosInstance,name:"/rosapi/topics",serviceType:"rosapi/Topics"});
      topicsSrv.callService(new ROSLIB.ServiceRequest({}),res=>{
        if(res?.topics) setRosInfo(prev=>({...prev,topics:res.topics.slice(0,12)}));
      });
      const nodesSrv=new ROSLIB.Service({ros:rosInstance,name:"/rosapi/nodes",serviceType:"rosapi/Nodes"});
      nodesSrv.callService(new ROSLIB.ServiceRequest({}),res=>{
        if(res?.nodes) setRosInfo(prev=>({...prev,nodes:res.nodes.slice(0,8)}));
      });
    } catch(e){/* rosapi might not be available */}

    return()=>subs.forEach(s=>s.unsubscribe());
  },[rosConnected,rosInstance]);

  const bump=(name)=>{
    const now=Date.now();
    setTlog(prev=>{
      const last=lastT.current[name]||now;
      const dt=now-last; lastT.current[name]=now;
      const hz=dt>0?Math.round(1000/dt):prev[name].hz;
      return{...prev,[name]:{count:prev[name].count+1,hz:hz||prev[name].hz,last:ts()}};
    });
  };

  // Draw velocity vector
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width, H=canvas.height, cx=W/2, cy=H/2;
    ctx.clearRect(0,0,W,H);
    // background
    ctx.fillStyle="#111820"; ctx.fillRect(0,0,W,H);
    // grid
    ctx.strokeStyle="#1E2D3D"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(W,cy); ctx.moveTo(cx,0); ctx.lineTo(cx,H); ctx.stroke();
    // circle guide
    ctx.strokeStyle="#253545"; ctx.beginPath(); ctx.arc(cx,cy,Math.min(cx,cy)-4,0,Math.PI*2); ctx.stroke();
    // vector
    const len=vel.linear*60;
    const ang=vel.angular;
    const tx=cx+len*Math.sin(ang), ty=cy-len*Math.cos(ang);
    ctx.strokeStyle="#00D4FF"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(tx,ty); ctx.stroke();
    // arrowhead
    if(Math.abs(len)>4){
      const a=Math.atan2(ty-cy,tx-cx);
      ctx.beginPath();
      ctx.moveTo(tx,ty);
      ctx.lineTo(tx-8*Math.cos(a-.4),ty-8*Math.sin(a-.4));
      ctx.lineTo(tx-8*Math.cos(a+.4),ty-8*Math.sin(a+.4));
      ctx.closePath(); ctx.fillStyle="#00D4FF"; ctx.fill();
    }
    // center dot
    ctx.beginPath(); ctx.arc(cx,cy,4,0,Math.PI*2);
    ctx.fillStyle="#00FF9D"; ctx.fill();
  },[vel]);

  const trackedTopics=["/joint_states","/cmd_vel"];

  return(
    <div>
      {/* Status grid */}
      <div className="diag-grid">
        <div className="diag-cell">
          <div className="diag-lbl">Bridge</div>
          <div className={`diag-val ${rosConnected?"ok":"err"}`}>{rosConnected?"LIVE":"DOWN"}</div>
        </div>
        <div className="diag-cell">
          <div className="diag-lbl">Nodes</div>
          <div className="diag-val ok">{rosInfo.nodes.length||"–"}</div>
        </div>
        <div className="diag-cell">
          <div className="diag-lbl">/joint_states</div>
          <div className={`diag-val ${tlog["/joint_states"].hz>0?"ok":"warn"}`}>{tlog["/joint_states"].hz} Hz</div>
        </div>
        <div className="diag-cell">
          <div className="diag-lbl">/cmd_vel</div>
          <div className={`diag-val ${tlog["/cmd_vel"].hz>0?"ok":"warn"}`}>{tlog["/cmd_vel"].hz} Hz</div>
        </div>
      </div>

      {/* Topic bus */}
      <div style={{borderTop:"1px solid var(--b0)"}}>
        <div style={{padding:"6px 11px 3px",display:"flex",justifyContent:"space-between"}}>
          <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)",letterSpacing:".1em",textTransform:"uppercase"}}>Topic Bus</span>
          <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)"}}>Msgs · Hz · Last</span>
        </div>
        {trackedTopics.map(t=>(
          <div className="topic-row" key={t}>
            <span className="topic-name">{t}</span>
            <div className="topic-meta">
              <span className="topic-cnt">{tlog[t].count}</span>
              <span className="topic-hz">{tlog[t].hz}Hz</span>
              <span className="topic-time">{tlog[t].last}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Vector viz */}
      <div className="vec-canvas-wrap" style={{borderTop:"1px solid var(--b0)"}}>
        <div>
          <div style={{fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:4}}>Velocity Vector</div>
          <canvas ref={canvasRef} width={90} height={90} style={{borderRadius:6,display:"block"}}/>
        </div>
        <div className="vec-stats">
          <div className="vstat">
            <div className="vstat-lbl">Linear</div>
            <span style={{color:"var(--cyan)"}}>{vel.linear.toFixed(3)}</span>
            <span style={{color:"var(--lo)",fontSize:9}}> m/s</span>
          </div>
          <div className="vstat">
            <div className="vstat-lbl">Angular</div>
            <span style={{color:"var(--amb)"}}>{vel.angular.toFixed(3)}</span>
            <span style={{color:"var(--lo)",fontSize:9}}> rad/s</span>
          </div>
          <div className="vstat" style={{marginTop:4}}>
            <div className="vstat-lbl">Active topics</div>
            <span style={{color:"var(--grn)"}}>{rosInfo.topics.length||"–"}</span>
          </div>
        </div>
      </div>

      {/* Discovered nodes */}
      {rosInfo.nodes.length>0&&(
        <div style={{borderTop:"1px solid var(--b0)",padding:"5px 0"}}>
          <div style={{padding:"4px 11px 2px",fontFamily:"JetBrains Mono",fontSize:9,color:"var(--lo)",letterSpacing:".1em",textTransform:"uppercase"}}>ROS Nodes</div>
          {rosInfo.nodes.map(n=>(
            <div key={n} style={{padding:"3px 11px",fontFamily:"JetBrains Mono",fontSize:9,color:"var(--mid)",borderTop:"1px solid var(--b0)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Arm Viz ──────────────────────────────────────────────────────────────────
function ArmViz({joints}){
  const cx=105,cy=110,R=d=>(d*Math.PI)/180;
  const sa=R(joints.joint_2-90),ea=R(joints.joint_2+joints.joint_3-90);
  const wa=R(joints.joint_2+joints.joint_3+joints.joint_4-90),ba=R(joints.joint_1);
  const L1=48,L2=34,L3=20;
  const x1=cx+L1*Math.cos(sa),y1=cy+L1*Math.sin(sa);
  const x2=x1+L2*Math.cos(ea),y2=y1+L2*Math.sin(ea);
  const x3=x2+L3*Math.cos(wa),y3=y2+L3*Math.sin(wa);
  const g=joints.joint_6/100,m=(a,b)=>(a+b)/2;
  return(
    <div className="vizwrap">
      <svg viewBox="0 0 210 210" style={{width:"100%"}}>
        <defs><pattern id="gp" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0L0,0L0,20" fill="none" stroke="#1E2D3D" strokeWidth=".5"/></pattern></defs>
        <rect width="210" height="210" fill="url(#gp)" rx="8"/>
        <circle cx={cx} cy={cy} r="88" fill="none" stroke="#1E2D3D" strokeWidth=".5" strokeDasharray="4 4"/>
        <circle cx={cx} cy={cy} r="52" fill="none" stroke="#1E2D3D" strokeWidth=".5" strokeDasharray="2 6"/>
        <line x1={cx} y1={cy} x2={cx+88*Math.cos(ba)} y2={cy+88*Math.sin(ba)} stroke="#00D4FF" strokeWidth=".7" strokeDasharray="3 3" opacity=".2"/>
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
        <text x={m(cx,x1)-7} y={m(cy,y1)-5} fontSize="7.5" fill="#00D4FF" fontFamily="Inter,sans-serif" fontWeight="600">Upper Arm</text>
        <text x={m(x1,x2)-5} y={m(y1,y2)-5} fontSize="7.5" fill="#00FF9D" fontFamily="Inter,sans-serif" fontWeight="600">Forearm</text>
        <text x={m(x2,x3)+3} y={m(y2,y3)-3} fontSize="7.5" fill="#FFB800" fontFamily="Inter,sans-serif" fontWeight="600">Wrist</text>
        <text x={cx-9} y={cy+19} fontSize="7.5" fill="#00D4FF" fontFamily="Inter,sans-serif">Base</text>
        <text x={x3+4} y={y3+3} fontSize="7.5" fill="#FF4D6D" fontFamily="Inter,sans-serif" fontWeight="600">Grip</text>
        <text x="3" y="206" fontSize="7" fill="#3D4E5E" fontFamily="monospace">SIDE VIEW</text>
      </svg>
      <div className="vizleg">
        {[["#00D4FF","Upper Arm"],["#00FF9D","Forearm"],["#FFB800","Wrist"],["#FF4D6D","Gripper"]].map(([c,l])=>(
          <div className="vli" key={l}><div className="vld" style={{background:c}}/><span>{l}</span></div>
        ))}
      </div>
    </div>
  );
}

// ─── Step/Jog buttons ────────────────────────────────────────────────────────
function SBtn({children,onClick,disabled,speed,title,style}){
  const h=useLongPress(onClick,speed);
  return <button className="sbtn" disabled={disabled} title={title} style={style} {...(disabled?{}:h)}>{children}</button>;
}
function JBtn({children,onClick,disabled,speed,cls=""}){
  const h=useLongPress(onClick,speed);
  return <button className={`jbtn ${cls}`} disabled={disabled} {...(disabled?{}:h)}>{children}</button>;
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

  const log=useCallback((msg,type="info")=>{setLogs(p=>[{msg,type,time:ts()},...p.slice(0,59)]);},[]);

  useEffect(()=>{const t=setInterval(()=>{setHz(cntRef.current);cntRef.current=0;},1000);return()=>clearInterval(t);},[]);

  const connect=useCallback(()=>{
    const ROSLIB=window.ROSLIB;
    if(!ROSLIB){log("roslib.js not loaded","error");return;}
    if(rosRef.current) rosRef.current.close();
    setConn("connecting"); log(`Connecting to ${url} …`,"warn");
    const ros=new ROSLIB.Ros({url}); rosRef.current=ros;
    ros.on("connection",()=>{
      setConn("connected"); log("ROS2 bridge connected","success");
      pubRef.current=new ROSLIB.Topic({ros,name:"/joint_commands",messageType:"sensor_msgs/JointState"});
      subRef.current=new ROSLIB.Topic({ros,name:"/joint_states",  messageType:"sensor_msgs/JointState"});
      subRef.current.subscribe(msg=>{
        if(msg.name&&msg.position){const fb={};msg.name.forEach((n,i)=>{fb[n]=(msg.position[i]*180)/Math.PI;});setFeed(p=>({...p,...fb}));}
      });
      log("Subscribed /joint_states","info");
    });
    ros.on("error",e=>log(`Error: ${e?.message??e}`,"error"));
    ros.on("close",()=>{setConn("disconnected");log("Closed","warn");pubRef.current=null;subRef.current=null;});
  },[url,log]);

  const disconnect=useCallback(()=>{if(rosRef.current){rosRef.current.close();rosRef.current=null;}},[]);

  const publish=useCallback((ov)=>{
    if(!pubRef.current||estp) return;
    const j=ov??joints, sm=[.3,1,2][speed];
    const ROSLIB=window.ROSLIB;
    pubRef.current.publish(new ROSLIB.Message({
      name:JOINTS.map(jt=>jt.id),
      position:JOINTS.map(jt=>(j[jt.id]*Math.PI)/180),
      velocity:JOINTS.map(()=>sm),effort:[],
    }));
    cntRef.current+=1;
  },[joints,estp,speed]);

  const estop=useCallback(()=>{
    setEstp(true); log("⚠ EMERGENCY STOP","error");
    if(pubRef.current&&window.ROSLIB){
      pubRef.current.publish(new window.ROSLIB.Message({
        name:JOINTS.map(j=>j.id),
        position:JOINTS.map(j=>(joints[j.id]*Math.PI)/180),
        velocity:JOINTS.map(()=>0),effort:JOINTS.map(()=>0),
      }));
    }
  },[joints,log]);

  const resume=useCallback(()=>{setEstp(false);log("ESTOP cleared","success");},[log]);

  const stepJ=useCallback((id,delta)=>{
    if(estRef.current) return;
    setJ(prev=>{const j=JOINTS.find(x=>x.id===id);return{...prev,[id]:clamp(prev[id]+delta,j.min,j.max)};});
  },[]);

  const setJabs=useCallback((id,v)=>{
    if(estRef.current) return;
    setJ(prev=>{const j=JOINTS.find(x=>x.id===id);return{...prev,[id]:clamp(v,j.min,j.max)};});
  },[]);

  useEffect(()=>{if(conn==="connected"&&!estp) publish(joints);},[joints]); // eslint-disable-line

  const applyP=useCallback((p)=>{if(estp) return;setJ(p.values);log(`Preset: ${p.name}`,"info");},[estp,log]);
  const resetAll=useCallback(()=>{setJ(initJ());log("All → 0°","info");},[log]);

  const maxErr=Math.max(...JOINTS.map(j=>Math.abs((joints[j.id]||0)-(feed[j.id]||0))));
  const anyNear=JOINTS.some(j=>nearLim(joints[j.id],j));
  const dis=estp||conn!=="connected";

  return(
    <>
      <style>{CSS}</style>
      {estp&&<><div className="estop-ov"/><div className="estop-banner">⬛ EMERGENCY STOP — ALL MOTION HALTED</div></>}

      <div className="shell">
        {/* Header */}
        <header className="hdr">
          <div className="brand"><div className={`bdot ${conn!=="connected"?"off":""}`}/>ARM · CONTROL</div>
          <div className="hdr-r">
            <div className={`badge ${conn}`}><div className="bdg-dot"/>{conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}</div>
            {conn==="connected"&&<button className="hbtn disc" onClick={disconnect}>Disconnect</button>}
            {estp?<button className="hbtn resume" onClick={resume}>CLEAR ESTOP</button>:<button className="hbtn estop" onClick={estop}>⬛ E-STOP</button>}
          </div>
        </header>

        {/* Body */}
        <div className="body">

          {/* ── LEFT SIDEBAR ── */}
          <aside className="side side-l">
            <div className="slbl">Connection</div>
            <div className="cform">
              <div><div className="flbl">WebSocket URL</div>
                <input className="finput" value={url} onChange={e=>setUrl(e.target.value)} disabled={conn==="connected"} spellCheck={false}/>
              </div>
              <div className="cbtns">
                <button className="cbtn on" onClick={connect} disabled={conn!=="disconnected"}>{conn==="connecting"?"…":"Connect"}</button>
                <button className="cbtn off" onClick={disconnect} disabled={conn==="disconnected"}>Off</button>
              </div>
            </div>

            <div className="slbl">Speed</div>
            <div className="spd-row">{SPEEDS.map((s,i)=><button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSp(i)}>{s}</button>)}</div>

            <div className="slbl">Presets</div>
            <div className="pgrid">
              {PRESETS.map(p=>(
                <button key={p.name} className="pbtn" onClick={()=>applyP(p)} disabled={dis}>
                  <span className="ico">{p.icon}</span>{p.name}
                </button>
              ))}
            </div>

            <div className="slbl">Actions</div>
            <div style={{padding:"0 11px 9px",display:"flex",gap:5}}>
              <button className="rbtn ghost" style={{fontSize:10}} onClick={resetAll} disabled={dis}>Reset All</button>
              <button className="rbtn ghost" style={{fontSize:10}} onClick={()=>publish()} disabled={dis}>Publish</button>
            </div>

            <div className="slbl">Arm Preview</div>
            <ArmViz joints={joints}/>
          </aside>

          {/* ── CENTER ── */}
          <main className="center">
            <div className="cgrid">

              {/* Joint Controls */}
              <div className="card">
                <div className="chdr"><span className="ctitle">Joint Controls</span><span className="ctag">sensor_msgs/JointState</span></div>
                {JOINTS.map(j=>{
                  const val=joints[j.id], fill=fillStyle(val,j.min,j.max,j.color);
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
                        <span style={{color:"var(--lo)",fontSize:9,marginLeft:3}}>{j.unit}</span>
                        <button className="sbtn" style={{marginLeft:"auto"}} onClick={()=>setJabs(j.id,0)} disabled={dis} title="Zero">⊙</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right column */}
              <div className="cright">

                {/* Cartesian */}
                <div className="card">
                  <div className="chdr"><span className="ctitle">Cartesian Jog</span><span className="ctag">Hold=continuous · {JOG_DEG[speed]}°/tick</span></div>
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
                  <div style={{padding:"9px 11px"}}><button className="rbtn ghost" onClick={resetAll} disabled={dis}>Zero All Axes</button></div>
                </div>

                {/* System Log */}
                <div className="card">
                  <div className="chdr"><span className="ctitle">System Log</span><button className="ctag" style={{cursor:"pointer"}} onClick={()=>setLogs([])}>Clear</button></div>
                  <div className="logwrap">
                    {logs.length===0&&<div className="lent"><span className="ltm">{ts()}</span><span className="lmsg">Waiting…</span></div>}
                    {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
                  </div>
                </div>

                {/* Diagnostics */}
                <div className="card">
                  <div className="chdr"><span className="ctitle">ROS2 Diagnostics</span><span className="ctag">rosbridge</span></div>
                  <DiagnosticsPanel rosConnected={conn==="connected"} rosInstance={rosRef.current}/>
                </div>

              </div>
            </div>
          </main>

          {/* ── RIGHT SIDEBAR ── */}
          <aside className="side side-r">
            <div className="slbl">Telemetry</div>
            <div className="card" style={{margin:"0 10px 10px"}}>
              <div className="tgrid">
                <div className="tcell"><div className="tlbl">Status</div><div className={`tval ${conn==="connected"?"ok":"err"}`}>{conn==="connected"?"LIVE":"OFF"}</div></div>
                <div className="tcell"><div className="tlbl">Pub Hz</div><div className="tval">{hz}<span style={{fontSize:10,color:"var(--mid)"}}>Hz</span></div></div>
                <div className="tcell"><div className="tlbl">Speed</div><div className={`tval ${speed===2?"warn":""}`}>{SPEEDS[speed]}</div></div>
                <div className="tcell"><div className="tlbl">Max Err</div><div className={`tval ${maxErr>5?"warn":"ok"}`}>{maxErr.toFixed(1)}<span style={{fontSize:10,color:"var(--mid)"}}>°</span></div></div>
                <div className="tcell"><div className="tlbl">Limits</div><div className={`tval ${anyNear?"warn":"ok"}`}>{anyNear?"WARN":"OK"}</div></div>
                <div className="tcell"><div className="tlbl">E-Stop</div><div className={`tval ${estp?"err":"ok"}`}>{estp?"ACTV":"CLR"}</div></div>
              </div>
            </div>

            <div className="slbl">Feedback vs CMD</div>
            <div className="card" style={{margin:"0 10px 10px"}}>
              {JOINTS.map(j=>{
                const cmd=joints[j.id]??0, fb=feed[j.id]??0, err=Math.abs(cmd-fb);
                return(
                  <div className="fbrow" key={j.id}>
                    <div className="fbtop">
                      <span style={{fontSize:10,color:"var(--mid)"}}>{j.label}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:9,color:err>3?"var(--amb)":"var(--lo)"}}>Δ{err.toFixed(1)}{j.unit}</span>
                    </div>
                    <div className="fbbot">
                      <span style={{fontFamily:"JetBrains Mono",fontSize:11,color:j.color}}>CMD {cmd.toFixed(1)}{j.unit}</span>
                      <span style={{fontFamily:"JetBrains Mono",fontSize:11,color:"var(--mid)"}}>FB {fb.toFixed(1)}{j.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="slbl">Emergency</div>
            <div style={{padding:"0 10px 10px",display:"flex",flexDirection:"column",gap:5}}>
              <button className="rbtn danger" onClick={estop} disabled={estp}>⬛ EMERGENCY STOP</button>
              {estp&&<button className="rbtn success" onClick={resume}>✓ CLEAR &amp; RESUME</button>}
            </div>
          </aside>
        </div>

        {/* Strip */}
        <div className="strip">
          <div className={`sdot ${conn==="connected"?"ok":conn==="connecting"?"warn":"err"}`}/>
          <span>ros2 bridge</span><span style={{color:"var(--lo)"}}>·</span>
          <span style={{color:"var(--lo)"}}>{url}</span>
          <span style={{marginLeft:"auto",color:"var(--lo)"}}>ARM·CTRL v1.4 · {ts()}</span>
        </div>
      </div>
    </>
  );
}