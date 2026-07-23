# ARM·CONTROL — 6-DOF Robotic Arm Dashboard

> A real-time, browser-based Human–Machine Interface (HMI) for controlling a 6-DOF teachable robotic arm. Built with React, Vite, ROS2, and rosbridge, the dashboard runs entirely client-side without requiring its own application backend. An integrated Local Simulation Mode enables full UI development and testing without physical hardware.

---

# Overview

ARM·CONTROL is the operator interface for a 6-axis robotic arm and implements the three primary capabilities of the project.

| Function | Description |
|----------|-------------|
| **Web Control** | Operate and monitor the robotic arm entirely from a browser using joint controls, Cartesian jogging, saved positions, and a live visualization. |
| **Teach Mode** | De-energize the motors, manually guide the arm, record waypoints, and replay recorded trajectories. |
| **Closed-Loop Accuracy** | Measure positioning performance using encoder feedback with automated repeatability testing, error visualization, and CSV export. |

---

# System Architecture

```text
Browser (React 18 + Vite Dashboard)
        │
        │  WebSocket (ws://<pi-host>:9090)
        ▼
rosbridge_websocket (Docker on Raspberry Pi)
        │
        │  ROS2 Topics
        ▼
Serial Bridge Node ─────► ESP32-S2 ─────► Stepper / Servo Drivers
        │                                 │
        ▼                                 ▼
/joint_states Feedback            AS5600 Encoders
        │
        ▼
Foxglove Studio (3D Digital Twin)
```

All user interactions pass through a single `dispatchCommand()` transport layer instead of directly interacting with ROS2 APIs. This abstraction isolates communication from the user interface, allowing the transport mechanism to be replaced in the future (for example MQTT instead of rosbridge) without modifying the dashboard logic.

## Network Stack

| Layer | Technology |
|--------|------------|
| Remote access | Tailscale VPN |
| Browser ↔ ROS2 | rosbridge_websocket |
| Dashboard hosting | Nginx (static build on Raspberry Pi) |
| Visualization | Foxglove Studio |

The Raspberry Pi only serves static assets and relays ROS2 traffic through rosbridge. All rendering, state management, and interface logic execute in the browser, leaving the Pi's computing resources available for ROS2, Docker containers, and hardware communication.

---

# Features

## Motion Control

- Independent control of all six joints
- Slider, numeric input, and hold-to-jog controls
- Cartesian jogging interface
- Adjustable movement speed
- Built-in robot presets
- User-defined custom positions
- Live 2D arm visualization

---

## Teach Mode

- Motor power toggle for manual guidance
- Waypoint recording from encoder feedback
- Trajectory playback
- Persistent waypoint storage using Local Storage

---

## Closed-Loop Accuracy

- Live commanded-versus-actual joint comparison
- Color-coded tracking error indicators
- Automated repeatability testing
- SVG trend visualization
- CSV export for experimental results

---

## Diagnostics & Safety

- ROS2 topic monitoring
- ROS2 node monitoring
- Emergency Stop
- Resume confirmation
- Motion confirmation dialogs
- Automatic reconnection with exponential backoff
- Session logging with CSV export
- Demo Mode for presentations

---

## Simulation

A built-in Local Simulation Mode allows every dashboard feature—including Teach Mode, waypoint playback, and repeatability testing—to operate without ROS2 or physical hardware by using an internal mock transport.

---

## Platform

- Responsive tablet-friendly interface
- Touch-optimized controls
- Industrial HMI-inspired dark theme
- Client-side only architecture

---

# Technology Stack

### Frontend

- React 18
- Vite
- JavaScript
- CSS
- SVG

### Robotics

- ROS2 Humble
- rosbridge_suite
- roslib.js

### Communication

- WebSocket
- ROS2 Topics

### Deployment

- Docker
- Nginx
- Raspberry Pi

---

# Engineering Decisions

Several architectural decisions were intentionally made to keep the dashboard lightweight, modular, and suitable for embedded robotic systems.

- **Client-side architecture** — the application has no dedicated backend server. The Raspberry Pi only serves static files and relays ROS2 traffic.
- **Transport abstraction** — all robot commands pass through a single `dispatchCommand()` layer, making it straightforward to replace rosbridge with another transport protocol in the future.
- **Hardware-independent Simulation Mode** — enables development and testing without requiring access to the robotic arm.
- **Native SVG visualizations** — custom-built charts eliminate the need for external charting libraries, reducing bundle size.
- **Browser-native CSV export** — exports are generated using standard browser APIs without additional dependencies.
- **Local Storage persistence** — operator preferences, presets, and waypoints remain available across browser sessions without requiring cloud storage or databases.
- **Automatic reconnection strategy** — capped exponential backoff prevents endless retry loops while providing robust recovery from temporary network interruptions.
- **Centralized dashboard architecture** — the application's primary functionality resides within a single React component (App.jsx), simplifying rapid prototyping and maintenance while supporting modular assets and styling.

---

# Getting Started

Install dependencies.

```bash
npm install
```

Start the development server.

```bash
npm run dev
```

`roslib.js` is loaded through a CDN in `index.html`. During connection the dashboard verifies that `window.ROSLIB` exists and reports a clear error if the library is unavailable.

---

## Simulation Mode

No hardware is required for development.

Switch the dashboard header to **SIM** to enable the built-in simulation transport.

All major functionality is available, including:

- Joint control
- Teach Mode
- Waypoint playback
- Repeatability testing
- Diagnostics

---

## Connecting to a Robot

1. Enter the rosbridge WebSocket address.
2. Select **LIVE** mode.
3. Press **Connect**.

---

## Production Deployment

```bash
npm run build

rsync -avz --delete ./dist/ pi@<pi-host>:/path/to/dashboard-dist/
```

The production build is served by Nginx running on the Raspberry Pi.

---

# Development Status

| Component | Status |
|-----------|--------|
| Dashboard | Complete |
| ROS2 integration | Complete |
| Local Simulation Mode | Complete |
| Repeatability Testing | Complete |
| Docker deployment | Complete |
| Serial bridge node | In development |
| ESP32-S2 firmware | In development |
| Foxglove URDF | Pending |

The dashboard has intentionally been designed to remain hardware-independent during software development so that every workflow can be validated before physical system integration.

---

# Future Work

Planned improvements include:

- Cartesian inverse kinematics
- MoveIt 2 integration
- Motion planning
- Collision detection
- Camera streaming
- Vision-guided manipulation
- Multi-arm support
- MQTT transport backend
- User authentication and role management
- Progressive Web App (PWA) support
- Performance benchmarking tools
- Additional diagnostic visualizations

---

# Repository Structure

```text
├── public/
│   ├── favicon.svg          # Application favicon
│   └── icons.svg            # Dashboard icons
│
├── src/
│   ├── assets/              # Static assets
│   ├── App.css              # Dashboard styling
│   ├── App.jsx              # Main dashboard application
│   ├── index.css            # Global styles
│   └── main.jsx             # React entry point
│
├── .gitignore
├── .oxlintrc.json           # Lint configuration
├── index.html               # Vite HTML entry
├── LICENSE
├── package.json
├── package-lock.json
├── README.md
└── vite.config.js           # Vite configuration
```

---

# License

This project is licensed under the MIT License.