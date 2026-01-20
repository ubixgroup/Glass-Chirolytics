import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageType, Message, User } from '@/types/webTypes';
import { GestureRecognizerResult } from '@mediapipe/tasks-vision';

// gesture data with timestamp
export type RemoteGestureData = {
  gesture: GestureRecognizerResult;
  timestamp: number;
};

// ice servers configuration for webrtc
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// websocket hook for managing connection to server
export const useWebSocket = (
  url: string,
  selectedDeviceId?: string
): {
  isConnected: boolean;
  connectionError: string | null;
  currentUser: User | null;
  connectedUsers: User[];
  sendMessage: (message: Message) => void;
  rtcConnected: boolean;
  rtcConnectionState: RTCPeerConnectionState | null;
  rtcDataChannel: RTCDataChannel | null;
  remoteStream: MediaStream | null;
  remoteGestureData: RemoteGestureData | null;
  sendRtcData: (data: unknown) => void;
  replaceVideoTrack: (track: MediaStreamTrack) => Promise<void>;
  currentPing: number | null;
  pingHistory: number[];
} => {
  // connection state
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // user state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<User[]>([]);

  // webrtc state
  const [rtcConnected, setRtcConnected] = useState<boolean>(false);
  const [rtcConnectionState, setRtcConnectionState] =
    useState<RTCPeerConnectionState | null>(null);
  const [rtcDataChannel, setRtcDataChannel] = useState<RTCDataChannel | null>(
    null
  );
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteGestureData, setRemoteGestureData] =
    useState<RemoteGestureData | null>(null);

  // websocket reference
  const socketRef = useRef<WebSocket | null>(null);

  // webrtc references
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const targetClientIdRef = useRef<number | null>(null);

  // track refs for managing video tracks
  const localStreamRef = useRef<MediaStream | null>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);

  // queue for ice candidates received before remote description is set
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // reconnection settings
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttempts = useRef<number>(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;

  // add ping state
  const [currentPing, setCurrentPing] = useState<number | null>(null);
  const [pingHistory, setPingHistory] = useState<number[]>([]);

  // process queued ice candidates after remote description is set
  const processQueuedIceCandidates = useCallback(async () => {
    if (
      !peerConnectionRef.current ||
      !peerConnectionRef.current.remoteDescription
    ) {
      return;
    }

    const queuedCandidates = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      try {
        await peerConnectionRef.current.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.error('error adding queued ice candidate:', error);
      }
    }
  }, []);

  // send rtc data
  const sendRtcData = useCallback((data: unknown) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(data));
    }
  }, []);

  // send message to server
  const sendMessage = useCallback((message: Message): void => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      console.warn('cannot send message, websocket not connected');
    }
  }, []);

  // method to replace the video track in the peer connection
  const replaceVideoTrack = useCallback(
    async (newTrack: MediaStreamTrack): Promise<void> => {
      if (!peerConnectionRef.current || !rtcConnected) {
        console.warn('cannot replace track, peer connection not established');
        return;
      }

      try {
        // find the sender for the video track
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(
          (sender) => sender.track && sender.track.kind === 'video'
        );

        if (videoSender) {
          // store the sender reference for future use
          senderRef.current = videoSender;

          // replace the track
          await videoSender.replaceTrack(newTrack);
          console.log(
            'successfully replaced video track with visualization track'
          );
        } else {
          console.warn('no video sender found in peer connection');
        }
      } catch (error) {
        console.error('error replacing video track:', error);
      }
    },
    [rtcConnected]
  );

  // setup data channel
  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    setRtcDataChannel(channel);

    channel.onopen = () => {
      console.log('data channel opened');
    };

    channel.onclose = () => {
      console.log('data channel closed');
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'gesture') {
          setRemoteGestureData(
            message.data as {
              gesture: GestureRecognizerResult;
              timestamp: number;
            }
          );
        }
      } catch (error) {
        console.error('error parsing data channel message', error);
      }
    };
  }, []);

  // create and setup peer connection
  const createPeerConnection = useCallback(() => {
    // close any existing connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    // clear any pending ice candidates
    pendingIceCandidatesRef.current = [];

    // create new peer connection
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = peerConnection;

    // handle remote stream
    peerConnection.ontrack = (event) => {
      console.log('received remote track:', event.track.kind);
      const [remoteVideoTrack] = event.streams;
      setRemoteStream(remoteVideoTrack);
    };

    // handle ice candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && targetClientIdRef.current) {
        sendMessage({
          type: MessageType.RTC_ICE_CANDIDATE,
          targetClientId: targetClientIdRef.current,
          data: { candidate: event.candidate.toJSON() },
        });
      }
    };

    // handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('rtc connection state:', peerConnection.connectionState);
      setRtcConnectionState(peerConnection.connectionState);

      if (peerConnection.connectionState === 'connected') {
        setRtcConnected(true);
      } else if (
        peerConnection.connectionState === 'disconnected' ||
        peerConnection.connectionState === 'failed' ||
        peerConnection.connectionState === 'closed'
      ) {
        setRtcConnected(false);
        setRemoteStream(null);
      }
    };

    // handle data channel
    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      setupDataChannel(channel);
    };

    return peerConnection;
  }, [sendMessage, setupDataChannel]);

  // create offer (initiator)
  const createOffer = useCallback(
    async (targetId: number) => {
      if (!peerConnectionRef.current) return;

      try {
        // get local stream with selected device if specified and limit to 30fps
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(selectedDeviceId
              ? { deviceId: { exact: selectedDeviceId } }
              : {}),
            frameRate: { max: 30 }, // limit to 30fps
          },
          audio: true, // add audio track
        });

        // store local stream for future track replacement
        localStreamRef.current = localStream;

        // add local tracks to peer connection
        localStream.getTracks().forEach((track) => {
          if (peerConnectionRef.current) {
            const sender = peerConnectionRef.current.addTrack(
              track,
              localStream
            );

            // store the sender for the video track
            if (track.kind === 'video') {
              senderRef.current = sender;
            }
          }
        });

        // create data channel (initiator only)
        const dataChannel = peerConnectionRef.current.createDataChannel('data');
        setupDataChannel(dataChannel);

        // create and set local description
        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);

        // send offer to peer
        sendMessage({
          type: MessageType.RTC_OFFER,
          targetClientId: targetId,
          data: { offer },
        });
      } catch (error) {
        console.error('error creating offer:', error);
      }
    },
    [sendMessage, setupDataChannel, selectedDeviceId]
  );

  // handle incoming messages
  const handleMessage = useCallback(
    (message: Message): void => {
      switch (message.type) {
        case MessageType.CONNECT:
          // set current user from connection response
          if (message.data?.id && message.data?.username) {
            setCurrentUser({
              id: message.data.id,
              username: message.data.username,
            });
          }
          break;

        case MessageType.USER_LIST:
          // update connected users list
          if (message.data?.users) {
            setConnectedUsers(message.data.users);
          }
          break;

        case MessageType.PING:
          // respond to ping with pong
          sendMessage({ type: MessageType.PONG });
          break;

        case MessageType.INITIATE_RTC:
          // server is telling us to initiate webrtc
          if (message.data?.targetClientId !== undefined) {
            const targetId = message.data.targetClientId;
            targetClientIdRef.current = targetId;

            // create peer connection and store in ref
            createPeerConnection();

            // if we should initiate, create and send offer
            if (message.data.shouldInitiate) {
              createOffer(targetId);
            }
          }
          break;

        case MessageType.RTC_OFFER:
          // handle incoming offer
          if (message.data?.offer && message.sourceClientId !== undefined) {
            (async () => {
              try {
                // create peer connection if not exists
                if (!peerConnectionRef.current) {
                  createPeerConnection();
                }

                // set target client id
                if (message.sourceClientId !== undefined) {
                  targetClientIdRef.current = message.sourceClientId;
                }

                // get local stream with selected device if specified and limit to 30fps
                const localStream = await navigator.mediaDevices.getUserMedia({
                  video: {
                    ...(selectedDeviceId
                      ? { deviceId: { exact: selectedDeviceId } }
                      : {}),
                    frameRate: { max: 30 }, // limit to 30fps
                  },
                  audio: true, // add audio track
                });

                // store local stream for future track replacement
                localStreamRef.current = localStream;

                localStream.getTracks().forEach((track) => {
                  if (peerConnectionRef.current) {
                    const sender = peerConnectionRef.current.addTrack(
                      track,
                      localStream
                    );

                    // store the sender for the video track
                    if (track.kind === 'video') {
                      senderRef.current = sender;
                    }
                  }
                });

                // set remote description from offer
                if (message.data?.offer) {
                  await peerConnectionRef.current?.setRemoteDescription(
                    new RTCSessionDescription(message.data.offer)
                  );
                  // process any queued ice candidates now that remote description is set
                  await processQueuedIceCandidates();
                }

                // create and set local description
                const answer = await peerConnectionRef.current?.createAnswer();
                await peerConnectionRef.current?.setLocalDescription(answer);

                // send answer back
                sendMessage({
                  type: MessageType.RTC_ANSWER,
                  targetClientId: message.sourceClientId,
                  data: { answer },
                });
              } catch (error) {
                console.error('error handling offer:', error);
              }
            })();
          }
          break;

        case MessageType.RTC_ANSWER:
          // handle incoming answer
          if (message.data?.answer) {
            (async () => {
              try {
                if (message.data?.answer) {
                  await peerConnectionRef.current?.setRemoteDescription(
                    new RTCSessionDescription(message.data.answer)
                  );
                  // process any queued ice candidates now that remote description is set
                  await processQueuedIceCandidates();
                }
              } catch (error) {
                console.error('error handling answer:', error);
              }
            })();
          }
          break;

        case MessageType.RTC_ICE_CANDIDATE:
          // handle incoming ice candidate
          if (message.data?.candidate) {
            (async () => {
              try {
                if (message.data?.candidate && peerConnectionRef.current) {
                  // check if remote description is set
                  if (peerConnectionRef.current.remoteDescription) {
                    // remote description is set, add candidate immediately
                    await peerConnectionRef.current.addIceCandidate(
                      new RTCIceCandidate(message.data.candidate)
                    );
                  } else {
                    // remote description not set yet, queue the candidate
                    pendingIceCandidatesRef.current.push(
                      message.data.candidate
                    );
                  }
                }
              } catch (error) {
                console.error('error adding ice candidate:', error);
              }
            })();
          }
          break;

        case MessageType.DISCONNECT:
          // if the disconnected client was our rtc peer, close the connection
          if (
            message.clientId !== undefined &&
            message.clientId === targetClientIdRef.current
          ) {
            if (peerConnectionRef.current) {
              peerConnectionRef.current.close();
              peerConnectionRef.current = null;
            }
            targetClientIdRef.current = null;
            setRtcConnected(false);
            setRtcConnectionState(null);
          }
          break;

        default:
          console.log('received message:', message);
      }
    },
    [sendMessage, createPeerConnection, createOffer, selectedDeviceId]
  );

  // connect to websocket
  const connect = useCallback(() => {
    // clear any existing connection
    if (socketRef.current) {
      socketRef.current.close();
    }

    try {
      // create new websocket connection
      const socket = new WebSocket(url);
      socketRef.current = socket;

      // connection opened
      socket.onopen = () => {
        console.log('websocket connected');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttempts.current = 0;
      };

      // connection closed
      socket.onclose = (event: CloseEvent) => {
        console.log('websocket disconnected', event.code, event.reason);
        setIsConnected(false);

        // close rtc connection if exists
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
          setRtcConnected(false);
          setRtcConnectionState(null);
        }

        // attempt to reconnect if not closed cleanly
        if (
          !event.wasClean &&
          reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS
        ) {
          const delay =
            RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current);
          console.log(`attempting to reconnect in ${delay}ms...`);

          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectAttempts.current += 1;
            connect();
          }, delay);
        }
      };

      // connection error
      socket.onerror = (error: Event) => {
        console.error('websocket error:', error);
        setConnectionError('connection error');
      };

      // message received
      socket.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data) as Message;
          handleMessage(message);
        } catch (error) {
          console.error('error parsing message:', error);
        }
      };
    } catch (error) {
      console.error('error creating websocket:', error);
      setConnectionError('failed to connect');
    }
  }, [url, handleMessage]);

  // connect on mount, disconnect on unmount
  useEffect(() => {
    connect();

    // cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (socketRef.current) {
        socketRef.current.close();
      }

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);
  // LEAVE THIS DEPENDENCY EMPTY, IF YOU PUT CONNECT IT WILL MAKE WEBRTC FAIL

  // ping monitoring effect
  useEffect(() => {
    if (!peerConnectionRef.current || !rtcConnected) {
      setCurrentPing(null);
      setPingHistory([]);
      return;
    }

    const getPingStats = async () => {
      try {
        const stats = await peerConnectionRef.current?.getStats();
        if (!stats) return;

        // find the active candidate pair
        for (const [, stat] of stats) {
          if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
            const rtt = stat.currentRoundTripTime;
            if (rtt !== undefined) {
              const pingMs = Math.round(rtt * 1000); // convert to milliseconds
              setCurrentPing(pingMs);
              setPingHistory((prev) => {
                const newHistory = [...prev, pingMs];
                // keep only last 30 seconds of data
                return newHistory.slice(-30);
              });
            }
            break;
          }
        }
      } catch (error) {
        console.error('error getting ping stats:', error);
      }
    };

    // start polling ping stats every second
    const pingInterval = setInterval(getPingStats, 1000);

    return () => {
      clearInterval(pingInterval);
    };
  }, [rtcConnected]);

  return {
    isConnected,
    connectionError,
    currentUser,
    connectedUsers,
    sendMessage,
    rtcConnected,
    rtcConnectionState,
    rtcDataChannel,
    remoteStream,
    remoteGestureData,
    sendRtcData,
    replaceVideoTrack,
    currentPing,
    pingHistory,
  };
};
