# 🔒 Consent Protocol Implementation

## Overview
Added a comprehensive consent/approval system to AirBridge to prevent unwanted file transfers. Users must now explicitly accept or decline incoming file transfers before they begin.

## Changes Made

### Server-Side (`server/index.js`)
Added three new Socket.io event handlers:

1. **transfer-request**: Received when a sender wants to send a file
   - Relays file metadata (name, size, type) to receiver
   - Does not initiate actual file transfer yet

2. **transfer-accepted**: Received when receiver accepts the transfer
   - Notifies sender to begin sending file chunks
   - Triggers actual P2P file transfer

3. **transfer-rejected**: Received when receiver declines the transfer
   - Sends rejection notification to sender with reason
   - Prevents file transfer from starting

### Client-Side (`client/src/App.jsx`)

#### New State Variables
- `transferRequest`: Stores incoming transfer request details
- `waitingForAcceptance`: Shows sender is waiting for receiver's decision
- `transferDeclined`: Indicates transfer was rejected
- `declineReason`: Stores rejection reason message
- `pendingFileRef`: Holds file waiting for acceptance

#### New Socket Event Listeners
- **transfer-request**: Displays consent modal to receiver
- **transfer-accepted**: Triggers file transfer after acceptance
- **transfer-rejected**: Shows decline notification to sender

#### Modified Functions
- **sendFile()**: Now sends only metadata first, stores file in `pendingFileRef`
- **startFileTransfer()**: New function that initiates actual file sending after acceptance
- **handleAcceptTransfer()**: Emits acceptance signal to sender
- **handleDeclineTransfer()**: Emits rejection signal to sender

#### New UI Components

1. **Consent Modal** (for receiver)
   - Displays file metadata (name, size, type)
   - Shows "Accept" and "Decline" buttons
   - Prevents automatic downloads

2. **Waiting Modal** (for sender)
   - Shows "Waiting for Acceptance" message
   - Animated spinner for better UX
   - Displayed while waiting for receiver's decision

3. **Declined Modal** (for sender)
   - Shows "Transfer Declined" message
   - Displays decline reason
   - Auto-dismisses after 5 seconds

## Security Benefits

✅ **No Auto-Downloads**: Files never download without explicit user consent  
✅ **Informed Decision**: Receiver sees file details before accepting  
✅ **Clear Feedback**: Both parties see transfer status in real-time  
✅ **Privacy Protection**: Users can decline unwanted files  
✅ **Transparent Process**: All transfer requests are logged

## User Flow

### Sender Side:
1. Selects file
2. Clicks "Send File"
3. Metadata sent to receiver
4. "Waiting for Acceptance" modal appears
5. If accepted: File transfer begins
6. If declined: "Transfer Declined" notification shows

### Receiver Side:
1. Receives incoming transfer notification
2. Consent modal appears showing file details
3. Reviews file name, size, and type
4. Clicks "Accept" or "Decline"
5. If accepted: File transfer begins automatically
6. If declined: Modal closes, sender notified

## Technical Details

### Protocol Sequence:
```
Sender                          Server                      Receiver
  |                               |                             |
  |--transfer-request(metadata)-->|                             |
  |                               |--transfer-request---------->|
  |                               |                             |
  |                               |                    [User Decision]
  |                               |                             |
  |                               |<--transfer-accepted---------|
  |<--transfer-accepted-----------|                             |
  |                               |                             |
  [Start sending chunks]                          [Start receiving]
```

### Port Configuration:
- Server: Port 5001 (changed from 5000 due to macOS Control Center conflict)
- Client: Port 5173 (Vite default)

## Testing Instructions

1. Open two browser windows/tabs
2. Both connect to the same room
3. In Window 1: Select a file and click "Send"
4. In Window 2: Consent modal appears
5. Click "Accept" → File transfers
6. OR click "Decline" → Transfer cancelled, sender notified

## Files Modified
- `/server/index.js` - Added consent event handlers
- `/client/src/App.jsx` - Added consent state management, UI modals, and event handlers
- `/client/postcss.config.js` - Updated to use `@tailwindcss/postcss`

## Dependencies Added
- `@tailwindcss/postcss` - Updated Tailwind CSS PostCSS plugin

## Notes
- All transfers now require explicit consent
- Console logs show all consent protocol events
- Modals use Apple-style dark theme consistent with existing UI
- Transfer speeds and progress tracking remain unchanged
