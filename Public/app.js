"use strict";

const socket = io();
const $ = selector => document.querySelector(selector);

const lobby = $("#lobby");
const chatView = $("#chat-view");
const connectionLabel = $("#connection-label");
const roomsList = $("#rooms-list");
const messagesEl = $("#messages");
const messageInput = $("#message-input");
const toastEl = $("#toast");

let currentRoom = null;
let currentUsername = "";
let knownMessages = [];
let toastTimer = null;
let configuredTtlMinutes = 60;
let messageLimit = 100;

$("#year").textContent = String(new Date().getFullYear());

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

function showLobby() {
  lobby.classList.remove("hidden");
  chatView.classList.add("hidden");
  currentRoom = null;
  knownMessages = [];
  socket.emit("rooms:list");
  messagesEl.replaceChildren();
}

function showChat(room, messages, members, ttlMinutes, limit) {
  currentRoom = room;
  configuredTtlMinutes = ttlMinutes || configuredTtlMinutes;
  messageLimit = limit || messageLimit;
  lobby.classList.add("hidden");
  chatView.classList.remove("hidden");
  $("#sidebar-room-name").textContent = room.name;
  $("#sidebar-room-code").textContent = room.code;
  $("#chat-room-title").textContent = room.name;
  $("#header-room-code").textContent = room.code;
  $("#expiry-label").textContent = `MESSAGES EXPIRE AFTER ${configuredTtlMinutes} MIN`;
  renderMessages(messages || []);
  renderMembers(members || []);
  messageInput.focus();
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderMessages(messages) {
  const shouldStick = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
  knownMessages = messages;
  const fragment = document.createDocumentFragment();

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "system-message";
    const span = document.createElement("span");
    span.textContent = "You're early. Start the conversation.";
    empty.append(span);
    fragment.append(empty);
  }

  for (const msg of messages) {
    if (msg.system) {
      const row = document.createElement("div");
      row.className = "system-message";
      const span = document.createElement("span");
      span.textContent = msg.text;
      row.append(span);
      fragment.append(row);
      continue;
    }
    const row = document.createElement("article");
    row.className = "message";
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = (msg.username || "?").slice(0, 1).toUpperCase();
    const content = document.createElement("div");
    content.className = "message-content";
    const head = document.createElement("div");
    head.className = "message-head";
    const user = document.createElement("span");
    user.className = "message-user" + (msg.username === currentUsername ? " own" : "");
    user.textContent = msg.username || "guest";
    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(msg.createdAt);
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = msg.text;
    head.append(user, time);
    content.append(head, text);
    row.append(avatar, content);
    fragment.append(row);
  }

  messagesEl.replaceChildren(fragment);
  $("#message-count").textContent = `${messages.length} / ${messageLimit}`;
  if (shouldStick) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMembers(members) {
  $("#member-count").textContent = String(members.length);
  const list = $("#members-list");
  const fragment = document.createDocumentFragment();
  for (const member of members) {
    const row = document.createElement("div");
    row.className = "member";
    const avatar = document.createElement("div");
    avatar.className = "member-avatar";
    avatar.textContent = (member.username || "?").slice(0, 1).toUpperCase();
    const name = document.createElement("span");
    name.className = "member-name" + (member.username === currentUsername ? " me" : "");
    name.textContent = member.username + (member.username === currentUsername ? " (you)" : "");
    row.append(avatar, name);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function renderRooms(rooms) {
  if (!rooms.length) {
    roomsList.innerHTML = '<div class="empty-rooms">No active rooms right now. Create one and invite someone in.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const room of rooms) {
    const card = document.createElement("article");
    card.className = "room-card";
    const top = document.createElement("div");
    top.className = "room-card-top";
    const icon = document.createElement("div");
    icon.className = "room-card-icon";
    icon.textContent = "#";
    const details = document.createElement("div");
    details.style.minWidth = "0";
    const name = document.createElement("div");
    name.className = "room-card-name";
    name.textContent = room.name;
    const code = document.createElement("div");
    code.className = "room-card-code";
    code.textContent = room.code;
    details.append(name, code);
    top.append(icon, details);
    const bottom = document.createElement("div");
    bottom.className = "room-card-bottom";
    const people = document.createElement("span");
    people.className = "room-people";
    people.textContent = `${room.memberCount} online`;
    const join = document.createElement("button");
    join.className = "room-join";
    join.type = "button";
    join.textContent = "JOIN →";
    join.addEventListener("click", () => {
      const username = prompt("Choose a username (2–24 characters):");
      if (!username) return;
      currentUsername = username.trim().slice(0, 24);
      socket.emit("room:join", { username: currentUsername, code: room.code });
    });
    bottom.append(people, join);
    card.append(top, bottom);
    fragment.append(card);
  }
  roomsList.replaceChildren(fragment);
}

$("#create-form").addEventListener("submit", event => {
  event.preventDefault();
  const username = $("#create-username").value.trim();
  const name = $("#room-name").value.trim();
  currentUsername = username;
  socket.emit("room:create", { username, name });
});

$("#join-form").addEventListener("submit", event => {
  event.preventDefault();
  const username = $("#join-username").value.trim();
  const code = $("#room-code").value.trim().toUpperCase();
  currentUsername = username;
  socket.emit("room:join", { username, code });
});

$("#room-code").addEventListener("input", event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
});

$("#message-form").addEventListener("submit", event => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !currentRoom) return;
  socket.emit("message:send", { text });
  messageInput.value = "";
  messageInput.focus();
});

$("#leave-room").addEventListener("click", () => {
  socket.emit("room:leave");
  showLobby();
});

$("#refresh-rooms").addEventListener("click", () => socket.emit("rooms:list"));

$("#copy-code").addEventListener("click", async () => {
  if (!currentRoom) return;
  try {
    await navigator.clipboard.writeText(currentRoom.code);
    $("#copy-label").textContent = "COPIED ✓";
    setTimeout(() => { $("#copy-label").textContent = "COPY ↗"; }, 1500);
  } catch {
    toast(`Room code: ${currentRoom.code}`);
  }
});

socket.on("connect", () => {
  connectionLabel.textContent = "CONNECTED";
  socket.emit("rooms:list");
});

socket.on("disconnect", () => {
  connectionLabel.textContent = "RECONNECTING";
  toast("Connection lost. Reconnecting…", true);
});

socket.on("connect_error", () => {
  connectionLabel.textContent = "OFFLINE";
});

socket.on("server:config", config => {
  configuredTtlMinutes = config.ttlMinutes || 60;
  messageLimit = config.messageLimit || 100;
  document.querySelector(".rules-row").children[1].lastElementChild.textContent = `Auto-expire in ${configuredTtlMinutes} min`;
});

socket.on("rooms:list", renderRooms);

socket.on("room:joined", data => {
  showChat(data.room, data.messages, data.members, data.ttlMinutes, data.messageLimit);
  toast(`You're in ${data.room.name}`);
});

socket.on("messages:sync", messages => {
  if (currentRoom) renderMessages(messages);
});

socket.on("room:presence", data => {
  if (!currentRoom) {
    socket.emit("rooms:list");
    return;
  }
  renderMembers(data.members || []);
  $("#message-count").textContent = `${data.messageCount} / ${messageLimit}`;
});

socket.on("system:notice", notice => {
  if (!currentRoom) return;
  const current = knownMessages.filter(message => !message.system);
  // Show presence notices locally; they are not retained as chat history.
  renderMessages([...current, { ...notice, system: true }]);
  setTimeout(() => {
    if (currentRoom) renderMessages(knownMessages.filter(message => !message.system));
  }, 3500);
});

socket.on("app:error", error => toast(error.message || "Something went wrong.", true));

window.addEventListener("beforeunload", () => {
  // The server also removes the member on disconnect.
});

socket.emit("rooms:list");
