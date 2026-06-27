import React, { useState, useEffect, useRef } from 'react';

export default function RosDiagnosticsDashboard({ rosConnected, rosInstance }) {
  // State for system diagnostics
  const [topicsLog, setTopicsLog] = useState({
    '/cmd_vel': { count: 0, lastReceived: '-', frequency: 0 },
    '/odom': { count: 0, lastReceived: '-', frequency: 0 },
    '/diagnostics': { count: 0, lastReceived: '-', frequency: 0 },
  });

  const [currentVelocity, setCurrentVelocity] = useState({ linear: 0, angular: 0 });
  const canvasRef = useRef(null);
  const lastTimeRef = useRef({});

  // Simulate or subscribe to ROS 2 Topics
  useEffect(() => {
    if (!rosConnected || !rosInstance) return;

    // Example Subscription for cmd_vel
    const cmdVelListener = new window.ROSLIB.Topic({
      ros: rosInstance,
      name: '/cmd_vel',
      messageType: 'geometry_msgs/Twist'
    });

    cmdVelListener.subscribe((message) => {
      const now = Date.now();
      setCurrentVelocity({
        linear: message.linear.x,
        angular: message.angular.z
      });

      updateTopicMeta('/cmd_vel', now);
    });

    // Example Subscription for Odometry
    const odomListener = new window.ROSLIB.Topic({
      ros: rosInstance,
      name: '/odom',
      messageType: 'nav_msgs/Odometry'
    });

    odomListener.subscribe(() => {
      updateTopicMeta('/odom', Date.now());
    });

    return () => {
      cmdVelListener.unsubscribe();
      odomListener.unsubscribe();
    };
  }, [rosConnected, rosInstance]);

  // Helper to calculate frequencies and update topic states
  const updateTopicMeta = (topicName, timestamp) => {
    setTopicsLog((prev) => {
      const lastTime = lastTimeRef.current[topicName] || timestamp;
      const timeDiff = timestamp - lastTime;
      const freq = timeDiff > 0 ? Math.round(1000 / timeDiff) : 0;
      lastTimeRef.current[topicName] = timestamp;

      return {
        ...prev,
        [topicName]: {
          count: prev[topicName].count + 1,
          lastReceived: new Date(timestamp).toLocaleTimeString(),
          frequency: freq > 0 ? freq : prev[topicName].frequency
        }
      };
    });
  };

  // Draw 2D Vector Directional Representation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw grid crosshair
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY); ctx.lineTo(canvas.width, centerY);
    ctx.moveTo(centerX, 0); ctx.lineTo(centerX, canvas.height);
    ctx.stroke();

    // Draw velocity vector arrow
    const vectorLength = currentVelocity.linear * 80; // Scale factor
    const angle = currentVelocity.angular; 

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    
    // Compute target end points based on velocity inputs
    const targetX = centerX + vectorLength * Math.sin(angle);
    const targetY = centerY - vectorLength * Math.cos(angle);
    
    ctx.lineTo(targetX, targetY);
    ctx.stroke();

    // Draw center point indicator
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
    ctx.fill();
  }, [currentVelocity]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: '#333' }}>
      <h2>ROS 2 Local Diagnostics Control</h2>
      <p>Connection Status: <strong style={{ color: rosConnected ? '#10b981' : '#ef4444' }}>{rosConnected ? 'CONNECTED' : 'DISCONNECTED'}</strong></p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
        {/* Topic Frequency Tracker Table */}
        <div>
          <h3>Topic Bus Activity</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '8px' }}>Topic Name</th>
                <th style={{ padding: '8px' }}>Msg Count</th>
                <th style={{ padding: '8px' }}>Est. Frequency</th>
                <th style={{ padding: '8px' }}>Last Data Stream</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(topicsLog).map(([topic, meta]) => (
                <tr key={topic} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{topic}</td>
                  <td style={{ padding: '8px' }}>{meta.count}</td>
                  <td style={{ padding: '8px' }}>{meta.frequency} Hz</td>
                  <td style={{ padding: '8px', color: '#666' }}>{meta.lastReceived}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 2D Vector Mapping Canvas */}
        <div>
          <h3>Live Vector Heading Visualizer</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <canvas ref={canvasRef} width={200} height={200} style={{ border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#f8fafc' }} />
            <div>
              <p><strong>Linear Vel:</strong> {currentVelocity.linear.toFixed(2)} m/s</p>
              <p><strong>Angular Vel:</strong> {currentVelocity.angular.toFixed(2)} rad/s</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}