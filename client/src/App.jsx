import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { QRCodeSVG } from 'qrcode.react';

const SERVER_URL = 'http://localhost:5000';
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for better LAN throughput
const SPEED_CALC_INTERVAL = 1000; // Calculate speed every second

// Connection state machine
const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  SIGNALING: 'SIGNALING',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  FAILED: 'FAILED',
  RECONNECTING: 'RECONNECTING'
};

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000; // 2 seconds

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [currentRoom, setCurrentRoom] = useState('');
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
  const [isInitiator, setIsInitiator] = useState(false);
  
  // File transfer states
  const [selectedFile, setSelectedFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [receivingFileName, setReceivingFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [transferComplete, setTransferComplete] = useState(false);
  const [downloadReady, setDownloadReady] = useState(false);
  const [completedFileUrl, setCompletedFileUrl] = useState(null);
  const [transferSpeed, setTransferSpeed] = useState(0); // MB/s
  const [receiveSpeed, setReceiveSpeed] = useState(0); // MB/s
  
  const peerRef = useRef(null);
  const fileChunksRef = useRef([]);
  const receivedBytesRef = useRef(0);
  const totalFileSizeRef = useRef(0);
  const fileInputRef = useRef(null);
  
  // Production-grade refs
  const iceCandidateQueueRef = useRef([]);
  const remoteDescriptionSetRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const isReconnectingRef = useRef(false);
  
  // Performance tracking refs
  const lastSpeedCalcTimeRef = useRef(0);
  const bytesSentSinceLastCalcRef = useRef(0);
  const bytesReceivedSinceLastCalcRef = useRef(0);
  const sendAbortControllerRef = useRef(null);

  // Verbose logging utility
  const log = {
    info: (message, ...args) => {
      console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    },
    warn: (message, ...args) => {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    },
    error: (message, ...args) => {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
    },
    signal: (type, data) => {
      console.log(`[SIGNAL] ${new Date().toISOString()} - ${type}`, data);
    },
    state: (oldState, newState) => {
      console.log(`[STATE] ${new Date().toISOString()} - ${oldState} → ${newState}`);
    }
  };

  useEffect(() => {
    // Connect to signaling server
    log.info('Initializing socket connection to signaling server');
    const newSocket = io(SERVER_URL);

    newSocket.on('connect', () => {
      log.info('✅ Connected to signaling server:', newSocket.id);
      setConnected(true);
      setSocket(newSocket);
      setConnectionState(ConnectionState.DISCONNECTED);
    });

    newSocket.on('disconnect', () => {
      log.warn('❌ Disconnected from signaling server');
      setConnected(false);
      setConnectionState(ConnectionState.DISCONNECTED);
    });

    // When existing users in room are sent (we are joining an occupied room)
    newSocket.on('room-users', (users) => {
      log.info('👥 Existing users in room:', users);
      
      if (users.length > 0) {
        // We are NOT the initiator (someone was already in the room)
        log.info('📱 Joining as RECEIVER (non-initiator)');
        setIsInitiator(false);
        setConnectionState(ConnectionState.SIGNALING);
      } else {
        // We are the first one, we will be the initiator
        log.info('🎯 Joining as INITIATOR (first in room)');
        setIsInitiator(true);
        setConnectionState(ConnectionState.SIGNALING);
      }
    });

    // When a new user connects to our room
    newSocket.on('user-connected', (userId) => {
      log.info('👤 User connected:', userId);
      
      // If we are the initiator, start the WebRTC connection
      if (peerRef.current === null && !isReconnectingRef.current) {
        log.info('🤝 Initiating P2P connection as INITIATOR');
        setConnectionState(ConnectionState.CONNECTING);
        createPeer(true, newSocket);
      }
    });

    // Receive WebRTC signal from the other peer
    newSocket.on('signal', ({ from, signal }) => {
      log.signal('RECEIVED', { from, signalType: signal.type });
      
      // If we don't have a peer yet, create one as receiver
      if (peerRef.current === null && !isReconnectingRef.current) {
        log.info('🤝 Creating P2P connection as RECEIVER');
        setConnectionState(ConnectionState.CONNECTING);
        createPeer(false, newSocket);
      }
      
      // Signal the peer with incoming data
      if (peerRef.current) {
        try {
          peerRef.current.signal(signal);
          
          // Mark that remote description has been set if this is an answer/offer
          if (signal.type === 'answer' || signal.type === 'offer') {
            remoteDescriptionSetRef.current = true;
            log.info('Remote description set, processing queued ICE candidates');
            
            // Process queued ICE candidates
            while (iceCandidateQueueRef.current.length > 0) {
              const candidate = iceCandidateQueueRef.current.shift();
              log.info('Processing queued ICE candidate');
              try {
                peerRef.current.signal(candidate);
              } catch (err) {
                log.error('Error processing queued ICE candidate:', err);
              }
            }
          }
          
          // If this is an ICE candidate and remote description isn't set, queue it
          if (signal.candidate && !remoteDescriptionSetRef.current) {
            log.info('Queuing ICE candidate (remote description not set yet)');
            iceCandidateQueueRef.current.push(signal);
          }
        } catch (err) {
          log.error('Error signaling peer:', err);
        }
      }
    });

    newSocket.on('user-disconnected', (userId) => {
      log.warn('👋 User disconnected:', userId);
      handlePeerDisconnection();
    });

    return () => {
      log.info('Cleaning up socket connection');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (peerRef.current) {
        peerRef.current.destroy();
      }
      newSocket.close();
    };
  }, []);

  const handlePeerDisconnection = () => {
    log.warn('Handling peer disconnection');
    const oldState = connectionState;
    setConnectionState(ConnectionState.DISCONNECTED);
    log.state(oldState, ConnectionState.DISCONNECTED);
    
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    // Reset ICE candidate queue and flags
    iceCandidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;
  };

  const attemptReconnection = (initiator, socket) => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      log.error('Max reconnection attempts reached. Giving up.');
      setConnectionState(ConnectionState.FAILED);
      isReconnectingRef.current = false;
      return;
    }

    reconnectAttemptsRef.current += 1;
    isReconnectingRef.current = true;
    setConnectionState(ConnectionState.RECONNECTING);
    
    log.info(`Attempting reconnection (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      log.info('Creating new peer connection after delay');
      createPeer(initiator, socket);
    }, RECONNECT_DELAY);
  };

  const createPeer = (initiator, socket) => {
    log.info('Creating peer connection', { initiator, trickle: false });
    
    // Reset flags for new connection
    iceCandidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;
    
    const peer = new SimplePeer({
      initiator: initiator,
      trickle: false, // Send all ICE candidates at once
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    // When WebRTC signal is ready, send it to the other peer via Socket.io
    peer.on('signal', (signalData) => {
      log.signal('SENT', { signalType: signalData.type, sdp: signalData.sdp ? 'present' : 'absent' });
      socket.emit('signal', { to: null, signal: signalData });
    });

    // When direct P2P connection is established
    peer.on('connect', () => {
      log.info('🎉 DIRECT P2P CONNECTION ESTABLISHED!');
      const oldState = connectionState;
      setConnectionState(ConnectionState.CONNECTED);
      log.state(oldState, ConnectionState.CONNECTED);
      
      // Reset reconnection attempts on successful connection
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    });

    // Handle incoming data (file chunks or metadata)
    peer.on('data', (data) => {
      try {
        // Try to parse as JSON (metadata)
        const message = JSON.parse(data.toString());
        
        if (message.type === 'metadata') {
          log.info('📦 Receiving file metadata:', message);
          setReceivingFileName(message.name);
          totalFileSizeRef.current = message.size;
          receivedBytesRef.current = 0;
          fileChunksRef.current = [];
          setReceiving(true);
          setReceiveProgress(0);
          setReceiveSpeed(0);
          
          // Initialize speed calculation
          lastSpeedCalcTimeRef.current = Date.now();
          bytesReceivedSinceLastCalcRef.current = 0;
        }
      } catch (e) {
        // Not JSON, must be a file chunk (ArrayBuffer)
        fileChunksRef.current.push(data);
        receivedBytesRef.current += data.length;
        bytesReceivedSinceLastCalcRef.current += data.length;
        
        const progress = (receivedBytesRef.current / totalFileSizeRef.current) * 100;
        setReceiveProgress(progress);
        
        // Calculate receive speed every second
        const now = Date.now();
        const timeDiff = now - lastSpeedCalcTimeRef.current;
        
        if (timeDiff >= SPEED_CALC_INTERVAL) {
          const bytesPerSecond = (bytesReceivedSinceLastCalcRef.current / timeDiff) * 1000;
          const mbPerSecond = bytesPerSecond / (1024 * 1024);
          setReceiveSpeed(mbPerSecond);
          
          log.info(`📥 Receive speed: ${mbPerSecond.toFixed(2)} MB/s | Progress: ${progress.toFixed(1)}%`);
          
          // Reset for next interval
          lastSpeedCalcTimeRef.current = now;
          bytesReceivedSinceLastCalcRef.current = 0;
        }
        
        // Check if we've received the complete file
        if (receivedBytesRef.current >= totalFileSizeRef.current) {
          log.info('✅ File transfer complete! Assembling file...');
          setReceiveSpeed(0);
          assembleAndDownloadFile();
        }
      }
    });

    // Handle errors with reconnection logic
    peer.on('error', (err) => {
      log.error('❌ Peer connection error:', err.message);
      
      // Don't reconnect if we're already connected (likely a data channel error)
      if (connectionState === ConnectionState.CONNECTED) {
        log.warn('Error on established connection, not reconnecting');
        return;
      }
      
      // Clean up current peer
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      
      // Attempt reconnection if not already reconnecting
      if (!isReconnectingRef.current) {
        attemptReconnection(initiator, socket);
      }
    });

    // Handle connection close
    peer.on('close', () => {
      log.warn('🔌 Peer connection closed');
      const oldState = connectionState;
      
      // Only attempt reconnection if we were connected or connecting
      if (oldState === ConnectionState.CONNECTED || oldState === ConnectionState.CONNECTING) {
        log.info('Connection was active, attempting reconnection');
        
        // Clean up current peer
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
        
        if (!isReconnectingRef.current) {
          attemptReconnection(initiator, socket);
        }
      } else {
        setConnectionState(ConnectionState.DISCONNECTED);
        log.state(oldState, ConnectionState.DISCONNECTED);
      }
    });

    peerRef.current = peer;
    log.info('Peer reference stored, waiting for connection...');
  };

  const assembleAndDownloadFile = () => {
    console.log('🔧 Assembling', fileChunksRef.current.length, 'chunks...');
    
    // Combine all chunks into a single Blob
    const blob = new Blob(fileChunksRef.current);
    
    // Create a download URL
    const url = URL.createObjectURL(blob);
    setCompletedFileUrl(url);
    setDownloadReady(true);
    setTransferComplete(true);
    
    console.log('💾 File ready for download:', receivingFileName);
    
    // Auto-download
    const a = document.createElement('a');
    a.href = url;
    a.download = receivingFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Reset receiving state (but keep the completed status for UI)
    setReceiving(false);
  };

  const sendFile = async () => {
    if (!selectedFile || !peerRef.current) return;
    await sendFileDirectly(selectedFile);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      log.info('📁 File selected:', file.name, file.size, 'bytes');
      setSelectedFile(file);
      setTransferComplete(false);
      setDownloadReady(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    const isPeerConnected = connectionState === ConnectionState.CONNECTED;
    
    if (file && isPeerConnected && !sending && !receiving) {
      log.info('📁 File dropped:', file.name, file.size, 'bytes');
      setSelectedFile(file);
      setTransferComplete(false);
      setDownloadReady(false);
      // Auto-send on drop
      setTimeout(() => {
        sendFileDirectly(file);
      }, 100);
    }
  };

  const sendFileDirectly = async (file) => {
    if (!file || !peerRef.current) return;
    
    // Create abort controller for cancellation
    sendAbortControllerRef.current = new AbortController();
    const { signal } = sendAbortControllerRef.current;
    
    setSending(true);
    setSendProgress(0);
    setTransferSpeed(0);
    
    log.info('📤 Preparing to send file:', file.name, file.size, 'bytes');
    log.info(`Using chunk size: ${CHUNK_SIZE} bytes (${(CHUNK_SIZE / 1024).toFixed(0)}KB)`);
    
    // Step 1: Send metadata
    const metadata = {
      type: 'metadata',
      name: file.name,
      size: file.size
    };
    
    try {
      peerRef.current.send(JSON.stringify(metadata));
      log.info('📨 Metadata sent:', metadata);
    } catch (err) {
      log.error('Failed to send metadata:', err);
      setSending(false);
      return;
    }
    
    // Step 2: Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
    log.info(`📦 File will be sent in ${totalChunks} chunks`);
    
    // Initialize speed tracking
    lastSpeedCalcTimeRef.current = Date.now();
    bytesSentSinceLastCalcRef.current = 0;
    
    // Step 3: Send chunks with backpressure control
    let offset = 0;
    let chunkNumber = 0;
    
    const sendNextChunk = () => {
      if (signal.aborted) {
        log.warn('File transfer aborted');
        setSending(false);
        setTransferSpeed(0);
        return;
      }
      
      if (offset >= arrayBuffer.byteLength) {
        // Transfer complete
        log.info('✅ File sending complete!');
        setSending(false);
        setSendProgress(100);
        setTransferSpeed(0);
        setSelectedFile(null);
        setTransferComplete(true);
        
        // Reset after a delay
        setTimeout(() => {
          setTransferComplete(false);
        }, 3000);
        return;
      }
      
      // Slice the next chunk (efficient - doesn't copy memory, creates view)
      const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
      chunkNumber++;
      
      // Attempt to write the chunk
      let canContinue;
      try {
        canContinue = peerRef.current.write(chunk);
      } catch (err) {
        log.error('Error writing chunk:', err);
        setSending(false);
        setTransferSpeed(0);
        return;
      }
      
      offset += chunk.byteLength;
      bytesSentSinceLastCalcRef.current += chunk.byteLength;
      
      // Update progress
      const progress = (offset / arrayBuffer.byteLength) * 100;
      setSendProgress(Math.min(progress, 100));
      
      // Calculate and update speed
      const now = Date.now();
      const timeDiff = now - lastSpeedCalcTimeRef.current;
      
      if (timeDiff >= SPEED_CALC_INTERVAL) {
        const bytesPerSecond = (bytesSentSinceLastCalcRef.current / timeDiff) * 1000;
        const mbPerSecond = bytesPerSecond / (1024 * 1024);
        setTransferSpeed(mbPerSecond);
        
        log.info(`📤 Speed: ${mbPerSecond.toFixed(2)} MB/s | Progress: ${progress.toFixed(1)}% | Chunk ${chunkNumber}/${totalChunks}`);
        
        // Reset for next interval
        lastSpeedCalcTimeRef.current = now;
        bytesSentSinceLastCalcRef.current = 0;
      }
      
      // Backpressure control
      if (canContinue) {
        // Buffer not full, can send next chunk immediately
        // Use setImmediate pattern for better performance
        setTimeout(sendNextChunk, 0);
      } else {
        // Buffer is full, wait for drain event
        log.info('⏸️  Backpressure detected, waiting for drain event...');
        peerRef.current.once('drain', () => {
          log.info('▶️  Drain event received, resuming transfer');
          sendNextChunk();
        });
      }
    };
    
    // Start sending
    sendNextChunk();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-3xl shadow-2xl p-8 max-w-md w-full backdrop-blur-lg">
          {/* Logo/Title */}
          <div className="text-center mb-8">
            <div className="inline-block p-4 bg-blue-600 rounded-2xl mb-4">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-white mb-2">
              AirBridge
            </h1>
            <p className="text-gray-400 text-sm">Local-First File Transfer</p>
          </div>

          <div className="space-y-6">
            {/* Connection Status */}
            <div className="flex items-center justify-center gap-2 p-3 bg-gray-900 rounded-xl border border-gray-700">
              <div className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
              <span className="text-sm font-medium text-gray-300">
                {connected ? 'Server Connected' : 'Connecting...'}
              </span>
            </div>

            {/* Room Input */}
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-gray-300">
                Room ID
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                placeholder="Enter room code"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button
                onClick={joinRoom}
                disabled={!connected || !roomId.trim()}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed transition transform hover:scale-105 active:scale-95"
              >
                Join Room
              </button>
            </div>

            {/* Info */}
            <div className="text-center pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-500">
                WebRTC • Peer-to-Peer • No Upload Limits
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sharing View - After joining a room
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-gray-800 border border-gray-700 rounded-3xl shadow-2xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">AirBridge</h1>
              <p className="text-gray-400 text-sm">Room: <span className="text-blue-400 font-mono">{currentRoom}</span></p>
            </div>
            <button
              onClick={() => {
                if (peerRef.current) {
                  peerRef.current.destroy();
                  peerRef.current = null;
                }
                setCurrentRoom('');
                setConnectionState(ConnectionState.DISCONNECTED);
                setRoomId('');
                setTransferComplete(false);
                setDownloadReady(false);
                reconnectAttemptsRef.current = 0;
                isReconnectingRef.current = false;
                if (reconnectTimeoutRef.current) {
                  clearTimeout(reconnectTimeoutRef.current);
                }
                if (completedFileUrl) {
                  URL.revokeObjectURL(completedFileUrl);
                }
              }}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded-xl font-medium hover:bg-gray-600 transition"
            >
              Leave
            </button>
          </div>

          {/* Connection Status */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="p-3 bg-gray-900 rounded-xl border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-xs font-medium text-gray-400">Signaling</span>
              </div>
              <p className="text-sm font-semibold text-white">
                {connected ? 'Connected' : 'Disconnected'}
              </p>
            </div>

            <div className="p-3 bg-gray-900 rounded-xl border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${
                  connectionState === ConnectionState.CONNECTED 
                    ? 'bg-green-500 animate-pulse' 
                    : connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.RECONNECTING
                    ? 'bg-yellow-500 animate-pulse'
                    : connectionState === ConnectionState.FAILED
                    ? 'bg-red-500'
                    : 'bg-gray-500'
                }`}></div>
                <span className="text-xs font-medium text-gray-400">Peer-to-Peer</span>
              </div>
              <p className="text-sm font-semibold text-white">
                {connectionState === ConnectionState.CONNECTED 
                  ? 'Connected' 
                  : connectionState === ConnectionState.CONNECTING 
                  ? 'Connecting...'
                  : connectionState === ConnectionState.RECONNECTING
                  ? `Reconnecting (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
                  : connectionState === ConnectionState.FAILED
                  ? 'Failed'
                  : 'Waiting...'}
              </p>
            </div>
          </div>
        </div>

        {/* Main Transfer Area */}
        <div className="bg-gray-800 border border-gray-700 rounded-3xl shadow-2xl p-8">
          {connectionState !== ConnectionState.CONNECTED ? (
            /* Waiting for Peer */
            <div className="text-center py-12">
              <div className="inline-block p-6 bg-gray-900 rounded-2xl mb-6">
                {connectionState === ConnectionState.FAILED ? (
                  <svg className="w-16 h-16 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-16 h-16 text-gray-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                {connectionState === ConnectionState.FAILED 
                  ? 'Connection Failed' 
                  : connectionState === ConnectionState.RECONNECTING
                  ? `Reconnecting... (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`
                  : connectionState === ConnectionState.CONNECTING
                  ? 'Connecting to peer...'
                  : 'Waiting for peer...'}
              </h3>
              <p className="text-gray-400 mb-8">
                {connectionState === ConnectionState.FAILED
                  ? 'Unable to establish P2P connection. Please try again.'
                  : connectionState === ConnectionState.RECONNECTING
                  ? 'Connection lost. Attempting to reconnect...'
                  : isInitiator 
                  ? 'Share this room code with another device' 
                  : 'Connecting to initiator...'}
              </p>
              
              {/* QR Code */}
              {isInitiator && connectionState !== ConnectionState.FAILED && (
                <div className="inline-block p-6 bg-white rounded-2xl">
                  <QRCodeSVG 
                    value={`${window.location.origin}?room=${currentRoom}`} 
                    size={200}
                    level="H"
                  />
                </div>
              )}
            </div>
          ) : (
            /* Connected - Drop Zone */
            <div>
              {/* Transfer Complete Message */}
              {transferComplete && (
                <div className="mb-6 p-4 bg-green-900 border border-green-700 rounded-xl">
                  <div className="flex items-center gap-3">
                    <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-green-300">Transfer Complete!</p>
                      <p className="text-xs text-green-400">File sent successfully</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Download Ready Message */}
              {downloadReady && (
                <div className="mb-6 p-4 bg-blue-900 border border-blue-700 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <svg className="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <p className="text-sm font-semibold text-blue-300">{receivingFileName}</p>
                        <p className="text-xs text-blue-400">Download complete</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = completedFileUrl;
                        a.download = receivingFileName;
                        a.click();
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
                    >
                      Download Again
                    </button>
                  </div>
                </div>
              )}

              {/* Receiving Progress */}
              {receiving && (
                <div className="mb-6 p-6 bg-gray-900 border border-gray-700 rounded-xl">
                  <div className="flex items-center gap-3 mb-4">
                    <svg className="w-6 h-6 text-blue-400 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">Receiving: {receivingFileName}</p>
                      <p className="text-xs text-gray-400">{formatFileSize(receivedBytesRef.current)} / {formatFileSize(totalFileSizeRef.current)}</p>
                    </div>
                    {receiveSpeed > 0 && (
                      <div className="text-right">
                        <p className="text-sm font-bold text-blue-400">{receiveSpeed.toFixed(2)} MB/s</p>
                        <p className="text-xs text-gray-500">⚡ Speed</p>
                      </div>
                    )}
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3 mb-2">
                    <div 
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${receiveProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-center text-sm font-semibold text-blue-400">
                    {receiveProgress.toFixed(1)}%
                  </p>
                </div>
              )}

              {/* Sending Progress */}
              {sending && (
                <div className="mb-6 p-6 bg-gray-900 border border-gray-700 rounded-xl">
                  <div className="flex items-center gap-3 mb-4">
                    <svg className="w-6 h-6 text-green-400 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3 3m0 0l-3-3m-3 3v12" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">Sending: {selectedFile?.name}</p>
                      <p className="text-xs text-gray-400">{formatFileSize(selectedFile?.size || 0)}</p>
                    </div>
                    {transferSpeed > 0 && (
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-400">{transferSpeed.toFixed(2)} MB/s</p>
                        <p className="text-xs text-gray-500">⚡ Speed</p>
                      </div>
                    )}
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3 mb-2">
                    <div 
                      className="bg-green-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${sendProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-center text-sm font-semibold text-green-400">
                    {sendProgress.toFixed(1)}%
                  </p>
                </div>
              )}

              {/* Drop Zone */}
              {!sending && !receiving && (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 ${
                    isDragging 
                      ? 'border-blue-500 bg-blue-900 bg-opacity-20 scale-105' 
                      : 'border-gray-600 hover:border-gray-500 hover:bg-gray-900'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  
                  <div className="space-y-4">
                    <div className="inline-block p-6 bg-gray-900 rounded-2xl">
                      <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    
                    <div>
                      <h3 className="text-xl font-semibold text-white mb-2">
                        {isDragging ? 'Drop file here' : 'Drop files to send'}
                      </h3>
                      <p className="text-gray-400 text-sm">
                        or click to browse
                      </p>
                    </div>

                    {selectedFile && !isDragging && (
                      <div className="mt-6 p-4 bg-gray-900 rounded-xl border border-gray-700 inline-block">
                        <p className="text-sm font-semibold text-white">{selectedFile.name}</p>
                        <p className="text-xs text-gray-400">{formatFileSize(selectedFile.size)}</p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            sendFile();
                          }}
                          className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
                        >
                          Send File
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Info */}
              <div className="mt-6 text-center">
                <p className="text-xs text-gray-500">
                  Files are transferred directly via WebRTC • No server upload • No size limits
                  {connectionState === ConnectionState.RECONNECTING && (
                    <> • Reconnecting...</>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
