(function () {
    const ROOM_PARAM = "room";
    const ROOM_STATE_PREFIX = "bitplanes-room-state:";
    const PLAYER_ID_KEY = "bitplanes-session-player-id";
    const PRESENCE_TIMEOUT_MS = 7000;
    const HEARTBEAT_MS = 2000;
    const MAX_PLAYERS = 4;
    const MIN_PLAYERS = 2;
    const API_BASE = getApiBase();

    const form = document.getElementById("game");
    const panel = document.getElementById("multiplayer-panel");
    const nicknameInput = document.querySelector('input[name="nickname"]');

    if (!form || !panel || !nicknameInput) {
        return;
    }

    const ui = {
        arrival: document.getElementById("multiplayer-arrival"),
        arrivalRoomCode: document.getElementById("arrival-room-code"),
        transportPill: document.getElementById("transport-pill"),
        playerCountPill: document.getElementById("player-count-pill"),
        createRoomButton: document.getElementById("create-room-button"),
        joinRoomButton: document.getElementById("join-room-button"),
        roomCodeInput: document.getElementById("room-code-input"),
        status: document.getElementById("multiplayer-status"),
        feedback: document.getElementById("multiplayer-feedback"),
        lobby: document.getElementById("multiplayer-lobby"),
        roomCodeDisplay: document.getElementById("room-code-display"),
        roomLinkDisplay: document.getElementById("room-link-display"),
        roomModeDisplay: document.getElementById("room-mode-display"),
        copyRoomCodeButton: document.getElementById("copy-room-code-button"),
        copyRoomLinkButton: document.getElementById("copy-room-link-button"),
        toggleReadyButton: document.getElementById("toggle-ready-button"),
        startRoomButton: document.getElementById("start-room-button"),
        startRoomHint: document.getElementById("start-room-hint"),
        leaveRoomButton: document.getElementById("leave-room-button"),
        rosterSummary: document.getElementById("roster-summary"),
        playerList: document.getElementById("room-player-list"),
    };

    const self = {
        id: getOrCreatePlayerId(),
        ready: false,
    };

    const transport = {
        apiBase: API_BASE,
        channel: null,
        eventSource: null,
        mode: "unknown",
        roomCode: null,
    };

    let state = null;
    let hostIntervalId = null;
    let heartbeatIntervalId = null;
    let started = false;
    let transportAvailabilityPromise = null;
    let joinInFlight = false;
    let createInFlight = false;
    let sseRetryCount = 0;
    const SSE_MAX_RETRIES = 5;

    bindEvents();
    syncRoomFromUrl();
    render();

    function bindEvents() {
        ui.createRoomButton.addEventListener("click", function () {
            createRoom();
        });
        ui.joinRoomButton.addEventListener("click", function () {
            joinRoomFromInput();
        });
        ui.copyRoomCodeButton.addEventListener("click", function () {
            if (state) {
                copyText(state.roomCode, "Room code copied.");
            }
        });
        ui.copyRoomLinkButton.addEventListener("click", function () {
            if (state) {
                copyText(getRoomUrl(state.roomCode), "Room link copied.");
            }
        });
        ui.toggleReadyButton.addEventListener("click", function () {
            toggleReady();
        });
        ui.startRoomButton.addEventListener("click", function () {
            startRoomMatch();
        });
        ui.leaveRoomButton.addEventListener("click", function () {
            leaveRoom();
        });
        ui.roomCodeInput.addEventListener("input", function () {
            ui.roomCodeInput.value = sanitizeRoomCode(ui.roomCodeInput.value);
        });
        nicknameInput.addEventListener("change", announcePresence);
        nicknameInput.addEventListener("keyup", announcePresence);
        document.querySelectorAll('input[name="mode"]').forEach(function (input) {
            input.addEventListener("change", function () {
                if (isHost()) {
                    mutateState(function (draft) {
                        draft.selectedMode = getSelectedMode();
                    });
                }
            });
        });
        window.addEventListener("storage", function (event) {
            if (!state || transport.mode !== "local") {
                return;
            }
            if (event.key !== getRoomStorageKey(state.roomCode) || !event.newValue) {
                return;
            }
            const nextState = parseState(event.newValue);
            if (nextState) {
                state = nextState;
                syncSelfFromState();
                render();
            }
        });
        window.addEventListener("beforeunload", function () {
            leaveRoom({ silent: true });
        });
    }

    async function createRoom() {
        if (createInFlight) {
            return;
        }
        const nickname = getNickname();
        if (!nickname) {
            flagNicknameInvalid();
            setStatus("Pick a nickname before creating a room.");
            nicknameInput.focus();
            return;
        }

        clearNicknameInvalid();
        createInFlight = true;
        clearFeedback();
        setStatus("Creating room...");
        render();

        try {
            const roomCode = generateRoomCode();
            await connectToRoom(roomCode);
            self.ready = true;
            started = false;
            state = {
                roomCode: roomCode,
                hostId: self.id,
                createdAt: Date.now(),
                selectedMode: getSelectedMode(),
                players: [createPlayerRecord(self.id, nickname, true)],
            };

            persistRoomSnapshot(state);
            await persistAndBroadcastState();
            startHostLoop();
            startHeartbeatLoop();
            updateRoomUrl(state.roomCode);
            setStatus("Room created. Share the code or link, then start when everyone is in.");
            setFeedback("Room " + state.roomCode + " is ready to share.");
        } finally {
            createInFlight = false;
            render();
        }
    }

    function joinRoomFromInput() {
        const roomCode = sanitizeRoomCode(ui.roomCodeInput.value);
        if (!roomCode) {
            setStatus("Enter a room code to join.");
            return;
        }
        joinRoom(roomCode);
    }

    async function joinRoom(roomCode) {
        if (joinInFlight) {
            return;
        }
        const nickname = getNickname();
        if (!nickname) {
            flagNicknameInvalid();
            setStatus("Pick a nickname before joining a room.");
            nicknameInput.focus();
            return;
        }

        clearNicknameInvalid();
        joinInFlight = true;
        clearFeedback();
        setStatus("Joining room " + roomCode + "...");
        render();

        try {
            await connectToRoom(roomCode);
            started = false;

            const storedState = await loadStoredState(roomCode);
            if (storedState) {
                state = storedState;
                syncSelectedMode(state.selectedMode);
            } else {
                state = {
                    roomCode: roomCode,
                    hostId: null,
                    createdAt: Date.now(),
                    selectedMode: getSelectedMode(),
                    players: [],
                };
            }

            startHeartbeatLoop();
            updateRoomUrl(roomCode);
            await postMessage({
                type: "hello",
                player: createPlayerRecord(self.id, nickname, self.ready),
            });

            if (transport.mode === "remote") {
                setStatus(storedState ? "Joined online room. Waiting for host instructions." : "Connected online. Waiting for the host to publish room state.");
            } else {
                setStatus(storedState ? "Joined local browser room. Waiting for host instructions." : "Waiting for the host in this browser prototype.");
            }

            if (!storedState && transport.mode === "remote") {
                setFeedback("Room is reachable, but no host has published lobby state yet.");
            }
        } catch (error) {
            state = null;
            setStatus("Failed to join room " + roomCode + ". Please try again.");
            setFeedback(error && error.message ? error.message : "Could not connect to the room.");
        } finally {
            joinInFlight = false;
            render();
        }
    }

    function leaveRoom(options) {
        const silent = options && options.silent;
        if (!state) {
            return;
        }

        if (isHost()) {
            mutateState(function (draft) {
                draft.players = draft.players.filter(function (player) {
                    return player.id !== self.id;
                });
                if (draft.players.length > 0) {
                    draft.hostId = draft.players[0].id;
                }
            });
        } else {
            postMessage({ type: "leave", playerId: self.id });
        }

        teardownRoom();
        self.ready = false;
        started = false;
        if (!silent) {
            setStatus("Left room.");
            setFeedback("You can create a new room or join another one.");
        }
        render();
    }

    function toggleReady() {
        if (!state) {
            return;
        }
        self.ready = !self.ready;
        const ownPlayer = state.players.find(function (player) {
            return player.id === self.id;
        });
        if (ownPlayer) {
            ownPlayer.ready = self.ready;
        }
        announcePresence();
        render();
    }

    function startRoomMatch() {
        if (!state) {
            return;
        }
        if (!isHost()) {
            setStatus("Only the host can start the match.");
            return;
        }

        const activePlayers = getActivePlayers();
        if (activePlayers.length < MIN_PLAYERS) {
            setStatus("At least 2 players are needed to start.");
            return;
        }
        if (activePlayers.length > MAX_PLAYERS) {
            setStatus("This prototype supports up to 4 players per room.");
            return;
        }

        const selectedMode = getSelectedMode();
        mutateState(function (draft) {
            draft.selectedMode = selectedMode;
            draft.startedAt = Date.now();
        });
        postMessage({
            type: "start-match",
            selectedMode: selectedMode,
        });
        launchLocalMatch(selectedMode);
    }

    async function connectToRoom(roomCode) {
        if (transport.roomCode === roomCode && transport.mode !== "unknown") {
            return;
        }

        teardownChannel();
        transport.roomCode = roomCode;
        transport.mode = (await hasRemoteTransport()) ? "remote" : "local";

        if (transport.mode === "remote") {
            connectRemote(roomCode);
            return;
        }

        connectLocal(roomCode);
        setFeedback("Room server unavailable. Using browser-local sync for testing.");
    }

    function connectLocal(roomCode) {
        if ("BroadcastChannel" in window) {
            transport.channel = new BroadcastChannel("bitplanes-room-" + roomCode);
            transport.channel.addEventListener("message", function (event) {
                handleMessage(event.data);
            });
        }
    }

    function connectRemote(roomCode) {
        const eventsUrl = transport.apiBase + "/rooms/" + encodeURIComponent(roomCode) + "/events?playerId=" + encodeURIComponent(self.id);
        transport.eventSource = new EventSource(eventsUrl);
        transport.eventSource.addEventListener("message", function (event) {
            try {
                handleMessage(JSON.parse(event.data));
            } catch (error) {
                setStatus("Received an invalid room event from the server.");
            }
        });
        transport.eventSource.addEventListener("error", function () {
            if (sseRetryCount >= SSE_MAX_RETRIES) {
                setStatus("Room connection lost. Please leave and rejoin.");
                return;
            }
            sseRetryCount += 1;
            setStatus("Room connection interrupted. Reconnecting (" + sseRetryCount + "/" + SSE_MAX_RETRIES + ")...");
            transport.eventSource.close();
            transport.eventSource = null;
            window.setTimeout(function () {
                connectRemote(roomCode);
            }, 2000);
        });
    }

    function handleMessage(message) {
        if (!message || !state || message.playerId === self.id) {
            return;
        }

        if (message.type === "connected") {
            sseRetryCount = 0;
            return;
        }

        if (message.type === "room-state") {
            if (!message.state || !Array.isArray(message.state.players) || typeof message.state.roomCode !== "string") {
                return;
            }
            state = message.state;
            persistRoomSnapshot(state);
            syncSelfFromState();
            render();
            return;
        }

        if (message.type === "start-match") {
            if (started) {
                return;
            }
            syncSelectedMode(message.selectedMode);
            launchLocalMatch(message.selectedMode);
            return;
        }

        if (!isHost()) {
            return;
        }

        if (message.type === "hello" || message.type === "presence") {
            upsertPlayer(message.player);
            return;
        }

        if (message.type === "leave") {
            mutateState(function (draft) {
                draft.players = draft.players.filter(function (player) {
                    return player.id !== message.playerId;
                });
                if (draft.hostId === message.playerId && draft.players.length > 0) {
                    draft.hostId = draft.players[0].id;
                }
            });
        }
    }

    function upsertPlayer(player) {
        if (!player || !state) {
            return;
        }

        mutateState(function (draft) {
            const existing = draft.players.find(function (entry) {
                return entry.id === player.id;
            });
            if (existing) {
                existing.name = player.name;
                existing.ready = !!player.ready;
                existing.lastSeen = Date.now();
            } else if (draft.players.length < MAX_PLAYERS) {
                draft.players.push(createPlayerRecord(player.id, player.name, player.ready));
            }
        });
    }

    function announcePresence() {
        if (!state) {
            return;
        }

        const player = createPlayerRecord(self.id, getNickname(), self.ready);
        if (isHost()) {
            upsertPlayer(player);
            return;
        }

        postMessage({
            type: "presence",
            player: player,
        });
    }

    function mutateState(mutator) {
        if (!state) {
            return;
        }

        const draft = {
            roomCode: state.roomCode,
            hostId: state.hostId,
            createdAt: state.createdAt,
            selectedMode: state.selectedMode,
            startedAt: state.startedAt,
            players: state.players.map(function (player) {
                return {
                    id: player.id,
                    name: player.name,
                    ready: !!player.ready,
                    lastSeen: player.lastSeen,
                };
            }),
        };

        mutator(draft);
        state = draft;
        persistRoomSnapshot(state);
        persistAndBroadcastState();
        syncSelfFromState();
        render();
    }

    async function persistAndBroadcastState() {
        if (!state) {
            return;
        }

        persistRoomSnapshot(state);
        await postMessage({
            type: "room-state",
            state: state,
        });
    }

    function startHostLoop() {
        stopHostLoop();
        hostIntervalId = window.setInterval(function () {
            if (!state || !isHost()) {
                return;
            }
            mutateState(function (draft) {
                draft.players = draft.players.filter(function (player) {
                    return player.id === self.id || Date.now() - (player.lastSeen || 0) < PRESENCE_TIMEOUT_MS;
                });
            });
        }, HEARTBEAT_MS);
    }

    function stopHostLoop() {
        if (hostIntervalId) {
            window.clearInterval(hostIntervalId);
            hostIntervalId = null;
        }
    }

    function startHeartbeatLoop() {
        stopHeartbeatLoop();
        announcePresence();
        heartbeatIntervalId = window.setInterval(announcePresence, HEARTBEAT_MS);
        if (isHost()) {
            startHostLoop();
        }
    }

    function stopHeartbeatLoop() {
        if (heartbeatIntervalId) {
            window.clearInterval(heartbeatIntervalId);
            heartbeatIntervalId = null;
        }
        stopHostLoop();
    }

    function launchLocalMatch(mode) {
        if (started) {
            return;
        }
        started = true;
        syncSelectedMode(mode);
        setStatus("Launching match for room " + state.roomCode + ".");
        window.setTimeout(function () {
            form.requestSubmit();
        }, 50);
    }

    function render() {
        const activeRoom = !!state;
        ui.lobby.hidden = !activeRoom;
        ui.arrival.hidden = !getPendingRoomCode() || activeRoom;
        ui.arrivalRoomCode.textContent = getPendingRoomCode() || "------";
        updateTransportPill(activeRoom);

        if (!activeRoom) {
            ui.playerList.innerHTML = "";
            ui.roomCodeDisplay.textContent = "-";
            ui.roomModeDisplay.textContent = humanizeMode(getSelectedMode());
            ui.roomLinkDisplay.href = "#";
            ui.roomLinkDisplay.textContent = "Open room";
            ui.rosterSummary.textContent = "0/4 pilots connected";
            ui.playerCountPill.textContent = "0/4 pilots";
            ui.toggleReadyButton.disabled = true;
            ui.startRoomButton.disabled = true;
            ui.startRoomButton.textContent = "Start Match";
            ui.startRoomHint.textContent = "The host can start once at least 2 pilots are in the lobby.";
            ui.copyRoomCodeButton.disabled = true;
            ui.copyRoomLinkButton.disabled = true;
            ui.leaveRoomButton.disabled = true;
            ui.createRoomButton.disabled = createInFlight;
            ui.joinRoomButton.disabled = joinInFlight;
            return;
        }

        const activePlayers = getActivePlayers();
        const roomUrl = getRoomUrl(state.roomCode);
        const modeLabel = transport.mode === "remote" ? "Online room" : "Local browser room";
        const startHint = getStartHint(activePlayers.length);

        ui.roomCodeDisplay.textContent = state.roomCode;
        ui.roomLinkDisplay.href = roomUrl;
        ui.roomLinkDisplay.textContent = roomUrl;
        ui.roomModeDisplay.textContent = humanizeMode(state.selectedMode || getSelectedMode()) + " · " + modeLabel;
        ui.rosterSummary.textContent = activePlayers.length + "/4 pilots connected";
        ui.playerCountPill.textContent = activePlayers.length + "/4 pilots";
        ui.copyRoomCodeButton.disabled = false;
        ui.copyRoomLinkButton.disabled = false;
        ui.leaveRoomButton.disabled = false;
        ui.toggleReadyButton.disabled = isHost();
        ui.toggleReadyButton.textContent = self.ready ? "Unready" : "Ready Up";
        ui.startRoomHint.textContent = startHint;
        ui.startRoomButton.disabled = !isHost() || activePlayers.length < MIN_PLAYERS || activePlayers.length > MAX_PLAYERS;
        ui.startRoomButton.textContent = getStartButtonLabel(activePlayers.length);
        ui.createRoomButton.disabled = createInFlight;
        ui.joinRoomButton.disabled = joinInFlight;

        ui.playerList.innerHTML = activePlayers.map(function (player) {
            const badges = [];
            if (player.id === state.hostId) {
                badges.push('<span class="multiplayer-player-badge multiplayer-player-badge-host">Host</span>');
            }
            if (player.id === self.id) {
                badges.push('<span class="multiplayer-player-badge">You</span>');
            }
            badges.push(player.ready
                ? '<span class="multiplayer-player-badge multiplayer-player-badge-ready">Ready</span>'
                : '<span class="multiplayer-player-badge multiplayer-player-badge-waiting">Waiting</span>');

            return '<li><strong>' +
                escapeHtml(player.name) +
                '</strong><span class="multiplayer-player-badges">' +
                badges.join("") +
                "</span></li>";
        }).join("");
    }

    function syncRoomFromUrl() {
        const roomCode = getPendingRoomCode();
        if (!roomCode) {
            return;
        }
        ui.roomCodeInput.value = roomCode;
        joinRoom(roomCode);
    }

    function syncSelfFromState() {
        if (!state) {
            return;
        }
        const ownPlayer = state.players.find(function (player) {
            return player.id === self.id;
        });
        if (ownPlayer) {
            self.ready = !!ownPlayer.ready;
        }
        if (state.selectedMode) {
            syncSelectedMode(state.selectedMode);
        }
        if (state.hostId === self.id) {
            startHostLoop();
        }
    }

    async function postMessage(message) {
        if (!message) {
            return;
        }

        const payload = {
            playerId: self.id,
            roomCode: transport.roomCode,
            timestamp: Date.now(),
            type: message.type,
            state: message.state,
            player: message.player,
            selectedMode: message.selectedMode,
        };

        if (transport.mode === "remote") {
            try {
                await fetch(transport.apiBase + "/rooms/" + encodeURIComponent(transport.roomCode) + "/events", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(10000),
                });
            } catch (error) {
                setStatus("Could not reach the room server. Falling back to browser-local sync.");
            }
            return;
        }

        if (transport.channel) {
            transport.channel.postMessage(payload);
        }
    }

    function teardownRoom() {
        stopHeartbeatLoop();
        teardownChannel();
        if (state && state.roomCode) {
            localStorage.removeItem(getRoomStorageKey(state.roomCode));
        }
        const params = new URLSearchParams(window.location.search);
        params.delete(ROOM_PARAM);
        const nextQuery = params.toString();
        history.replaceState({}, "", window.location.pathname + (nextQuery ? "?" + nextQuery : ""));
        state = null;
    }

    function teardownChannel() {
        if (transport.channel) {
            transport.channel.close();
            transport.channel = null;
        }
        if (transport.eventSource) {
            transport.eventSource.close();
            transport.eventSource = null;
        }
        transport.roomCode = null;
        transport.mode = "unknown";
    }

    function getActivePlayers() {
        if (!state) {
            return [];
        }
        return state.players.filter(function (player) {
            return Date.now() - (player.lastSeen || 0) < PRESENCE_TIMEOUT_MS || player.id === self.id;
        });
    }

    function updateRoomUrl(roomCode) {
        const params = new URLSearchParams(window.location.search);
        params.set(ROOM_PARAM, roomCode);
        history.replaceState({}, "", window.location.pathname + "?" + params.toString());
    }

    async function loadStoredState(roomCode) {
        if (transport.mode === "remote") {
            try {
                const response = await fetch(transport.apiBase + "/rooms/" + encodeURIComponent(roomCode) + "/state", { signal: AbortSignal.timeout(10000) });
                if (response.ok) {
                    const payload = await response.json();
                    persistRoomSnapshot(payload.state);
                    return payload.state;
                }
            } catch (error) {
                return parseState(localStorage.getItem(getRoomStorageKey(roomCode)));
            }
        }

        return parseState(localStorage.getItem(getRoomStorageKey(roomCode)));
    }

    function persistRoomSnapshot(nextState) {
        if (!nextState || !nextState.roomCode) {
            return;
        }
        localStorage.setItem(getRoomStorageKey(nextState.roomCode), JSON.stringify(nextState));
    }

    function parseState(raw) {
        if (!raw) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.roomCode || !Array.isArray(parsed.players)) {
                return null;
            }
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function getRoomStorageKey(roomCode) {
        return ROOM_STATE_PREFIX + roomCode;
    }

    function getSelectedMode() {
        const checked = document.querySelector('input[name="mode"]:checked');
        return checked ? checked.value : "death-match";
    }

    function syncSelectedMode(mode) {
        const input = document.querySelector('input[name="mode"][value="' + mode + '"]');
        if (input) {
            input.checked = true;
        }
    }

    function isHost() {
        return !!state && state.hostId === self.id;
    }

    function getNickname() {
        return nicknameInput.value.trim();
    }

    function humanizeMode(mode) {
        return String(mode || "death-match").split("-").map(function (segment) {
            return segment.charAt(0).toUpperCase() + segment.slice(1);
        }).join(" ");
    }

    function copyText(text, successMessage) {
        if (!text) {
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                setStatus(successMessage);
            }, function () {
                fallbackCopy(text, successMessage);
            });
            return;
        }

        fallbackCopy(text, successMessage);
    }

    function fallbackCopy(text, successMessage) {
        const input = document.createElement("input");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        setStatus(successMessage);
    }

    function createPlayerRecord(id, name, ready) {
        return {
            id: id,
            name: name || "Pilot",
            ready: !!ready,
            lastSeen: Date.now(),
        };
    }

    function sanitizeRoomCode(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }

    function generateRoomCode() {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let roomCode = "";
        for (let index = 0; index < 6; index += 1) {
            roomCode += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        return roomCode;
    }

    function getRoomUrl(roomCode) {
        return window.location.origin + window.location.pathname + "?room=" + roomCode;
    }

    function getOrCreatePlayerId() {
        let playerId = sessionStorage.getItem(PLAYER_ID_KEY);
        if (!playerId) {
            playerId = "pilot-" + Math.random().toString(36).slice(2, 10);
            sessionStorage.setItem(PLAYER_ID_KEY, playerId);
        }
        return playerId;
    }

    function setStatus(message) {
        ui.status.textContent = message;
    }

    function setFeedback(message) {
        if (!message) {
            clearFeedback();
            return;
        }
        ui.feedback.hidden = false;
        ui.feedback.textContent = message;
    }

    function clearFeedback() {
        ui.feedback.hidden = true;
        ui.feedback.textContent = "";
    }

    function updateTransportPill(activeRoom) {
        const classes = ["multiplayer-pill"];
        let label = "Checking connection...";

        if (transport.mode === "remote") {
            classes.push("multiplayer-pill-online");
            label = activeRoom ? "Online connected" : "Online room server ready";
        } else if (transport.mode === "local") {
            classes.push("multiplayer-pill-local");
            label = activeRoom ? "Local browser sync" : "Local fallback ready";
        } else if (joinInFlight || createInFlight) {
            label = "Connecting...";
        }

        ui.transportPill.className = classes.join(" ");
        ui.transportPill.textContent = label;
    }

    function getPendingRoomCode() {
        return sanitizeRoomCode(new URLSearchParams(window.location.search).get(ROOM_PARAM) || "");
    }

    function getStartButtonLabel(playerCount) {
        if (!isHost()) {
            return "Host Starts Match";
        }
        if (playerCount < MIN_PLAYERS) {
            return "Need More Pilots";
        }
        if (playerCount > MAX_PLAYERS) {
            return "Room Full";
        }
        return "Start Match";
    }

    function getStartHint(playerCount) {
        if (!isHost()) {
            return "Only the host can launch the match.";
        }
        if (playerCount < MIN_PLAYERS) {
            return "Need at least 2 pilots before the host can start.";
        }
        if (playerCount > MAX_PLAYERS) {
            return "This room supports up to 4 pilots.";
        }
        return "All set. Launch whenever your squad is ready.";
    }

    function flagNicknameInvalid() {
        nicknameInput.classList.add("input-invalid");
    }

    function clearNicknameInvalid() {
        nicknameInput.classList.remove("input-invalid");
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getApiBase() {
        const configuredBase = window.BIT_PLANES_MULTIPLAYER_API || "/api/bit-planes";
        return configuredBase.replace(/\/$/, "");
    }

    async function hasRemoteTransport() {
        if (!transportAvailabilityPromise) {
            transportAvailabilityPromise = fetch(transport.apiBase + "/health", { cache: "no-store", signal: AbortSignal.timeout(10000) })
                .then(function (response) {
                    return response.ok;
                })
                .catch(function () {
                    return false;
                });
        }
        return transportAvailabilityPromise;
    }
})();
