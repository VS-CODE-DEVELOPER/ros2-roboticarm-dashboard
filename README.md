# ARM · CONTROL — 6-DOF Robotic Arm Dashboard

> A real-time, browser-based control dashboard for a 6-DOF web-controlled teachable robotic arm. Built on ROS2 + rosbridge with React/Vite, running entirely client-side with no application backend of its own. Includes an offline Local Simulation Mode so the UI can be developed and demoed without any hardware attached.

**Project:** Web-Controlled ROS2 Teachable Robotic Arm — Embedded Systems Final Project, Group G201
**Team:** Vidhan Shivani (software, electronics, system architecture) · Simon Rapa (CAD/mechanical)

---

## What This Is

The dashboard is the operator interface for a 6-axis robotic arm and directly implements the project's three core functions:

| Function | What it does |
|---|---|
| **1. Web Control** | Operate and monitor the arm entirely through the browser — joint sliders, Cartesian jog, saved positions, live 2D preview |
| **2. Teach Mode** | De-energize the motors, physically guide the arm by hand, record waypoints, and play back recorded trajectories |
| **3. Closed-Loop Accuracy** | Automated repeatability testing against real encoder feedback, with color-coded delta bars, a trend chart, and CSV export for report evidence |

---

## System Architecture

```
Browser (React 18 + Vite dashboard)
        │
        │  WebSocket  ws://<pi-host>:9090
        ▼
rosbridge_websocket  (Raspberry Pi, Docker)
        │
        │  ROS2 topics
        ▼
Serial Bridge Node  ──►  ESP32-S2  ──►  Steppers / Servos
        │                              (arm hardware)
        │                                    │
        ▼                                    ▼
/joint_states feedback              AS5600 encoders (closed-loop)
        │
        ▼
Foxglove Studio (3D digital twin, separate rosbridge client)
```

**Transport layer:** all button/slider actions go through a single `dispatchCommand()` chokepoint in the dashboard, rather than components calling ROS2 APIs directly. Today that chokepoint targets rosbridge over WebSocket; the abstraction exists specifically so a future transport (e.g. MQTT between the Pi and ESP32) can be swapped in without touching UI code.

### Network Stack
| Layer | Technology |
|---|---|
| Remote access to the Pi | Tailscale VPN (private mesh network) |
| ROS2 ↔ Browser bridge | `rosbridge_websocket`, port `9090` |
| Dashboard hosting | Nginx on the Pi (static build), self-hosted — not deployed to Vercel in production |
| 3D visualization | [Foxglove Studio](https://app.foxglove.dev), connected via the same rosbridge WebSocket |

The Pi only ever serves static files and relays WebSocket traffic — the dashboard itself runs on whatever device opens it (laptop/tablet), keeping the Pi's 1GB RAM budget free for ROS2, the serial bridge, and Docker.

---

## Features

### Control
- 6 independent joint controls — slider, exact numeric entry, or hold-to-jog buttons
- Cartesian jog panel (X/Y/Z) as a separate tab
- Speed selector showing real °/s, not just qualitative labels
- Built-in presets (Home, Grab Ready, Release, Stow) **plus operator-savable custom positions**
- Live 2D side-view arm preview

### Teach Mode
- Arm Power toggle — de-energizes motors for hand-guiding, blocks web control while active
- Waypoint recording from live encoder feedback
- Trajectory playback with stop control
- **Trajectory memory** — waypoints persist across page reloads (localStorage)

### Closed-Loop Accuracy
- Commanded-vs-actual feedback per joint with color-coded delta bars (green < 1°, amber 1–3°, red > 3°)
- Repeatability test tool — cycles the arm N times against a target, logs error per run
- Custom-built SVG trend chart (no charting library — kept the bundle light on purpose)
- One-click CSV export of test results for the technical report

### Diagnostics & Safety
- ROS2 topic/node health monitor
- Spacebar Emergency Stop (plus the on-screen button), always accessible except while typing in a field
- Confirmation dialogs on every action that moves real hardware
- **Demo Mode** — bypasses confirmations for a live presentation; Resume-from-E-stop is deliberately exempt and always confirms regardless
- **Auto-reconnect** with capped exponential backoff (gives up cleanly after 8 attempts instead of retrying forever)
- **Full session log export** — every logged event, timestamped and correlated with actual joint position at that moment, downloadable as CSV

### Simulation & Testing
- **Local Simulation Mode (SIM)** — a fully offline mock transport built into the dashboard. Commands are echoed back as fake telemetry after a short delay, so Teach Mode and Repeatability workflows can be fully exercised with zero hardware attached
- Toggle between LIVE (real rosbridge) and SIM from the header at any time while disconnected

### Platform
- Responsive layout — collapses to a single scrollable column with 44×44px touch targets below 1024px, for tablet/phone operation next to the physical arm
- Dark, high-density HMI-style theme

---

## Tech Stack

- **React 18 + Vite** — single-file dashboard component, no external state management
- **roslib.js** — ROS2/rosbridge client (loaded via CDN)
- **ROS2 Humble** + `rosbridge_suite` — Pi-side middleware
- No charting library — trend chart is hand-built SVG (~30 lines)
- No date/CSV libraries — native `Blob` + `URL.createObjectURL` for all exports

---

## Getting Started

```bash
npm install
npm run dev
```

`roslib.js` is expected as a CDN script in `index.html` — the dashboard checks for `window.ROSLIB` on connect and logs an error if it's missing rather than failing silently.

**No hardware needed to develop against this UI** — switch the header toggle to **SIM** and every feature (Teach Mode, waypoint playback, repeatability testing) works against the mock transport.

### Connecting to a real Pi
1. Set the WebSocket address in the header (defaults to `ws://<current-hostname>:9090`)
2. Toggle the header mode to **LIVE**
3. Click **Connect**

### Production deployment
```bash
npm run build
rsync -avz --delete ./dist/ pi@<pi-host>:/path/to/dashboard-dist/
```
Served by Nginx on the Pi — see the Docker Compose setup in the deployment docs for the `nginx` + `rosbridge` container pair.

---

## Project Status

| Layer | Status |
|---|---|
| Dashboard (this repo) | Feature-complete for Functions 1–3 |
| Pi deployment (Docker, rosbridge, Nginx) | Architected, deployment scripted |
| Serial bridge node (Pi ↔ ESP32) | Not yet built |
| ESP32-S2 firmware | Not yet built |
| Foxglove URDF | Pending from mechanical/CAD side |

The dashboard is intentionally hardware-agnostic at this stage — everything above is designed to be tested end-to-end in Simulation Mode before the physical bring-up begins.

---

## Repository Layout
```
/src
  App.jsx      — the entire dashboard (single-file by design)
/docs
  (deployment, wiring, and protocol notes — see project report)
```