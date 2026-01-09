import { io } from 'socket.io-client';

// Use your laptop's IP address
const SOCKET_URL = 'http://192.168.1.109:5000';

// Create socket connection
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  timeout: 20000
});

// Connection events
socket.on('connect', () => {
  console.log('✅ Socket connected:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('❌ Socket connection error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('🔴 Socket disconnected:', reason);
});

// Export socket
export { socket };