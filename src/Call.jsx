import { useEffect, useRef, useState } from 'react'
import { socket } from './socket'

// Configuration
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
}

export default function Call() {
  // State
  const [users, setUsers] = useState([])
  const [myId, setMyId] = useState('')
  const [remoteId, setRemoteId] = useState('')
  const [callStatus, setCallStatus] = useState('Ready to call')
  const [iceState, setIceState] = useState('')
  const [audioDevices, setAudioDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [logs, setLogs] = useState([])
  
  // Refs
  const localAudioRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const peerConnectionRef = useRef(null)
  const localStreamRef = useRef(null)
  const isCallerRef = useRef(false)

  // Add log
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    const logMessage = `[${timestamp}] ${message}`
    console.log(logMessage)
    setLogs(prev => [...prev.slice(-20), { message: logMessage, type }])
  }

  // Get audio devices
  const getAudioDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        addLog('Device enumeration not supported', 'warn')
        return
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter(device => device.kind === 'audioinput')
      setAudioDevices(audioInputs)
      
      if (audioInputs.length > 0) {
        setSelectedDevice(audioInputs[0].deviceId)
      }
      
      addLog(`Found ${audioInputs.length} audio devices`, 'success')
    } catch (error) {
      addLog(`Device enumeration error: ${error.message}`, 'error')
    }
  }

  // Get user media with device selection
  const getUserMedia = async (deviceId = '') => {
    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId && { deviceId: { exact: deviceId } })
        },
        video: false
      }

      addLog('Requesting microphone access...', 'info')
      
      let stream
      
      // Modern API
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } 
      // Legacy API
      else if (navigator.getUserMedia) {
        stream = await new Promise((resolve, reject) => {
          navigator.getUserMedia(constraints, resolve, reject)
        })
      } 
      // WebKit browsers
      else if (navigator.webkitGetUserMedia) {
        stream = await new Promise((resolve, reject) => {
          navigator.webkitGetUserMedia(constraints, resolve, reject)
        })
      } 
      else {
        throw new Error('getUserMedia not supported in this browser')
      }

      if (!stream) {
        throw new Error('No stream received')
      }

      const tracks = stream.getAudioTracks()
      if (tracks.length === 0) {
        throw new Error('No audio tracks in stream')
      }

      addLog(`Microphone access granted: ${tracks.length} track(s)`, 'success')
      
      // Set local audio element
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream
        localAudioRef.current.volume = 0 // Mute local audio
      }

      return stream
    } catch (error) {
      addLog(`Microphone error: ${error.name} - ${error.message}`, 'error')
      
      // User denied permission
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('❌ Microphone access was denied. Please allow microphone access in browser settings and refresh the page.')
      }
      // No microphone
      else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('🎤 No microphone found. Please connect a microphone and try again.')
      }
      // Other errors
      else {
        alert(`Microphone error: ${error.message}`)
      }
      
      return null
    }
  }

  // Create peer connection
  const createPeerConnection = () => {
    try {
      addLog('Creating peer connection...', 'info')
      
      const pc = new RTCPeerConnection(ICE_SERVERS)
      
      // When remote stream arrives
      pc.ontrack = (event) => {
        addLog('Remote audio track received', 'success')
        
        if (event.streams && event.streams[0] && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0]
          
          remoteAudioRef.current.play().catch(error => {
            addLog(`Remote audio play error: ${error.message}`, 'warn')
          })
        }
      }
      
      // ICE candidate generated
      pc.onicecandidate = (event) => {
        if (event.candidate && remoteId) {
          addLog('Sending ICE candidate', 'info')
          socket.emit('ice-candidate', {
            to: remoteId,
            candidate: event.candidate
          })
        }
      }
      
      // ICE connection state change
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState
        setIceState(state)
        addLog(`ICE connection state: ${state}`, 'info')
        
        if (state === 'connected' || state === 'completed') {
          setCallStatus('Connected')
        } else if (state === 'disconnected' || state === 'failed') {
          setCallStatus('Disconnected')
          endCall()
        }
      }
      
      // Connection state change
      pc.onconnectionstatechange = () => {
        addLog(`Connection state: ${pc.connectionState}`, 'info')
      }
      
      // Signaling state change
      pc.onsignalingstatechange = () => {
        addLog(`Signaling state: ${pc.signalingState}`, 'info')
      }
      
      return pc
    } catch (error) {
      addLog(`Peer connection error: ${error.message}`, 'error')
      return null
    }
  }

  // Initialize
  useEffect(() => {
    // Check if we're on HTTPS
    const isSecure = window.location.protocol === 'https:'
    if (!isSecure) {
      addLog('⚠️ Running on HTTP. For mobile, use ngrok or HTTPS', 'warn')
    }

    // Get audio devices
    getAudioDevices()

    // Socket event handlers
    const handleConnect = () => {
      const id = socket.id
      addLog(`Connected to server. Your ID: ${id}`, 'success')
      setMyId(id)
    }

    const handleUsers = (userList) => {
      const otherUsers = userList.filter(id => id !== socket.id)
      addLog(`Available users: ${otherUsers.length}`, 'info')
      setUsers(otherUsers)
    }

    const handleOffer = async ({ from, offer }) => {
      addLog(`Incoming call from ${from}`, 'info')
      setRemoteId(from)
      setCallStatus('Incoming call...')
      
      if (window.confirm(`📞 Incoming call from ${from.slice(0, 8)}...\n\nAccept call?`)) {
        await handleIncomingCall(from, offer)
      }
    }

    const handleAnswer = async ({ answer }) => {
      addLog('Call answered', 'success')
      
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(answer)
          )
          setCallStatus('Connected')
        } catch (error) {
          addLog(`Error setting remote answer: ${error.message}`, 'error')
        }
      }
    }

    const handleIceCandidate = async ({ candidate }) => {
      if (peerConnectionRef.current && candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          )
          addLog('ICE candidate added', 'info')
        } catch (error) {
          addLog(`Error adding ICE candidate: ${error.message}`, 'error')
        }
      }
    }

    // Register socket listeners
    socket.on('connect', handleConnect)
    socket.on('users', handleUsers)
    socket.on('offer', handleOffer)
    socket.on('answer', handleAnswer)
    socket.on('ice-candidate', handleIceCandidate)

    // Ping server every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping')
      }
    }, 30000)

    // Cleanup
    return () => {
      socket.off('connect', handleConnect)
      socket.off('users', handleUsers)
      socket.off('offer', handleOffer)
      socket.off('answer', handleAnswer)
      socket.off('ice-candidate', handleIceCandidate)
      clearInterval(pingInterval)
      
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close()
      }
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  // Handle incoming call
  const handleIncomingCall = async (from, offer) => {
    try {
      setCallStatus('Connecting...')
      isCallerRef.current = false
      
      // Create peer connection
      peerConnectionRef.current = createPeerConnection()
      if (!peerConnectionRef.current) {
        throw new Error('Failed to create peer connection')
      }
      
      // Set remote description (offer)
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(offer)
      )
      
      // Get local audio stream
      const stream = await getUserMedia(selectedDevice)
      if (!stream) {
        throw new Error('Failed to get microphone access')
      }
      
      // Add tracks to connection
      stream.getAudioTracks().forEach(track => {
        peerConnectionRef.current.addTrack(track, stream)
      })
      
      localStreamRef.current = stream
      
      // Create answer
      const answer = await peerConnectionRef.current.createAnswer({
        offerToReceiveAudio: true
      })
      
      await peerConnectionRef.current.setLocalDescription(answer)
      
      // Send answer
      socket.emit('answer', {
        to: from,
        answer: answer
      })
      
      addLog('Call accepted and answered', 'success')
      setCallStatus('Connected')
      
    } catch (error) {
      addLog(`Error answering call: ${error.message}`, 'error')
      setCallStatus('Error')
      endCall()
    }
  }

  // Start a call
  const startCall = async (toUserId) => {
    try {
      addLog(`Starting call to ${toUserId}`, 'info')
      setRemoteId(toUserId)
      setCallStatus('Calling...')
      isCallerRef.current = true
      
      // Clean up existing connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close()
      }
      
      // Create new peer connection
      peerConnectionRef.current = createPeerConnection()
      if (!peerConnectionRef.current) {
        throw new Error('Failed to create peer connection')
      }
      
      // Get local audio stream
      const stream = await getUserMedia(selectedDevice)
      if (!stream) {
        throw new Error('Failed to get microphone access')
      }
      
      // Add tracks to connection
      stream.getAudioTracks().forEach(track => {
        peerConnectionRef.current.addTrack(track, stream)
      })
      
      localStreamRef.current = stream
      
      // Create offer
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true
      })
      
      await peerConnectionRef.current.setLocalDescription(offer)
      
      // Send offer
      socket.emit('offer', {
        to: toUserId,
        offer: offer
      })
      
      addLog('Call offer sent', 'success')
      
    } catch (error) {
      addLog(`Error starting call: ${error.message}`, 'error')
      setCallStatus('Error')
      endCall()
    }
  }

  // End call
  const endCall = () => {
    addLog('Ending call', 'info')
    
    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
    
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }
    
    // Clear audio elements
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null
    }
    
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null
    }
    
    // Reset state
    setRemoteId('')
    setCallStatus('Ready to call')
    setIceState('')
    isCallerRef.current = false
  }

  // Test microphone
  const testMicrophone = async () => {
    try {
      addLog('Testing microphone...', 'info')
      
      const stream = await getUserMedia(selectedDevice)
      if (stream) {
        // Play test sound
        if (localAudioRef.current) {
          localAudioRef.current.volume = 0.5 // Unmute for test
          localAudioRef.current.play()
        }
        
        // Stop after 3 seconds
        setTimeout(() => {
          stream.getTracks().forEach(track => track.stop())
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = null
            localAudioRef.current.volume = 0
          }
          addLog('Microphone test successful', 'success')
        }, 3000)
      }
    } catch (error) {
      addLog(`Microphone test failed: ${error.message}`, 'error')
    }
  }

  // Refresh devices
  const refreshDevices = async () => {
    await getAudioDevices()
  }

  return (
    <div style={{ padding: '30px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 style={{ 
          color: '#2c3e50', 
          marginBottom: '10px',
          fontSize: '2.5rem',
          fontWeight: 'bold'
        }}>
          🎤 WebRTC Voice Call
        </h1>
        <p style={{ color: '#7f8c8d', fontSize: '1.1rem' }}>
          Real-time audio calling between devices
        </p>
      </div>

      {/* Status Card */}
      <div style={{
        backgroundColor: '#f8f9fa',
        borderRadius: '15px',
        padding: '25px',
        marginBottom: '25px',
        boxShadow: '0 5px 15px rgba(0,0,0,0.05)',
        border: '1px solid #e9ecef'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ color: '#2c3e50', marginBottom: '15px' }}>Connection Status</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
              <div>
                <p style={{ color: '#6c757d', marginBottom: '5px' }}>Your ID:</p>
                <p style={{ 
                  color: '#3498db', 
                  fontWeight: 'bold',
                  fontSize: '1.1rem',
                  wordBreak: 'break-all'
                }}>
                  {myId || 'Connecting...'}
                </p>
              </div>
              <div>
                <p style={{ color: '#6c757d', marginBottom: '5px' }}>Status:</p>
                <p style={{ 
                  color: callStatus.includes('Connected') ? '#27ae60' :
                         callStatus.includes('Calling') || callStatus.includes('Connecting') ? '#f39c12' :
                         callStatus.includes('Error') ? '#e74c3c' : '#2c3e50',
                  fontWeight: 'bold',
                  fontSize: '1.1rem'
                }}>
                  {callStatus}
                </p>
              </div>
            </div>
            
            {remoteId && (
              <div style={{ marginTop: '15px' }}>
                <p style={{ color: '#6c757d', marginBottom: '5px' }}>Connected to:</p>
                <p style={{ 
                  color: '#9b59b6', 
                  fontWeight: 'bold',
                  fontSize: '1.1rem',
                  wordBreak: 'break-all'
                }}>
                  {remoteId}
                </p>
              </div>
            )}
            
            {iceState && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ color: '#6c757d', marginBottom: '5px' }}>ICE State:</p>
                <p style={{ color: '#34495e' }}>{iceState}</p>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={testMicrophone}
              style={{
                padding: '12px 20px',
                backgroundColor: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              🎤 Test Microphone
            </button>
            
            <button
              onClick={refreshDevices}
              style={{
                padding: '10px 15px',
                backgroundColor: '#95a5a6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              🔄 Refresh Devices
            </button>
            
            {remoteId && (
              <button
                onClick={endCall}
                style={{
                  padding: '12px 20px',
                  backgroundColor: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                🛑 End Call
              </button>
            )}
          </div>
        </div>

        {/* Audio Device Selection */}
        {audioDevices.length > 0 && (
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #dee2e6' }}>
            <p style={{ color: '#6c757d', marginBottom: '10px' }}>Select Microphone:</p>
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #ced4da',
                fontSize: '14px'
              }}
            >
              {audioDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Users List */}
      <div style={{ marginBottom: '30px' }}>
        <h3 style={{ color: '#2c3e50', marginBottom: '15px' }}>
          Available Users ({users.length})
        </h3>
        
        {users.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            backgroundColor: '#f8f9fa',
            borderRadius: '10px',
            border: '2px dashed #dee2e6'
          }}>
            <p style={{ color: '#6c757d', fontSize: '16px' }}>
              No other users online. Open another browser tab or device.
            </p>
            <p style={{ color: '#95a5a6', fontSize: '14px', marginTop: '10px' }}>
              Make sure both devices are connected to same WiFi
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '15px'
          }}>
            {users.map(id => (
              <button
                key={id}
                onClick={() => startCall(id)}
                disabled={remoteId === id}
                style={{
                  padding: '20px 15px',
                  backgroundColor: remoteId === id ? '#2ecc71' : '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontSize: '15px',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  transition: 'all 0.3s',
                  opacity: remoteId === id ? 0.8 : 1,
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px'
                }}
                onMouseOver={(e) => {
                  if (remoteId !== id) {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.15)'
                  }
                }}
                onMouseOut={(e) => {
                  if (remoteId !== id) {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
                  }
                }}
              >
                <span style={{ fontSize: '24px' }}>
                  {remoteId === id ? '📞' : '📱'}
                </span>
                <span>
                  {remoteId === id ? 'Talking...' : `Call ${id.slice(0, 8)}`}
                </span>
                <span style={{ 
                  fontSize: '12px', 
                  opacity: 0.8,
                  wordBreak: 'break-all'
                }}>
                  {id}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Audio Controls */}
      <div style={{ marginBottom: '30px' }}>
        <h3 style={{ color: '#2c3e50', marginBottom: '20px' }}>Audio Controls</h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '30px'
        }}>
          <div>
            <div style={{
              backgroundColor: '#e8f4fc',
              padding: '20px',
              borderRadius: '12px',
              border: '1px solid #bbdefb'
            }}>
              <h4 style={{ color: '#1976d2', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>🎤</span> Your Microphone
              </h4>
              <audio
                ref={localAudioRef}
                controls
                muted
                style={{ width: '100%', marginBottom: '10px' }}
              />
              <p style={{ fontSize: '13px', color: '#5d99c6', marginTop: '10px' }}>
                This is what you sound like (muted for you)
              </p>
            </div>
          </div>
          
          <div>
            <div style={{
              backgroundColor: '#f3e5f5',
              padding: '20px',
              borderRadius: '12px',
              border: '1px solid #e1bee7'
            }}>
              <h4 style={{ color: '#7b1fa2', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>🔊</span> Remote Audio
              </h4>
              <audio
                ref={remoteAudioRef}
                controls
                style={{ width: '100%', marginBottom: '10px' }}
              />
              <p style={{ fontSize: '13px', color: '#9c27b0', marginTop: '10px' }}>
                This is what the other person sounds like
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ color: '#2c3e50' }}>Activity Logs</h3>
          <button
            onClick={() => setLogs([])}
            style={{
              padding: '8px 15px',
              backgroundColor: '#95a5a6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Clear Logs
          </button>
        </div>
        
        <div style={{
          backgroundColor: '#2c3e50',
          borderRadius: '10px',
          padding: '20px',
          maxHeight: '200px',
          overflowY: 'auto',
          fontFamily: 'monospace'
        }}>
          {logs.length === 0 ? (
            <p style={{ color: '#95a5a6', textAlign: 'center', padding: '20px' }}>
              No activity yet. Start a call to see logs.
            </p>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #34495e',
                  color: log.type === 'error' ? '#e74c3c' :
                         log.type === 'success' ? '#2ecc71' :
                         log.type === 'warn' ? '#f39c12' : '#ecf0f1',
                  fontSize: '13px'
                }}
              >
                {log.message}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Mobile Instructions */}
      <div style={{
        marginTop: '30px',
        padding: '20px',
        backgroundColor: '#fff8e1',
        borderRadius: '10px',
        border: '1px solid #ffd54f'
      }}>
        <h4 style={{ color: '#ff8f00', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>📱</span> Mobile Access Instructions
        </h4>
        <ol style={{ paddingLeft: '20px', color: '#5d4037', lineHeight: '1.8' }}>
          <li>Connect mobile to <strong>same WiFi</strong> as laptop</li>
          <li>Open <strong>Chrome/Edge</strong> browser on mobile</li>
          <li>Go to: <code style={{ backgroundColor: '#f5f5f5', padding: '2px 6px', borderRadius: '4px' }}>http://192.168.1.109:5173</code></li>
          <li><strong>Allow microphone permissions</strong> when prompted</li>
          <li>Click on user ID to start call</li>
        </ol>
        
        <div style={{ marginTop: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '6px' }}>
          <p style={{ color: '#d84315', fontWeight: 'bold', marginBottom: '5px' }}>Troubleshooting:</p>
          <ul style={{ paddingLeft: '20px', color: '#5d4037' }}>
            <li>Make sure server is running: <code>node server.js</code></li>
            <li>Refresh page if users don't appear</li>
            <li>Check firewall: allow ports 5173 and 5000</li>
            <li>Try incognito mode if permissions blocked</li>
          </ul>
        </div>
      </div>
    </div>
  )
}