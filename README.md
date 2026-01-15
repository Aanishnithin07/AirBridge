# AirBridge 🌉

**A serverless, local-first file transfer tool inspired by AirDrop.**

Uses WebRTC for peer-to-peer data streaming and Socket.io for signaling. No database, no file size limits, cross-platform.

![Dark Mode UI](https://img.shields.io/badge/UI-Dark%20Mode-000000?style=for-the-badge)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-blue?style=for-the-badge)
![No Upload Limits](https://img.shields.io/badge/Size-No%20Limits-green?style=for-the-badge)

## ✨ Features

- 🚀 **Direct P2P Transfer** - Files transfer directly between devices via WebRTC
- 🔒 **Private & Secure** - No servers store your files
- ⚡ **Blazing Fast** - Transfer at local network speeds (50+ MB/s)
- 📦 **No Size Limits** - Send files of any size
- 🎨 **Beautiful Dark UI** - Apple-inspired minimalist design
- 📱 **QR Code Sharing** - Easy room sharing via QR codes
- 🖱️ **Drag & Drop** - Simply drag files to send
- 📊 **Real-time Progress** - Live transfer progress on both devices
- 🌐 **Cross-Platform** - Works on any device with a modern browser

## 🛠️ Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Signaling Server**: Node.js + Express + Socket.io
- **P2P Transfer**: WebRTC (via simple-peer)
- **QR Codes**: qrcode.react

## 📁 Project Structure

```
AirBridge/
├── server/          # Signaling server (matchmaking only)
│   ├── index.js     # Socket.io server
│   └── package.json
└── client/          # React frontend
    ├── src/
    │   ├── App.jsx  # Main application
    │   └── index.css
    └── package.json
```

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ installed
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Aanishnithin07/AirBridge.git
   cd AirBridge
   ```

2. **Install server dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install client dependencies**
   ```bash
   cd ../client
   npm install
   ```

### Running the Application

1. **Start the signaling server** (in one terminal)
   ```bash
   cd server
   npm run dev
   ```
   Server runs on: `http://localhost:5000`

2. **Start the client** (in another terminal)
   ```bash
   cd client
   npm run dev
   ```
   Client runs on: `http://localhost:5173`

3. **Open two browser tabs**
   - Both at `http://localhost:5173`
   - Enter the same room ID in both tabs
   - Wait for P2P connection to establish
   - Drag & drop files to transfer!

## 📖 How It Works

### The Magic of WebRTC

```
Traditional Transfer:
You → Cloud Server → Friend
(Slow, uses data, privacy concerns)

AirBridge (WebRTC):
You ←→ Friend
(Instant, local WiFi, private)
```

### The Process

1. **Signaling** - Server helps devices find each other (like a matchmaker)
2. **Handshake** - WebRTC establishes direct P2P connection
3. **Transfer** - Files stream directly device-to-device
4. **Server Steps Back** - After connection, server isn't involved in transfer

### File Transfer Flow

1. File is selected/dropped on sender's device
2. **Metadata packet** sent first (filename, size)
3. File split into **16KB chunks**
4. Chunks streamed through WebRTC DataChannel
5. Receiver collects and reassembles chunks
6. File auto-downloads when complete

## 🎯 Use Cases

- **Nearby Transfer** - Send files to devices on the same WiFi
- **No Internet Needed** - Works on local network only
- **Large Files** - No upload limits like cloud services
- **Privacy** - Files never touch a server
- **Cross-Device** - Phone to laptop, laptop to laptop, etc.

## 🏗️ Architecture

### Phase 1: Skeleton & Signaling
- ✅ Monorepo structure
- ✅ Socket.io signaling server
- ✅ React client setup

### Phase 2: WebRTC Connection
- ✅ SimplePeer integration
- ✅ P2P handshake logic
- ✅ Initiator/Receiver roles

### Phase 3: File Streaming
- ✅ File chunking (16KB)
- ✅ Progress tracking
- ✅ Auto-download on completion

### Phase 4: UI Polish
- ✅ Dark mode design
- ✅ Drag & drop
- ✅ QR code sharing
- ✅ Progress animations

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📝 License

ISC

## 🙏 Acknowledgments

- Inspired by Apple AirDrop
- Built with [simple-peer](https://github.com/feross/simple-peer)
- UI inspired by modern Apple design language

## 🔮 Future Enhancements

- [ ] Multiple file transfers
- [ ] Folder transfers
- [ ] Text/clipboard sharing
- [ ] Mobile app (React Native)
- [ ] End-to-end encryption
- [ ] Custom room names with random generation
- [ ] Transfer history
- [ ] Peer discovery (no room codes needed)

---

**Made with ❤️ by the power of local-first technology**

*"Why use the internet when you're standing right next to each other?"*