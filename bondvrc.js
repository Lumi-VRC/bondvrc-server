// Minimal WebSocket relay for VRC Bond.
// - Accepts clients that send JSON with { type, bond_code, session_id }.
// - When a client sends { type: "sending_true" }, all other sessions with the
//   same bond_code get a { type: "peer_ping", bond_code, from_session }.
// - Connection tracking is in-memory; restart clears state.
//
// Usage:
//   npm install ws
//   npm install nodejs
//   node bondvrc.js
//   (or manage with pm2 / systemd)



// simply expose a websocket port via nginx or some other acceptable method. This listens for connections on that port.
// I rate limited mine at the nginx level, but it's probably smarter to rate limit here as well. Feel free to adapt my code as you see fit.

// User touches necklace -> flips sending bool -> osc app detects it and pings server with the bond code and unique session id generated upon program start
// Then, it forwards that ping to identical bond codes with different session ids.
// Upon receiving that ping, the client app will flip the receiving bool, which activates the avatar effects!

const { WebSocketServer } = require("ws");

const PORT = 6666;

const wss = new WebSocketServer({ port: PORT });

console.log(`[bondvrc] Listening on ws://0.0.0.0:${PORT}`);

// Track clients by session and bond_code.
const clients = new Map(); // session_id -> { ws, bond_code }

wss.on("connection", (ws, req) => {
  const peer = req.socket.remoteAddress;
  console.log(`[bondvrc] client connected from ${peer}`);

  ws.on("message", (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch (err) {
      console.log(`[bondvrc] non-JSON message from ${peer}: ${data}`);
      return;
    }
    const session_id = payload?.session_id;
    const bond_code = payload?.bond_code;
    const type = payload?.type || "unknown";
    const sidLabel = session_id ? ` session=${session_id}` : "";

    if (bond_code && session_id) {
      // Update registry
      clients.set(session_id, { ws, bond_code });
      console.log(`[bondvrc] bond_code=${bond_code}${sidLabel} type=${type}`);

      if (type === "sending_true") {
        // Fan out a peer ping to all OTHER sessions on the same bond_code.
        for (const [sid, info] of clients.entries()) {
          if (sid === session_id) continue;
          if (info.bond_code === bond_code && info.ws.readyState === info.ws.OPEN) {
            try {
              info.ws.send(
                JSON.stringify({
                  type: "peer_ping", //keepalive ping for ws
                  bond_code,
                  from_session: session_id,
                })
              );
              console.log(`[bondvrc] pinged session=${sid} for bond_code=${bond_code}`);
            } catch (e) {
              console.log(`[bondvrc] failed to ping session=${sid}: ${e}`);
            }
          }
        }
      }
    } else {
      console.log(`[bondvrc] message from ${peer}:`, payload);
    }
  });

  ws.on("close", () => {
    console.log(`[bondvrc] client disconnected ${peer}`);
    // Remove this ws from registry.
    for (const [sid, info] of clients.entries()) {
      if (info.ws === ws) {
        clients.delete(sid);
      }
    }
  });
});

