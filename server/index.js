const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { uniqueNamesGenerator, adjectives, animals } = require('unique-names-generator');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for local network access
    methods: ['GET', 'POST']
  }
});

app.use(cors());

// Store active rooms and their users
const rooms = new Map();
// Store users by IP for discovery: Map<IP, Set<SocketID>>
const usersByIp = new Map();
// Store user metadata: Map<SocketID, { name, avatar, ip, room }>
const users = new Map();

// Helper to generate random name
const generateName = () => {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: ' ',
    style: 'capital',
    length: 2
  });
};

const getIp = (socket) => {
  // Try to get IP from headers (if behind proxy) or connection
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  // Normalize IPv6 localhost
  if (ip === '::1') return '127.0.0.1';
  // Remove IPv6 prefix if present (e.g., ::ffff:192.168.1.1)
  if (ip.includes('::ffff:')) return ip.split('::ffff:')[1];
  return ip;
};

io.on('connection', (socket) => {
  const userIp = getIp(socket);
  const userName = generateName();

  // Register user
  users.set(socket.id, {
    id: socket.id,
    name: userName,
    ip: userIp,
    room: null
  });

  console.log(`✅ User connected: ${userName} (${socket.id}) from ${userIp}`);

  // Add to IP group for discovery
  if (!usersByIp.has(userIp)) {
    usersByIp.set(userIp, new Set());
  }
  usersByIp.get(userIp).add(socket.id);

  // Send back their assigned name
  socket.emit('my-info', { name: userName, id: socket.id });

  // Handle "join-nearby" - Client asking for discovery
  socket.on('join-nearby', () => {
    const nearbyIds = Array.from(usersByIp.get(userIp) || []);

    // Filter out self
    const nearbyUsers = nearbyIds
      .filter(id => id !== socket.id)
      .map(id => {
        const u = users.get(id);
        return { id: u.id, name: u.name };
      });

    socket.emit('nearby-users', nearbyUsers);

    // Notify others on same IP that I am here
    nearbyIds.forEach(id => {
      if (id !== socket.id) {
        io.to(id).emit('user-discovered', { id: socket.id, name: userName });
      }
    });
  });

  // Handle direct connection request (Smart Discovery)
  socket.on('connect-to-user', ({ targetId }) => {
    const target = users.get(targetId);
    if (target) {
      // Create a unique private room ID
      // Sort IDs to ensure both generate same room name
      const roomName = `private-${[socket.id, targetId].sort().join('-')}`;

      console.log(`🔗 Linking ${socket.id} and ${targetId} in ${roomName}`);

      // Tell both to join this room
      io.to(socket.id).emit('force-join', roomName);
      io.to(targetId).emit('force-join', roomName);
    }
  });

  // Handle room joining (Standard & Private)
  socket.on('join-room', (roomId) => {
    console.log(`🚪 User ${users.get(socket.id).name} joining room: ${roomId}`);

    // Leave any previous rooms
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });

    // Join the new room
    socket.join(roomId);

    // Update user record
    const user = users.get(socket.id);
    if (user) user.room = roomId;

    // Track room members
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    // Notify others in the room
    const roomMembers = Array.from(rooms.get(roomId));

    // Send list of existing users to the new joiner
    socket.emit('room-users', roomMembers.filter(id => id !== socket.id));

    // Notify existing users about the new joiner
    socket.to(roomId).emit('user-connected', socket.id);
  });

  // Handle WebRTC signaling
  socket.on('signal', ({ to, signal }) => {
    // If 'to' is specified, send to that specific user
    // Otherwise, broadcast to everyone in the room except sender
    if (to) {
      io.to(to).emit('signal', { from: socket.id, signal });
    } else {
      socket.rooms.forEach((room) => {
        if (room !== socket.id) {
          socket.to(room).emit('signal', { from: socket.id, signal });
        }
      });
    }
  });

  // Handle file transfer request
  socket.on('transfer-request', ({ metadata }) => {
    const user = users.get(socket.id);
    // Include user name in request
    const senderName = user ? user.name : 'Unknown';

    console.log(`📄 Transfer request from ${senderName}`);
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.to(room).emit('transfer-request', { from: socket.id, senderName, metadata });
      }
    });
  });

  // Handle transfer acceptance
  socket.on('transfer-accepted', ({ to }) => {
    io.to(to).emit('transfer-accepted', { from: socket.id });
  });

  // Handle transfer rejection
  socket.on('transfer-rejected', ({ to, reason }) => {
    io.to(to).emit('transfer-rejected', { from: socket.id, reason });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;

    console.log(`❌ User disconnected: ${user.name}`);

    // Remove from IP tracking
    const userIp = user.ip;
    if (usersByIp.has(userIp)) {
      usersByIp.get(userIp).delete(socket.id);
      // Note: Set iteration is safe even after deletion
      const nearbyIds = usersByIp.get(userIp);
      if (nearbyIds) {
        nearbyIds.forEach(id => {
          io.to(id).emit('user-gone', socket.id);
        });
      }
      if (usersByIp.get(userIp).size === 0) {
        usersByIp.delete(userIp);
      }
    }

    // Remove from active rooms
    rooms.forEach((members, roomId) => {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        socket.to(roomId).emit('user-disconnected', socket.id);
        if (members.size === 0) {
          rooms.delete(roomId);
        }
      }
    });

    users.delete(socket.id);
  });
});

const PORT = 5001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Signaling server running on http://0.0.0.0:${PORT}`);
});
