# ARM · CONTROL — ROS2 Robotic Arm Dashboard

> A real-time web-based control dashboard for a 6-DOF robotic arm, built on ROS2, rosbridge, and React/Vite. Connects to a Raspberry Pi over a private VPN tunnel and runs fully in the browser with no backend required.

---

## System Architecture

```
Browser (Vercel)
      │
      │  WebSocket  ws://<your-pi-ip>:9090
      ▼
rosbridge_websocket  (Raspberry Pi)
      │
      │  ROS2 Topics
      ▼
Robot ROS2 Nodes  ──►  Servo / Motor Drivers  ──►  Arm Hardware
      │
      ▼
/joint_states feedback  (back to browser)
```

### Network Stack

| Layer | Technology |
|---|---|
| Remote access | Tailscale VPN (private mesh network) |
| ROS2 ↔ Browser bridge | rosbridge_websocket on port `9090` |
| Frontend | React 18 + Vite, deployed on Vercel |
| ROS2 JS client | roslibjs (loaded via CDN) |

---

## Features

### Control
- **6-joint control** — Base Rotation, Shoulder, Elbow, Wrist Pitch, Wrist Roll, Gripper
- **Joint sliders** with live fill, min/max labels, and colour-coded per joint
- **±Step buttons** with long-hold for continuous jogging (hold = stream commands)
- **Numeric input** — type exact degree values directly
- **Zero per joint** — reset any single joint to 0° with one click
- **Cartesian Jog** — X/Y/Z axis jog buttons mapped to base joints (hold = continuous)
- **Speed control** — Slow / Normal / Fast (affects step size and publish rate)

### Safety
- **Emergency Stop** — instantly halts all motion, publishes zero velocity to `/joint_commands`, locks all controls
- **Clear & Resume** — re-enables motion after confirming stop
- **Joint limit warnings** — sliders and values turn amber (NEAR LIMIT) or red (AT LIMIT) with flashing border when within 5° of hardware limits
- **Emergency overlay** — full-screen red border + banner when Emergency Stop is active

### Presets
| Name | Description |
|---|---|
| Home | All joints at 0° |
| Grab Ready | Arm extended in pick position |
| Release | Gripper fully open |
| Stow | Arm folded for safe transport |

### Visualisation
- **2D arm preview** — live SVG side-view showing Upper Arm, Forearm, Wrist, Gripper segments updating in real-time with labelled segments and joint markers
- **Foxglove 3D integration** — placeholder ready for Foxglove WebGL panel (planned)

### Diagnostics Panel
- **System status KPIs** — Bridge status, ROS node count, `/joint_states` Hz, `/cmd_vel` Hz
- **Topic bus table** — live message count, frequency, and last-seen timestamp per topic
- **Velocity vector canvas** — live arrow visualisation of `/cmd_vel` linear and angular velocity
- **ROS2 node list** — auto-discovered active nodes via `/rosapi/nodes`

### Telemetry Sidebar
- Publish rate (Hz), connection status, speed mode
- Max joint position error (CMD vs FB)
- Limit warning status, Emergency stop status
- Per-joint Feedback vs Command comparison

---

## ROS2 Topics

| Topic | Direction | Message Type | Purpose |
|---|---|---|---|
| `/joint_commands` | Dashboard → Pi | `sensor_msgs/JointState` | Send target joint positions |
| `/joint_states` | Pi → Dashboard | `sensor_msgs/JointState` | Real joint feedback |
| `/cmd_vel` | Pi → Dashboard | `geometry_msgs/Twist` | Velocity vector display |
| `/diagnostics` | Pi → Dashboard | `diagnostic_msgs/DiagnosticArray` | System health (planned) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Raspberry Pi running ROS2 (Humble or Jazzy)
- rosbridge installed on the Pi
- Tailscale installed on both Pi and your machine

### Pi Setup

```bash
# Install rosbridge if not already installed
sudo apt install ros-humble-rosbridge-suite

# Launch the WebSocket bridge (runs on port 9090)
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

### Local Development

```bash
# Clone the repo
git clone https://github.com/your-username/arm-control
cd arm-control

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Connect to Your Pi

In `src/App.jsx`, set the default WebSocket URL to your Pi's Tailscale IP:

```js
const [url, setUrl] = useState("ws://<your-pi-tailscale-ip>:9090");
```

Or type it directly into the URL bar in the dashboard header at runtime — no code change needed.

### Add roslib CDN to index.html

```html
<!-- Add inside <head> in index.html -->
<script src="https://cdn.jsdelivr.net/npm/roslib@1/build/roslib.min.js"></script>
```

### Deploy to Vercel

```bash
# One-command deploy
npx vercel

# Or push to GitHub — Vercel auto-deploys on every commit
git push origin main
```

---

## Project Structure

```
arm-control/
├── public/
├── src/
│   ├── App.jsx          # Main dashboard — all components, logic, CSS-in-JS
│   └── main.jsx         # React entry point
├── index.html           # Vite HTML shell — roslib CDN goes here
├── vite.config.js
└── package.json
```

> All components (ArmViz, DiagPanel, StepBtn, JogBtn) live in `App.jsx` as a single-file architecture for simplicity of deployment and iteration.

---

## Roadmap

- [ ] Foxglove WebGL 3D arm visualiser (replacing 2D SVG)
- [ ] Gamepad / Xbox controller support mapped to joints
- [ ] Keyboard shortcuts (WASD + Space for Emergency Stop)
- [ ] Custom saved pose presets (stored in browser localStorage)
- [ ] MoveIt2 Cartesian IK integration (real X/Y/Z end-effector control)
- [ ] Joint trajectory recording and playback

---

## Hardware

| Component | Details |
|---|---|
| Controller | Raspberry Pi (ROS2 Humble) |
| Connectivity | Tailscale VPN over WiFi |
| Arm | 6-DOF custom design |
| Interface | rosbridge WebSocket on port 9090 |

---

## Built With

- [React 18](https://react.dev) + [Vite](https://vitejs.dev)
- [ROS2 Humble](https://docs.ros.org/en/humble/)
- [roslibjs](https://github.com/RobotWebTools/roslibjs)
- [rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite)
- [Tailscale](https://tailscale.com)
- [Vercel](https://vercel.com)