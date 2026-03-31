const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT_DIR = path.resolve(__dirname, "../public");
const API_BASE = "/api/bit-planes";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ROOM_TTL_MS = 1000 * 60 * 60 * 2;
const MAX_PLAYERS = 4;

const rooms = new Map();

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    pruneRooms();

    if (request.method === "OPTIONS") {
        writeCorsHeaders(response);
        response.writeHead(204);
        response.end();
        return;
    }

    if (request.method === "GET" && url.pathname === `${API_BASE}/health`) {
        writeJson(response, 200, {
            ok: true,
            now: Date.now(),
            rooms: rooms.size,
        });
        return;
    }

    const roomMatch = url.pathname.match(/^\/api\/bit-planes\/rooms\/([A-Z0-9]{1,12})(?:\/(events|state))?$/);
    if (roomMatch) {
        const roomCode = roomMatch[1];
        const endpoint = roomMatch[2] || "state";

        if (endpoint === "events" && request.method === "GET") {
            handleRoomEvents(request, response, roomCode, url.searchParams.get("playerId"));
            return;
        }

        if (endpoint === "events" && request.method === "POST") {
            readJson(request, response, (payload) => {
                handleRoomEventPost(response, roomCode, payload);
            });
            return;
        }

        if (endpoint === "state" && request.method === "GET") {
            handleRoomStateGet(response, roomCode);
            return;
        }
    }

    if (request.method === "GET" || request.method === "HEAD") {
        serveStaticFile(url.pathname, response, request.method === "HEAD");
        return;
    }

    writeJson(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
    console.log(`Bit-Planes multiplayer server running on http://${HOST}:${PORT}/bit-planes/index.html`);
});

function handleRoomEvents(request, response, roomCode, playerId) {
    const room = getRoom(roomCode);

    writeCorsHeaders(response);
    response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    response.write("\n");

    const subscriber = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        playerId: playerId || null,
        response,
    };

    room.subscribers.add(subscriber);
    room.lastTouchedAt = Date.now();

    sendSse(response, {
        type: "connected",
        roomCode,
        playerId: subscriber.playerId,
    });

    if (room.state) {
        sendSse(response, {
            type: "room-state",
            roomCode,
            state: room.state,
        });
    }

    const keepAlive = setInterval(() => {
        response.write(": keep-alive\n\n");
    }, 15000);

    request.on("close", () => {
        clearInterval(keepAlive);
        room.subscribers.delete(subscriber);
        room.lastTouchedAt = Date.now();
    });
}

function handleRoomEventPost(response, roomCode, payload) {
    if (!payload || typeof payload !== "object" || typeof payload.type !== "string") {
        writeJson(response, 400, { error: "Invalid event payload" });
        return;
    }

    const room = getRoom(roomCode);
    const event = {
        playerId: typeof payload.playerId === "string" ? payload.playerId : null,
        roomCode,
        selectedMode: typeof payload.selectedMode === "string" ? payload.selectedMode : null,
        state: payload.state || null,
        player: payload.player || null,
        timestamp: Date.now(),
        type: payload.type,
    };

    if (event.type === "room-state" && event.state) {
        const validationError = validateRoomState(event.state, roomCode);
        if (validationError) {
            writeJson(response, 400, { error: validationError });
            return;
        }
        room.state = event.state;
    }

    room.lastTouchedAt = Date.now();
    broadcast(room, event);
    writeJson(response, 202, { ok: true });
}

function handleRoomStateGet(response, roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.state) {
        writeJson(response, 404, { error: "Room not found" });
        return;
    }

    room.lastTouchedAt = Date.now();
    writeJson(response, 200, { ok: true, state: room.state });
}

function serveStaticFile(requestPath, response, isHeadRequest) {
    const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
    const filePath = path.resolve(ROOT_DIR, `.${normalizedPath}`);

    if (!filePath.startsWith(ROOT_DIR)) {
        writeJson(response, 403, { error: "Forbidden" });
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
            writeJson(response, 404, { error: "File not found" });
            return;
        }

        const extension = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[extension] || "application/octet-stream";
        writeCorsHeaders(response);
        response.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": stats.size,
        });

        if (isHeadRequest) {
            response.end();
            return;
        }

        fs.createReadStream(filePath).pipe(response);
    });
}

function getRoom(roomCode) {
    let room = rooms.get(roomCode);
    if (!room) {
        room = {
            state: null,
            subscribers: new Set(),
            createdAt: Date.now(),
            lastTouchedAt: Date.now(),
        };
        rooms.set(roomCode, room);
    }
    return room;
}

function broadcast(room, event) {
    for (const subscriber of room.subscribers) {
        sendSse(subscriber.response, event);
    }
}

function sendSse(response, payload) {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function validateRoomState(state, roomCode) {
    if (!state || typeof state !== "object") {
        return "Room state must be an object";
    }
    if (state.roomCode !== roomCode) {
        return "Room code mismatch";
    }
    if (!Array.isArray(state.players)) {
        return "Room players must be an array";
    }
    if (state.players.length > MAX_PLAYERS) {
        return "Room exceeds max players";
    }
    return null;
}

function pruneRooms() {
    const now = Date.now();
    for (const [roomCode, room] of rooms.entries()) {
        if (room.subscribers.size > 0) {
            continue;
        }
        if (now - room.lastTouchedAt > ROOM_TTL_MS) {
            rooms.delete(roomCode);
        }
    }
}

function readJson(request, response, onSuccess) {
    let body = "";
    request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
            request.destroy();
        }
    });
    request.on("end", () => {
        try {
            const parsed = body ? JSON.parse(body) : {};
            onSuccess(parsed);
        } catch (error) {
            writeJson(response, 400, { error: "Invalid JSON payload" });
        }
    });
}

function writeJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    writeCorsHeaders(response);
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
}

function writeCorsHeaders(response) {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS");
}
