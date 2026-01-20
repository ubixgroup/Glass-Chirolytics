import { WebSocketServer, WebSocket } from 'ws';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { Message, MessageType, ConnectedClient } from '@/types/webTypes';
// port for the websocket server
const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 8080;
// ssl certificate paths - these should be set in environment variables
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './certificates/cert.pem';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './certificates/key.pem';

// maximum number of allowed clients
const MAX_CLIENTS = 2;

// connection types to distinguish between different websocket purposes
enum ConnectionType {
  VIDEO = 'video', // for webrtc video connections
  YJS = 'yjs', // for y-webrtc/yjs connections
  UNKNOWN = 'unknown', // default type
}

class GestARServer {
  private wss: WebSocketServer;
  private httpsServer: https.Server;
  private clients: Set<ConnectedClient> = new Set();
  private nextClientId = 1;

  // track client ip addresses to identify unique clients
  private clientIps = new Map<string, number>();

  // for y-webrtc signaling
  private rooms = new Map<string, Set<WebSocket>>();
  private topics = new Map<WebSocket, Set<string>>();

  // for webrtc video signaling
  private videoRooms = new Map<string, Set<WebSocket>>();
  private videoClients = new Map<string, WebSocket>();

  constructor() {
    // create https server with ssl certificates
    this.httpsServer = https.createServer({
      cert: fs.readFileSync(path.resolve(SSL_CERT_PATH)),
      key: fs.readFileSync(path.resolve(SSL_KEY_PATH)),
    });

    // create secure websocket server attached to https server
    this.wss = new WebSocketServer({ server: this.httpsServer });

    // start listening on the specified port
    this.httpsServer.listen(PORT, '0.0.0.0', () => {
      console.log(`secure websocket server running on port ${PORT}`);
    });

    // setup connection handler
    this.setupConnectionHandler();
  }

  // handle new connections
  private setupConnectionHandler(): void {
    // do this when connection attempt happens
    this.wss.on('connection', (ws: WebSocket, req) => {
      // log connection attempt with ip address
      const ip = req.socket.remoteAddress || 'unknown';
      const url = new URL(req.url || '', `https://${req.headers.host}`);

      // determine connection type from query parameter
      let connectionType = ConnectionType.UNKNOWN;
      if (url.searchParams.has('type')) {
        const type = url.searchParams.get('type');
        if (type === ConnectionType.YJS) {
          connectionType = ConnectionType.YJS;
        } else if (type === ConnectionType.VIDEO) {
          connectionType = ConnectionType.VIDEO;
        }
      }

      console.log(`[server] connection attempt from ${ip} (${connectionType})`);

      // handle y-webrtc connections differently
      if (connectionType === ConnectionType.YJS) {
        // initialize client's topics set for y-webrtc
        this.topics.set(ws, new Set());

        // handle messages from client
        ws.on('message', (message: string) => {
          try {
            const data = JSON.parse(message.toString()) as Message;
            this.handleYjsMessage(ws, data);
          } catch (error) {
            console.error('error processing y-webrtc message:', error);
          }
        });

        // handle client disconnect
        ws.on('close', () => {
          this.handleYjsDisconnect(ws);
        });

        return; // exit early, don't count YJS connections as clients
      }

      // create a client id to check for duplicate connections
      const clientId = this.nextClientId++;

      // check if max clients reached
      if (this.clients.size >= MAX_CLIENTS) {
        console.log(
          `[server] rejecting client connection: max clients (${MAX_CLIENTS}) reached`
        );
        this.sendToClient(ws, {
          type: MessageType.ERROR,
          data: { message: 'max clients reached' },
        });
        ws.close();
        return;
      }

      // create new client
      const client: ConnectedClient = {
        id: clientId,
        ws,
      };

      // assign a unique id for video signaling
      const videoClientId = Math.random().toString(36).substring(2, 15);
      this.videoClients.set(videoClientId, ws);

      // send the client its video client id
      this.sendToClient(ws, {
        type: MessageType.CONNECTION,
        data: { id: videoClientId },
      });

      // add to clients set
      this.clients.add(client);

      console.log(
        `[server] client ${clientId} connected. total clients: ${this.clients.size}`
      );

      // notify client of their id
      this.sendToClient(ws, {
        type: MessageType.CONNECT,
        clientId,
        data: {
          id: clientId.toString(),
          username: `user ${clientId}`,
        },
      });

      // broadcast updated client list
      this.broadcastClientList();

      // if we now have exactly 2 clients, initiate webrtc connection
      if (this.clients.size === MAX_CLIENTS) {
        console.log(
          '[server] two clients connected, initiating webrtc connection'
        );
        this.initiateWebRTCConnection();
      }

      // handle messages from client
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString()) as Message;
          this.handleClientMessage(client, data);
        } catch (error) {
          console.error('error processing message:', error);
        }
      });

      // handle client disconnect
      ws.on('close', () => {
        this.handleClientDisconnect(client);
      });
    });
  }

  // handle y-webrtc messages
  private handleYjsMessage(ws: WebSocket, message: Message): void {
    switch (message.type) {
      case MessageType.PUBLISH: {
        const { topic, data } = message;
        if (!topic) return;

        // add client to the room
        if (!this.rooms.has(topic)) {
          this.rooms.set(topic, new Set());
        }
        this.rooms.get(topic)!.add(ws);
        this.topics.get(ws)!.add(topic);

        // broadcast the message to all other clients in the room
        for (const roomClient of this.rooms.get(topic)!) {
          if (roomClient !== ws && roomClient.readyState === WebSocket.OPEN) {
            this.sendToClient(roomClient, {
              type: MessageType.PUBLISH,
              topic,
              data: data,
            });
          }
        }
        break;
      }

      case MessageType.SUBSCRIBE: {
        const subscribeTopic = message.topic;
        if (!subscribeTopic) return;

        // add client to the room
        if (!this.rooms.has(subscribeTopic)) {
          this.rooms.set(subscribeTopic, new Set());
        }
        this.rooms.get(subscribeTopic)!.add(ws);
        this.topics.get(ws)!.add(subscribeTopic);

        // acknowledge subscription
        this.sendToClient(ws, {
          type: MessageType.SUBSCRIBE,
          topic: subscribeTopic,
        });
        break;
      }

      case MessageType.UNSUBSCRIBE: {
        const unsubscribeTopic = message.topic;
        if (!unsubscribeTopic) return;

        // remove client from the room
        if (this.rooms.has(unsubscribeTopic)) {
          this.rooms.get(unsubscribeTopic)!.delete(ws);
        }
        this.topics.get(ws)!.delete(unsubscribeTopic);
        break;
      }

      case MessageType.PING:
        // respond to ping with pong for y-webrtc connections
        this.sendToClient(ws, { type: MessageType.PONG });
        break;

      default:
        console.log('received unhandled y-webrtc message:', message);
    }
  }

  // handle y-webrtc client disconnect
  private handleYjsDisconnect(ws: WebSocket): void {
    // clean up y-webrtc topics
    const clientTopics = this.topics.get(ws);
    if (clientTopics) {
      for (const topic of clientTopics) {
        if (this.rooms.has(topic)) {
          this.rooms.get(topic)!.delete(ws);
        }
      }
    }
    this.topics.delete(ws);
  }

  // initiate webrtc connection between the two clients
  private initiateWebRTCConnection(): void {
    // get the two clients
    const clients = Array.from(this.clients);
    if (clients.length !== 2) return;

    // tell the first client to initiate the connection
    this.sendToClient(clients[0].ws, {
      type: MessageType.INITIATE_RTC,
      data: {
        targetClientId: clients[1].id,
        shouldInitiate: true,
      },
    });

    // tell the second client to expect an offer
    this.sendToClient(clients[1].ws, {
      type: MessageType.INITIATE_RTC,
      data: {
        targetClientId: clients[0].id,
        shouldInitiate: false,
      },
    });
  }

  // handle messages from clients
  private handleClientMessage(client: ConnectedClient, message: Message): void {
    const ws = client.ws;

    // handle different message types
    switch (message.type) {
      case MessageType.RTC_OFFER:
      case MessageType.RTC_ANSWER:
      case MessageType.RTC_ICE_CANDIDATE:
        if (message.targetClientId) {
          const targetClient = Array.from(this.clients).find(
            (c) => c.id === message.targetClientId
          );
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            this.sendToClient(targetClient.ws, {
              ...message,
              sourceClientId: client.id,
            });
          }
        }
        break;

      case MessageType.JOIN_VIDEO_ROOM: {
        const roomId = message.roomId;
        if (!roomId) return;

        // create room if it doesn't exist
        if (!this.videoRooms.has(roomId)) {
          this.videoRooms.set(roomId, new Set());
        }

        const room = this.videoRooms.get(roomId)!;

        // add this client to the room
        room.add(ws);

        // find this client's video id
        let videoId = '';
        for (const [id, socket] of this.videoClients.entries()) {
          if (socket === ws) {
            videoId = id;
            break;
          }
        }

        // notify this client about existing peers
        const peers = Array.from(room).filter((peer) => peer !== ws);
        if (peers.length > 0) {
          this.sendToClient(ws, {
            type: MessageType.EXISTING_PEERS,
            peerIds: Array.from(peers)
              .map((peer) => {
                // find clientId for this peer
                for (const [id, socket] of this.videoClients.entries()) {
                  if (socket === peer) return id;
                }
                return null;
              })
              .filter(Boolean) as string[],
          });
        }

        // notify room that a new peer joined
        for (const roomClient of room) {
          if (roomClient !== ws && roomClient.readyState === WebSocket.OPEN) {
            this.sendToClient(roomClient, {
              type: MessageType.NEW_PEER,
              peerId: videoId,
            });
          }
        }
        break;
      }

      case MessageType.LEAVE_VIDEO_ROOM: {
        const leaveRoomId = message.roomId;
        if (!leaveRoomId) return;

        if (this.videoRooms.has(leaveRoomId)) {
          const leaveRoom = this.videoRooms.get(leaveRoomId)!;
          leaveRoom.delete(ws);

          // find client's video id
          let leaveVideoId = '';
          for (const [id, socket] of this.videoClients.entries()) {
            if (socket === ws) {
              leaveVideoId = id;
              break;
            }
          }

          // notify others that peer left
          for (const roomClient of leaveRoom) {
            if (roomClient.readyState === WebSocket.OPEN) {
              this.sendToClient(roomClient, {
                type: MessageType.PEER_LEFT,
                peerId: leaveVideoId,
              });
            }
          }
        }
        break;
      }

      case MessageType.VIDEO_OFFER:
      case MessageType.VIDEO_ANSWER:
      case MessageType.ICE_CANDIDATE: {
        // forward these messages to the specific peer
        const { peerId } = message;
        if (!peerId) return;

        const targetPeer = this.videoClients.get(peerId);

        // find sender's video id
        let senderVideoId = '';
        for (const [id, socket] of this.videoClients.entries()) {
          if (socket === ws) {
            senderVideoId = id;
            break;
          }
        }

        if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
          this.sendToClient(targetPeer, {
            type: message.type,
            peerId: senderVideoId, // who the message is from
            data: message.data,
          });
        }
        break;
      }

      default:
        console.log(
          `[server] received message from client ${client.id}:`,
          message
        );
    }
  }

  // handle client disconnect
  private handleClientDisconnect(client: ConnectedClient): void {
    const ws = client.ws;

    // remove from clients collection
    this.clients.delete(client);
    console.log(
      `[server] client ${client.id} disconnected. total clients: ${this.clients.size}`
    );

    // notify remaining clients about the disconnection
    this.broadcast({
      type: MessageType.DISCONNECT,
      clientId: client.id,
    });

    // broadcast updated client list
    this.broadcastClientList();

    // clean up video rooms
    // find client's video id
    let videoId = '';
    for (const [id, socket] of this.videoClients.entries()) {
      if (socket === ws) {
        videoId = id;
        this.videoClients.delete(id);
        break;
      }
    }

    // notify all video rooms that this client left
    for (const room of this.videoRooms.values()) {
      if (room.has(ws)) {
        room.delete(ws);

        // notify others in room
        for (const roomClient of room) {
          if (roomClient.readyState === WebSocket.OPEN) {
            this.sendToClient(roomClient, {
              type: MessageType.PEER_LEFT,
              peerId: videoId,
            });
          }
        }
      }
    }
  }

  // send message to specific client
  private sendToClient(ws: WebSocket, message: Message): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // broadcast message to all clients
  private broadcast(message: Message): void {
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(client.ws, message);
      }
    });
  }

  // broadcast current client list to all clients
  private broadcastClientList(): void {
    const clientList = Array.from(this.clients).map((client) => ({
      id: client.id.toString(),
      username: `user ${client.id}`,
    }));

    this.broadcast({
      type: MessageType.USER_LIST,
      data: { users: clientList },
    });
  }

  // stop the server
  public stop(): void {
    this.wss.close();
    this.httpsServer.close();
    console.log('secure websocket server stopped');
  }
}

// create and export server instance
const server = new GestARServer();

// handle process termination
process.on('SIGINT', () => {
  server.stop();
  process.exit();
});

export default server;
