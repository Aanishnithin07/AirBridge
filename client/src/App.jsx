import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:5000';

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');

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
    });

    newSocket.on('user-connected', (userId) => {
      console.log('👤 User connected:', userId);
    });

    newSocket.on('user-disconnected', (userId) => {
      console.log('👋 User disconnected:', userId);
    });

    newSocket.on('room-users', (users) => {
      console.log('👥 Existing users in room:', users);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const joinRoom = () => {
    if (socket && roomId.trim()) {
      console.log('🚪 Joining room:', roomId);
      socket.emit('join-room', roomId);
    }
  };

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
              placeholder="Enter room ID"
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

export default App;
