import { Server as SocketIOServer } from 'socket.io';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let io;

export async function GET(req) {
  if (!io) {
    const res = new Response();
    
    // Initialize Socket.IO with the raw Node.js server
    const httpServer = res.socket?.server;
    if (!httpServer) {
      return new Response('Server not ready', { status: 500 });
    }

    io = new SocketIOServer(httpServer, {
      path: '/api/socket/io',
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Store waiting sockets and pairs
    const waitingSockets = new Set();
    const pairs = new Map();

    io.on('connection', (socket) => {
      console.log('New connection:', socket.id);

      // Pairing logic
      if (waitingSockets.size > 0) {
        // Get the first waiting socket
        const [partnerId] = waitingSockets;
        const partner = io.sockets.sockets.get(partnerId);
        
        if (partner) {
          waitingSockets.delete(partnerId);
          pairs.set(socket.id, partnerId);
          pairs.set(partnerId, socket.id);

          socket.emit('partnerFound', { shouldInitiate: true });
          partner.emit('partnerFound', { shouldInitiate: false });
          console.log(`Paired ${socket.id} with ${partnerId}`);
        } else {
          // If partner socket is invalid, add current socket to waiting list
          waitingSockets.add(socket.id);
          socket.emit('waiting', { message: 'Waiting for partner...' });
        }
      } else {
        waitingSockets.add(socket.id);
        socket.emit('waiting', { message: 'Waiting for partner...' });
        console.log('Added to waiting list:', socket.id);
      }

      // Signal forwarding
      socket.on('signal', (data) => {
        const partnerId = pairs.get(socket.id);
        if (partnerId) {
          io.to(partnerId).emit('signal', data);
        }
      });

      // Chat forwarding
      socket.on('chat', (data) => {
        const partnerId = pairs.get(socket.id);
        if (partnerId) {
          io.to(partnerId).emit('chat', data);
        }
      });

      // Cleanup on disconnect
      socket.on('disconnect', () => {
        const partnerId = pairs.get(socket.id);
        if (partnerId) {
          io.to(partnerId).emit('partnerDisconnected');
          pairs.delete(partnerId);
          pairs.delete(socket.id);
        }
        waitingSockets.delete(socket.id);
        console.log('Disconnected:', socket.id);
      });
    });
  }

  return new Response('Socket server is running', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
    }
  });
}