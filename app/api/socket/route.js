import { Server } from 'socket.io';

// Socket.IO server instance (Next.js API route)
let io;

export default function handler(req, res) {
  if (!io) {
    // Initialize Socket.IO server
    io = new Server(res.socket.server, {
      cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });

    // Store waiting sockets and pairs
    const waitingSockets = [];
    const pairs = new Map();

    io.on('connection', (socket) => {
      console.log('New connection:', socket.id);

      // Pairing logic
      if (waitingSockets.length > 0) {
        const partner = waitingSockets.pop();
        pairs.set(socket.id, partner.id);
        pairs.set(partner.id, socket.id);

        socket.emit('partnerFound', { shouldInitiate: true });
        partner.emit('partnerFound', { shouldInitiate: false });
        console.log(`Paired ${socket.id} with ${partner.id}`);
      } else {
        waitingSockets.push(socket);
        socket.emit('waiting', { message: 'Waiting for partner...' });
        console.log('Added to waiting list:', socket.id);
      }

      // Signal forwarding
      socket.on('signal', (data) => {
        const partnerId = pairs.get(socket.id);
        if (partnerId) io.to(partnerId).emit('signal', data);
      });

      // Chat forwarding
      socket.on('chat', (data) => {
        const partnerId = pairs.get(socket.id);
        if (partnerId) io.to(partnerId).emit('chat', data);
      });

      // Cleanup on disconnect
      socket.on('disconnect', () => {
        const partnerId = pairs.get(socket.id);
        if (partnerId) {
          io.to(partnerId).emit('partnerDisconnected');
          pairs.delete(partnerId);
          pairs.delete(socket.id);
        }
        const index = waitingSockets.findIndex(s => s.id === socket.id);
        if (index > -1) waitingSockets.splice(index, 1);
      });
    });
  }

  // Required for Next.js API route
  res.end();
}