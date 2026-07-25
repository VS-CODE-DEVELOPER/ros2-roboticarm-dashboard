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
const stripProto = (s) => s.replace(/^wss?:\/\//i,"").replace(/^https?:\/\//i,"");
const hostOf = (wsUrl) => stripProto(wsUrl).split(":")[0].split("/")[0];

// ─── localStorage ─────────────────────────────────────────────────────────────
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
  --hdr:48px;
}
html,body,#root{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--hi);font-family:'Inter',sans-serif;font-size:12px;line-height:1.4}

.shell{display:flex;flex-direction:column;width:100vw;height:100vh;overflow:hidden}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:var(--hdr);background:var(--panel);border-bottom:1px solid var(--b0);z-index:100;flex-shrink:0}
.brand{display:flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.05em;color:var(--cyan);flex-shrink:0}
.bdot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 7px var(--cyan);animation:blink 2s infinite}
.bdot.off{background:var(--lo);box-shadow:none;animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}

.hdr-center{display:flex;align-items:center;gap:8px;flex:1;justify-content:center}
.hdr-url-wrap{display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--b0);border-radius:var(--r);padding:4px 10px;width:240px}
.hdr-url-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--lo);letter-spacing:.1em;text-transform:uppercase}
.hdr-url-input{background:transparent;border:none;color:var(--hi);font-family:'JetBrains Mono',monospace;font-size:10px;outline:none;width:100%}

.hbtn{padding:5px 14px;border-radius:var(--r);font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.05em;cursor:pointer;transition:all .15s;border:1.5px solid transparent}
.hbtn.conn{background:var(--gdim);color:var(--grn);border-color:var(--grn)}
.hbtn.conn:hover:not(:disabled){background:var(--grn);color:var(--bg)}
.hbtn.disc{background:transparent;color:var(--mid);border-color:var(--b1)}
.hbtn.disc:hover:not(:disabled){border-color:var(--red);color:var(--red)}
.hbtn.estop{background:var(--rdim);border-color:var(--red);color:var(--red);padding:5px 20px}
.hbtn.estop:hover:not(:disabled){background:var(--red);color:#fff}
.hbtn.resume{background:var(--gdim);border-color:var(--grn);color:var(--grn)}
.hbtn.resume:hover:not(:disabled){background:var(--grn);color:var(--bg)}

.badge{display:flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:10px;font-weight:600;font-family:'JetBrains Mono',monospace;letter-spacing:.07em;text-transform:uppercase;border:1px solid transparent;white-space:nowrap}
.badge.connected{color:var(--grn);border-color:var(--grn);background:var(--gdim)}
.badge.disconnected{color:var(--mid);border-color:var(--b0)}
.bdg-dot{width:5px;height:5px;border-radius:50%;background:currentColor}

/* ── Main Layout: 3 Columns ── */
.main-stage{display:flex;flex:1;overflow:hidden;background:#000}

/* LEFT MENU */
.left-menu{width:340px;background:var(--panel);border-right:1px solid var(--b0);display:flex;flex-direction:column;z-index:10}
.menu-tabs{display:flex;padding:12px 12px 0;gap:4px;border-bottom:1px solid var(--b0);background:var(--panel)}
.mtab{flex:1;padding:8px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mid);background:transparent;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;transition:all .2s}
.mtab.active{background:var(--bg);color:var(--cyan);border-color:var(--b0)}
.mtab.active.teach{color:var(--purple)}

.menu-content{flex:1;overflow-y:auto;background:var(--bg);padding:12px;display:flex;flex-direction:column;gap:16px}
.menu-content::-webkit-scrollbar{width:4px}
.menu-content::-webkit-scrollbar-thumb{background:var(--b0);border-radius:2px}

.sec-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lo);margin-bottom:6px}

/* Left Panel UI Elements */
.spd-row{display:flex;gap:4px}
.spd{flex:1;padding:6px 2px;background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);color:var(--mid);font-size:10px;font-weight:600;cursor:pointer;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px}
.spd.on{background:var(--cdim);border-color:var(--cyan);color:var(--cyan)}
.spd-rate{font-family:'JetBrains Mono',monospace;font-size:7px;color:var(--lo)}

.jog-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.jax{background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);padding:6px}
.axlbl{font-size:9px;color:var(--mid);margin-bottom:4px;display:flex;align-items:center;gap:4px}
.axdot{width:4px;height:4px;border-radius:50%}
.jog-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px}
.jbtn{padding:6px 3px;background:var(--bg);border:1px solid var(--b0);border-radius:4px;color:var(--mid);font-size:9px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:1px}
.jbtn:hover:not([disabled]){border-color:var(--cyan);color:var(--cyan)}
.jbtn.mid{background:transparent;color:var(--lo);cursor:default;border:none}

.jrow{background:var(--panel);border:1px solid var(--b0);border-radius:var(--r);padding:8px;margin-bottom:6px}
.jhdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.jname{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:500}
.jdot{width:6px;height:6px;border-radius:50%}
.jval{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700}
.swrap{position:relative;height:16px;display:flex;align-items:center;margin-bottom:4px}
.strk{position:absolute;left:0;right:0;height:2px;background:var(--b1);border-radius:2px}
.sfill{position:absolute;height:2px;border-radius:2px}
input[type=range]{position:relative;width:100%;height:16px;appearance:none;background:transparent;cursor:pointer;z-index:1}
input[type=range]::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:var(--hi);border:2px solid var(--cyan)}

/* CENTER FOXGLOVE */
.foxglove-stage{flex:1;position:relative;display:flex;flex-direction:column;background:#0A0A0A}
.fg-iframe{width:100%;height:100%;border:none}
.fg-overlay{position:absolute;top:12px;right:12px;display:flex;gap:8px;z-index:20}
.fg-pill{background:rgba(13,17,23,.85);border:1px solid var(--purple);color:var(--purple);padding:4px 10px;border-radius:12px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;backdrop-filter:blur(4px);display:flex;align-items:center;gap:6px}
.fg-link{background:rgba(199,125,255,.15);color:var(--purple);padding:4px 10px;border-radius:12px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;text-decoration:none;border:1px solid var(--purple);backdrop-filter:blur(4px);transition:all .2s}
.fg-link:hover{background:var(--purple);color:#000}

/* RIGHT STATUS SIDEBAR */
.right-status{width:280px;background:var(--panel);border-left:1px solid var(--b0);display:flex;flex-direction:column;z-index:10}
.rs-hdr{padding:12px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--hi);border-bottom:1px solid var(--b0);background:rgba(255,255,255,.02)}

.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0);border-bottom:1px solid var(--b0)}
.tcell{background:var(--panel);padding:10px 12px}
.tlbl{font-size:8px;font-family:'JetBrains Mono',monospace;color:var(--lo);letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px}
.tval{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--hi)}
.tval.ok{color:var(--grn)}
.tval.err{color:var(--red)}

.fb-list{padding:12px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--b0)}
.fbrow{display:flex;flex-direction:column;gap:2px}
.fbtop{display:flex;justify-content:space-between;font-size:9px;color:var(--mid)}
.fbbar-track{height:3px;background:var(--bg);border-radius:2px;overflow:hidden;border:1px solid var(--b0)}
.fbbar-fill{height:100%;border-radius:2px}

.sys-logs{flex:1;overflow:hidden;display:flex;flex-direction:column;background:var(--bg)}
.log-wrap{flex:1;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:9px;display:flex;flex-direction:column-reverse;padding-bottom:8px}
.log-wrap::-webkit-scrollbar{width:4px}
.log-wrap::-webkit-scrollbar-thumb{background:var(--b0)}
.lent{display:flex;gap:6px;padding:6px 10px;border-top:1px solid var(--b0)}
.ltm{color:var(--lo);flex-shrink:0}
.lmsg{color:var(--mid)}
.lmsg.info{color:var(--cyan)}
.lmsg.success{color:var(--grn)}
.lmsg.warn{color:var(--amb)}
.lmsg.error{color:var(--red)}

.estop-ov{position:fixed;inset:0;background:rgba(255,59,59,.07);border:4px solid var(--red);pointer-events:none;z-index:999;animation:ep .5s infinite alternate}
@keyframes ep{from{opacity:.3}to{opacity:1}}
`;

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
function JBtn({children,onClick,disabled,speed}){
  const h=useLongPress(onClick,speed);
  return <button className="jbtn" disabled={disabled} {...(disabled?{}:h)}>{children}</button>;
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
  
  // Left menu state
  const [menuTab, setMenuTab] = useState("control"); // "control" or "teach"

  const [presets,setPresets] = useState(DEFAULT_PRESETS);
  const [armPower,setArmPower] = useState(true);
  const [waypoints,setWaypoints] = useState(initialWaypoints());
  const [playing,setPlaying] = useState(false);
  const playCancelRef = useRef(false);

  const [remoteStatus,setRemoteStatus] = useState("idle");
  const [remoteActiveJoint,setRemoteActiveJoint] = useState(null);
  const [remoteBrokerUrl,setRemoteBrokerUrlRaw] = useState(initialRemoteUrl());

  const rosRef=useRef(null), pubRef=useRef(null), subRef=useRef(null), powerRef=useRef(null);
  const cntRef=useRef(0), estRef=useRef(false), feedRef=useRef(initJ());
  const logHistoryRef=useRef([]);
  const reconnectAttemptRef=useRef(0), reconnectTimerRef=useRef(null), manualDisconnectRef=useRef(false);
  const speedRef=useRef(speed), disRef=useRef(false);

  useEffect(()=>{estRef.current=estp;},[estp]);
  useEffect(()=>{speedRef.current=speed;},[speed]);
  useEffect(()=>{ safeSet("armctrl_waypoints", JSON.stringify(waypoints)); },[waypoints]);

  const log=useCallback((msg,type="info")=>{
    const entry={msg,type,time:ts(),iso:new Date().toISOString()};
    logHistoryRef.current.push(entry);
    if(logHistoryRef.current.length>1000) logHistoryRef.current.shift();
    setLogs(p=>[entry,...p.slice(0,49)]);
  },[]);

  const setUrl = useCallback(v=>{ setUrlRaw("ws://"+stripProto(v)); safeSet("armctrl_url", "ws://"+stripProto(v)); },[]);
  const setSp  = useCallback(v=>{ setSpRaw(v); safeSet("armctrl_speed", String(v)); },[]);

  const dispatchCommand = useCallback((type, payload) => {
    const ROSLIB = window.ROSLIB;
    if (type === "JOINT_COMMAND" && pubRef.current && ROSLIB) {
      pubRef.current.publish(new ROSLIB.Message({
        name: JOINTS.map(j=>j.id), position: JOINTS.map(j=>(payload.joints[j.id]*Math.PI)/180),
        velocity: JOINTS.map(()=>payload.speedMs), effort: [],
      }));
      cntRef.current += 1;
    } else if (type === "ARM_POWER" && powerRef.current && ROSLIB) {
      powerRef.current.publish(new ROSLIB.Message({data:payload.on}));
    } else if (type === "ESTOP" && pubRef.current && ROSLIB) {
      pubRef.current.publish(new ROSLIB.Message({
        name: JOINTS.map(j=>j.id), position: JOINTS.map(j=>(payload.joints[j.id]*Math.PI)/180),
        velocity: JOINTS.map(()=>0), effort: JOINTS.map(()=>0),
      }));
    }
  }, []);

  const connect=useCallback(()=>{
    manualDisconnectRef.current=false;
    clearTimeout(reconnectTimerRef.current);
    const ROSLIB=window.ROSLIB;
    if(!ROSLIB) return log("roslib.js not loaded","error");
    if(rosRef.current) rosRef.current.close();
    setConn("connecting");
    log(`Connecting → ${url}`,"warn");
    
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
    });
    ros.on("error",e=>{ if(reconnectAttemptRef.current===0) log(`ROS Error: ${e?.message??e}`,"error"); });
    ros.on("close",()=>{
      pubRef.current=null; subRef.current=null;
      if(!manualDisconnectRef.current && reconnectAttemptRef.current<8){
        const delay=Math.min(1000*Math.pow(1.5,reconnectAttemptRef.current),5000);
        reconnectTimerRef.current=setTimeout(()=>{ reconnectAttemptRef.current+=1; connect(); },delay);
      } else {
        setConn("disconnected"); reconnectAttemptRef.current=0; log("ROS Connection closed","warn");
      }
    });
  },[url,log]);

  const disconnect=useCallback(()=>{
    manualDisconnectRef.current=true;
    clearTimeout(reconnectTimerRef.current); reconnectAttemptRef.current=0;
    if(rosRef.current){rosRef.current.close();rosRef.current=null;}
  },[]);

  const publish=useCallback((ov)=>{
    if(estp || !pubRef.current) return;
    dispatchCommand("JOINT_COMMAND", {joints:ov??joints, speedMs:[.3,1,2][speed]});
  },[joints,estp,speed,dispatchCommand]);

  const handleEstop=useCallback(()=>{
    setEstp(true); log("⚠ EMERGENCY STOP ACTIVATED","error");
    dispatchCommand("ESTOP", {joints});
  },[joints,log,dispatchCommand]);

  useEffect(()=>{
    const onKey=(e)=>{
      if(e.code!=="Space") return;
      if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) return;
      e.preventDefault(); if(!estRef.current) handleEstop();
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

  const dis=estp||conn!=="connected"||!armPower;
  useEffect(()=>{ disRef.current=dis; },[dis]);

  // ── MQTT Remote ──
  const lastRemoteCmd = useRef(0), remoteActiveTimeout = useRef(null);
  useEffect(() => {
    setRemoteStatus("connecting");
    const client = mqtt.connect(remoteBrokerUrl);
    client.on("connect", () => { setRemoteStatus("linked"); client.subscribe("remote/data"); });
    client.on("reconnect", () => setRemoteStatus("connecting"));
    client.on("close", () => setRemoteStatus(p => p==="error" ? p : "offline"));
    client.on("error", () => setRemoteStatus("error"));

    client.on("message", (topic, msg) => {
      if (topic !== "remote/data" || estRef.current || disRef.current) return;
      const now = Date.now();
      if (now - lastRemoteCmd.current < 40) return;
      lastRemoteCmd.current = now;

      try {
        const d = JSON.parse(msg.toString());
        const amt = JOG_DEG[speedRef.current], L = 1700, H = 2400;
        let mv = null;

        if (d.joyX < L) { stepJ("joint_1", -amt); mv="joint_1"; }
        if (d.joyX > H) { stepJ("joint_1",  amt); mv="joint_1"; }
        if (d.joyY < L) { stepJ("joint_2", -amt); mv="joint_2"; }
        if (d.joyY > H) { stepJ("joint_2",  amt); mv="joint_2"; }
        if (d.btn1 === 0) { stepJ("joint_6",  5); mv="joint_6"; }
        if (d.btn2 === 0) { stepJ("joint_6", -5); mv="joint_6"; }

        if (mv) {
          remoteActiveJointRef.current = mv; setRemoteActiveJoint(mv);
          clearTimeout(remoteActiveTimeout.current);
          remoteActiveTimeout.current = setTimeout(()=>{ setRemoteActiveJoint(null); }, 300);
        }
      } catch (e) {}
    });
    return () => { clearTimeout(remoteActiveTimeout.current); client.end(true); };
  }, [stepJ, remoteBrokerUrl]);

  // Derived Foxglove Host
  const host = hostOf(url);
  const fgTarget = `ws://${host}:8765`;
  const fgUrl = `https://app.foxglove.dev/?ds=foxglove-websocket&ds.url=${encodeURIComponent(fgTarget)}`;

  return(
    <>
      <style>{CSS}</style>
      {estp&&<div className="estop-ov"/>}
      
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
              <input className="hdr-url-input" value={url.replace(/^ws:\/\//,"")} onChange={e=>setUrl(e.target.value)} disabled={conn==="connected"} placeholder="host:9090"/>
            </div>
            <button className="hbtn conn" onClick={connect} disabled={conn!=="disconnected"}>{conn==="connecting"?"Connecting…":"Connect"}</button>
            <button className="hbtn disc" onClick={disconnect} disabled={conn==="disconnected"}>Disconnect</button>
          </div>
          <div className="hdr-r">
            <div className={`badge ${conn}`}>
              <div className="bdg-dot"/>
              {conn==="connected"?"ONLINE":conn==="connecting"?"CONNECTING":"OFFLINE"}
            </div>
            {estp
              ?<button className="hbtn resume" onClick={()=>{setEstp(false); log("E-Stop Cleared","success");}}>CLEAR E-STOP</button>
              :<button className="hbtn estop" onClick={handleEstop}>⬛ E-STOP</button>
            }
          </div>
        </header>

        {/* ── MAIN STAGE ── */}
        <div className="main-stage">
          
          {/* LEFT MENU (Controls) */}
          <aside className="left-menu">
            <div className="menu-tabs">
              <button className={`mtab ${menuTab==="control"?"active":""}`} onClick={()=>setMenuTab("control")}>Control</button>
              <button className={`mtab ${menuTab==="teach"?"active teach":""}`} onClick={()=>setMenuTab("teach")}>Teach</button>
            </div>
            
            <div className="menu-content">
              {menuTab === "control" ? (
                <>
                  <div>
                    <div className="sec-lbl">Speed</div>
                    <div className="spd-row">
                      {SPEEDS.map((s,i)=>(
                        <button key={s} className={`spd ${speed===i?"on":""}`} onClick={()=>setSp(i)}>
                          <div>{s}</div>
                          <div className="spd-rate">{JOG_DEG[i]}°/t</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="sec-lbl">Cartesian Jog</div>
                    <div className="jog-grid">
                      {[
                        {axis:"X",label:"Base",color:"#00D4FF",id:"joint_1",dir:["←","→"]},
                        {axis:"Y",label:"Shoulder",color:"#00FF9D",id:"joint_2",dir:["↓","↑"]},
                        {axis:"Z",label:"Elbow",color:"#FFB800",id:"joint_3",dir:["←","→"]},
                      ].map(({axis,label,color,id,dir})=>(
                        <div className="jax" key={axis}>
                          <div className="axlbl"><div className="axdot" style={{background:color}}/>{axis} {label}</div>
                          <div className="jog-row">
                            <JBtn speed={speed} onClick={()=>stepJ(id,-JOG_DEG[speed])} disabled={dis}>{dir[0]}</JBtn>
                            <div className="jbtn mid"></div>
                            <JBtn speed={speed} onClick={()=>stepJ(id,JOG_DEG[speed])} disabled={dis}>{dir[1]}</JBtn>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="sec-lbl">Joint Sliders</div>
                    {JOINTS.map(j=>{
                      const val=joints[j.id], fill=fillSt(val,j.min,j.max,j.color);
                      return(
                        <div className="jrow" key={j.id}>
                          <div className="jhdr">
                            <div className="jname"><div className="jdot" style={{background:j.color}}/>{j.label}</div>
                            <div className="jval" style={{color:j.color}}>{val.toFixed(1)}{j.unit}</div>
                          </div>
                          <div className="swrap">
                            <div className="strk"/><div className="sfill" style={fill}/>
                            <input type="range" min={j.min} max={j.max} step=".5" value={val} onChange={e=>setJabs(j.id,e.target.value)} disabled={dis}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  {/* Teach Mode Content */}
                  <div>
                    <div className="sec-lbl">Motor Power</div>
                    <div style={{background:"var(--panel)",padding:12,borderRadius:"var(--r)",border:"1px solid var(--b0)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{fontSize:10,fontWeight:600,color:"var(--hi)"}}>{armPower?"Energized":"Free (Teach)"}</span>
                        <button style={{background:armPower?"var(--grn)":"var(--b1)",border:"none",width:38,height:20,borderRadius:10,position:"relative",cursor:"pointer"}} onClick={()=>{
                          const n=!armPower; setArmPower(n); 
                          if(powerRef.current) powerRef.current.publish(new window.ROSLIB.Message({data:n}));
                          log(n?"Arm power ON":"Teach Mode Active", n?"success":"warn");
                        }} disabled={estp||conn!=="connected"}>
                          <div style={{width:16,height:16,borderRadius:"50%",background:"var(--hi)",position:"absolute",top:2,left:armPower?20:2,transition:"left .12s"}}/>
                        </button>
                      </div>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--lo)",lineHeight:1.4}}>
                        {armPower?"Motors are holding position. Disable to move the arm by hand and record points.":"Motors are slack. Move the arm manually and click Record."}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="sec-lbl">Record Path</div>
                    <button style={{width:"100%",padding:10,background:"var(--rdim)",border:"1px solid var(--red)",borderRadius:"var(--r)",color:"var(--red)",fontFamily:"'JetBrains Mono'",fontSize:10,fontWeight:700,cursor:"pointer",marginBottom:8}} 
                      onClick={()=>{
                        setWaypoints(p=>[...p,{id:Date.now(),values:{...feedRef.current},label:`Point ${p.length+1}`}]);
                        log("Waypoint recorded","success");
                      }} disabled={armPower||conn!=="connected"||estp}>
                      RECORD WAYPOINT
                    </button>
                    <div style={{background:"var(--panel)",border:"1px solid var(--b0)",borderRadius:"var(--r)",maxHeight:200,overflowY:"auto",fontFamily:"'JetBrains Mono'",fontSize:9}}>
                      {waypoints.length===0 ? <div style={{padding:12,color:"var(--lo)",textAlign:"center"}}>No points recorded</div>
                       : waypoints.map(w=>(
                         <div key={w.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",borderBottom:"1px solid var(--b0)"}}>
                           <span>{w.label}</span>
                           <button style={{background:"transparent",border:"none",color:"var(--red)",cursor:"pointer"}} onClick={()=>setWaypoints(p=>p.filter(x=>x.id!==w.id))}>✕</button>
                         </div>
                       ))}
                    </div>
                  </div>

                  <div style={{display:"flex",gap:4}}>
                    <button style={{flex:1,padding:8,background:"var(--cdim)",border:"1px solid var(--cyan)",color:"var(--cyan)",borderRadius:"var(--r)",fontFamily:"'JetBrains Mono'",fontSize:9,fontWeight:700,cursor:"pointer"}} 
                      onClick={async ()=>{
                        if(!armPower) return log("Re-energize first","error");
                        playCancelRef.current=false; setPlaying(true); log("Playing path","info");
                        for(const wp of waypoints){
                          if(playCancelRef.current) break;
                          setJ(prev=>({...prev,...wp.values}));
                          await new Promise(r=>setTimeout(r,1500));
                        }
                        setPlaying(false);
                      }} disabled={waypoints.length===0||playing||!armPower||conn!=="connected"}>▶ PLAY PATH</button>
                    <button style={{padding:"8px 12px",background:"transparent",border:"1px solid var(--b1)",color:"var(--mid)",borderRadius:"var(--r)",fontFamily:"'JetBrains Mono'",fontSize:9,fontWeight:700,cursor:"pointer"}} 
                      onClick={()=>{playCancelRef.current=true;}} disabled={!playing}>STOP</button>
                  </div>
                </>
              )}
            </div>
          </aside>

          {/* CENTER FOXGLOVE FRAME */}
          <main className="foxglove-stage">
            <div className="fg-overlay">
              <div className="fg-pill">Foxglove 3D</div>
              <a href={fgUrl} target="_blank" rel="noopener noreferrer" className="fg-link">Open in New Tab ↗</a>
            </div>
            <iframe src={fgUrl} className="fg-iframe" title="Foxglove Digital Twin"/>
          </main>

          {/* RIGHT STATUS FRAME */}
          <aside className="right-status">
            <div className="rs-hdr">Telemetry & Status</div>
            
            <div className="tgrid">
              <div className="tcell"><div className="tlbl">Remote Link</div>
                <div className={`tval ${remoteStatus==="linked"?"ok":remoteStatus==="error"?"err":""}`}>{remoteStatus.toUpperCase()}</div>
              </div>
              <div className="tcell"><div className="tlbl">Active Input</div>
                <div className="tval" style={{color:remoteActiveJoint?"var(--grn)":"var(--hi)"}}>{remoteActiveJoint ? "HARDWARE" : "WEB UI"}</div>
              </div>
            </div>

            <div className="fb-list">
              <div className="sec-lbl">Joint Tracking</div>
              {JOINTS.map(j=>{
                const err = Math.abs((joints[j.id]??0)-(feed[j.id]??0));
                return (
                  <div className="fbrow" key={j.id}>
                    <div className="fbtop">
                      <span>{j.short}</span>
                      <span style={{color:deltaColor(err)}}>Δ {err.toFixed(1)}°</span>
                    </div>
                    <div className="fbbar-track"><div className="fbbar-fill" style={{width:`${deltaPct(err)}%`,background:deltaColor(err)}}/></div>
                  </div>
                );
              })}
            </div>

            <div className="sys-logs">
              <div className="rs-hdr" style={{borderTop:"1px solid var(--b0)"}}>System Log</div>
              <div className="log-wrap">
                {logs.length===0&&<div className="lent"><span className="ltm">{ts()}</span><span className="lmsg">Waiting for connection…</span></div>}
                {logs.map((l,i)=><div className="lent" key={i}><span className="ltm">{l.time}</span><span className={`lmsg ${l.type}`}>{l.msg}</span></div>)}
              </div>
            </div>
          </aside>

        </div>
      </div>
    </>
  );
}