# Glass Chirolytics

Please use a Chromium-based browser (performance/compatibility), preferably Google Chrome.

## Getting Started

### Install required packages

```sh
npm install
```

### Generate the locally-trusted certificates (requires mkcert and this script has Unix-specific commands)

```sh
./gencert.sh
```

### Starting the WebSocket server

```sh
npm run server
```

You can stop the server by pressing `Ctrl+C` in the terminal. The server will shut down by closing all active WebSocket connections before exiting.

### Starting the client dev server

```sh
npm run dev
```



You can stop the client dev server by pressing `q` in the terminal.

> Once the application is running, you may need to grant webcam access under your browsers settings. Otherwise the webcam feed may be empty.

### Creating a two-person experience

Both participants need the WebSocket server and client dev server running on the host machine (see above). Each person opens the app in their browser using the host machine's **network IP address** (e.g. `https://172.x.x.x:5173`), not `localhost` or `127.0.0.1`. The network IP is printed when you run `./gencert.sh`.

On each browser, expand the mini-panel in the bottom-right corner and confirm:

- **websocket** shows **connected**

If websocket stays disconnected, double-check that both people are using the same network IP URL and that the WebSocket server is running.

## WebSocket Connection

The application automatically establishes a secure WebSocket connection. The connection URL is dynamically determined based on your current browsing context:

- Protocol: Matches your current protocol (`wss://` for HTTPS, `ws://` for HTTP)
- Host: Uses your current hostname
- Port: Uses port 8080 by default (configurable via environment variable WS_PORT)

For example, when developing locally, it would connect to `wss://localhost:8080`.

## Code Structure (src)

```sh
src
|
+-- app               # contains main application component
|
+-- assets            # contains datasets and gesture recongition models
|
+-- components        # shared components used across the entire application
|
+-- context           # context is used as entry point for y-webrtc
|
+-- hooks             # shared hooks used across the entire application
|
+-- server            # websocket server implementation
|
+-- types             # shared types used across the application
|
+-- utils             # shared utility functions
```
