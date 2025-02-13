"use client";

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Video, MessageCircle, UserPlus } from 'lucide-react';

export default function Home() {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [peer, setPeer] = useState(null);
  const [connected, setConnected] = useState(false);
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerConnectionRef = useRef();

  useEffect(() => {
    const initSocket = async () => {
      await fetch('/api/socket');
      const newSocket = io({ path: '/api/socket' });
      setSocket(newSocket);

      return () => newSocket.close();
    };

    initSocket();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const initWebRTC = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideoRef.current.srcObject = stream;

        socket.emit('ready');

        socket.on('matched', async (peerId) => {
          setPeer(peerId);
          setConnected(true);
          
          const configuration = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          };
          
          const pc = new RTCPeerConnection(configuration);
          peerConnectionRef.current = pc;

          stream.getTracks().forEach(track => pc.addTrack(track, stream));

          pc.ontrack = (event) => {
            remoteVideoRef.current.srcObject = event.streams[0];
          };

          pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
              socket.emit('ice-candidate', { candidate, to: peerId });
            }
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', { offer, to: peerId });
        });

        socket.on('offer', async ({ offer, from }) => {
          const pc = peerConnectionRef.current;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('answer', { answer, to: from });
        });

        socket.on('answer', async ({ answer }) => {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        });

        socket.on('ice-candidate', async ({ candidate }) => {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('Error adding ice candidate:', e);
          }
        });

        socket.on('disconnected', () => {
          setConnected(false);
          setPeer(null);
          setMessages([]);
          remoteVideoRef.current.srcObject = null;
          socket.emit('ready');
        });

        socket.on('chat', ({ message, from }) => {
          setMessages(prev => [...prev, { text: message, from }]);
        });
      } catch (error) {
        console.error('Error accessing media devices:', error);
      }
    };

    initWebRTC();

    return () => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [socket]);

  const handleNext = () => {
    if (socket && connected) {
      socket.emit('next');
      setMessages([]);
      remoteVideoRef.current.srcObject = null;
      setConnected(false);
      setPeer(null);
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (currentMessage.trim() && socket && peer) {
      socket.emit('chat', { message: currentMessage, to: peer });
      setMessages(prev => [...prev, { text: currentMessage, from: 'me' }]);
      setCurrentMessage('');
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-2 aspect-video relative">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover rounded-lg"
                />
                <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded-md text-sm">
                  You
                </div>
              </Card>
              <Card className="p-2 aspect-video relative">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover rounded-lg"
                />
                <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded-md text-sm">
                  Stranger
                </div>
              </Card>
            </div>
            <div className="flex justify-center space-x-4">
              <Button
                onClick={handleNext}
                variant="default"
                size="lg"
                className="w-48"
              >
                {connected ? (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Next Person
                  </>
                ) : (
                  <>
                    <Video className="mr-2 h-4 w-4" />
                    Finding Partner...
                  </>
                )}
              </Button>
            </div>
          </div>
          <Card className="p-4">
            <div className="flex items-center space-x-2 mb-4">
              <MessageCircle className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Chat</h2>
            </div>
            <ScrollArea className="h-[400px] mb-4">
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      msg.from === 'me' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        msg.from === 'me'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <form onSubmit={sendMessage} className="flex space-x-2">
              <Input
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                placeholder="Type a message..."
                disabled={!connected}
              />
              <Button type="submit" disabled={!connected}>
                Send
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}