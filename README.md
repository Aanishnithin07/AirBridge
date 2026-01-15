# AirBridge

A serverless, local-first file transfer tool inspired by AirDrop. Uses WebRTC for peer-to-peer data streaming and Socket.io for signaling. No database, no file size limits, cross-platform.

## Tech Stack
- **Frontend**: React + Vite + Tailwind CSS
- **Signaling Server**: Node.js + Express + Socket.io
- **P2P Transfer**: WebRTC (simple-peer)

## Project Structure
```
AirBridge/
├── server/     # Signaling server
└── client/     # React frontend
```

## Getting Started

### Server
```bash
cd server
npm install
npm run dev
```

### Client
```bash
cd client
npm install
npm run dev
```
