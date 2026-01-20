// use default websocket url
function getWebsocketUrl(): string {
  // get the current host from the window location
  const host = window.location.hostname;
  // use the same protocol as the current page (wss for https, ws for http)
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // use port 8080 by default
  const port = '8080';
  console.log(`${protocol}://${host}:${port}`);
  return `${protocol}://${host}:${port}`;
}

export default getWebsocketUrl;
