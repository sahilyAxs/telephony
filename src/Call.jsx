import { useEffect, useRef, useState } from 'react'
import { socket } from './socket'

// Enhanced Configuration with TURN servers
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free TURN servers for NAT traversal
    {
      urls: 'turn:numb.viagenie.ca',
      credential: 'muazkh',
      username: 'webrtc@live.com'
    },
    {
      urls: 'turn:turn.bistri.com:80',
      credential: 'homeo',
      username: 'homeo'
    },
    {
      urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
      credential: 'webrtc',
      username: 'webrtc'
    }
  ],
  iceTransportPolicy: 'all', // Allow relay
  iceCandidatePoolSize: 10
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
  const [debugInfo, setDebugInfo] = useState('')
  
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
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
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

      // Log audio track details
      tracks.forEach(track => {
        console.log('Audio track settings:', track.getSettings())
        console.log('Track enabled:', track.enabled)
        console.log('Track readyState:', track.readyState)
      })

      addLog(`Microphone access granted: ${tracks.length} track(s)`, 'success')
      
      // Set local audio element
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream
        localAudioRef.current.volume = 0 // Mute local audio
        
        // Try to play local audio
        localAudioRef.current.play().catch(e => {
          console.warn('Local audio play warning:', e)
        })
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
        console.log('Remote track event:', {
          streams: event.streams.length,
          track: event.track,
          receiver: event.receiver
        })
        
        addLog('Remote audio track received', 'success')
        
        if (event.streams && event.streams[0]) {
          const remoteStream = event.streams[0]
          console.log('Remote stream tracks:', remoteStream.getTracks().length)
          
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream
            
            // Try to play with retry logic
            const playRemoteAudio = () => {
              remoteAudioRef.current.play()
                .then(() => {
                  addLog('Remote audio playing successfully', 'success')
                })
                .catch(error => {
                  console.warn('Remote audio play error, retrying...', error)
                  setTimeout(playRemoteAudio, 500)
                })
            }
            
            playRemoteAudio()
          }
        }
      }
      
      // ICE candidate generated
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE candidate:', event.candidate.type, event.candidate.protocol)
          addLog(`ICE candidate: ${event.candidate.type}`, 'info')
          
          if (event.candidate && remoteId) {
            socket.emit('ice-candidate', {
              to: remoteId,
              candidate: event.candidate
            })
          }
        } else {
          addLog('ICE gathering complete', 'info')
        }
      }
      
      // ICE candidate error
      pc.onicecandidateerror = (event) => {
        console.error('ICE candidate error:', event)
        addLog(`ICE candidate error: ${event.errorCode}`, 'error')
      }
      
      // ICE gathering state change
      pc.onicegatheringstatechange = () => {
        console.log('ICE gathering state:', pc.iceGatheringState)
        addLog(`ICE gathering: ${pc.iceGatheringState}`, 'info')
      }
      
      // ICE connection state change
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState
        setIceState(state)
        addLog(`ICE connection state: ${state}`, 'info')
        
        if (state === 'connected' || state === 'completed') {
          setCallStatus('Connected')
          
          // Get connection stats
          setTimeout(() => {
            getConnectionStats()
          }, 2000)
        } else if (state === 'disconnected') {
          setCallStatus('Disconnected - Reconnecting...')
        } else if (state === 'failed') {
          setCallStatus('Connection Failed')
          addLog('ICE connection failed. May need TURN server.', 'error')
          endCall()
        }
      }
      
      // Connection state change
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        addLog(`Connection state: ${state}`, 'info')
        
        if (state === 'failed') {
          addLog('Peer connection failed. Check network/Firewall.', 'error')
        }
      }
      
      // Signaling state change
      pc.onsignalingstatechange = () => {
        addLog(`Signaling state: ${pc.signalingState}`, 'info')
      }
      
      // Negotiation needed
      pc.onnegotiationneeded = async () => {
        addLog('Negotiation needed', 'info')
      }
      
      // Add connection stats monitoring
      const statsInterval = setInterval(() => {
        if (pc.iceConnectionState === 'connected') {
          getConnectionStats()
        }
      }, 5000)
      
      // Store interval for cleanup
      pc._statsInterval = statsInterval
      
      return pc
    } catch (error) {
      addLog(`Peer connection error: ${error.message}`, 'error')
      return null
    }
  }

  // Get connection statistics
  const getConnectionStats = async () => {
    if (!peerConnectionRef.current) return
    
    try {
      const stats = await peerConnectionRef.current.getStats()
      let audioBytesSent = 0
      let audioBytesReceived = 0
      let candidateType = ''
      
      stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.mediaType === 'audio') {
          audioBytesSent = report.bytesSent || 0
        }
        if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
          audioBytesReceived = report.bytesReceived || 0
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateType = report.candidateType || candidateType
        }
      })
      
      const debugMsg = `Stats: Sent=${audioBytesSent} bytes, Received=${audioBytesReceived} bytes, Candidate=${candidateType}`
      console.log(debugMsg)
      setDebugInfo(debugMsg)
      
      if (audioBytesSent > 0 && audioBytesReceived === 0) {
        addLog('⚠️ Audio sending but not receiving. Check remote side.', 'warn')
      }
    } catch (error) {
      console.error('Stats error:', error)
    }
  }

  // Debug connection function
  const debugConnection = async () => {
    console.log('=== DEBUG CONNECTION START ===')
    
    let debugText = '=== DEBUG INFO ===\n'
    
    // Check local stream
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getTracks()
      debugText += `Local tracks: ${tracks.length}\n`
      tracks.forEach((track, i) => {
        debugText += `Track ${i}: ${track.kind}, enabled: ${track.enabled}, muted: ${track.muted}\n`
        console.log('Track settings:', track.getSettings())
      })
    } else {
      debugText += 'No local stream\n'
    }
    
    // Check peer connection
    if (peerConnectionRef.current) {
      debugText += `\nPeer Connection:\n`
      debugText += `Signaling: ${peerConnectionRef.current.signalingState}\n`
      debugText += `ICE Connection: ${peerConnectionRef.current.iceConnectionState}\n`
      debugText += `ICE Gathering: ${peerConnectionRef.current.iceGatheringState}\n`
      debugText += `Connection: ${peerConnectionRef.current.connectionState}\n`
      
      // Check transceivers
      const transceivers = peerConnectionRef.current.getTransceivers()
      debugText += `\nTransceivers: ${transceivers.length}\n`
      transceivers.forEach((transceiver, i) => {
        debugText += `Transceiver ${i}: direction=${transceiver.direction}, currentDirection=${transceiver.currentDirection}\n`
      })
      
      // Check local description
      if (peerConnectionRef.current.localDescription) {
        const sdp = peerConnectionRef.current.localDescription.sdp
        const lines = sdp.split('\n')
        const hostCandidates = lines.filter(l => l.includes('host')).length
        const srflxCandidates = lines.filter(l => l.includes('srflx')).length
        const relayCandidates = lines.filter(l => l.includes('relay')).length
        
        debugText += `\nSDP Candidates:\n`
        debugText += `Host: ${hostCandidates}, Srflx: ${srflxCandidates}, Relay: ${relayCandidates}\n`
      }
    } else {
      debugText += '\nNo peer connection\n'
    }
    
    // Check remote audio
    if (remoteAudioRef.current?.srcObject) {
      const remoteStream = remoteAudioRef.current.srcObject
      const remoteTracks = remoteStream.getTracks()
      debugText += `\nRemote stream tracks: ${remoteTracks.length}\n`
      remoteTracks.forEach(track => {
        debugText += `Remote track: ${track.kind}, enabled: ${track.enabled}\n`
      })
    } else {
      debugText += '\nNo remote stream\n'
    }
    
    console.log(debugText)
    setDebugInfo(debugText)
    addLog('Debug information collected', 'info')
    
    console.log('=== DEBUG CONNECTION END ===')
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
        // Clear stats interval
        if (peerConnectionRef.current._statsInterval) {
          clearInterval(peerConnectionRef.current._statsInterval)
        }
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
      addLog('Remote description set', 'success')
      
      // Get local audio stream
      const stream = await getUserMedia(selectedDevice)
      if (!stream) {
        throw new Error('Failed to get microphone access')
      }
      
      // Add tracks to connection
      stream.getAudioTracks().forEach(track => {
        peerConnectionRef.current.addTrack(track, stream)
        console.log('Added local track to peer connection')
      })
      
      localStreamRef.current = stream
      
      // Create answer
      const answer = await peerConnectionRef.current.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      })
      
      await peerConnectionRef.current.setLocalDescription(answer)
      addLog('Local description set', 'success')
      
      // Send answer
      socket.emit('answer', {
        to: from,
        answer: answer
      })
      
      addLog('Call accepted and answered', 'success')
      setCallStatus('Connected')
      
      // Debug after connection
      setTimeout(debugConnection, 2000)
      
    } catch (error) {
      addLog(`Error answering call: ${error.message}`, 'error')
      console.error('Answer call error:', error)
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
        if (peerConnectionRef.current._statsInterval) {
          clearInterval(peerConnectionRef.current._statsInterval)
        }
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
        console.log('Added local track to peer connection (caller)')
      })
      
      localStreamRef.current = stream
      
      // Create offer with audio only
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      })
      
      await peerConnectionRef.current.setLocalDescription(offer)
      addLog('Local offer set', 'success')
      
      // Log offer details
      console.log('Offer SDP:', offer.sdp)
      
      // Send offer
      socket.emit('offer', {
        to: toUserId,
        offer: offer
      })
      
      addLog('Call offer sent', 'success')
      
      // Debug after offer
      setTimeout(debugConnection, 1000)
      
    } catch (error) {
      addLog(`Error starting call: ${error.message}`, 'error')
      console.error('Start call error:', error)
      setCallStatus('Error')
      endCall()
    }
  }

  // End call
  const endCall = () => {
    addLog('Ending call', 'info')
    
    // Close peer connection
    if (peerConnectionRef.current) {
      // Clear stats interval
      if (peerConnectionRef.current._statsInterval) {
        clearInterval(peerConnectionRef.current._statsInterval)
      }
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
    setDebugInfo('')
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
          localAudioRef.current.play().then(() => {
            addLog('Microphone test - playing local audio', 'success')
          })
        }
        
        // Test audio levels
        const audioContext = new AudioContext()
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        source.connect(analyser)
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        
        const checkAudioLevel = () => {
          analyser.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length
          console.log('Audio level:', average)
          
          if (average > 5) {
            addLog(`✅ Microphone working - Audio level: ${average.toFixed(1)}`, 'success')
          } else {
            addLog('⚠️ Low audio level - Speak louder', 'warn')
          }
        }
        
        // Check audio level after 1 second
        setTimeout(checkAudioLevel, 1000)
        
        // Stop after 3 seconds
        setTimeout(() => {
          stream.getTracks().forEach(track => track.stop())
          if (localAudioRef.current) {
            localAudioRef.current.srcObject = null
            localAudioRef.current.volume = 0
          }
          audioContext.close()
          addLog('Microphone test completed', 'info')
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

  // Network test
  const testNetwork = async () => {
    try {
      addLog('Testing network connectivity...', 'info')
      
      // Create temporary peer connection to test ICE
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })
      
      // Create data channel for testing
      const dc = pc.createDataChannel('test')
      
      dc.onopen = () => {
        addLog('✅ Data channel open - Network works', 'success')
        dc.close()
        pc.close()
      }
      
      dc.onerror = (error) => {
        addLog(`❌ Data channel error: ${error}`, 'error')
        pc.close()
      }
      
      // Create offer to trigger ICE gathering
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      
      // Check ICE candidates after 2 seconds
      setTimeout(() => {
        if (pc.localDescription) {
          const sdp = pc.localDescription.sdp
          const lines = sdp.split('\n')
          const candidates = lines.filter(l => l.includes('a=candidate'))
          
          addLog(`Found ${candidates.length} ICE candidates`, 'info')
          
          // Check candidate types
          const types = {
            host: candidates.filter(c => c.includes('typ host')).length,
            srflx: candidates.filter(c => c.includes('typ srflx')).length,
            relay: candidates.filter(c => c.includes('typ relay')).length
          }
          
          console.log('Candidate types:', types)
          
          if (types.srflx === 0 && types.relay === 0) {
            addLog('⚠️ No STUN/TURN candidates. May have NAT issues.', 'warn')
          }
          
          if (types.relay > 0) {
            addLog('✅ Using TURN relay - Good for strict NAT', 'success')
          }
        }
        
        pc.close()
      }, 2000)
      
    } catch (error) {
      addLog(`Network test error: ${error.message}`, 'error')
    }
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
          🎤 WebRTC Voice Call (Enhanced)
        </h1>
        <p style={{ color: '#7f8c8d', fontSize: '1.1rem' }}>
          Real-time audio calling with debugging
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
                <p style={{ 
                  color: iceState === 'connected' ? '#27ae60' :
                         iceState === 'checking' ? '#f39c12' :
                         iceState === 'failed' ? '#e74c3c' : '#34495e',
                  fontWeight: 'bold'
                }}>
                  {iceState}
                </p>
              </div>
            )}
            
            {debugInfo && (
              <div style={{ 
                marginTop: '10px', 
                padding: '10px',
                backgroundColor: '#2c3e50',
                borderRadius: '5px',
                maxHeight: '100px',
                overflowY: 'auto'
              }}>
                <p style={{ 
                  color: '#fff', 
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-line',
                  margin: 0
                }}>
                  {debugInfo}
                </p>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '200px' }}>
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
              onClick={debugConnection}
              style={{
                padding: '12px 20px',
                backgroundColor: '#8e44ad',
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
              🔧 Debug Connection
            </button>
            
            <button
              onClick={testNetwork}
              style={{
                padding: '12px 20px',
                backgroundColor: '#16a085',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              🌐 Test Network
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
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
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
                  gap: '8px',
                  marginTop: '10px'
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
                fontSize: '14px',
                backgroundColor: 'white'
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
              Make sure both devices are connected to same WiFi and refresh page
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
                  backgroundColor: remoteId === id ? '#2ecc71' : 
                                  isCallerRef.current ? '#3498db' : '#9b59b6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: remoteId === id ? 'default' : 'pointer',
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
                  {remoteId === id ? '📞' : 
                   isCallerRef.current ? '📤' : '📥'}
                </span>
                <span>
                  {remoteId === id ? 'Talking...' : 
                   isCallerRef.current ? `Call ${id.slice(0, 8)}` : `Receive from ${id.slice(0, 8)}`}
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
                onPlay={() => addLog('Local audio playing', 'info')}
                onError={(e) => addLog(`Local audio error: ${e.target.error}`, 'error')}
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
                onPlay={() => addLog('Remote audio playing', 'success')}
                onError={(e) => addLog(`Remote audio error: ${e.target.error}`, 'error')}
              />
              <p style={{ fontSize: '13px', color: '#9c27b0', marginTop: '10px' }}>
                This is what the other person sounds like
              </p>
              {remoteAudioRef.current?.srcObject && (
                <p style={{ fontSize: '12px', color: '#7b1fa2', marginTop: '5px' }}>
                  Audio stream active
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ color: '#2c3e50' }}>Activity Logs</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => navigator.clipboard.writeText(logs.map(l => l.message).join('\n'))}
              style={{
                padding: '8px 15px',
                backgroundColor: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              📋 Copy Logs
            </button>
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
                  fontSize: '13px',
                  wordBreak: 'break-word'
                }}
              >
                {log.message}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Troubleshooting Guide */}
      <div style={{
        marginTop: '30px',
        padding: '20px',
        backgroundColor: '#e8f5e9',
        borderRadius: '10px',
        border: '1px solid #4caf50'
      }}>
        <h4 style={{ color: '#2e7d32', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>🔧</span> Troubleshooting Guide
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <h5 style={{ color: '#388e3c' }}>One-way Audio Issues</h5>
            <ul style={{ paddingLeft: '20px', color: '#1b5e20', lineHeight: '1.6' }}>
              <li>Click <strong>"Debug Connection"</strong> button</li>
              <li>Check if <strong>ICE State</strong> shows "connected"</li>
              <li>Verify <strong>Remote stream tracks</strong> count is 1</li>
              <li>Use <strong>"Test Network"</strong> button</li>
              <li>Try different <strong>WiFi/Network</strong></li>
            </ul>
          </div>
          <div>
            <h5 style={{ color: '#388e3c' }}>Quick Fixes</h5>
            <ul style={{ paddingLeft: '20px', color: '#1b5e20', lineHeight: '1.6' }}>
              <li><strong>Refresh</strong> both browser pages</li>
              <li>Allow <strong>microphone permissions</strong></li>
              <li>Try <strong>incognito mode</strong></li>
              <li>Use <strong>Chrome/Firefox</strong> latest version</li>
              <li>Disable <strong>VPN/Firewall</strong> temporarily</li>
            </ul>
          </div>
        </div>
        
        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: 'white', borderRadius: '8px' }}>
          <p style={{ color: '#d84315', fontWeight: 'bold', marginBottom: '10px' }}>🔍 Debug Tips:</p>
          <ol style={{ paddingLeft: '20px', color: '#5d4037', lineHeight: '1.6' }}>
            <li>If <code>Remote stream tracks: 0</code> - Remote not sending audio</li>
            <li>If <code>ICE State: failed</code> - Network/NAT issue, use mobile data</li>
            <li>If <code>Host: 0, Srflx: 0</code> - STUN blocked, use TURN server</li>
            <li>Check browser console (F12) for detailed errors</li>
          </ol>
        </div>
      </div>
    </div>
  )
}