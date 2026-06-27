import React, { useState, useEffect, useRef } from 'react';

export default function RosDiagnosticsDashboard({ rosConnected, rosInstance }) {
  const TOPICS = ["/joint_commands", "/joint_states", "/cmd_vel", "/diagnostics"];
  const [tlog, setTlog] = useState(
    Object.fromEntries(TOPICS.map((t) => [t, { count: 0, hz: 0, last: "-" }]))
  );
  const [vel, setVel] = useState({ linear: 0, angular: 0 });
  const [rosInfo, setRosInfo] = useState({ topics: [], nodes: [] });
  const lastT = useRef({});
  const canvasRef = useRef(null);

  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  useEffect(() => {
    if (!rosConnected || !rosInstance) return;
    const ROSLIB = window.ROSLIB;
    const subs = [];

    const jsSub = new ROSLIB.Topic({ ros: rosInstance, name: "/joint_states", messageType: "sensor_msgs/JointState" });
    jsSub.subscribe(() => bump("/joint_states"));
    subs.push(jsSub);

    const cvSub = new ROSLIB.Topic({ ros: rosInstance, name: "/cmd_vel", messageType: "geometry_msgs/Twist" });
    cvSub.subscribe((msg) => {
      bump("/cmd_vel");
      if (msg?.linear && msg?.angular) setVel({ linear: msg.linear.x, angular: msg.angular.z });
    });
    subs.push(cvSub);

    try {
      const topicsSrv = new ROSLIB.Service({ ros: rosInstance, name: "/rosapi/topics", serviceType: "rosapi/Topics" });
      topicsSrv.callService(new ROSLIB.ServiceRequest({}), (res) => {
        if (res?.topics) setRosInfo((prev) => ({ ...prev, topics: res.topics.slice(0, 12) }));
      });
      const nodesSrv = new ROSLIB.Service({ ros: rosInstance, name: "/rosapi/nodes", serviceType: "rosapi/Nodes" });
      nodesSrv.callService(new ROSLIB.ServiceRequest({}), (res) => {
        if (res?.nodes) setRosInfo((prev) => ({ ...prev, nodes: res.nodes.slice(0, 8) }));
      });
    } catch (e) {
      // rosapi might not be available
    }

    return () => subs.forEach((s) => s.unsubscribe());
  }, [rosConnected, rosInstance]);

  const bump = (name) => {
    const now = Date.now();
    setTlog((prev) => {
      const last = lastT.current[name] || now;
      const dt = now - last;
      lastT.current[name] = now;
      const hz = dt > 0 ? Math.round(1000 / dt) : prev[name].hz;
      return { ...prev, [name]: { count: prev[name].count + 1, hz: hz || prev[name].hz, last: ts() } };
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);
    
    // Background and styling to match your dark mode
    ctx.fillStyle = "#111820"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#1E2D3D"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.strokeStyle = "#253545"; ctx.beginPath(); ctx.arc(cx, cy, Math.min(cx, cy) - 4, 0, Math.PI * 2); ctx.stroke();
    
    const len = vel.linear * 60;
    const ang = vel.angular;
    const tx = cx + len * Math.sin(ang), ty = cy - len * Math.cos(ang);
    ctx.strokeStyle = "#00D4FF"; ctx.lineWidth = 2;
    
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    if (Math.abs(len) > 4) {
      const a = Math.atan2(ty - cy, tx - cx);
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 8 * Math.cos(a - 0.4), ty - 8 * Math.sin(a - 0.4));
      ctx.lineTo(tx - 8 * Math.cos(a + 0.4), ty - 8 * Math.sin(a + 0.4));
      ctx.closePath(); ctx.fillStyle = "#00D4FF"; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#00FF9D"; ctx.fill();
  }, [vel]);

  const trackedTopics = ["/joint_states", "/cmd_vel"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1px", background: "var(--b0)" }}>
      
      {/* Box 1: Status Grid */}
      <div style={{ background: "var(--card)", padding: "12px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          <div style={{ border: "1px solid var(--b0)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "4px" }}>Bridge</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "14px", fontWeight: "600", color: rosConnected ? "var(--grn)" : "var(--red)" }}>{rosConnected ? "LIVE" : "DOWN"}</div>
          </div>
          <div style={{ border: "1px solid var(--b0)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "4px" }}>Nodes</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "14px", fontWeight: "600", color: "var(--grn)" }}>{rosInfo.nodes.length || "–"}</div>
          </div>
          <div style={{ border: "1px solid var(--b0)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "4px" }}>/joint_states</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "14px", fontWeight: "600", color: tlog["/joint_states"].hz > 0 ? "var(--grn)" : "var(--amb)" }}>{tlog["/joint_states"].hz} Hz</div>
          </div>
          <div style={{ border: "1px solid var(--b0)", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", fontFamily: "'JetBrains Mono', monospace", color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "4px" }}>/cmd_vel</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "14px", fontWeight: "600", color: tlog["/cmd_vel"].hz > 0 ? "var(--grn)" : "var(--amb)" }}>{tlog["/cmd_vel"].hz} Hz</div>
          </div>
        </div>
      </div>

      {/* Box 2: Topic Bus */}
      <div style={{ background: "var(--card)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "10px 16px 8px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--b0)" }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase" }}>Topic Bus</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--lo)" }}>Msgs · Hz · Last</span>
        </div>
        <div style={{ flex: 1, padding: "8px 0" }}>
          {trackedTopics.map((t) => (
            <div key={t} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--b0)", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px" }}>
              <span style={{ color: "var(--cyan)" }}>{t}</span>
              <div style={{ display: "flex", gap: "14px" }}>
                <span style={{ color: "var(--lo)" }}>{tlog[t].count}</span>
                <span style={{ color: "var(--grn)", minWidth: "36px", textAlign: "right" }}>{tlog[t].hz}Hz</span>
                <span style={{ color: "var(--mid)", minWidth: "55px", textAlign: "right" }}>{tlog[t].last}</span>
              </div>
            </div>
          ))}
          {rosInfo.nodes.length > 0 && (
             <div style={{ padding: "12px 16px" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase" }}>Detected Nodes</span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
                  {rosInfo.nodes.slice(0, 4).map((n) => (
                    <span key={n} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--mid)", background: "var(--panel)", padding: "3px 8px", borderRadius: "4px", border: "1px solid var(--b0)" }}>
                      {n.split('/').pop() || n}
                    </span>
                  ))}
                </div>
             </div>
          )}
        </div>
      </div>

      {/* Box 3: Vector & Kinematics */}
      <div style={{ background: "var(--card)", display: "flex", alignItems: "center", padding: "16px 24px", gap: "24px" }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "var(--lo)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 10 }}>Velocity Vector</div>
          <canvas ref={canvasRef} width={90} height={90} style={{ borderRadius: 8, display: "block", border: "1px solid var(--b0)" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div style={{ color: "var(--lo)", fontSize: 9, marginBottom: 2, fontFamily: "'JetBrains Mono', monospace", letterSpacing: ".05em" }}>Linear X</div>
            <span style={{ color: "var(--cyan)", fontSize: "16px", fontFamily: "'JetBrains Mono', monospace", fontWeight: "600" }}>{vel.linear.toFixed(3)}</span><span style={{ color: "var(--lo)", fontSize: 10 }}> m/s</span>
          </div>
          <div>
            <div style={{ color: "var(--lo)", fontSize: 9, marginBottom: 2, fontFamily: "'JetBrains Mono', monospace", letterSpacing: ".05em" }}>Angular Z</div>
            <span style={{ color: "var(--amb)", fontSize: "16px", fontFamily: "'JetBrains Mono', monospace", fontWeight: "600" }}>{vel.angular.toFixed(3)}</span><span style={{ color: "var(--lo)", fontSize: 10 }}> rad/s</span>
          </div>
        </div>
      </div>

    </div>
  );
}