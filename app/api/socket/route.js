import { Server } from 'socket.io';

const ioHandler = (req, res) => {
  if (!res.socket.server.io) {
    const io = new Server(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
    });

    const users = new Map();
    const waitingUsers = new Set();

    io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      socket.on('ready', () => {
        waitingUsers.add(socket.id);
        matchUsers();
      });

      socket.on('offer', ({ offer, to }) => {
        socket.to(to).emit('offer', { offer, from: socket.id });
      });

      socket.on('answer', ({ answer, to }) => {
        socket.to(to).emit('answer', { answer, from: socket.id });
      });

      socket.on('ice-candidate', ({ candidate, to }) => {
        socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
      });

      socket.on('next', () => {
        const currentPeer = users.get(socket.id);
        if (currentPeer) {
          socket.to(currentPeer).emit('disconnected');
          users.delete(socket.id);
          users.delete(currentPeer);
        }
        waitingUsers.add(socket.id);
        matchUsers();
      });

      socket.on('disconnect', () => {
        const peer = users.get(socket.id);
        if (peer) {
          socket.to(peer).emit('disconnected');
          users.delete(socket.id);
          users.delete(peer);
        }
        waitingUsers.delete(socket.id);
      });

      socket.on('chat', ({ message, to }) => {
        socket.to(to).emit('chat', { message, from: socket.id });
      });
    });

    function matchUsers() {
      const waitingArray = Array.from(waitingUsers);
      while (waitingArray.length >= 2) {
        const user1 = waitingArray.shift();
        const user2 = waitingArray.shift();
        
        users.set(user1, user2);
        users.set(user2, user1);
        
        waitingUsers.delete(user1);
        waitingUsers.delete(user2);
        
        io.to(user1).emit('matched', user2);
        io.to(user2).emit('matched', user1);
      }
    }

    res.socket.server.io = io;
  }
  res.end();
};

export const GET = ioHandler;
export const POST = ioHandler;