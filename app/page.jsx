'use client';
import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function Home() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [status, setStatus] = useState('Connecting...');
  const [chatMessages, setChatMessages] = useState([]);
  const chatInputRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        // Get media stream
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // Connect to Socket.IO
        socketRef.current = io('/api/socket', {
          path: '/api/socket',
        });

        socketRef.current.on('connect', () => {
          if (isMounted) setStatus('Connected');
        });

        socketRef.current.on('waiting', (data) => {
          if (isMounted) setStatus(data.message);
        });

        socketRef.current.on('partnerFound', async (data) => {
          if (!isMounted) return;
          setStatus('Partner found!');

          // Initialize WebRTC
          peerConnectionRef.current = new RTCPeerConnection(configuration);
          stream.getTracks().forEach(track => 
            peerConnectionRef.current.addTrack(track, stream)
          );

          peerConnectionRef.current.ontrack = (event) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
          };

          peerConnectionRef.current.onicecandidate = (event) => {
            if (event.candidate) {
              socketRef.current.emit('signal', { 
                type: 'candidate', 
                candidate: event.candidate 
              });
            }
          };

          if (data.shouldInitiate) {
            const offer = await peerConnectionRef.current.createOffer();
            await peerConnectionRef.current.setLocalDescription(offer);
            socketRef.current.emit('signal', { type: 'offer', sdp: offer });
          }
        });

        socketRef.current.on('signal', async (data) => {
          if (!peerConnectionRef.current) return;

          try {
            if (data.type === 'offer') {
              await peerConnectionRef.current.setRemoteDescription(data.sdp);
              const answer = await peerConnectionRef.current.createAnswer();
              await peerConnectionRef.current.setLocalDescription(answer);
              socketRef.current.emit('signal', { type: 'answer', sdp: answer });
            } else if (data.type === 'answer') {
              await peerConnectionRef.current.setRemoteDescription(data.sdp);
            } else if (data.type === 'candidate') {
              await peerConnectionRef.current.addIceCandidate(data.candidate);
            }
          } catch (err) {
            console.error('Signal error:', err);
          }
        });

        socketRef.current.on('chat', (data) => {
          if (isMounted) {
            setChatMessages(prev => [...prev, { 
              sender: 'Partner', 
              message: data.message 
            }]);
          }
        });

        socketRef.current.on('partnerDisconnected', () => {
          if (isMounted) {
            setStatus('Partner disconnected');
            peerConnectionRef.current?.close();
            peerConnectionRef.current = null;
          }
        });

      } catch (err) {
        console.error('Initialization error:', err);
        if (isMounted) setStatus('Error accessing media');
      }
    }

    init();

    return () => {
      isMounted = false;
      socketRef.current?.disconnect();
      peerConnectionRef.current?.close();
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
  }, []);

  const sendChat = () => {
    const message = chatInputRef.current.value.trim();
    if (message && socketRef.current) {
      socketRef.current.emit('chat', { message });
      setChatMessages(prev => [...prev, { sender: 'You', message }]);
      chatInputRef.current.value = '';
    }
  };

  return (
    <main className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Random Video Chat</h1>
      <p className="mb-4">Status: {status}</p>
      
      <div className="flex gap-4 mb-8">
        <div className="flex-1">
          <h3 className="text-lg mb-2">Your Video</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full bg-black aspect-video"
          />
        </div>
        <div className="flex-1">
          <h3 className="text-lg mb-2">Partner Video</h3>
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="w-full bg-black aspect-video"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg mb-2">Chat</h3>
        <div className="border rounded-lg h-48 overflow-y-auto p-2 mb-4">
          {chatMessages.map((msg, i) => (
            <div key={i} className="mb-1">
              <strong>{msg.sender}:</strong> {msg.message}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            ref={chatInputRef}
            type="text"
            placeholder="Type a message"
            className="flex-1 p-2 border rounded"
            onKeyDown={(e) => e.key === 'Enter' && sendChat()}
          />
          <button 
            onClick={sendChat}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}