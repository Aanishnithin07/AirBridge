import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

const SERVER_URL = 'http://localhost:5000';
const CHUNK_SIZE = 16 * 1024; // 16KB chunks

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [currentRoom, setCurrentRoom] = useState('');
  const [peerConnected, setPeerConnected] = useState(false);
  const [isInitiator, setIsInitiator] = useState(false);
  
  // File transfer states
  const [selectedFile, setSelectedFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [receivingFileName, setReceivingFileName] = useState('');
  
  const peerRef = useRef(null);
  const fileChunksRef = useRef([]);
  const receivedBytesRef = useRef(0);
  const totalFileSizeRef = useRef(0);

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

    // Handle incoming data (file chunks or metadata)
    peer.on('data', (data) => {
      try {
        // Try to parse as JSON (metadata)
        const message = JSON.parse(data.toString());
        
        if (message.type === 'metadata') {
          console.log('📦 Receiving file metadata:', message);
          setReceivingFileName(message.name);
          totalFileSizeRef.current = message.size;
          receivedBytesRef.current = 0;
          fileChunksRef.current = [];
          setReceiving(true);
          setReceiveProgress(0);
        }
      } catch (e) {
        // Not JSON, must be a file chunk (ArrayBuffer)
        console.log('📥 Received chunk, size:', data.length);
        fileChunksRef.current.push(data);
        receivedBytesRef.current += data.length;
        
        const progress = (receivedBytesRef.current / totalFileSizeRef.current) * 100;
        setReceiveProgress(progress);
        
        // Check if we've received the complete file
        if (receivedBytesRef.current >= totalFileSizeRef.current) {
          console.log('✅ File transfer complete! Assembling file...');
          assembleAndDownloadFile();
        }
      }
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

  const assembleAndDownloadFile = () => {
    console.log('🔧 Assembling', fileChunksRef.current.length, 'chunks...');
    
    // Combine all chunks into a single Blob
    const blob = new Blob(fileChunksRef.current);
    
    // Create a download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivingFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('💾 File downloaded:', receivingFileName);
    
    // Reset receiving state
    setReceiving(false);
    setReceiveProgress(0);
    setReceivingFileName('');
    fileChunksRef.current = [];
    receivedBytesRef.current = 0;
    totalFileSizeRef.current = 0;
  };

  const sendFile = async () => {
    if (!selectedFile || !peerRef.current) return;
    
    setSending(true);
    setSendProgress(0);
    
    console.log('📤 Preparing to send file:', selectedFile.name, selectedFile.size, 'bytes');
    
    // Step 1: Send metadata
    const metadata = {
      type: 'metadata',
      name: selectedFile.name,
      size: selectedFile.size
    };
    
    peerRef.current.send(JSON.stringify(metadata));
    console.log('📨 Metadata sent:', metadata);
    
    // Step 2: Read file as ArrayBuffer
    const arrayBuffer = await selectedFile.arrayBuffer();
    const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
    console.log('📦 File will be sent in', totalChunks, 'chunks of', CHUNK_SIZE, 'bytes');
    
    // Step 3: Send chunks
    let offset = 0;
    let chunkNumber = 0;
    
    while (offset < arrayBuffer.byteLength) {
      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
      peerRef.current.send(chunk);
      
      offset += CHUNK_SIZE;
      chunkNumber++;
      
      const progress = (offset / arrayBuffer.byteLength) * 100;
      setSendProgress(Math.min(progress, 100));
      
      console.log(`📤 Sent chunk ${chunkNumber}/${totalChunks} (${progress.toFixed(1)}%)`);
      
      // Small delay to prevent overwhelming the connection
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    console.log('✅ File sending complete!');
    setSending(false);
    setSendProgress(0);
    setSelectedFile(null);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      console.log('📁 File selected:', file.name, file.size, 'bytes');
      setSelectedFile(file);
    }
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
                  Direct connection active. You can now transfer files.
                </p>
              </div>
            )}
          </div>

          {/* File Transfer Section */}
          {peerConnected && (
            <div className="space-y-4 pt-4 border-t">
              {/* Receiving Status */}
              {receiving && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-900 mb-2">
                    📥 Receiving: {receivingFileName}
                  </p>
                  <div className="w-full bg-green-200 rounded-full h-2 mb-1">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${receiveProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-green-700">
                    {receiveProgress.toFixed(1)}% complete
                  </p>
                </div>
              )}

              {/* Send File */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Send a file
                </label>
                <input
                  type="file"
                  onChange={handleFileSelect}
                  disabled={sending || receiving}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
                />
                
                {selectedFile && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-800">{selectedFile.name}</p>
                    <p className="text-xs text-gray-600">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                )}

                {sending && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-900 mb-2">
                      📤 Sending: {selectedFile?.name}
                    </p>
                    <div className="w-full bg-blue-200 rounded-full h-2 mb-1">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${sendProgress}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-blue-700">
                      {sendProgress.toFixed(1)}% complete
                    </p>
                  </div>
                )}

                <button
                  onClick={sendFile}
                  disabled={!selectedFile || sending || receiving}
                  className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                >
                  {sending ? 'Sending...' : 'Send File'}
                </button>
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 mb-2">
              <strong>Role:</strong> {isInitiator ? 'Initiator (First to join)' : 'Receiver (Second to join)'}
            </p>
            <p className="text-xs text-gray-500">
              {peerConnected 
                ? 'Files are transferred directly between devices via WebRTC.' 
                : 'Open browser console (F12) to see WebRTC handshake details.'}
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
