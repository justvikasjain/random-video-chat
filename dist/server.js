const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const waitingUsers = new Set();
const chatPairs = new Map();

io.on('connection', socket => {
    console.log('User connected:', socket.id);

    socket.on('start_chat', () => {
        if (waitingUsers.has(socket.id)) return;

        if (waitingUsers.size > 0) {
            const iterator = waitingUsers.values();
            const partnerId = iterator.next().value;
            waitingUsers.delete(partnerId);

            chatPairs.set(socket.id, partnerId);
            chatPairs.set(partnerId, socket.id);

            io.to(socket.id).emit('chat_started', { initiator: true, partnerId });
            io.to(partnerId).emit('chat_started', { initiator: false, partnerId: socket.id });
        } else {
            waitingUsers.add(socket.id);
            socket.emit('waiting');
        }
    });

    // WebRTC Signaling
    socket.on('offer', data => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('offer', data);
        }
    });

    socket.on('answer', data => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('answer', data);
        }
    });

    socket.on('ice-candidate', data => {
        const partnerId = chatPairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('ice-candidate', data);
        }
    });

    socket.on('send_message', message => {
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
        waitingUsers.delete(socket.id);
    });

    socket.on('skip', () => {
        const oldPartnerId = chatPairs.get(socket.id);
        if (oldPartnerId) {
            io.to(oldPartnerId).emit('partner_disconnected');
            chatPairs.delete(oldPartnerId);
            chatPairs.delete(socket.id);
        }
        socket.emit('start_chat');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});