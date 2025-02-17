const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    pingTimeout: 60000,
    pingInterval: 25000,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });

app.use(express.static('public'));

const waitingQueue = [];
const chatPairs = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('start_chat', () => {
        // Check if there is a waiting user to match with
        while (waitingQueue.length > 0) {
          const partnerId = waitingQueue.shift();
          // Make sure the partner is not the current socket and is still connected
          if (partnerId !== socket.id && io.sockets.sockets.get(partnerId)) {
            // We found a valid partner.
            chatPairs.set(socket.id, partnerId);
            chatPairs.set(partnerId, socket.id);
    
            io.to(socket.id).emit('chat_started', { initiator: true, partnerId });
            io.to(partnerId).emit('chat_started', { initiator: false, partnerId: socket.id });
            return; // Exit after successful pairing
          }
          // If partnerId is invalid (disconnected), continue the loop.
        }
    
        // No valid partner was found; add the current socket to the waiting queue.
        waitingQueue.push(socket.id);
        socket.emit('waiting');
      });

    // WebRTC Signaling
    socket.on('offer', (data) => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('offer', data);
        }
    });

    socket.on('answer', (data) => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('answer', data);
        }
    });

    socket.on('ice-candidate', (data) => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('ice-candidate', data);
        }
    });

    socket.on('send_message', (message) => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('receive_message', message);
        }
    });

    socket.on('disconnect', () => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('partner_disconnected');
            chatPairs.delete(partnerId);
            chatPairs.delete(socket.id);
        }
        removeFromQueue(socket.id);
    });

    function removeFromQueue(socketId) {
        const index = waitingQueue.indexOf(socketId);
        if (index !== -1) {
            waitingQueue.splice(index, 1);
        }
    }

    socket.on('skip', () => {
        const oldPartnerId = chatPairs.get(socket.id);
        if (oldPartnerId) {
            io.to(oldPartnerId).emit('partner_disconnected');
            chatPairs.delete(oldPartnerId);
            chatPairs.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
