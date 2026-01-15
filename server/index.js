const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173', // Vite's default port
    methods: ['GET', 'POST']
  }
});

app.use(cors());

// Store active rooms and their users
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  // Handle room joining
  socket.on('join-room', (roomId) => {
    console.log(`🚪 User ${socket.id} joining room: ${roomId}`);
    
    // Leave any previous rooms
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });

    // Join the new room
    socket.join(roomId);

    // Track room members
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    // Notify others in the room
    const roomMembers = Array.from(rooms.get(roomId));
    console.log(`👥 Room ${roomId} now has ${roomMembers.length} member(s)`);

    // Send list of existing users to the new joiner
    socket.emit('room-users', roomMembers.filter(id => id !== socket.id));

    // Notify existing users about the new joiner
    socket.to(roomId).emit('user-connected', socket.id);
  });

  // Handle WebRTC signaling
  socket.on('signal', ({ to, signal }) => {
    console.log(`📡 Forwarding signal from ${socket.id} to ${to}`);
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    // Remove from all rooms
    rooms.forEach((members, roomId) => {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        // Notify others in the room
        socket.to(roomId).emit('user-disconnected', socket.id);
        
        // Clean up empty rooms
        if (members.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on http://localhost:${PORT}`);
});
