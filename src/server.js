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

const rooms = new Map(); // Stores room info: { roomId: { name, isPrivate, participants: Set, maxParticipants } }
const userRooms = new Map();

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

    socket.on('create_room', ({ name, isPrivate, maxParticipants = 10 }) => {
        console.log("creating room"); 
        const roomId = isPrivate ? generateRoomCode() : name.toLowerCase().replace(/\s+/g, '-');

        if (rooms.has(roomId)) {
            socket.emit('room_error', 'Room already exists');
            return;
        }

        rooms.set(roomId, {
            name,
            isPrivate,
            participants: new Set(),
            maxParticipants,
            creator: socket.id
        });

        socket.emit('room_created', { roomId, name, isPrivate });
        if (!isPrivate) {
            io.emit('room_public_rooms_list', getPublicRooms());
        }
    });

    socket.on('join_room', async (roomId) => {
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('room_error', 'Room not found');
            return;
        }

        if (room.participants.size >= room.maxParticipants) {
            socket.emit('room_error', 'Room is full');
            return;
        }

        // Leave current room if in one
        const currentRoomId = userRooms.get(socket.id);
        if (currentRoomId) {
            await leaveRoom(socket, currentRoomId);
        }

        // Join new room
        room.participants.add(socket.id);
        userRooms.set(socket.id, roomId);
        socket.join(roomId);

        // Notify everyone in room including the new participant
        io.in(roomId).emit('room_participant_joined', {
            participantId: socket.id,
            participantCount: room.participants.size
        });

        // Send existing participants to new user
        socket.emit('room_joined', {
            roomId,
            participants: Array.from(room.participants),
            isCreator: room.creator === socket.id
        });
    });

    // Handle WebRTC signaling within rooms
    socket.on('room_offer', (data) => {
        const roomId = userRooms.get(socket.id);
        if (roomId) {
            io.to(data.to).emit('room_offer', {
                offer: data.offer,
                from: socket.id
            });
        }
    });

    socket.on('room_answer', (data) => {
        const roomId = userRooms.get(socket.id);
        if (roomId) {
            io.to(data.to).emit('room_answer', {
                answer: data.answer,
                from: socket.id
            });
        }
    });

    socket.on('room_ice-candidate', (data) => {
        const roomId = userRooms.get(socket.id);
        if (roomId) {
            io.to(data.to).emit('room_ice-candidate', {
                candidate: data.candidate,
                from: socket.id
            });
        }
    });

    // Handle chat messages within rooms
    socket.on('room_send_message', (message) => {
        const roomId = userRooms.get(socket.id);
        if (roomId) {
            // Broadcast to everyone in the room including sender
            io.in(roomId).emit('room_receive_message', {
                senderId: socket.id,
                message,
                timestamp: Date.now()
            });
        }
    });

    socket.on('leave_room', async () => {
        const roomId = userRooms.get(socket.id);
        if (roomId) {
            await leaveRoom(socket, roomId);
        }
    });

    socket.on('get_public_rooms', () => {
        socket.emit('room_public_rooms_list', getPublicRooms());
    });

    socket.on('disconnect', async () => {
        const roomId = userRooms.get(socket.id);
        if (roomId) {
            await leaveRoom(socket, roomId);
        }
    });

    // Helper functions
    function generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    function getPublicRooms() {
        const publicRooms = [];
        for (const [roomId, room] of rooms.entries()) {
            if (!room.isPrivate) {
                publicRooms.push({
                    id: roomId,
                    name: room.name,
                    participants: room.participants.size,
                    maxParticipants: room.maxParticipants
                });
            }
        }
        return publicRooms;
    }

    async function leaveRoom(socket, roomId) {
        const room = rooms.get(roomId);
        if (room) {
            room.participants.delete(socket.id);
            userRooms.delete(socket.id);
            socket.leave(roomId);

            // Notify everyone in room
            io.in(roomId).emit('room_participant_left', {
                participantId: socket.id,
                participantCount: room.participants.size
            });

            // If room is empty, delete it and update public rooms list
            if (room.participants.size === 0) {
                rooms.delete(roomId);
                if (!room.isPrivate) {
                    io.emit('room_public_rooms_list', getPublicRooms());
                }
            }
        }
    }
});



const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
