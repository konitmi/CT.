"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const MESSAGE_LIMIT = 100;
const MESSAGE_TTL_MS = Math.max(60_000, Number(process.env.MESSAGE_TTL_MINUTES || 60) * 60_000);
const ROOM_EMPTY_TTL_MS = 30 * 60_000;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_ROOM_NAME_LENGTH = 40;
const MAX_USERNAME_LENGTH = 24;
const ROOM_CODE_LENGTH = 6;

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "Public"), {
  etag: true,
  maxAge: "1h"
}));

app.get("/health", (_req, res) => res.json({ ok: true, service: "CT", storage: "in-memory-only" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 20000
});

// Nothing here is written to a database or file. A process restart clears all rooms/messages.
const rooms = new Map();
const socketState = new Map();
const messageTimes = new Map();

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function normaliseRoomName(value) {
  return cleanText(value, MAX_ROOM_NAME_LENGTH).replace(/\s+/g, " ");
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getRoom(code) {
  if (typeof code !== "string") return null;
  return rooms.get(code.toUpperCase()) || null;
}

function activeMembers(room) {
  return [...room.members.values()].map(({ id, username }) => ({ id, username }));
}

function roomSummary(room) {
  return {
    code: room.code,
    name: room.name,
    memberCount: room.members.size,
    messageCount: room.messages.length
  };
}

function broadcastRoomList() {
  const activeRooms = [...rooms.values()]
    .filter(room => room.members.size > 0)
    .sort((a, b) => b.members.size - a.members.size)
    .slice(0, 50)
    .map(roomSummary);
  io.emit("rooms:list", activeRooms);
}

function emitRoomState(room) {
  io.to(room.code).emit("room:presence", {
    members: activeMembers(room),
    memberCount: room.members.size,
    messageCount: room.messages.length
  });
}

function emitMessages(room) {
  io.to(room.code).emit("messages:sync", room.messages);
}

function pruneRoom(room, now = Date.now()) {
  const before = room.messages.length;
  room.messages = room.messages.filter(message => now - message.createdAt < MESSAGE_TTL_MS);
  if (room.messages.length !== before) emitMessages(room);
}

function removeMember(socket, { announce = true } = {}) {
  const state = socketState.get(socket.id);
  if (!state) return;

  const room = rooms.get(state.roomCode);
  socketState.delete(socket.id);
  messageTimes.delete(socket.id);

  if (!room) return;
  room.members.delete(socket.id);
  socket.leave(room.code);

  if (announce) {
    io.to(room.code).emit("system:notice", {
      id: makeId(),
      text: `${state.username} left the room`,
      createdAt: Date.now()
    });
  }
  emitRoomState(room);

  if (room.members.size === 0) {
    room.emptySince = Date.now();
  }
  broadcastRoomList();
}

function rateAllowed(socket) {
  const now = Date.now();
  const times = (messageTimes.get(socket.id) || []).filter(time => now - time < 10_000);
  if (times.length >= 8) {
    messageTimes.set(socket.id, times);
    return false;
  }
  times.push(now);
  messageTimes.set(socket.id, times);
  return true;
}

function sendError(socket, message) {
  socket.emit("app:error", { message });
}

io.on("connection", socket => {
  socket.emit("server:config", {
    messageLimit: MESSAGE_LIMIT,
    ttlMinutes: Math.round(MESSAGE_TTL_MS / 60_000)
  });

  socket.on("rooms:list", () => {
    socket.emit("rooms:list", [...rooms.values()]
      .filter(room => room.members.size > 0)
      .sort((a, b) => b.members.size - a.members.size)
      .slice(0, 50)
      .map(roomSummary));
  });

  socket.on("room:create", payload => {
    if (socketState.has(socket.id)) removeMember(socket);

    const username = cleanText(payload && payload.username, MAX_USERNAME_LENGTH);
    const name = normaliseRoomName(payload && payload.name);
    if (username.length < 2) return sendError(socket, "Choose a username with at least 2 characters.");
    if (name.length < 2) return sendError(socket, "Room name must have at least 2 characters.");

    const code = makeRoomCode();
    const room = {
      code,
      name,
      members: new Map(),
      messages: [],
      createdAt: Date.now(),
      emptySince: null
    };
    rooms.set(code, room);
    joinRoom(socket, room, username);
    broadcastRoomList();
  });

  socket.on("room:join", payload => {
    if (socketState.has(socket.id)) removeMember(socket);

    const username = cleanText(payload && payload.username, MAX_USERNAME_LENGTH);
    const code = cleanText(payload && payload.code, ROOM_CODE_LENGTH).toUpperCase();
    if (username.length < 2) return sendError(socket, "Choose a username with at least 2 characters.");
    if (!/^[A-Z2-9]{6}$/.test(code)) return sendError(socket, "Enter a valid 6-character room code.");

    const room = getRoom(code);
    if (!room) return sendError(socket, "That room doesn't exist anymore. It may have expired or the server may have restarted.");
    joinRoom(socket, room, username);
  });

  socket.on("message:send", payload => {
    const state = socketState.get(socket.id);
    if (!state) return sendError(socket, "Join a room before sending messages.");

    const room = getRoom(state.roomCode);
    if (!room) {
      removeMember(socket, { announce: false });
      return sendError(socket, "This room no longer exists. Please join another room.");
    }

    const text = cleanText(payload && payload.text, MAX_MESSAGE_LENGTH);
    if (!text) return;
    if (!rateAllowed(socket)) return sendError(socket, "You're sending messages too quickly. Please wait a moment.");

    pruneRoom(room);
    const message = {
      id: makeId(),
      username: state.username,
      text,
      createdAt: Date.now()
    };
    room.messages.push(message);

    // The room only keeps the newest 100 messages in RAM.
    if (room.messages.length > MESSAGE_LIMIT) {
      room.messages.splice(0, room.messages.length - MESSAGE_LIMIT);
    }

    emitMessages(room);
    emitRoomState(room);
  });

  socket.on("room:leave", () => removeMember(socket));
  socket.on("disconnect", () => removeMember(socket));
});

function joinRoom(socket, room, username) {
  const safeUsername = username;
  room.emptySince = null;
  room.members.set(socket.id, { id: socket.id, username: safeUsername });
  socketState.set(socket.id, { roomCode: room.code, username: safeUsername });
  socket.join(room.code);

  pruneRoom(room);
  socket.emit("room:joined", {
    room: roomSummary(room),
    messages: room.messages,
    members: activeMembers(room),
    ttlMinutes: Math.round(MESSAGE_TTL_MS / 60_000),
    messageLimit: MESSAGE_LIMIT
  });

  socket.to(room.code).emit("system:notice", {
    id: makeId(),
    text: `${safeUsername} joined the room`,
    createdAt: Date.now()
  });
  emitRoomState(room);
  broadcastRoomList();
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    pruneRoom(room, now);
    if (room.members.size === 0 && room.emptySince && now - room.emptySince > ROOM_EMPTY_TTL_MS) {
      rooms.delete(code);
      broadcastRoomList();
    }
  }
}, 15_000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CT is running on port ${PORT}`);
});
