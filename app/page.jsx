// /app/page.jsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const configuration = { 
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ] 
};

export default function Home() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [status, setStatus] = useState('Initializing...');
  const [chatMessages, setChatMessages] = useState([]);
  const chatInputRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        // Get media stream
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Connect to Socket.IO
        socketRef.current = io({
          path: '/api/socket/io',
          addTrailingSlash: false,
        });

        socketRef.current.on('connect', () => {
          if (isMounted) setStatus('Connected, waiting for partner...');
        });

        socketRef.current.on('connect_error', (error) => {
          console.error('Socket connection error:', error);
          if (isMounted) setStatus('Connection error. Please refresh.');
        });

        socketRef.current.on('waiting', (data) => {
          if (isMounted) setStatus(data.message);
        });

        socketRef.current.on('partnerFound', async (data) => {
          if (!isMounted) return;
          setStatus('Partner found! Establishing connection...');

          try {
            // Initialize WebRTC
            peerConnectionRef.current = new RTCPeerConnection(configuration);
            
            // Add local tracks to the connection
            localStreamRef.current.getTracks().forEach(track => 
              peerConnectionRef.current.addTrack(track, localStreamRef.current)
            );

            // Handle incoming tracks
            peerConnectionRef.current.ontrack = (event) => {
              if (remoteVideoRef.current && event.streams[0]) {
                remoteVideoRef.current.srcObject = event.streams[0];
              }
            };

            // Handle ICE candidates
            peerConnectionRef.current.onicecandidate = (event) => {
              if (event.candidate) {
                socketRef.current.emit('signal', { 
                  type: 'candidate', 
                  candidate: event.candidate 
                });
              }
            };

            // Handle connection state changes
            peerConnectionRef.current.onconnectionstatechange = () => {
              const state = peerConnectionRef.current.connectionState;
              if (state === 'connected') {
                setStatus('Connected with partner');
              } else if (state === 'disconnected' || state === 'failed') {
                setStatus('Connection lost');
              }
            };

            if (data.shouldInitiate) {
              const offer = await peerConnectionRef.current.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
              });
              await peerConnectionRef.current.setLocalDescription(offer);
              socketRef.current.emit('signal', { type: 'offer', sdp: offer });
            }
          } catch (err) {
            console.error('WebRTC setup error:', err);
            setStatus('Failed to setup video call');
          }
        });

        socketRef.current.on('signal', async (data) => {
          if (!peerConnectionRef.current) return;

          try {
            if (data.type === 'offer') {
              await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
              const answer = await peerConnectionRef.current.createAnswer();
              await peerConnectionRef.current.setLocalDescription(answer);
              socketRef.current.emit('signal', { type: 'answer', sdp: answer });
            } 
            else if (data.type === 'answer') {
              await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
            } 
            else if (data.type === 'candidate') {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          } catch (err) {
            console.error('Signal handling error:', err);
          }
        });

        socketRef.current.on('chat', (data) => {
          if (isMounted) {
            setChatMessages(prev => [...prev, { 
              sender: 'Partner', 
              message: data.message,
              timestamp: new Date().toLocaleTimeString()
            }]);
          }
        });

        socketRef.current.on('partnerDisconnected', () => {
          if (isMounted) {
            setStatus('Partner disconnected');
            if (peerConnectionRef.current) {
              peerConnectionRef.current.close();
              peerConnectionRef.current = null;
            }
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = null;
            }
          }
        });

      } catch (err) {
        console.error('Initialization error:', err);
        if (isMounted) setStatus('Error accessing camera/microphone');
      }
    }

    init();

    return () => {
      isMounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    };
  }, []);

  const sendChat = () => {
    const message = chatInputRef.current?.value.trim();
    if (message && socketRef.current) {
      socketRef.current.emit('chat', { message });
      setChatMessages(prev => [...prev, { 
        sender: 'You', 
        message,
        timestamp: new Date().toLocaleTimeString()
      }]);
      chatInputRef.current.value = '';
    }
  };

  return (
    <main className="p-4 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Random Video Chat</h1>
      <p className="mb-4 text-lg">Status: {status}</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div>
          <h3 className="text-xl mb-2">Your Video</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full bg-gray-900 aspect-video rounded-lg"
          />
        </div>
        <div>
          <h3 className="text-xl mb-2">Partner Video</h3>
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="w-full bg-gray-900 aspect-video rounded-lg"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-xl mb-2">Chat</h3>
        <div className="border rounded-lg h-64 overflow-y-auto p-4 mb-4 bg-gray-50">
          {chatMessages.map((msg, i) => (
            <div key={i} className={`mb-2 ${msg.sender === 'You' ? 'text-right' : ''}`}>
              <div className={`inline-block max-w-[70%] rounded-lg p-2 ${
                msg.sender === 'You' ? 'bg-blue-500 text-white' : 'bg-gray-200'
              }`}>
                <div className="font-medium">{msg.sender}</div>
                <div>{msg.message}</div>
                <div className="text-xs opacity-75">{msg.timestamp}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            ref={chatInputRef}
            type="text"
            placeholder="Type a message..."
            className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && sendChat()}
          />
          <button 
            onClick={sendChat}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}