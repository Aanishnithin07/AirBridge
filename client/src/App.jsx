import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SERVER_URL = 'http://localhost:5000';

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [currentRoom, setCurrentRoom] = useState('');
  const [peerConnected, setPeerConnected] = useState(false);
  const [isInitiator, setIsInitiator] = useState(false);
  
  const peerRef = useRef(null);

  useEffect(() => {
    // Connect to signaling server
    const newSocket = io(SERVER_URL);

    newSocket.on('connect', () => {
      console.log('✅ Connected to signaling server:', newSocket.id);
      setConnected(true);
      setSocket(newSocket);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from signaling server');
      setConnected(false);
      setPeerConnected(false);
    });

    // When existing users in room are sent (we are joining an occupied room)
    newSocket.on('room-users', (users) => {
      console.log('👥 Existing users in room:', users);
      
      if (users.length > 0) {
        // We are NOT the initiator (someone was already in the room)
        console.log('📱 Joining as RECEIVER (non-initiator)');
        setIsInitiator(false);
      } else {
        // We are the first one, we will be the initiator
        console.log('🎯 Joining as INITIATOR (first in room)');
        setIsInitiator(true);
      }
    });

    // When a new user connects to our room
    newSocket.on('user-connected', (userId) => {
      console.log('👤 User connected:', userId);
      
      // If we are the initiator, start the WebRTC connection
      if (peerRef.current === null) {
        console.log('🤝 Initiating P2P connection as INITIATOR');
        createPeer(true, newSocket);
      }
    });

    // Receive WebRTC signal from the other peer
    newSocket.on('signal', ({ from, signal }) => {
      console.log('📡 Received signal from:', from);
      
      // If we don't have a peer yet, create one as receiver
      if (peerRef.current === null) {
        console.log('🤝 Creating P2P connection as RECEIVER');
        createPeer(false, newSocket);
      }
      
      // Signal the peer with incoming data
      if (peerRef.current) {
        peerRef.current.signal(signal);
      }
    });

    newSocket.on('user-disconnected', (userId) => {
      console.log('👋 User disconnected:', userId);
      setPeerConnected(false);
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
    });

    return () => {
      if (peerRef.current) {
        peerRef.current.destroy();
      }
      newSocket.close();
    };
  }, []);

  const createPeer = (initiator, socket) => {
    const peer = new SimplePeer({
      initiator: initiator,
      trickle: false, // Send all ICE candidates at once
    });

    // When WebRTC signal is ready, send it to the other peer via Socket.io
    peer.on('signal', (signalData) => {
      console.log('📤 Sending signal data to peer');
      socket.emit('signal', { to: null, signal: signalData }); // Server will broadcast to room
    });

    // When direct P2P connection is established
    peer.on('connect', () => {
      console.log('🎉 DIRECT P2P CONNECTION ESTABLISHED!');
      setPeerConnected(true);
    });

    // Handle errors
    peer.on('error', (err) => {
      console.error('❌ Peer connection error:', err);
    });

    peer.on('close', () => {
      console.log('🔌 Peer connection closed');
      setPeerConnected(false);
    });

    peerRef.current = peer;
  };

  const joinRoom = () => {
    if (socket && roomId.trim()) {
      console.log('🚪 Joining room:', roomId);
      setCurrentRoom(roomId);
      socket.emit('join-room', roomId);
    }
  };

  const joinRoom = () => {
    if (socket && roomId.trim()) {
      console.log('🚪 Joining room:', roomId);
      setCurrentRoom(roomId);
      socket.emit('join-room', roomId);
    }
  };

  // Lobby View - Before joining a room
  if (!currentRoom) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-4xl font-bold text-center mb-2 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            AirBridge
          </h1>
          <p className="text-center text-gray-600 mb-8">Local-First File Transfer</p>

          <div className="space-y-4">
            {/* Connection Status */}
            <div className="flex items-center justify-center gap-2 p-3 bg-gray-50 rounded-lg">
              <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium">
                {connected ? 'Connected to server' : 'Disconnected'}
              </span>
            </div>

            {/* Room Join */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Room ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                placeholder="Enter room ID (e.g., test123)"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={joinRoom}
                disabled={!connected || !roomId.trim()}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
              >
                Join Room
              </button>
            </div>

            {/* Console Hint */}
            <div className="text-xs text-gray-500 text-center pt-4 border-t">
              Open browser console to see connection logs
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sharing View - After joining a room
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
        <h1 className="text-3xl font-bold text-center mb-2 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
          AirBridge
        </h1>
        <p className="text-center text-gray-600 mb-6">Room: {currentRoom}</p>

        <div className="space-y-4">
          {/* Connection Status Cards */}
          <div className="grid grid-cols-2 gap-4">
            {/* Server Connection */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-xs font-medium text-gray-600">Server</span>
              </div>
              <p className="text-sm font-semibold">
                {connected ? 'Connected' : 'Disconnected'}
              </p>
            </div>

            {/* P2P Connection */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${peerConnected ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                <span className="text-xs font-medium text-gray-600">Peer</span>
              </div>
              <p className="text-sm font-semibold">
                {peerConnected ? 'Connected' : 'Waiting...'}
              </p>
            </div>
          </div>

          {/* Status Message */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            {!peerConnected ? (
              <div>
                <p className="text-sm font-medium text-blue-900 mb-1">
                  Waiting for peer...
                </p>
                <p className="text-xs text-blue-700">
                  {isInitiator 
                    ? '📱 You are the initiator. Share this room ID with another device.' 
                    : '🔗 Connecting to the initiator...'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-green-900 mb-1">
                  🎉 P2P Connection Established!
                </p>
                <p className="text-xs text-green-700">
                  Direct connection active. Ready to transfer files (Phase 3).
                </p>
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-2">
              <strong>Role:</strong> {isInitiator ? 'Initiator (First to join)' : 'Receiver (Second to join)'}
            </p>
            <p className="text-xs text-gray-500">
              Open browser console (F12) to see WebRTC handshake details.
            </p>
          </div>

          {/* Leave Room Button */}
          <button
            onClick={() => {
              if (peerRef.current) {
                peerRef.current.destroy();
                peerRef.current = null;
              }
              setCurrentRoom('');
              setPeerConnected(false);
              setRoomId('');
            }}
            className="w-full bg-gray-200 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-300 transition"
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
