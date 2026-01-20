import { WebSocket as WSWebSocket } from 'ws';

// message types for client-server communication
export enum MessageType {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  USER_LIST = 'user_list',
  RTC_OFFER = 'rtc_offer',
  RTC_ANSWER = 'rtc_answer',
  RTC_ICE_CANDIDATE = 'rtc_ice_candidate',
  INITIATE_RTC = 'initiate_rtc',
  ERROR = 'error',
  PING = 'ping',
  PONG = 'pong',

  // y-webrtc signaling message types
  PUBLISH = 'publish',
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',

  // video signaling message types
  CONNECTION = 'connection',
  JOIN_VIDEO_ROOM = 'join-video-room',
  LEAVE_VIDEO_ROOM = 'leave-video-room',
  EXISTING_PEERS = 'existing-peers',
  NEW_PEER = 'new-peer',
  PEER_LEFT = 'peer-left',
  VIDEO_OFFER = 'video-offer',
  VIDEO_ANSWER = 'video-answer',
  ICE_CANDIDATE = 'ice-candidate',
}

// user interface
export interface User {
  id: string;
  username: string;
}

// message data interface
export interface MessageData {
  id?: string;
  username?: string;
  users?: User[];
  message?: string;
  targetClientId?: number;
  shouldInitiate?: boolean;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;

  // for y-webrtc signaling
  topic?: string;

  // for video signaling
  roomId?: string;
  peerId?: string;
  peerIds?: string[];
}

// unified message interface
export interface Message {
  type: MessageType;
  clientId?: number;
  targetClientId?: number;
  sourceClientId?: number;
  data?: MessageData;

  // additional fields for y-webrtc
  topic?: string;

  // additional fields for video signaling
  roomId?: string;
  peerId?: string;
  peerIds?: string[];
}

// interface for connected clients
export interface ConnectedClient {
  id: number;
  ws: WSWebSocket;
}
