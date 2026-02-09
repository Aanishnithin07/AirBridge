import { useEffect, useState, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { QRCodeSVG } from 'qrcode.react';

const SERVER_URL = 'http://localhost:5001';
const CHUNK_SIZE = 64 * 1024; // 64KB chunks
const SPEED_CALC_INTERVAL = 1000;

// Sound Effects Manager (Procedural Audio)
const playSound = (type) => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  switch (type) {
    case 'connect':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;

    case 'request':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.linearRampToValueAtTime(600, now + 0.1);
      osc.frequency.linearRampToValueAtTime(1000, now + 0.2);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.2);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
      break;

    case 'complete':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.setValueAtTime(800, now + 0.1);
      osc.frequency.setValueAtTime(1200, now + 0.2);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
      break;

    case 'error':
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.3);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
      break;
  }
};

// Helper for file icons/previews
const FilePreview = ({ file, size = 'sm' }) => {
  const [preview, setPreview] = useState(null);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (isImage) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, isImage]);

  const sizeClasses = size === 'lg' ? 'w-16 h-16' : 'w-10 h-10';

  if (isImage && preview) {
    return (
      <img
        src={preview}
        alt={file.name}
        className={`${sizeClasses} object-cover rounded-lg shadow-sm border border-gray-600 bg-gray-800`}
      />
    );
  }

  return (
    <div className={`${sizeClasses} flex items-center justify-center bg-gray-700 rounded-lg border border-gray-600`}>
      <svg className="w-1/2 h-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
  );
};

// Start simple identicon generator based on name
const getAvatarColor = (name) => {
  const context = 'bg-gradient-to-br ';
  const colors = [
    'from-red-500 to-orange-500',
    'from-green-500 to-emerald-500',
    'from-blue-500 to-cyan-500',
    'from-indigo-500 to-purple-500',
    'from-pink-500 to-rose-500',
    'from-yellow-400 to-amber-500'
  ];
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return context + colors[sum % colors.length];
};

const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  SIGNALING: 'SIGNALING',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  FAILED: 'FAILED',
  RECONNECTING: 'RECONNECTING'
};

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [currentRoom, setCurrentRoom] = useState('');
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
  const [isInitiator, setIsInitiator] = useState(false);

  // Smart Discovery States
  const [myInfo, setMyInfo] = useState({ name: '', id: '' });
  const [nearbyUsers, setNearbyUsers] = useState([]);
  const [isDiscovering, setIsDiscovering] = useState(true);

  // File transfer states
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [currentFileProgress, setCurrentFileProgress] = useState(0);
  const [totalBatchSize, setTotalBatchSize] = useState(0);
  const [totalBytesTransferred, setTotalBytesTransferred] = useState(0);
  const [globalProgress, setGlobalProgress] = useState(0);

  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [receivingFileName, setReceivingFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [transferComplete, setTransferComplete] = useState(false);

  const [transferSpeed, setTransferSpeed] = useState(0);
  const [receiveSpeed, setReceiveSpeed] = useState(0);

  // Consent protocol states
  const [transferRequest, setTransferRequest] = useState(null);
  const [waitingForAcceptance, setWaitingForAcceptance] = useState(false);
  const [transferDeclined, setTransferDeclined] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const peerRef = useRef(null);
  const socketRef = useRef(null);
  const fileChunksRef = useRef([]);
  const receivedBytesRef = useRef(0);
  const currentFileSizeRef = useRef(0);
  const fileInputRef = useRef(null);
  const batchBytesTransferredRef = useRef(0);

  const iceCandidateQueueRef = useRef([]);
  const remoteDescriptionSetRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const isReconnectingRef = useRef(false);

  const lastSpeedCalcTimeRef = useRef(0);
  const bytesSentSinceLastCalcRef = useRef(0);
  const bytesReceivedSinceLastCalcRef = useRef(0);
  const sendAbortControllerRef = useRef(null);
  const pendingFilesRef = useRef([]);

  // Logging
  const log = useMemo(() => ({
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    signal: (type, data) => console.log(`[SIGNAL] ${type}`, data),
    state: (old, newS) => console.log(`[STATE] ${old} → ${newS}`)
  }), []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomIdFromUrl = urlParams.get('roomID');

    if (roomIdFromUrl) setRoomId(roomIdFromUrl);

    const newSocket = io(SERVER_URL);

    newSocket.on('connect', () => {
      setConnected(true);
      setSocket(newSocket);
      socketRef.current = newSocket;
      setConnectionState(ConnectionState.DISCONNECTED);
      // playSound('connect'); // Commented out to avoid noise on initial load

      // Auto-join if room ID requested
      if (roomIdFromUrl && roomIdFromUrl.trim()) {
        setCurrentRoom(roomIdFromUrl);
        newSocket.emit('join-room', roomIdFromUrl);
        setIsDiscovering(false);
      } else {
        // Otherwise, start discovery
        newSocket.emit('join-nearby');
        setIsDiscovering(true);
      }
    });

    newSocket.on('my-info', (info) => {
      setMyInfo(info);
    });

    newSocket.on('nearby-users', (users) => {
      setNearbyUsers(users);
    });

    newSocket.on('user-discovered', (user) => {
      setNearbyUsers(prev => {
        if (prev.find(u => u.id === user.id)) return prev;
        return [...prev, user];
      });
    });

    newSocket.on('user-gone', (userId) => {
      setNearbyUsers(prev => prev.filter(u => u.id !== userId));
    });

    newSocket.on('force-join', (room) => {
      setCurrentRoom(room);
      setRoomId(room);
      setIsDiscovering(false);
      newSocket.emit('join-room', room);
      playSound('connect');
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      setConnectionState(ConnectionState.DISCONNECTED);
      playSound('error');
    });

    newSocket.on('room-users', (users) => {
      if (users.length > 0) {
        setIsInitiator(false);
        setConnectionState(ConnectionState.SIGNALING);
      } else {
        setIsInitiator(true);
        setConnectionState(ConnectionState.SIGNALING);
      }
    });

    newSocket.on('user-connected', () => {
      if (peerRef.current === null && !isReconnectingRef.current) {
        setConnectionState(ConnectionState.CONNECTING);
        createPeer(true, newSocket);
      }
    });

    newSocket.on('signal', ({ from, signal }) => {
      if (peerRef.current === null && !isReconnectingRef.current) {
        setConnectionState(ConnectionState.CONNECTING);
        createPeer(false, newSocket);
      }

      if (peerRef.current) {
        try {
          peerRef.current.signal(signal);
          if (signal.type === 'answer' || signal.type === 'offer') {
            remoteDescriptionSetRef.current = true;
            while (iceCandidateQueueRef.current.length > 0) {
              const candidate = iceCandidateQueueRef.current.shift();
              try { peerRef.current.signal(candidate); } catch (e) { console.error(e); }
            }
          }
          if (signal.candidate && !remoteDescriptionSetRef.current) {
            iceCandidateQueueRef.current.push(signal);
          }
        } catch (e) {
          console.error(e);
        }
      }
    });

    newSocket.on('user-disconnected', () => {
      handlePeerDisconnection();
      playSound('error');
    });

    newSocket.on('transfer-request', ({ from, senderName, metadata }) => {
      setTransferRequest({ from, senderName, metadata });
      playSound('request');
    });

    newSocket.on('transfer-accepted', ({ from }) => {
      setWaitingForAcceptance(false);
      playSound('connect');
      if (pendingFilesRef.current.length > 0) {
        startBatchTransfer(pendingFilesRef.current);
        pendingFilesRef.current = [];
      }
    });

    newSocket.on('transfer-rejected', ({ from, reason }) => {
      setWaitingForAcceptance(false);
      setTransferDeclined(true);
      setDeclineReason(reason || 'User declined');
      playSound('error');
      pendingFilesRef.current = [];
      setTimeout(() => {
        setTransferDeclined(false);
        setDeclineReason('');
      }, 5000);
    });

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (peerRef.current) peerRef.current.destroy();
      newSocket.close();
    };
  }, []);

  const handlePeerDisconnection = () => {
    const oldState = connectionState;
    setConnectionState(ConnectionState.DISCONNECTED);
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    iceCandidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;
  };

  const attemptReconnection = (initiator, socket) => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionState(ConnectionState.FAILED);
      isReconnectingRef.current = false;
      return;
    }

    reconnectAttemptsRef.current += 1;
    isReconnectingRef.current = true;
    setConnectionState(ConnectionState.RECONNECTING);

    reconnectTimeoutRef.current = setTimeout(() => {
      createPeer(initiator, socket);
    }, RECONNECT_DELAY);
  };

  const createPeer = (initiator, socket) => {
    iceCandidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;

    const peer = new SimplePeer({
      initiator: initiator,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('signal', (signalData) => {
      socket.emit('signal', { to: null, signal: signalData });
    });

    peer.on('connect', () => {
      setConnectionState(ConnectionState.CONNECTED);
      playSound('connect');
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    });

    peer.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'file-start') {
          setReceivingFileName(message.name);
          currentFileSizeRef.current = message.size;
          setTotalFiles(message.totalFiles);
          setCurrentFileIndex(message.currentFileIndex);

          if (message.currentFileIndex === 0) {
            setTotalBatchSize(message.totalBatchSize || 0);
            batchBytesTransferredRef.current = 0;
            setGlobalProgress(0);
          }

          receivedBytesRef.current = 0;
          fileChunksRef.current = [];
          setReceiving(true);
          setCurrentFileProgress(0);
          setReceiveSpeed(0);

          lastSpeedCalcTimeRef.current = Date.now();
          bytesReceivedSinceLastCalcRef.current = 0;
        }
      } catch (e) {
        fileChunksRef.current.push(data);
        receivedBytesRef.current += data.length;
        bytesReceivedSinceLastCalcRef.current += data.length;
        batchBytesTransferredRef.current += data.length;

        const fileProg = (receivedBytesRef.current / currentFileSizeRef.current) * 100;
        setCurrentFileProgress(fileProg);

        if (totalBatchSize > 0) {
          const batchProg = (batchBytesTransferredRef.current / totalBatchSize) * 100;
          setGlobalProgress(batchProg);
        }

        const now = Date.now();
        const timeDiff = now - lastSpeedCalcTimeRef.current;

        if (timeDiff >= SPEED_CALC_INTERVAL) {
          const bytesPerSecond = (bytesReceivedSinceLastCalcRef.current / timeDiff) * 1000;
          const mbPerSecond = bytesPerSecond / (1024 * 1024);
          setReceiveSpeed(mbPerSecond);

          lastSpeedCalcTimeRef.current = now;
          bytesReceivedSinceLastCalcRef.current = 0;
        }

        if (receivedBytesRef.current >= currentFileSizeRef.current) {
          setReceiveSpeed(0);
          assembleAndDownloadFile();

          if (currentFileIndex === totalFiles - 1) {
            setTransferComplete(true);
            setReceiving(false);
            playSound('complete');
          }
        }
      }
    });

    peer.on('error', (err) => {
      if (connectionState === ConnectionState.CONNECTED) return;
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      if (!isReconnectingRef.current) {
        attemptReconnection(initiator, socket);
      }
    });

    peer.on('close', () => {
      const oldState = connectionState;
      if (oldState === ConnectionState.CONNECTED || oldState === ConnectionState.CONNECTING) {
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
        if (!isReconnectingRef.current) {
          attemptReconnection(initiator, socket);
        }
      } else {
        setConnectionState(ConnectionState.DISCONNECTED);
      }
    });

    peerRef.current = peer;
  };

  const assembleAndDownloadFile = () => {
    const blob = new Blob(fileChunksRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivingFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    fileChunksRef.current = [];
  };

  const sendFiles = async () => {
    if (!selectedFiles.length || !peerRef.current) return;
    if (connectionState !== 'CONNECTED') return;

    const totalSize = selectedFiles.reduce((acc, file) => acc + file.size, 0);
    const fileListMetadata = selectedFiles.map(f => ({ name: f.name, size: f.size, type: f.type }));

    const metadata = {
      count: selectedFiles.length,
      totalSize: totalSize,
      files: fileListMetadata
    };

    pendingFilesRef.current = selectedFiles;

    if (socketRef.current) {
      socketRef.current.emit('transfer-request', { roomId, metadata });
      setWaitingForAcceptance(true);
    }
  };

  const startBatchTransfer = async (files) => {
    setSending(true);
    setTotalFiles(files.length);
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    setTotalBatchSize(totalSize);

    batchBytesTransferredRef.current = 0;
    setGlobalProgress(0);

    sendAbortControllerRef.current = new AbortController();

    for (let i = 0; i < files.length; i++) {
      if (sendAbortControllerRef.current.signal.aborted) break;

      setCurrentFileIndex(i);
      const file = files[i];
      await sendSingleFile(file, i, files.length, totalSize);
    }

    setSending(false);
    setTransferComplete(true);
    playSound('complete');
    setSelectedFiles([]);
    setTimeout(() => {
      setTransferComplete(false);
    }, 3000);
  };

  const sendSingleFile = async (file, index, total, totalBatchSize) => {
    return new Promise(async (resolve, reject) => {
      if (!peerRef.current) { reject('disconnected'); return; }

      const { signal } = sendAbortControllerRef.current;
      setCurrentFileProgress(0);
      setTransferSpeed(0);

      const metadata = {
        type: 'file-start',
        name: file.name,
        size: file.size,
        currentFileIndex: index,
        totalFiles: total,
        totalBatchSize: totalBatchSize
      };

      try {
        peerRef.current.send(JSON.stringify(metadata));
      } catch (err) {
        reject(err);
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      lastSpeedCalcTimeRef.current = Date.now();
      bytesSentSinceLastCalcRef.current = 0;
      let offset = 0;

      const sendNextChunk = () => {
        if (signal.aborted) { reject('Aborted'); return; }

        if (offset >= arrayBuffer.byteLength) {
          resolve();
          return;
        }

        const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
        let canContinue;
        try {
          canContinue = peerRef.current.write(chunk);
        } catch (err) {
          reject(err);
          return;
        }

        offset += chunk.byteLength;
        bytesSentSinceLastCalcRef.current += chunk.byteLength;
        batchBytesTransferredRef.current += chunk.byteLength;

        const fileProg = (offset / arrayBuffer.byteLength) * 100;
        setCurrentFileProgress(Math.min(fileProg, 100));

        const batchProg = (batchBytesTransferredRef.current / totalBatchSize) * 100;
        setGlobalProgress(Math.min(batchProg, 100));

        const now = Date.now();
        const timeDiff = now - lastSpeedCalcTimeRef.current;

        if (timeDiff >= SPEED_CALC_INTERVAL) {
          const bytesPerSecond = (bytesSentSinceLastCalcRef.current / timeDiff) * 1000;
          const mbPerSecond = bytesPerSecond / (1024 * 1024);
          setTransferSpeed(mbPerSecond);
          lastSpeedCalcTimeRef.current = now;
          bytesSentSinceLastCalcRef.current = 0;
        }

        if (canContinue) {
          setTimeout(sendNextChunk, 0);
        } else {
          peerRef.current.once('drain', sendNextChunk);
        }
      };

      sendNextChunk();
    });
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && connectionState === ConnectionState.CONNECTED && !sending && !receiving) {
      setSelectedFiles(prev => [...prev, ...files]);
      setTransferComplete(false);
    }
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
      setCurrentRoom(roomId);
      socket.emit('join-room', roomId);
      setIsDiscovering(false);
    }
  };

  const connectToUser = (targetId) => {
    socket.emit('connect-to-user', { targetId });
  };

  if (!currentRoom) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex items-center justify-center p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-3xl shadow-2xl p-8 max-w-md w-full backdrop-blur-lg">
          <div className="text-center mb-8">
            <div className="inline-block p-4 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-900/50">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-white mb-2">AirBridge</h1>
            <p className="text-gray-400 text-sm">Local-First File Transfer</p>
            {myInfo.name && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-900 rounded-full border border-gray-700">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-gray-300 text-xs">You are <span className="font-bold text-white">{myInfo.name}</span></span>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Discovery / Nearby List */}
            {isDiscovering && (
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                    </span>
                    Nearby Devices
                  </label>
                  <span className="text-xs text-gray-500">{nearbyUsers.length} found</span>
                </div>

                <div className="bg-gray-900 rounded-xl p-2 max-h-48 overflow-y-auto space-y-2 border border-gray-700 min-h-[120px]">
                  {nearbyUsers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-28 text-gray-600">
                      <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <span className="text-xs">Scanning local network...</span>
                    </div>
                  ) : (
                    nearbyUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => connectToUser(user.id)}
                        className="w-full flex items-center justify-between p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition group border border-gray-700 hover:border-blue-500"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg ${getAvatarColor(user.name)}`}>
                            {user.name.charAt(0)}
                          </div>
                          <div className="text-left">
                            <div className="text-white font-medium group-hover:text-blue-300 transition">{user.name}</div>
                            <div className="text-gray-500 text-xs">Tap to connect</div>
                          </div>
                        </div>
                        <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </button>
                    ))
                  )}
                </div>
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-700"></div></div>
                  <div className="relative flex justify-center text-sm"><span className="px-2 bg-gray-800 text-gray-500">or use code</span></div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                placeholder="Enter room code manually"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <button
                onClick={joinRoom}
                disabled={!connected || !roomId.trim()}
                className="w-full bg-gray-700 text-white py-3 rounded-xl font-semibold hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 transition"
              >
                Join with Code
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800 border border-gray-700 rounded-3xl shadow-2xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white mb-1">AirBridge</h1>
              <p className="text-gray-400 text-sm">Room: <span className="text-blue-400 font-mono">{currentRoom}</span></p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded-xl font-medium hover:bg-gray-600 transition"
            >
              Leave
            </button>
          </div>
          <div className="mt-4 flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
            <span className="text-gray-300 text-sm font-medium">
              {connectionState === ConnectionState.CONNECTED ? 'Connected with Peer' : 'Waiting for Peer...'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div
              className={`
                relative group cursor-pointer
                border-2 border-dashed rounded-3xl p-8 aspect-video md:aspect-square flex flex-col items-center justify-center transition-all duration-300
                ${isDragging ? 'border-blue-500 bg-blue-500/10 scale-102' : 'border-gray-600 hover:border-blue-400 hover:bg-gray-800'}
                ${sending ? 'opacity-50 pointer-events-none' : ''}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => setSelectedFiles(prev => [...prev, ...Array.from(e.target.files)])} multiple />

              <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-white mb-2">Drop files here</p>
              <p className="text-sm text-gray-400">or click to browse</p>
            </div>

            {selectedFiles.length > 0 && (
              <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700 max-h-60 overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <span>📦 Queue</span>
                    <span className="bg-blue-600 text-xs px-2 py-0.5 rounded-full">{selectedFiles.length}</span>
                  </h3>
                  <button onClick={() => setSelectedFiles([])} className="text-xs text-red-400 hover:text-red-300" disabled={sending}>
                    Clear All
                  </button>
                </div>
                <div className="space-y-2">
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-gray-900 p-2 rounded-lg text-sm border border-gray-800 hover:border-gray-700 transition">
                      <div className="flex items-center gap-3">
                        <FilePreview file={file} />
                        <div className="truncate max-w-[150px] text-gray-300">{file.name}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-xs">{formatFileSize(file.size)}</span>
                        {!sending && (
                          <button onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))} className="text-gray-500 hover:text-white">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {!sending && !waitingForAcceptance && (
                  <button
                    onClick={sendFiles}
                    disabled={connectionState !== ConnectionState.CONNECTED}
                    className={`
                           w-full mt-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all
                           ${connectionState === ConnectionState.CONNECTED
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50'
                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'}
                         `}
                  >
                    <span>Send {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {(sending || receiving) && (
              <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    {sending ? <span className="animate-pulse">📤 Sending...</span> : <span className="animate-pulse">📥 Receiving...</span>}
                  </h3>
                  <span className="text-blue-400 font-mono text-sm bg-blue-900/30 px-2 py-1 rounded">
                    {sending ? transferSpeed.toFixed(1) : receiveSpeed.toFixed(1)} MB/s
                  </span>
                </div>

                {/* Global Progress */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span className="font-semibold text-gray-300">Total Progress</span>
                    <span>{globalProgress.toFixed(0)}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${globalProgress}%` }}></div>
                  </div>
                </div>

                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>File {currentFileIndex + 1} of {totalFiles}: <span className="text-white">{receivingFileName}</span></span>
                  <span>{currentFileProgress.toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-indigo-500 transition-all duration-100 ease-linear" style={{ width: `${currentFileProgress}%` }}></div>
                </div>
              </div>
            )}

            {transferComplete && (
              <div className="bg-green-500/10 border border-green-500/50 rounded-2xl p-4 flex items-center justify-center text-green-400 animate-pulse shadow-lg shadow-green-900/20">
                <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-bold">Transfer Session Completed!</span>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-8 flex flex-col items-center justify-center shadow-2xl">
              <QRCodeSVG value={`${window.location.origin}?roomID=${currentRoom}`} size={200} />
              <p className="mt-4 text-gray-900 font-medium">Scan to join room</p>
              <p className="text-gray-500 text-sm">{window.location.origin}?roomID={currentRoom}</p>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6">
              <h3 className="text-white font-semibold mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Tips
              </h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-start"><span className="mr-2">•</span>Share room ID or QR code with a device nearby</li>
                <li className="flex items-start"><span className="mr-2">•</span>Both devices must be online</li>
                <li className="flex items-start"><span className="mr-2">•</span>P2P transfer happens over local network</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {waitingForAcceptance && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-3xl p-8 max-w-sm w-full border border-gray-700 shadow-2xl text-center">
            <div className="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Waiting for Response...</h3>
            <p className="text-gray-400">Asking receiver to accept <span className="text-white font-medium block mt-1">{pendingFilesRef.current.length} file(s) ({formatFileSize(pendingFilesRef.current.reduce((a, b) => a + b.size, 0))})</span></p>
            <button onClick={() => setWaitingForAcceptance(false)} className="mt-6 text-gray-500 hover:text-white text-sm">Cancel</button>
          </div>
        </div>
      )}

      {transferDeclined && (
        <div className="fixed bottom-8 right-8 bg-red-900/90 text-white px-6 py-4 rounded-xl shadow-xl flex items-center gap-3 animate-bounce">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <div><p className="font-bold">Transfer Declined</p><p className="text-sm opacity-80">{declineReason}</p></div>
        </div>
      )}

      {transferRequest && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-3xl p-8 max-w-sm w-full border border-gray-700 shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/30">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Incoming Transfer</h3>
              <p className="text-gray-400 text-sm"><span className="text-blue-400 font-bold">{transferRequest.senderName || 'Unknown User'}</span> wants to send you files</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-4 mb-6 space-y-3">
              <div className="flex justify-between text-sm"><span className="text-gray-500">From</span><span className="text-gray-300 font-mono text-xs">{transferRequest.from.slice(0, 8)}...</span></div>
              <div className="border-t border-gray-800 my-2"></div>
              {transferRequest.metadata.count ? (
                <>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">Files</span><span className="text-white font-medium">{transferRequest.metadata.count}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-500">Total Size</span><span className="text-white font-medium">{formatFileSize(transferRequest.metadata.totalSize)}</span></div>
                  <div className="max-h-32 overflow-y-auto mt-2 space-y-1">
                    {transferRequest.metadata.files.map((f, i) => (
                      <div key={i} className="text-xs text-gray-400 truncate flex items-center gap-2">
                        <span>📄</span>
                        {f.name}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <><div className="flex justify-between text-sm"><span className="text-gray-500">File</span><span className="text-white font-medium truncate max-w-[150px]">{transferRequest.metadata.name}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Size</span><span className="text-white font-medium">{formatFileSize(transferRequest.metadata.size)}</span></div></>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { if (socketRef.current) { socketRef.current.emit('transfer-rejected', { roomId, to: transferRequest.from, reason: 'Declined by user' }); setTransferRequest(null); playSound('error'); } }} className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition">Decline</button>
              <button onClick={() => { if (socketRef.current) { socketRef.current.emit('transfer-accepted', { roomId, to: transferRequest.from }); setTransferRequest(null); playSound('connect'); } }} className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/40 transition transform hover:scale-105">Accept</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
