import { io } from 'socket.io-client';

// Use your deployed backend URL
const SOCKET_URL = 'https://new-voice-backend.onrender.com';

// Create socket connection
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  forceNew: true,
  upgrade: true,
  rejectUnauthorized: false
});

// Connection events
socket.on('connect', () => {
  console.log('✅ Socket connected:', socket.id);
  console.log('Transport:', socket.io.engine.transport.name);
});

socket.on('connect_error', (error) => {
  console.error('❌ Socket connection error:', error.message);
  console.error('Error details:', error);
});

socket.on('disconnect', (reason) => {
  console.log('🔴 Socket disconnected:', reason);
  if (reason === 'io server disconnect') {
    // Server disconnected, try to reconnect
    socket.connect();
  }
});

socket.on('reconnect', (attemptNumber) => {
  console.log('🔄 Reconnected after', attemptNumber, 'attempts');
});

socket.on('reconnect_attempt', (attemptNumber) => {
  console.log('🔄 Reconnection attempt:', attemptNumber);
});

socket.on('reconnect_error', (error) => {
  console.error('❌ Reconnection error:', error);
});

socket.on('reconnect_failed', () => {
  console.error('❌ Reconnection failed');
});

// Ping-pong for keepalive
socket.on('pong', () => {
  console.log('🏓 Pong received');
});

// Export socket
export { socket };