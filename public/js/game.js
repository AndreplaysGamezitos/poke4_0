/**
 * PokeFodase v3.0 — Frontend Game Client
 * Token-based auth · WebSocket-only real-time · Server-driven battles
 */

// ============================================
// CONSTANTS & CONFIG
// ============================================

const AVATARS = ['😎', '🤓', '😈', '🤠', '🥷', '🧙', '🦊', '🐲', '👻', '🤖', '🎃', '🦁', '🐺', '🦅', '🐸', '🐢', '🦇', '🐯', '🐼', '🦋'];

const API_BASE = '/api';

// ============================================
// GAME STATE
// ============================================

const GameState = {
    authToken: localStorage.getItem('pokefodase_token'),
    accountId: null,
    accountCode: null,
    accountName: null,
    accountAvatar: 1,
    accountElo: 0,
    roomCode: null,
    roomId: null,
    playerId: null,
    playerNumber: null,
    isHost: false,
    currentScreen: 'menu',
    selectedAvatar: 1,
    players: [],
    gameState: 'lobby',
    webSocket: null,
    // Catching phase
    catchingState: null,
    wildPokemon: null,
    isMyTurn: false,
    catchAnimationInProgress: false,
    // Starter selection
    starters: [],
    selectionState: null,
    initialTimer: 10,
    initialTimerInterval: null,
    initialTimerValue: 0,
    // Route
    currentRoute: 1,
};

// ============================================
// TOWN STATE
// ============================================

const TownState = {
    playerMoney: 0,
    ultraBalls: 0,
    hasUsedMegaStone: false,
    team: [],
    activeSlot: 0,
    isReady: false,
    players: [],
};

// ============================================
// TOURNAMENT STATE
// ============================================

const TournamentState = {
    brackets: [],
    byePlayer: null,
    currentMatch: null,
    players: [],
    completedMatches: 0,
    totalMatches: 0,
    hostPlayerId: null,
    isTiebreaker: false,
};

// ============================================
// BATTLE STATE
// ============================================

const BattleState = {
    phase: 'selection',
    isMyBattle: false,
    amPlayer1: false,
    isNpcBattle: false,
    npcData: null,
    player1: null,
    player2: null,
    player1Team: [],
    player2Team: [],
    player1Active: null,
    player2Active: null,
    player1HasSelected: false,
    player2HasSelected: false,
    currentTurn: null,
    typeMatchups: null,
};

// ============================================
// DOM REFERENCES
// ============================================

let DOM = {};

function cacheDom() {
    DOM = {
        // Screens
        screens: {
            menu: document.getElementById('screen-menu'),
            lobby: document.getElementById('screen-lobby'),
            initial: document.getElementById('screen-initial'),
            catching: document.getElementById('screen-catching'),
            town: document.getElementById('screen-town'),
            tournament: document.getElementById('screen-tournament'),
            battle: document.getElementById('screen-battle'),
            victory: document.getElementById('screen-victory'),
        },
        // Account
        accountSection: document.getElementById('account-section'),
        accountCreateView: document.getElementById('account-create-view'),
        accountLoginView: document.getElementById('account-login-view'),
        loggedInSection: document.getElementById('logged-in-section'),
        // Lobby
        playersList: document.getElementById('players-list'),
        displayRoomCode: document.getElementById('display-room-code'),
        playerCount: document.getElementById('player-count'),
        btnStartGame: document.getElementById('btn-start-game'),
        hostIndicator: document.getElementById('host-indicator'),
        // Starter
        starterGrid: document.getElementById('starter-grid'),
        selectedList: document.getElementById('selected-list'),
        initialTurnIndicator: document.getElementById('initial-turn-indicator'),
        // Catching
        catchingPlayersPanel: document.getElementById('catching-players-panel'),
        catchingTurnIndicator: document.getElementById('catching-turn-indicator'),
        catchingLogMessages: document.getElementById('catching-log-messages'),
        wildPokemonDisplay: document.getElementById('wild-pokemon-display'),
        wildPokemonPlaceholder: document.getElementById('wild-pokemon-placeholder'),
        btnCatch: document.getElementById('btn-catch'),
        btnUltraCatch: document.getElementById('btn-ultra-catch'),
        btnAttack: document.getElementById('btn-attack'),
        // Battle
        battleP1Avatar: document.getElementById('battle-p1-avatar'),
        battleP1Name: document.getElementById('battle-p1-name'),
        battleP2Avatar: document.getElementById('battle-p2-avatar'),
        battleP2Name: document.getElementById('battle-p2-name'),
        battleP1Sprite: document.getElementById('battle-p1-sprite'),
        battleP2Sprite: document.getElementById('battle-p2-sprite'),
        battleP1PokemonName: document.getElementById('battle-p1-pokemon-name'),
        battleP2PokemonName: document.getElementById('battle-p2-pokemon-name'),
        battleP1HpBar: document.getElementById('battle-p1-hp-bar'),
        battleP2HpBar: document.getElementById('battle-p2-hp-bar'),
        battleP1HpText: document.getElementById('battle-p1-hp-text'),
        battleP2HpText: document.getElementById('battle-p2-hp-text'),
        battleP1Attack: document.getElementById('battle-p1-attack'),
        battleP2Attack: document.getElementById('battle-p2-attack'),
        battleP1Speed: document.getElementById('battle-p1-speed'),
        battleP2Speed: document.getElementById('battle-p2-speed'),
        battleP1TypeAtk: document.getElementById('battle-p1-type-atk'),
        battleP2TypeAtk: document.getElementById('battle-p2-type-atk'),
        battleP1TypeDef: document.getElementById('battle-p1-type-def'),
        battleP2TypeDef: document.getElementById('battle-p2-type-def'),
        battleP1Stats: document.getElementById('battle-p1-stats'),
        battleP2Stats: document.getElementById('battle-p2-stats'),
        battleP1Team: document.getElementById('battle-p1-team'),
        battleP2Team: document.getElementById('battle-p2-team'),
        battleP1Pokemon: document.getElementById('battle-p1-pokemon'),
        battleP2Pokemon: document.getElementById('battle-p2-pokemon'),
        battleStatus: document.getElementById('battle-status'),
        battleActionDisplay: document.getElementById('battle-action-display'),
        battleActionText: document.getElementById('battle-action-text'),
        battleSelectionPanel: document.getElementById('battle-selection-panel'),
        battleSelectionGrid: document.getElementById('battle-selection-grid'),
        battleSelectionTitle: document.getElementById('battle-selection-title'),
        battleLogMessages: document.getElementById('battle-log-messages'),
        // Victory
        winnerName: document.getElementById('winner-name'),
        victoryMessage: document.getElementById('victory-message'),
        // Misc
        btnLeaveGame: document.getElementById('btn-leave-game'),
        loadingOverlay: document.getElementById('loading-overlay'),
        toastContainer: document.getElementById('toast-container'),
    };
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
    cacheDom();
    setupAvatarSelectors();
    setupEventListeners();
    checkExistingSession();
}

function setupEventListeners() {
    // Account
    document.getElementById('btn-account-create')?.addEventListener('click', createAccount);
    document.getElementById('btn-account-login')?.addEventListener('click', loginAccount);
    document.getElementById('btn-show-login')?.addEventListener('click', () => {
        document.getElementById('account-create-view').classList.add('hidden');
        document.getElementById('account-login-view').classList.remove('hidden');
    });
    document.getElementById('btn-show-create')?.addEventListener('click', () => {
        document.getElementById('account-login-view').classList.add('hidden');
        document.getElementById('account-create-view').classList.remove('hidden');
    });
    document.getElementById('btn-account-logout')?.addEventListener('click', logout);
    document.getElementById('btn-toggle-code')?.addEventListener('click', toggleCodeReveal);

    // Room
    document.getElementById('btn-create-room')?.addEventListener('click', createRoom);
    document.getElementById('btn-join-room')?.addEventListener('click', () => {
        document.getElementById('join-room-form').classList.toggle('hidden');
    });
    document.getElementById('btn-confirm-join')?.addEventListener('click', joinRoom);
    document.getElementById('btn-cancel-join')?.addEventListener('click', () => {
        document.getElementById('join-room-form').classList.add('hidden');
    });

    // Lobby
    document.getElementById('btn-start-game')?.addEventListener('click', startGame);
    document.getElementById('btn-leave-room')?.addEventListener('click', leaveRoom);
    document.getElementById('btn-copy-code')?.addEventListener('click', copyRoomCode);

    // Town
    document.getElementById('btn-buy-evo-soda')?.addEventListener('click', () => buyItem('evo_soda'));
    document.getElementById('btn-buy-ultra')?.addEventListener('click', () => buyItem('ultra_ball'));
    document.getElementById('btn-buy-mega-stone')?.addEventListener('click', () => buyItem('mega_stone'));
    document.getElementById('btn-buy-hp-boost')?.addEventListener('click', () => buyItem('hp_boost'));
    document.getElementById('btn-buy-attack-boost')?.addEventListener('click', () => buyItem('attack_boost'));
    document.getElementById('btn-buy-speed-boost')?.addEventListener('click', () => buyItem('speed_boost'));
    document.getElementById('btn-town-ready')?.addEventListener('click', toggleTownReady);

    // Tournament
    document.getElementById('btn-start-battle')?.addEventListener('click', startNextBattle);
    document.getElementById('btn-next-route')?.addEventListener('click', completeTournament);

    // Catching
    DOM.btnCatch?.addEventListener('click', () => attemptCatch(false));
    DOM.btnUltraCatch?.addEventListener('click', () => attemptCatch(true));
    DOM.btnAttack?.addEventListener('click', attackWildPokemon);

    // Keyboard shortcuts for catching
    document.addEventListener('keydown', handleCatchingKeyboard);

    // Victory
    document.getElementById('btn-return-menu')?.addEventListener('click', returnToMenu);

    // Leave game
    DOM.btnLeaveGame?.addEventListener('click', leaveRoom);
}

// ============================================
// API HELPER
// ============================================

async function apiCall(endpoint, data = {}, method = 'POST') {
    const headers = { 'Content-Type': 'application/json' };
    if (GameState.authToken) {
        headers['Authorization'] = `Bearer ${GameState.authToken}`;
    }
    const opts = { method, headers };
    if (method !== 'GET') {
        opts.body = JSON.stringify(data);
    }
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, opts);
        return await res.json();
    } catch (err) {
        console.error('API call error:', err);
        return { success: false, error: 'Network error', code: 'NETWORK_ERROR' };
    }
}

// ============================================
// UTILITIES
// ============================================

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function showToast(message, type = 'info') {
    if (!DOM.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function setLoading(show) {
    if (DOM.loadingOverlay) {
        DOM.loadingOverlay.classList.toggle('hidden', !show);
    }
}

function switchScreen(screenName) {
    Object.values(DOM.screens).forEach(s => s?.classList.remove('active'));
    const target = DOM.screens[screenName];
    if (target) target.classList.add('active');
    GameState.currentScreen = screenName;

    // Show/hide leave button during game
    const inGame = ['catching', 'town', 'tournament', 'battle'].includes(screenName);
    DOM.btnLeaveGame?.classList.toggle('hidden', !inGame);
}

// ============================================
// AVATAR SYSTEM
// ============================================

function setupAvatarSelectors() {
    const container = document.getElementById('account-avatar-selector');
    if (!container) return;
    container.innerHTML = '';
    AVATARS.forEach((emoji, i) => {
        const btn = document.createElement('div');
        btn.className = 'avatar-option' + (i === 0 ? ' selected' : '');
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            GameState.selectedAvatar = i + 1;
        });
        container.appendChild(btn);
    });
}

// ============================================
// ACCOUNT
// ============================================

async function createAccount() {
    const nickname = document.getElementById('account-nickname-create')?.value?.trim();
    if (!nickname) { showToast('Digite um nickname!', 'warning'); return; }
    setLoading(true);
    const result = await apiCall('/account/create', { nickname, avatar_id: GameState.selectedAvatar });
    setLoading(false);
    if (result.success) {
        GameState.authToken = result.token;
        localStorage.setItem('pokefodase_token', result.token);
        setAccountInfo(result.account);
        showLoggedIn();
        showToast('Conta criada!', 'success');
    } else {
        showToast(result.error || 'Erro ao criar conta', 'error');
    }
}

async function loginAccount() {
    const nickname = document.getElementById('account-nickname-login')?.value?.trim();
    const code = document.getElementById('account-code')?.value?.trim().toUpperCase();
    if (!nickname || !code) { showToast('Preencha todos os campos!', 'warning'); return; }
    setLoading(true);
    const result = await apiCall('/account/login', { nickname, account_code: code });
    setLoading(false);
    if (result.success) {
        GameState.authToken = result.token;
        localStorage.setItem('pokefodase_token', result.token);
        setAccountInfo(result.account);
        showLoggedIn();
        showToast('Logado!', 'success');
    } else {
        showToast(result.error || 'Erro ao entrar', 'error');
    }
}

function setAccountInfo(acct) {
    GameState.accountId = acct.id;
    GameState.accountCode = acct.code;
    GameState.accountName = acct.nickname;
    GameState.accountAvatar = acct.avatar_id || 1;
    GameState.accountElo = acct.elo || 0;
}

function showLoggedIn() {
    DOM.accountSection?.classList.add('hidden');
    DOM.loggedInSection?.classList.remove('hidden');
    document.getElementById('menu-account-avatar').textContent = AVATARS[GameState.accountAvatar - 1] || '😎';
    document.getElementById('menu-account-name').textContent = GameState.accountName;
    document.getElementById('menu-account-elo').textContent = `ELO: ${GameState.accountElo}`;
    document.getElementById('code-display').textContent = '••••••••';
    document.getElementById('code-display').classList.remove('revealed');
}

function logout() {
    localStorage.removeItem('pokefodase_token');
    GameState.authToken = null;
    GameState.accountId = null;
    GameState.accountCode = null;
    GameState.accountName = null;
    DOM.accountSection?.classList.remove('hidden');
    DOM.loggedInSection?.classList.add('hidden');
    showToast('Deslogado', 'info');
}

function toggleCodeReveal() {
    const el = document.getElementById('code-display');
    if (el.classList.contains('revealed')) {
        el.textContent = '••••••••';
        el.classList.remove('revealed');
    } else {
        el.textContent = GameState.accountCode || '????????';
        el.classList.add('revealed');
    }
}

async function checkExistingSession() {
    if (!GameState.authToken) return;
    try {
        const result = await apiCall('/game/state', {}, 'GET');
        if (result.success && result.in_game && result.room) {
            // We're in an active game — restore state
            const player = result.player;
            if (result.account) {
                setAccountInfo(result.account);
            } else {
                setAccountInfo({
                    id: player.account_id || GameState.accountId,
                    nickname: player.player_name,
                    code: GameState.accountCode || '????????',
                    avatar_id: player.avatar_id || GameState.accountAvatar,
                    elo: GameState.accountElo || 0,
                });
            }
            showLoggedIn();

            GameState.roomCode = result.room.room_code;
            GameState.roomId = result.room.id;
            GameState.playerId = player.id;
            GameState.playerNumber = player.player_number;
            GameState.isHost = player.is_host;
            GameState.players = result.players || [];
            GameState.currentRoute = result.room.current_route;

            showToast('Reconectado!', 'success');
            enterLobby();
            handleGameStateChange(result.room.game_state);
            return;
        }
        // Not in a room — just show logged-in state
        // Try to verify the token is still valid by showing logged-in
        // The token is a JWT, so if we got success: true, the token works
        if (result.success) {
            if (result.account) {
                setAccountInfo(result.account);
            }
            showLoggedIn();
        }
    } catch {
        // Token invalid or server down
        console.log('No existing session');
    }
}

// ============================================
// ROOM
// ============================================

async function createRoom() {
    setLoading(true);
    const result = await apiCall('/room/create', { game_mode: 'casual' });
    setLoading(false);
    if (result.success) {
        GameState.roomCode = result.room_code;
        GameState.roomId = result.room_id;
        GameState.playerId = result.player_id;
        GameState.playerNumber = result.player_number;
        GameState.isHost = result.is_host;
        showToast(`Sala criada: ${result.room_code}`, 'success');
        enterLobby();
        refreshLobby();
    } else {
        if (result.code === 'GAME_IN_PROGRESS' && result.room_code) {
            showToast('Você já está em uma sala! Reconectando...', 'warning');
            GameState.roomCode = result.room_code;
            await rejoinExistingRoom();
        } else {
            showToast(result.error || 'Erro ao criar sala', 'error');
        }
    }
}

async function joinRoom() {
    const code = document.getElementById('room-code-input')?.value?.trim().toUpperCase();
    if (!code) { showToast('Digite o código!', 'warning'); return; }
    setLoading(true);
    const result = await apiCall('/room/join', { room_code: code });
    setLoading(false);
    if (result.success) {
        GameState.roomCode = result.room_code;
        GameState.roomId = result.room_id;
        GameState.playerId = result.player_id;
        GameState.playerNumber = result.player_number;
        GameState.isHost = result.is_host;
        showToast('Entrou na sala!', 'success');
        document.getElementById('join-room-form')?.classList.add('hidden');
        enterLobby();
        refreshLobby();
    } else {
        if (result.code === 'GAME_IN_PROGRESS' && result.room_code) {
            GameState.roomCode = result.room_code;
            await rejoinExistingRoom();
        } else {
            showToast(result.error || 'Erro ao entrar', 'error');
        }
    }
}

async function rejoinExistingRoom() {
    const result = await apiCall(`/room/state?room_code=${GameState.roomCode}`, {}, 'GET');
    if (result.success) {
        GameState.roomId = result.room.id;
        const me = result.players.find(p => p.account_id === GameState.accountId);
        if (me) {
            GameState.playerId = me.id;
            GameState.playerNumber = me.player_number;
            GameState.isHost = me.is_host;
        }
        GameState.players = result.players;
        enterLobby();
        handleGameStateChange(result.room.game_state);
    }
}

async function leaveRoom() {
    if (!confirm('Sair da sala?')) return;
    disconnectWebSocket();
    setLoading(true);
    await apiCall('/room/leave', {});
    setLoading(false);
    GameState.roomCode = null;
    GameState.roomId = null;
    GameState.playerId = null;
    GameState.isHost = false;
    DOM.btnLeaveGame?.classList.add('hidden');
    switchScreen('menu');
    showToast('Saiu da sala', 'info');
}

function enterLobby() {
    switchScreen('lobby');
    DOM.displayRoomCode.textContent = GameState.roomCode;
    if (GameState.isHost) {
        DOM.hostIndicator?.classList.remove('hidden');
    } else {
        DOM.hostIndicator?.classList.add('hidden');
    }
    connectWebSocket();
}

function copyRoomCode() {
    navigator.clipboard?.writeText(GameState.roomCode);
    showToast('Código copiado!', 'success');
}

async function refreshLobby() {
    if (!GameState.roomCode) return;
    const result = await apiCall(`/room/state?room_code=${GameState.roomCode}`, {}, 'GET');
    if (!result.success) return;

    GameState.players = result.players;
    renderLobbyPlayers(result.players);

    DOM.playerCount.textContent = result.players.length;

    const isHost = result.players.find(p => p.id == GameState.playerId)?.is_host;
    GameState.isHost = !!isHost;
    DOM.btnStartGame.disabled = !isHost || result.players.length < 2;

    if (isHost) {
        DOM.hostIndicator?.classList.remove('hidden');
    } else {
        DOM.hostIndicator?.classList.add('hidden');
    }
}

function renderLobbyPlayers(players) {
    DOM.playersList.innerHTML = '';
    players.forEach(p => {
        const card = document.createElement('div');
        card.className = 'player-card';
        if (p.id == GameState.playerId) card.classList.add('is-you');
        if (p.is_host) card.classList.add('is-host');
        const avatar = AVATARS[p.avatar_id - 1] || '😎';
        card.innerHTML = `
            <div class="player-avatar">${avatar}</div>
            <div class="player-name">${escapeHtml(p.player_name)}</div>
            <div class="player-status">${p.is_host ? '👑 Host' : 'Jogador'}</div>
        `;
        DOM.playersList.appendChild(card);
    });
}

// ============================================
// GAME FLOW
// ============================================

async function startGame() {
    setLoading(true);
    const result = await apiCall('/game/start', {});
    setLoading(false);
    if (result.success) {
        showToast('Jogo iniciado!', 'success');
        // Transition handled by WebSocket event
    } else {
        showToast(result.error || 'Erro ao iniciar', 'error');
    }
}

function handleGameStateChange(newState) {
    if (newState === GameState.gameState && GameState.currentScreen !== 'lobby') return;
    GameState.gameState = newState;

    // Clear initial timer when leaving initial phase
    if (newState !== 'initial') {
        clearInitialTimer();
    }

    switch (newState) {
        case 'lobby':
            if (GameState.currentScreen !== 'lobby') switchScreen('lobby');
            break;
        case 'initial':
            switchScreen('initial');
            loadStarterPokemon();
            break;
        case 'catching':
            switchScreen('catching');
            initCatchingPhase();
            break;
        case 'town':
            switchScreen('town');
            initTownPhase();
            break;
        case 'tournament':
            switchScreen('tournament');
            initTournamentPhase();
            break;
        case 'battle':
            switchScreen('battle');
            initBattlePhase();
            break;
        case 'finished':
            switchScreen('victory');
            loadVictoryScreen();
            break;
    }
}

function returnToMenu() {
    disconnectWebSocket();
    GameState.roomCode = null;
    GameState.roomId = null;
    GameState.playerId = null;
    GameState.isHost = false;
    GameState.gameState = 'lobby';
    switchScreen('menu');
}

// ============================================
// WEBSOCKET
// ============================================

function connectWebSocket() {
    if (GameState.webSocket && GameState.webSocket.readyState === WebSocket.OPEN) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/?token=${GameState.authToken}&room_code=${GameState.roomCode}`;

    const ws = new WebSocket(wsUrl);
    GameState.webSocket = ws;

    ws.onopen = () => {
        console.log('[WS] Connected');
        // Start heartbeat
        ws._pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 25000);
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            handleWebSocketMessage(msg.event, msg.data);
        } catch (err) {
            console.error('[WS] Parse error:', err);
        }
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected');
        clearInterval(ws._pingInterval);
        // Auto-reconnect if still in a room
        if (GameState.roomCode && GameState.currentScreen !== 'menu') {
            setTimeout(() => connectWebSocket(), 3000);
        }
    };

    ws.onerror = (err) => {
        console.error('[WS] Error:', err);
    };
}

function disconnectWebSocket() {
    if (GameState.webSocket) {
        clearInterval(GameState.webSocket._pingInterval);
        GameState.webSocket.close();
        GameState.webSocket = null;
    }
}

function handleWebSocketMessage(eventType, eventData) {
    console.log('[WS]', eventType, eventData);

    switch (eventType) {
        case 'connected':
            break;

        case 'player_joined':
            showToast(`${eventData.player_name} entrou!`, 'info');
            refreshLobby();
            break;

        case 'player_left':
            showToast(`${eventData.player_name} saiu`, 'info');
            refreshLobby();
            break;

        case 'game_started':
            showToast('Jogo iniciado!', 'success');
            handleGameStateChange('initial');
            break;

        case 'starter_selected':
            showToast(`${eventData.player_name || 'Jogador'} escolheu ${eventData.pokemon_name}!`, 'info');
            refreshSelectionState();
            break;

        case 'phase_changed':
            if (eventData.new_phase) {
                const phaseNames = { catching: 'captura', town: 'cidade', tournament: 'torneio', battle: 'batalha', finished: 'fim' };
                showToast(`Fase: ${phaseNames[eventData.new_phase] || eventData.new_phase}!`, 'success');
            }
            handleGameStateChange(eventData.new_phase);
            break;

        case 'state_sync':
            handleGameStateChange(eventData.game_state);
            break;

        // Catching
        case 'wild_pokemon_appeared':
            addCatchingLog(`Um ${eventData.pokemon_name} selvagem apareceu!`, 'wild');
            if (!GameState.catchAnimationInProgress) refreshCatchingState();
            break;

        case 'catch_attempt':
            handleCatchAttemptEvent(eventData);
            break;

        case 'attack':
            const eff = eventData.type_multiplier > 1 ? ' (Super Efetivo!)' : (eventData.type_multiplier < 1 ? ' (Pouco Efetivo...)' : '');
            addCatchingLog(`${eventData.attacker_name} causou ${eventData.damage} de dano!${eff}`, 'attack');
            if (eventData.defeated) addCatchingLog(`${eventData.wild_pokemon_name || 'Pokémon selvagem'} fugiu!`, 'fled');
            if (eventData.evolved && eventData.evolved_into) addCatchingLog(`${eventData.pokemon_name} evoluiu para ${eventData.evolved_into.name}! 🌟`, 'evolution');
            refreshCatchingState();
            break;

        case 'turn_changed':
            if (!GameState.catchAnimationInProgress) refreshCatchingState();
            break;

        case 'pokemon_switched':
            showToast(`Trocou para ${eventData.pokemon_name}!`, 'info');
            refreshCatchingState();
            break;

        // Town
        case 'town_purchase':
        case 'town_sell':
        case 'town_ready_toggle':
        case 'town_switch_active':
            if (GameState.currentScreen === 'town') handleTownEvent(eventType, eventData);
            break;

        case 'town_phase_change':
            handleTownEvent('town_phase_change', eventData);
            break;

        // Tournament
        case 'battle_started':
            handleTournamentEvent('battle_started', eventData);
            break;

        case 'match_completed':
            handleTournamentEvent('match_completed', eventData);
            break;

        case 'tournament_updated':
            if (GameState.currentScreen === 'tournament') handleTournamentEvent('tournament_updated', eventData);
            break;

        case 'game_finished':
            handleTournamentEvent('game_finished', eventData);
            break;

        case 'tiebreaker_tournament':
            showToast('🔥 DESEMPATE!', 'warning');
            refreshTournamentState();
            break;

        // Battle
        case 'battle_pokemon_selected':
            handleBattleEvent('pokemon_selected', eventData);
            break;

        case 'battle_started_combat':
            handleBattleEvent('combat_started', eventData);
            break;

        case 'battle_attack':
            handleBattleEvent('attack', eventData);
            break;

        case 'battle_pokemon_fainted':
            handleBattleEvent('pokemon_fainted', eventData);
            break;

        case 'battle_pokemon_sent':
            handleBattleEvent('pokemon_sent', eventData);
            break;

        case 'battle_needs_replacement':
            handleBattleEvent('needs_replacement', eventData);
            break;

        case 'battle_ended':
            handleBattleEvent('battle_ended', eventData);
            break;

        case 'pong':
            break;

        default:
            console.log('[WS] Unhandled:', eventType);
    }
}

// ============================================
// STARTER SELECTION
// ============================================

async function loadStarterPokemon() {
    DOM.starterGrid.innerHTML = '<p>Carregando iniciais...</p>';
    DOM.initialTurnIndicator.textContent = 'Carregando...';

    try {
        const result = await apiCall('/game/state', {}, 'GET');
        if (!result.success) { showToast('Erro ao carregar', 'error'); return; }

        GameState.starters = result.starters || [];
        GameState.selectionState = result;
        GameState.players = result.players || [];
        GameState.initialTimer = result.initial_timer || 10;
        renderStarterSelection();
    } catch (err) {
        console.error('Error loading starters:', err);
        showToast('Erro ao carregar iniciais', 'error');
    }
}

function renderStarterSelection() {
    const starters = GameState.starters || [];
    const players = GameState.players || [];
    const state = GameState.selectionState || {};
    const currentTurnIndex = state.room?.current_player_turn ?? 0;

    // Determine whose turn it is by matching the player at the current index
    // Players are sorted by player_number, so index N = Nth player in sorted order
    const currentPlayer = players[currentTurnIndex] || null;
    const isMyTurn = currentPlayer && currentPlayer.id == GameState.playerId;

    // Find which Pokémon have been selected (both from players' teams and the taken flag)
    const selectedIds = new Set();
    for (const p of players) {
        if (p.team && p.team.length > 0) {
            p.team.forEach(t => selectedIds.add(t.pokemon_id));
        }
    }
    // Also check the taken flag from backend
    for (const s of starters) {
        if (s.taken) selectedIds.add(s.pokemon_id || s.id);
    }

    // Turn indicator + timer
    if (isMyTurn) {
        DOM.initialTurnIndicator.innerHTML = '🎯 Sua vez! Escolha seu Pokémon inicial! <span id="initial-countdown" style="color:#ef4444;font-weight:bold"></span>';
        DOM.initialTurnIndicator.style.color = '#4ade80';
        startInitialTimer();
    } else if (currentPlayer) {
        DOM.initialTurnIndicator.innerHTML = `Aguardando ${escapeHtml(currentPlayer.player_name)} escolher... <span id="initial-countdown" style="color:#fbbf24;font-weight:bold"></span>`;
        DOM.initialTurnIndicator.style.color = '#fbbf24';
        startInitialTimer();
    } else {
        clearInitialTimer();
    }

    // Render starter grid
    DOM.starterGrid.innerHTML = '';
    starters.forEach(pokemon => {
        const pokemonId = pokemon.pokemon_id || pokemon.id;
        const isSelected = selectedIds.has(pokemonId);
        const card = createPokemonCard(pokemon, isSelected, isMyTurn && !isSelected);
        if (isMyTurn && !isSelected) {
            card.addEventListener('click', () => selectStarter(pokemonId));
        }
        DOM.starterGrid.appendChild(card);
    });

    // Render selected list
    DOM.selectedList.innerHTML = '';
    players.forEach(p => {
        const item = document.createElement('div');
        item.className = 'selected-item';
        const avatar = AVATARS[p.avatar_id - 1] || '😎';
        const isMe = p.id == GameState.playerId;
        const hasPokemon = p.team && p.team.length > 0;
        if (hasPokemon) {
            const pk = p.team[0];
            item.innerHTML = `
                <div class="mini-avatar">${avatar}</div>
                <span class="${isMe ? 'is-you' : ''}">${escapeHtml(p.player_name)}</span>
                <span>→</span>
                <img src="${pk.sprite_url}" alt="${pk.name}" style="width:32px;height:32px" onerror="this.style.display='none'">
                <span>${pk.name}</span>
            `;
        } else {
            item.innerHTML = `
                <div class="mini-avatar">${avatar}</div>
                <span class="${isMe ? 'is-you' : ''}">${escapeHtml(p.player_name)}</span>
                <span class="waiting">Aguardando...</span>
            `;
        }
        DOM.selectedList.appendChild(item);
    });
}

function createPokemonCard(pokemon, isSelected = false, isClickable = false) {
    const card = document.createElement('div');
    card.className = 'pokemon-card';
    if (isSelected) card.classList.add('disabled');
    if (isClickable) card.classList.add('clickable');
    card.innerHTML = `
        <div class="pokemon-sprite">
            <img src="${pokemon.sprite_url}" alt="${pokemon.name}" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'">
        </div>
        <div class="pokemon-name">${pokemon.name}</div>
        <div class="pokemon-types">
            <span class="type-badge ${pokemon.type_defense}">${pokemon.type_defense}</span>
            ${pokemon.type_attack !== pokemon.type_defense ? `<span class="type-badge ${pokemon.type_attack}">${pokemon.type_attack}</span>` : ''}
        </div>
        <div class="pokemon-stats">
            <div class="stat"><span class="stat-label">HP</span><span class="stat-value">${pokemon.base_hp}</span></div>
            <div class="stat"><span class="stat-label">ATK</span><span class="stat-value">${pokemon.base_attack}</span></div>
            <div class="stat"><span class="stat-label">SPD</span><span class="stat-value">${pokemon.base_speed}</span></div>
        </div>
        ${isSelected ? '<div class="selected-overlay">ESCOLHIDO</div>' : ''}
    `;
    return card;
}

async function selectStarter(pokemonId) {
    clearInitialTimer();
    setLoading(true);
    const result = await apiCall('/game/select-starter', { pokemon_id: pokemonId });
    setLoading(false);
    if (result.success) {
        showToast(`Você escolheu ${result.pokemon?.name || 'um Pokémon'}!`, 'success');
        await refreshSelectionState();
    } else {
        showToast(result.error || 'Erro ao selecionar', 'error');
    }
}

function startInitialTimer() {
    clearInitialTimer();
    GameState.initialTimerValue = GameState.initialTimer || 10;
    updateTimerDisplay();

    GameState.initialTimerInterval = setInterval(() => {
        GameState.initialTimerValue--;
        updateTimerDisplay();
        if (GameState.initialTimerValue <= 0) {
            clearInitialTimer();
            handleInitialTimerExpired();
        }
    }, 1000);
}

function clearInitialTimer() {
    if (GameState.initialTimerInterval) {
        clearInterval(GameState.initialTimerInterval);
        GameState.initialTimerInterval = null;
    }
}

function updateTimerDisplay() {
    const el = document.getElementById('initial-countdown');
    if (el) {
        el.textContent = `(${GameState.initialTimerValue}s)`;
        if (GameState.initialTimerValue <= 3) {
            el.style.color = '#ef4444';
        }
    }
}

async function handleInitialTimerExpired() {
    // Determine whose turn it is
    const players = GameState.players || [];
    const state = GameState.selectionState || {};
    const currentTurnIndex = state.room?.current_player_turn ?? 0;
    const currentPlayer = players[currentTurnIndex] || null;
    const isMyTurn = currentPlayer && currentPlayer.id == GameState.playerId;

    if (isMyTurn) {
        // My timer expired — auto-pick
        showToast('Tempo esgotado! Pokémon aleatório selecionado.', 'warning');
        setLoading(true);
        const result = await apiCall('/game/auto-pick-starter', {});
        setLoading(false);
        if (result.success) {
            showToast(`Recebeu ${result.pokemon?.name || 'um Pokémon'} automaticamente!`, 'info');
            await refreshSelectionState();
        }
    }
    // If not my turn, just wait — the other player's client will auto-pick for them
}

async function refreshSelectionState() {
    try {
        const result = await apiCall('/game/state', {}, 'GET');
        if (result.success) {
            GameState.selectionState = result;
            GameState.starters = result.starters || GameState.starters;
            GameState.players = result.players || [];
            if (result.room) GameState.currentRoute = result.room.current_route;
            renderStarterSelection();
        }
    } catch (err) {
        console.error('Error refreshing selection:', err);
    }
}

// ============================================
// CATCHING PHASE
// ============================================

async function initCatchingPhase() {
    if (DOM.catchingLogMessages) DOM.catchingLogMessages.innerHTML = '';
    addCatchingLog('Bem-vindo à Fase de Captura!', 'system');
    await refreshCatchingState();
}

async function refreshCatchingState() {
    if (!GameState.roomCode) return;
    try {
        const result = await apiCall(`/catching/state?room_code=${GameState.roomCode}`, {}, 'GET');
        if (!result.success) return;

        GameState.catchingState = result;
        const room = result.room;
        const players = result.players;
        const wild = result.wild_pokemon;

        GameState.currentRoute = room.current_route;

        // Update route header
        document.getElementById('route-name').textContent = `Rota ${room.current_route}`;
        document.getElementById('encounters-remaining').textContent = `Encontros: ${room.encounters_remaining}`;
        document.getElementById('route-progress').textContent = `Rota ${room.current_route}/5`;

        // Determine current turn
        const currentTurnIndex = room.current_player_turn;
        const currentPlayer = players[currentTurnIndex];
        GameState.isMyTurn = currentPlayer?.id == GameState.playerId;

        // Render
        renderPlayersPanel(players, currentTurnIndex);
        renderTurnIndicator(players, currentTurnIndex);
        renderWildPokemon(wild);
        updateActionButtons(wild);
    } catch (err) {
        console.error('Error refreshing catching:', err);
    }
}

function renderWildPokemon(wild) {
    if (wild) {
        DOM.wildPokemonDisplay?.classList.remove('hidden');
        DOM.wildPokemonPlaceholder?.classList.add('hidden');
        document.getElementById('wild-pokemon-img').src = wild.sprite_url || '';
        document.getElementById('wild-pokemon-name').textContent = wild.pokemon_name || wild.name;
        const typeDef = document.getElementById('wild-pokemon-type-def');
        typeDef.textContent = wild.type_defense;
        typeDef.className = `type-badge ${wild.type_defense}`;
        const typeAtk = document.getElementById('wild-pokemon-type-atk');
        if (wild.type_attack && wild.type_attack !== wild.type_defense) {
            typeAtk.textContent = wild.type_attack;
            typeAtk.className = `type-badge ${wild.type_attack}`;
            typeAtk.classList.remove('hidden');
        } else {
            typeAtk.classList.add('hidden');
        }
        const hpPct = (wild.current_hp / wild.max_hp) * 100;
        const hpBar = document.getElementById('wild-hp-bar');
        hpBar.style.width = `${hpPct}%`;
        hpBar.classList.remove('hp-medium', 'hp-low');
        if (hpPct <= 20) hpBar.classList.add('hp-low');
        else if (hpPct <= 50) hpBar.classList.add('hp-medium');
        document.getElementById('wild-hp-text').textContent = `${wild.current_hp}/${wild.max_hp}`;
        GameState.wildPokemon = wild;
    } else {
        DOM.wildPokemonDisplay?.classList.add('hidden');
        DOM.wildPokemonPlaceholder?.classList.remove('hidden');
        GameState.wildPokemon = null;
    }
}

function renderTurnIndicator(players, currentTurn) {
    const currentPlayer = players[currentTurn];
    const el = document.getElementById('current-turn-name');
    if (el && currentPlayer) {
        el.textContent = currentPlayer.id == GameState.playerId ? '🎯 Sua vez!' : `Vez de ${currentPlayer.player_name}`;
    }
    if (DOM.catchingTurnIndicator) {
        DOM.catchingTurnIndicator.classList.toggle('your-turn', GameState.isMyTurn);
    }
}

function updateActionButtons(wildPokemon) {
    const canAct = GameState.isMyTurn && wildPokemon;
    const container = document.getElementById('player-action-buttons');
    container?.classList.toggle('hidden', !GameState.isMyTurn);
    if (DOM.btnCatch) DOM.btnCatch.disabled = !canAct;
    if (DOM.btnUltraCatch) {
        const myPlayer = GameState.catchingState?.players?.find(p => p.id == GameState.playerId);
        const balls = myPlayer?.ultra_balls || 0;
        DOM.btnUltraCatch.disabled = !canAct || balls <= 0;
        document.getElementById('ultra-ball-count').textContent = balls;
    }
    if (DOM.btnAttack) {
        const myPlayer = GameState.catchingState?.players?.find(p => p.id == GameState.playerId);
        const hasActive = myPlayer?.team?.some(t => t.is_active);
        DOM.btnAttack.disabled = !canAct || !hasActive;
    }
}

function renderPlayersPanel(players, currentTurn) {
    if (!DOM.catchingPlayersPanel) return;
    DOM.catchingPlayersPanel.innerHTML = '';

    players.forEach(player => {
        const card = document.createElement('div');
        card.className = 'catching-player-card';
        if (player.player_number == currentTurn) card.classList.add('active-turn');
        const isMe = player.id == GameState.playerId;
        if (isMe) card.classList.add('is-you');

        const avatar = AVATARS[player.avatar_id - 1] || '😎';
        const team = player.team || [];

        let teamHtml = '<div class="player-team-grid">';
        team.forEach(pk => {
            const canEvolve = pk.evolution_id != null;
            teamHtml += `
                <div class="team-pokemon-slot ${pk.is_active ? 'active' : ''} ${isMe ? 'clickable' : ''}"
                     title="${pk.name}${pk.is_active ? ' (Ativo)' : ''}"
                     ${isMe ? `data-pokemon-id="${pk.id}"` : ''}>
                    <img src="${pk.sprite_url || ''}" alt="${pk.name}" class="team-pokemon-sprite" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'">
                    ${canEvolve ? `<span class="pokemon-exp-badge">${pk.current_exp || 0}</span>` : ''}
                </div>
            `;
        });
        for (let i = team.length; i < 6; i++) teamHtml += '<div class="team-pokemon-slot empty"></div>';
        teamHtml += '</div>';

        card.innerHTML = `
            <div class="catching-player-header">
                <span class="player-avatar-mini">${avatar}</span>
                <span class="player-name">${escapeHtml(player.player_name)}</span>
                ${player.player_number == currentTurn ? '<span class="turn-badge">🎯</span>' : ''}
            </div>
            ${teamHtml}
            <div class="catching-player-stats">
                <span class="stat-item">🎖️ ${player.badges || 0}</span>
                <span class="stat-item">💰 R$${player.money || 0}</span>
                <span class="stat-item">◓ ${player.ultra_balls || 0}</span>
            </div>
        `;

        if (isMe) {
            card.querySelectorAll('.team-pokemon-slot.clickable:not(.active)').forEach(slot => {
                slot.addEventListener('click', () => {
                    const id = slot.dataset.pokemonId;
                    if (id) setActivePokemon(id);
                });
            });
        }

        DOM.catchingPlayersPanel.appendChild(card);
    });
}

async function setActivePokemon(pokemonId) {
    const result = await apiCall('/catching/set-active', { pokemon_id: parseInt(pokemonId) });
    if (result.success) {
        showToast('Pokémon trocado!', 'success');
        await refreshCatchingState();
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

async function attemptCatch(useUltraBall = false) {
    if (!GameState.isMyTurn || !GameState.wildPokemon) {
        showToast('Não é sua vez!', 'warning');
        return;
    }
    setLoading(true);
    const result = await apiCall('/catching/catch', { use_ultra_ball: useUltraBall });
    setLoading(false);
    if (!result.success) showToast(result.error || 'Erro', 'error');
    // Result handled via WebSocket event
}

async function attackWildPokemon() {
    if (!GameState.isMyTurn || !GameState.wildPokemon) {
        showToast('Não é sua vez!', 'warning');
        return;
    }
    setLoading(true);
    const result = await apiCall('/catching/attack', {});
    setLoading(false);
    if (!result.success) showToast(result.error || 'Erro', 'error');
}

async function handleCatchAttemptEvent(eventData) {
    GameState.catchAnimationInProgress = true;
    await showInlineDiceAnimation(eventData.dice_roll, eventData.caught, eventData.used_ultra_ball);

    if (eventData.caught) {
        if (eventData.team_full) {
            addCatchingLog(`${eventData.player_name} capturou mas time cheio! +R$2`, 'success');
        } else if (eventData.used_ultra_ball) {
            addCatchingLog(`${eventData.player_name} usou Ultra Ball e capturou ${eventData.pokemon_name}! 🟣`, 'success');
        } else {
            addCatchingLog(`${eventData.player_name} capturou ${eventData.pokemon_name}! 🎉`, 'success');
        }
    } else {
        addCatchingLog(`${eventData.player_name} tirou ${(eventData.dice_roll || 0) + 1} - ${eventData.pokemon_name} escapou!`, 'miss');
    }

    GameState.catchAnimationInProgress = false;
    refreshCatchingState();
}

async function showInlineDiceAnimation(finalValue, caught, usedUltraBall) {
    if (usedUltraBall) {
        await showUltraBallAnimation();
        return;
    }
    const container = document.getElementById('catch-dice-animation');
    const face = container?.querySelector('.dice-face');
    if (!container || !face) return;

    container.className = 'catch-dice';
    container.classList.remove('hidden');
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

    // Roll animation
    let elapsed = 0;
    await new Promise(resolve => {
        const timer = setInterval(() => {
            elapsed += 50;
            face.textContent = faces[Math.floor(Math.random() * 6)];
            if (elapsed >= 500) { clearInterval(timer); resolve(); }
        }, 50);
    });

    face.textContent = faces[finalValue] || '🎲';
    container.classList.add('stopped', caught ? 'success' : 'fail');
    await new Promise(r => setTimeout(r, 600));
    container.classList.add('hidden');
}

async function showUltraBallAnimation() {
    const el = document.getElementById('ultra-ball-animation');
    if (!el) return;
    el.classList.remove('hidden', 'active');
    await new Promise(r => setTimeout(r, 10));
    el.classList.add('active');
    await new Promise(r => setTimeout(r, 1000));
    el.classList.add('hidden');
    el.classList.remove('active');
}

function addCatchingLog(message, type = 'info') {
    if (!DOM.catchingLogMessages) return;
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> ${message}`;
    DOM.catchingLogMessages.appendChild(entry);
    DOM.catchingLogMessages.scrollTop = DOM.catchingLogMessages.scrollHeight;
    while (DOM.catchingLogMessages.children.length > 50) DOM.catchingLogMessages.removeChild(DOM.catchingLogMessages.firstChild);
}

function handleCatchingKeyboard(e) {
    if (GameState.currentScreen !== 'catching' || !GameState.isMyTurn) return;
    switch (e.key.toLowerCase()) {
        case 'c': if (!DOM.btnCatch?.disabled) attemptCatch(false); break;
        case 'u': if (!DOM.btnUltraCatch?.disabled) attemptCatch(true); break;
        case 'a': if (!DOM.btnAttack?.disabled) attackWildPokemon(); break;
    }
}

// ============================================
// TOWN PHASE
// ============================================

async function initTownPhase() {
    await refreshTownState();
}

async function refreshTownState() {
    if (!GameState.roomCode) return;
    try {
        const result = await apiCall(`/town/state?room_code=${GameState.roomCode}`, {}, 'GET');
        if (!result.success) return;

        TownState.playerMoney = result.player.money;
        TownState.ultraBalls = result.player.ultra_balls;
        TownState.hasUsedMegaStone = result.player.has_used_mega_stone || false;
        TownState.team = result.team;
        TownState.isReady = result.player.is_ready;
        TownState.players = result.players;

        // Find active slot from team is_active flag
        TownState.activeSlot = 0;
        result.team.forEach((p, i) => {
            if (p.is_active) TownState.activeSlot = i;
        });

        renderTownUI();
    } catch (err) {
        console.error('Error loading town state:', err);
    }
}

function renderTownUI() {
    document.getElementById('town-player-money').textContent = `R$ ${TownState.playerMoney}`;
    document.getElementById('town-route-indicator').textContent = `Rota ${GameState.currentRoute}/5`;
    document.getElementById('town-ultra-count').textContent = TownState.ultraBalls;

    // Shop buttons
    const money = TownState.playerMoney;
    document.getElementById('btn-buy-evo-soda').disabled = money < 1;
    document.getElementById('btn-buy-ultra').disabled = money < 3;
    document.getElementById('btn-buy-hp-boost').disabled = money < 2;
    document.getElementById('btn-buy-attack-boost').disabled = money < 2;
    document.getElementById('btn-buy-speed-boost').disabled = money < 2;

    const megaBtn = document.getElementById('btn-buy-mega-stone');
    megaBtn.disabled = money < 5 || TownState.hasUsedMegaStone;
    if (TownState.hasUsedMegaStone) megaBtn.textContent = 'USADO';

    renderTownTeamGrid();
    renderTownPlayersList();
    updateReadyButton();
}

function renderTownTeamGrid() {
    const grid = document.getElementById('town-team-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (let i = 0; i < 6; i++) {
        const pokemon = TownState.team[i];
        const slot = document.createElement('div');
        slot.className = 'town-pokemon-slot';

        if (pokemon) {
            const isActive = i === TownState.activeSlot;
            const sellPrice = 2 + (pokemon.evolution_number || 0);
            const canEvolve = pokemon.evolution_id != null;
            if (isActive) slot.classList.add('active');
            if (pokemon.is_mega) slot.classList.add('mega-evolved');

            const spriteUrl = pokemon.sprite_url || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.pokemon_id}.png`;
            const img = document.createElement('img');
            img.src = spriteUrl;
            img.alt = pokemon.name;
            img.className = 'team-pokemon-sprite';
            img.onerror = () => { img.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'; };
            slot.appendChild(img);

            if (pokemon.is_mega) {
                const badge = document.createElement('span');
                badge.className = 'pokemon-mega-badge';
                badge.textContent = 'MEGA';
                slot.appendChild(badge);
            }

            if (canEvolve) {
                const expBadge = document.createElement('span');
                expBadge.className = 'pokemon-exp-badge';
                expBadge.textContent = pokemon.current_exp || 0;
                slot.appendChild(expBadge);
            }

            const sellBadge = document.createElement('span');
            sellBadge.className = 'pokemon-sell-badge';
            sellBadge.textContent = `$${sellPrice}`;
            slot.appendChild(sellBadge);

            // Show bonus stats if any
            const bonuses = [];
            if (pokemon.bonus_hp > 0) bonuses.push(`+${pokemon.bonus_hp}HP`);
            if (pokemon.bonus_attack > 0) bonuses.push(`+${pokemon.bonus_attack}ATK`);
            if (pokemon.bonus_speed > 0) bonuses.push(`+${pokemon.bonus_speed}SPD`);
            if (bonuses.length > 0) {
                const bonusBadge = document.createElement('span');
                bonusBadge.className = 'pokemon-bonus-badge';
                bonusBadge.textContent = bonuses.join(' ');
                slot.appendChild(bonusBadge);
            }

            slot.title = `${pokemon.name}${isActive ? ' (Ativo)' : ''}\nVender: R$${sellPrice}`;
            slot.addEventListener('click', () => handleTownPokemonClick(pokemon, i));
        } else {
            slot.classList.add('empty');
        }
        grid.appendChild(slot);
    }

    const activePokemon = TownState.team[TownState.activeSlot];
    document.getElementById('town-active-name').textContent = activePokemon ? activePokemon.name : '---';
}

function handleTownPokemonClick(pokemon, slot) {
    if (slot === TownState.activeSlot) {
        if (TownState.team.filter(p => p).length > 1) {
            showSellConfirmation(pokemon);
        } else {
            showToast('Não pode vender o último Pokémon!', 'warning');
        }
    } else {
        setTownActivePokemon(slot);
    }
}

async function setTownActivePokemon(slot) {
    const result = await apiCall('/town/set-active', { slot });
    if (result.success) {
        TownState.activeSlot = slot;
        showToast('Pokémon ativo trocado!', 'success');
        renderTownUI();
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

function showSellConfirmation(pokemon) {
    const sellPrice = 2 + (pokemon.evolution_number || 0);
    const overlay = document.createElement('div');
    overlay.className = 'sell-modal-overlay';
    overlay.id = 'sell-modal-overlay';
    overlay.innerHTML = `
        <div class="sell-modal">
            <h3>Vender Pokémon?</h3>
            <div class="sell-modal-pokemon">
                <img src="${pokemon.sprite_url}" alt="${pokemon.name}" onerror="this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'">
                <span>${pokemon.name}</span>
                <span class="sell-modal-price">R$ ${sellPrice}</span>
            </div>
            <div class="sell-modal-actions">
                <button class="btn btn-danger" id="btn-confirm-sell">Vender</button>
                <button class="btn btn-secondary" id="btn-cancel-sell">Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('btn-confirm-sell').addEventListener('click', () => confirmSellPokemon(pokemon));
    document.getElementById('btn-cancel-sell').addEventListener('click', closeSellModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSellModal(); });
}

function closeSellModal() {
    document.getElementById('sell-modal-overlay')?.remove();
}

async function confirmSellPokemon(pokemon) {
    closeSellModal();
    const result = await apiCall('/town/sell', { team_id: pokemon.id });
    if (result.success) {
        showToast(`Vendeu ${pokemon.name} por R$${result.sell_price}!`, 'success');
        addTownLogMessage(`Vendeu ${pokemon.name} por R$${result.sell_price}`, 'sell');
        await refreshTownState();
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

async function buyItem(item) {
    const result = await apiCall('/town/buy', { item });
    if (result.success) {
        showToast(result.message || 'Compra realizada!', 'success');
        if (result.evolved) addTownLogMessage(`🎉 Pokémon evoluiu para ${result.evolved.to}!`, 'evolution');
        else addTownLogMessage(`Comprou ${item.replace('_', ' ')}`, 'purchase');
        await refreshTownState();
    } else {
        showToast(result.error || 'Erro na compra', 'error');
    }
}

async function toggleTownReady() {
    const result = await apiCall('/town/ready', {});
    if (result.success) {
        TownState.isReady = result.is_ready;
        updateReadyButton();
        showToast(result.is_ready ? 'Pronto!' : 'Cancelado', 'info');
        if (result.all_ready) showToast('Todos prontos! Iniciando torneio...', 'success');
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

function updateReadyButton() {
    const btn = document.getElementById('btn-town-ready');
    if (!btn) return;
    btn.textContent = TownState.isReady ? 'Cancelar Pronto' : 'Pronto para o Torneio';
    btn.classList.toggle('is-ready', TownState.isReady);
    const readyCount = TownState.players.filter(p => p.is_ready).length;
    document.getElementById('town-ready-status').textContent = `${readyCount}/${TownState.players.length} prontos`;
}

function renderTownPlayersList() {
    const list = document.getElementById('town-players-list');
    if (!list) return;
    list.innerHTML = '';
    TownState.players.forEach(p => {
        const card = document.createElement('div');
        card.className = 'town-player-card';
        if (p.is_ready) card.classList.add('ready');
        if (p.id == GameState.playerId) card.classList.add('is-self');
        const avatar = AVATARS[(p.avatar_id || 1) - 1] || '😎';
        card.innerHTML = `
            <div class="town-player-avatar">${avatar}</div>
            <div class="town-player-info">
                <span class="town-player-name">${escapeHtml(p.player_name)}</span>
                <span class="town-player-status ${p.is_ready ? 'ready' : ''}">${p.is_ready ? '✓ Pronto' : 'Comprando...'}</span>
            </div>
        `;
        list.appendChild(card);
    });
}

function addTownLogMessage(message, type = 'info') {
    const log = document.getElementById('town-log-messages');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 30) log.removeChild(log.firstChild);
}

function handleTownEvent(eventType, data) {
    switch (eventType) {
        case 'town_purchase':
            if (data.player_id != GameState.playerId) {
                addTownLogMessage(`${data.player_name} comprou ${data.item}`, 'info');
                if (data.evolved) addTownLogMessage(`${data.pokemon_name} evoluiu para ${data.evolved_to}!`, 'evolution');
            }
            break;
        case 'town_sell':
            if (data.player_id != GameState.playerId) {
                addTownLogMessage(`${data.player_name} vendeu ${data.pokemon_name}`, 'info');
            }
            break;
        case 'town_ready_toggle':
            refreshTownState();
            break;
        case 'town_phase_change':
            if (data.new_phase === 'tournament') {
                showToast('Todos prontos! Torneio começando!', 'success');
                handleGameStateChange('tournament');
            }
            break;
        case 'town_switch_active':
            if (data.player_id != GameState.playerId) {
                addTownLogMessage(`${data.player_name} trocou para ${data.pokemon_name}`, 'info');
            }
            break;
    }
}

// ============================================
// TOURNAMENT PHASE
// ============================================

async function initTournamentPhase() {
    await refreshTournamentState();
}

async function refreshTournamentState() {
    if (!GameState.roomCode) return;
    try {
        const result = await apiCall(`/tournament/state?room_code=${GameState.roomCode}`, {}, 'GET');
        if (!result.success) return;

        const matches = result.tournament?.matches || [];
        TournamentState.players = result.players || [];
        GameState.currentRoute = result.tournament?.current_route || GameState.currentRoute;

        // Find the host player
        const hostPlayer = TournamentState.players.find(p => p.is_host);
        TournamentState.hostPlayerId = hostPlayer?.id;

        // Build brackets from matches
        TournamentState.brackets = matches.map((m, idx) => {
            const p1 = m.player1_id ? {
                id: m.player1_id,
                name: m.player1_name,
                avatar: m.player1_avatar,
                badges: m.player1_badges || 0,
            } : null;

            let p2;
            if (m.is_npc_battle && m.npc_leader) {
                p2 = {
                    id: null,
                    name: m.npc_leader.name,
                    title: m.npc_leader.title,
                    avatar: m.npc_leader.avatar || '🏆',
                    is_npc: true,
                    badges: 0,
                };
            } else {
                p2 = m.player2_id ? {
                    id: m.player2_id,
                    name: m.player2_name,
                    avatar: m.player2_avatar,
                    badges: m.player2_badges || 0,
                } : null;
            }

            return {
                match_index: m.match_index,
                player1: p1,
                player2: p2,
                winner_id: m.winner_id,
                status: m.status,
                is_npc_battle: !!m.is_npc_battle,
                is_tiebreaker: !!m.is_tiebreaker,
            };
        });

        // Calculate completed & total
        TournamentState.completedMatches = matches.filter(m => m.status === 'completed').length;
        TournamentState.totalMatches = matches.length;
        TournamentState.isTiebreaker = matches.some(m => m.is_tiebreaker);

        // Identify bye player (odd count — not in any match)
        const matchedPlayerIds = new Set();
        matches.forEach(m => {
            if (m.player1_id) matchedPlayerIds.add(m.player1_id);
            if (m.player2_id && !m.is_npc_battle) matchedPlayerIds.add(m.player2_id);
        });
        const byePlayer = TournamentState.players.find(p => !matchedPlayerIds.has(p.id));
        TournamentState.byePlayer = byePlayer ? {
            id: byePlayer.id,
            name: byePlayer.player_name,
            avatar: byePlayer.avatar_id,
            badges: byePlayer.badges || 0,
        } : null;

        // Current match = next pending or in_progress
        const nextMatch = result.next_pending_match || result.current_match;
        if (nextMatch) {
            const nm = nextMatch;
            let p2Data;
            if (nm.is_npc_battle && nm.npc_leader) {
                p2Data = {
                    id: null,
                    name: nm.npc_leader.name,
                    title: nm.npc_leader.title,
                    avatar: nm.npc_leader.avatar || '🏆',
                    is_npc: true,
                    badges: 0,
                };
            } else {
                p2Data = {
                    id: nm.player2_id,
                    name: nm.player2_name,
                    avatar: nm.player2_avatar,
                    badges: nm.player2_badges || 0,
                };
            }
            TournamentState.currentMatch = {
                match_index: nm.match_index,
                player1: {
                    id: nm.player1_id,
                    name: nm.player1_name,
                    avatar: nm.player1_avatar,
                    badges: nm.player1_badges || 0,
                },
                player2: p2Data,
                is_npc_battle: !!nm.is_npc_battle,
                status: nm.status,
            };
        } else {
            TournamentState.currentMatch = null;
        }

        renderTournamentUI();
    } catch (err) {
        console.error('Error loading tournament:', err);
    }
}

function renderTournamentUI() {
    document.getElementById('tournament-route').textContent = TournamentState.isTiebreaker ? '⚔️ DESEMPATE' : `Rota ${GameState.currentRoute}`;
    document.getElementById('tournament-progress').textContent = `Partida ${TournamentState.completedMatches}/${TournamentState.totalMatches}`;

    const isHost = String(GameState.playerId) === String(TournamentState.hostPlayerId);
    document.getElementById('tournament-host-badge')?.classList.toggle('hidden', !isHost);

    renderTournamentBrackets();
    renderByePlayer();
    renderCurrentMatchPanel();
    renderTournamentStandings();
}

function renderTournamentBrackets() {
    const container = document.getElementById('tournament-brackets');
    if (!container) return;
    container.innerHTML = '';

    TournamentState.brackets.forEach((bracket, index) => {
        const el = document.createElement('div');
        el.className = 'bracket-match';
        if (bracket.status === 'completed') el.classList.add('completed');
        else if (bracket.status === 'in_progress') el.classList.add('current');
        if (bracket.is_npc_battle) el.classList.add('npc-battle');

        const p1 = bracket.player1;
        const p2 = bracket.player2;
        const winnerId = bracket.winner_id;
        const av1 = p1 ? (AVATARS[p1.avatar - 1] || '😎') : '?';
        const av2 = p2?.is_npc ? (p2.avatar || '🏆') : (p2 ? (AVATARS[p2.avatar - 1] || '😎') : '?');
        const p1Class = winnerId ? (winnerId == p1?.id ? 'winner' : 'loser') : '';
        const p2Class = winnerId ? (winnerId == p2?.id ? 'winner' : 'loser') : '';

        let resultHtml = bracket.status === 'completed' ? `<span class="winner-badge">✓</span>` : (bracket.status === 'in_progress' ? '<span class="pending">⚔️</span>' : '<span class="pending">Pendente</span>');

        el.innerHTML = `
            <div class="bracket-match-number">${bracket.is_npc_battle ? '🏟️ Ginásio' : `Partida ${index + 1}`}</div>
            <div class="bracket-players">
                <div class="bracket-player ${p1Class}">
                    <span class="bracket-player-avatar">${av1}</span>
                    <div class="bracket-player-info">
                        <div class="bracket-player-name">${p1?.name || 'TBD'}</div>
                        <div class="bracket-player-badges">🎖️ ${p1?.badges || 0}</div>
                    </div>
                </div>
                <span class="bracket-vs">VS</span>
                <div class="bracket-player ${p2Class} ${bracket.is_npc_battle ? 'npc-player' : ''}">
                    <span class="bracket-player-avatar">${av2}</span>
                    <div class="bracket-player-info">
                        <div class="bracket-player-name ${bracket.is_npc_battle ? 'npc-name' : ''}">${p2?.name || 'TBD'}</div>
                        ${bracket.is_npc_battle && p2?.title ? `<div class="bracket-player-title">${p2.title}</div>` : `<div class="bracket-player-badges">🎖️ ${p2?.badges || 0}</div>`}
                    </div>
                </div>
            </div>
            <div class="bracket-result">${resultHtml}</div>
        `;
        container.appendChild(el);
    });
}

function renderByePlayer() {
    const container = document.getElementById('tournament-bye');
    const info = document.getElementById('bye-player-info');
    if (!container || !info) return;
    if (TournamentState.byePlayer) {
        container.classList.remove('hidden');
        const av = AVATARS[TournamentState.byePlayer.avatar - 1] || '😎';
        info.innerHTML = `<span class="bye-player-avatar">${av}</span> <span class="bye-player-name">${TournamentState.byePlayer.name}</span> <span class="bye-player-badges">🎖️ ${TournamentState.byePlayer.badges}</span>`;
    } else {
        container.classList.add('hidden');
    }
}

function renderCurrentMatchPanel() {
    const matchPanel = document.getElementById('current-match-panel');
    const completePanel = document.getElementById('tournament-complete-panel');
    if (!matchPanel || !completePanel) return;

    const allComplete = TournamentState.brackets.every(b => b.status === 'completed');
    const isHost = String(GameState.playerId) === String(TournamentState.hostPlayerId);

    if (allComplete) {
        matchPanel.classList.add('hidden');
        completePanel.classList.remove('hidden');
        document.getElementById('btn-next-route')?.classList.toggle('hidden', !isHost);
        document.getElementById('tournament-complete-waiting')?.classList.toggle('hidden', isHost);
        return;
    }

    matchPanel.classList.remove('hidden');
    completePanel.classList.add('hidden');

    const match = TournamentState.currentMatch;
    if (!match || !match.player1 || !match.player2) return;

    const p1 = match.player1;
    const p2 = match.player2;
    const av1 = AVATARS[p1.avatar - 1] || '😎';
    const av2 = p2.is_npc ? (p2.avatar || '🏆') : (AVATARS[p2.avatar - 1] || '😎');
    const isP1 = p1.id == GameState.playerId;
    const isP2 = p2.id == GameState.playerId;

    document.getElementById('match-player1').className = `match-player ${isP1 ? 'is-you' : ''}`;
    document.getElementById('match-player1').innerHTML = `<div class="match-player-avatar">${av1}</div><div class="match-player-name">${p1.name}${isP1 ? ' (Você)' : ''}</div><div class="match-player-badges">🎖️ ${p1.badges}</div>`;

    document.getElementById('match-player2').className = `match-player ${isP2 ? 'is-you' : ''}`;
    document.getElementById('match-player2').innerHTML = `<div class="match-player-avatar">${av2}</div><div class="match-player-name">${p2.name}${isP2 ? ' (Você)' : ''}</div><div class="match-player-badges">🎖️ ${p2.badges || 0}</div>`;

    const btnStart = document.getElementById('btn-start-battle');
    const waitingMsg = document.getElementById('match-waiting');
    if (isHost) {
        btnStart?.classList.remove('hidden');
        waitingMsg?.classList.add('hidden');
    } else {
        btnStart?.classList.add('hidden');
        waitingMsg?.classList.remove('hidden');
    }
}

function renderTournamentStandings() {
    const list = document.getElementById('tournament-standings-list');
    if (!list) return;
    list.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'standings-header';
    header.innerHTML = '<span class="standings-goal">🎯 5 insígnias para vencer!</span>';
    list.appendChild(header);

    const sorted = [...TournamentState.players].sort((a, b) => (b.badges || 0) - (a.badges || 0) || (b.money || 0) - (a.money || 0));
    sorted.forEach((p, i) => {
        const rank = i + 1;
        const rankClass = rank === 1 ? 'gold' : (rank === 2 ? 'silver' : (rank === 3 ? 'bronze' : ''));
        const avatar = AVATARS[(p.avatar_id || 1) - 1] || '😎';
        const isYou = p.id == GameState.playerId;
        const el = document.createElement('div');
        el.className = `standings-player ${isYou ? 'is-you' : ''}`;
        el.innerHTML = `
            <span class="standings-rank ${rankClass}">#${rank}</span>
            <span class="standings-player-avatar">${avatar}</span>
            <div class="standings-player-info">
                <div class="standings-player-name">${p.player_name}${isYou ? ' (Você)' : ''}</div>
                <div class="standings-player-badges">🎖️ ${p.badges || 0}/5</div>
            </div>
            <span class="standings-player-money">R$${p.money || 0}</span>
        `;
        list.appendChild(el);
    });
}

async function startNextBattle() {
    if (!TournamentState.currentMatch) return;
    if (String(GameState.playerId) !== String(TournamentState.hostPlayerId)) {
        showToast('Apenas o host pode iniciar!', 'warning');
        return;
    }
    setLoading(true);
    const result = await apiCall('/tournament/start-match', { match_index: TournamentState.currentMatch.match_index });
    setLoading(false);
    if (result.success) {
        showToast('Batalha iniciando!', 'success');
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

async function completeTournament() {
    if (String(GameState.playerId) !== String(TournamentState.hostPlayerId)) {
        showToast('Apenas o host!', 'warning');
        return;
    }
    setLoading(true);
    const result = await apiCall('/tournament/complete', {});
    setLoading(false);
    if (result.success) {
        if (result.game_finished) {
            showToast(`🏆 ${result.winner?.name || 'Alguém'} venceu!`, 'success');
        } else {
            showToast(`Avançando para Rota ${result.new_route}!`, 'success');
        }
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

function handleTournamentEvent(eventType, data) {
    switch (eventType) {
        case 'battle_started':
            showToast(`Batalha: ${data?.player1?.name || '?'} vs ${data?.player2?.name || '?'}!`, 'info');
            handleGameStateChange('battle');
            break;
        case 'match_completed':
            showToast(`${data.winner_name} venceu!`, 'info');
            refreshTournamentState();
            break;
        case 'tournament_updated':
            refreshTournamentState();
            break;
        case 'game_finished':
            showToast(`🏆 ${data.winner_name} venceu o jogo!`, 'success');
            handleGameStateChange('finished');
            break;
    }
}

// ============================================
// BATTLE PHASE
// ============================================

async function initBattlePhase() {
    if (DOM.battleLogMessages) DOM.battleLogMessages.innerHTML = '';

    try {
        const result = await apiCall(`/battle/state?room_code=${GameState.roomCode}`, {}, 'GET');
        if (!result.success) { showToast(result.error || 'Erro ao carregar batalha', 'error'); return; }

        const bs = result.battle;
        const match = result.match;
        BattleState.isNpcBattle = match?.is_npc_battle || false;
        BattleState.npcData = match?.npc_leader || null;
        BattleState.isMyBattle = (GameState.playerId == match?.player1_id || (!BattleState.isNpcBattle && GameState.playerId == match?.player2_id));
        BattleState.amPlayer1 = (GameState.playerId == match?.player1_id);
        BattleState.player1 = {
            id: match?.player1_id,
            name: match?.player1_name,
            avatar: match?.player1_avatar,
        };
        BattleState.player2 = {
            id: match?.player2_id,
            name: match?.player2_name,
            avatar: match?.player2_avatar,
            is_npc: BattleState.isNpcBattle,
        };
        if (BattleState.isNpcBattle && match?.npc_leader) {
            BattleState.player2.avatar = match.npc_leader.avatar;
            BattleState.player2.name = match.npc_leader.name;
        }
        BattleState.player1Team = result.player1_team || [];
        BattleState.player2Team = result.player2_team || [];
        BattleState.player1Active = bs.player1_active_index;
        BattleState.player2Active = bs.player2_active_index;
        BattleState.player1HasSelected = bs.player1_has_selected;
        BattleState.player2HasSelected = bs.player2_has_selected;
        BattleState.phase = bs.phase;
        BattleState.currentTurn = bs.current_turn;

        renderBattleHeader();
        renderBattleArena();
        renderBattleTeamPreviews();
        updateBattleStatus();

        if (bs.phase === 'selection' && BattleState.isMyBattle) {
            const mySelected = BattleState.amPlayer1 ? BattleState.player1HasSelected : BattleState.player2HasSelected;
            if (!mySelected) showPokemonSelectionPanel();
            else showWaitingForOpponent();
        } else if (bs.phase === 'selection') {
            hidePokemonSelectionPanel();
            addBattleLog('Assistindo esta batalha.');
        }

        addBattleLog(`Batalha: ${BattleState.player1?.name} vs ${BattleState.player2?.name}!`);
    } catch (err) {
        console.error('Error initializing battle:', err);
        showToast('Erro ao carregar batalha', 'error');
    }
}

async function refreshBattleState() {
    try {
        const result = await apiCall(`/battle/state?room_code=${GameState.roomCode}`, {}, 'GET');
        if (!result.success) return;
        const bs = result.battle;
        BattleState.player1Team = result.player1_team || BattleState.player1Team;
        BattleState.player2Team = result.player2_team || BattleState.player2Team;
        BattleState.player1Active = bs.player1_active_index;
        BattleState.player2Active = bs.player2_active_index;
        BattleState.player1HasSelected = bs.player1_has_selected;
        BattleState.player2HasSelected = bs.player2_has_selected;
        BattleState.phase = bs.phase;
        BattleState.currentTurn = bs.current_turn;
        renderBattleArena();
        renderBattleTeamPreviews();
        updateBattleStatus();
    } catch (err) {
        console.error('Error refreshing battle state:', err);
    }
}

function renderBattleHeader() {
    const p1Avatar = BattleState.player1?.avatar;
    if (DOM.battleP1Avatar) DOM.battleP1Avatar.textContent = (typeof p1Avatar === 'number' ? AVATARS[p1Avatar - 1] : p1Avatar) || '😎';
    if (DOM.battleP1Name) DOM.battleP1Name.textContent = BattleState.player1?.name || 'Jogador 1';

    const isNpc = BattleState.player2?.is_npc || BattleState.isNpcBattle;
    if (isNpc) {
        if (DOM.battleP2Avatar) DOM.battleP2Avatar.textContent = BattleState.player2?.avatar || '🏆';
        if (DOM.battleP2Name) DOM.battleP2Name.innerHTML = `<span class="npc-name">${BattleState.player2?.name || 'Líder'}</span>`;
    } else {
        const p2Avatar = BattleState.player2?.avatar;
        if (DOM.battleP2Avatar) DOM.battleP2Avatar.textContent = (typeof p2Avatar === 'number' ? AVATARS[p2Avatar - 1] : p2Avatar) || '😎';
        if (DOM.battleP2Name) DOM.battleP2Name.textContent = BattleState.player2?.name || 'Jogador 2';
    }
}

function renderBattleArena() {
    const inSelection = BattleState.phase === 'selection';

    // Player 1
    const p1 = BattleState.player1Active !== null && BattleState.player1Active !== undefined
        ? BattleState.player1Team[BattleState.player1Active] : null;
    const showP1 = !inSelection || BattleState.amPlayer1 || (BattleState.player1HasSelected && BattleState.player2HasSelected);
    if (p1 && showP1) {
        if (DOM.battleP1Sprite) { DOM.battleP1Sprite.src = p1.sprite_url || ''; DOM.battleP1Sprite.classList.toggle('fainted', !!p1.is_fainted); DOM.battleP1Sprite.classList.remove('hidden-selection'); }
        if (DOM.battleP1PokemonName) DOM.battleP1PokemonName.textContent = p1.name;
        updateHpBar('p1', p1.current_hp, p1.max_hp);
        updatePokemonStats('p1', p1);
    } else if (inSelection && BattleState.player1HasSelected) {
        if (DOM.battleP1Sprite) { DOM.battleP1Sprite.src = ''; DOM.battleP1Sprite.classList.add('hidden-selection'); }
        if (DOM.battleP1PokemonName) DOM.battleP1PokemonName.textContent = '???';
        clearPokemonStats('p1');
    } else {
        if (DOM.battleP1Sprite) DOM.battleP1Sprite.src = '';
        if (DOM.battleP1PokemonName) DOM.battleP1PokemonName.textContent = '---';
        clearPokemonStats('p1');
    }

    // Player 2
    const p2 = BattleState.player2Active !== null && BattleState.player2Active !== undefined
        ? BattleState.player2Team[BattleState.player2Active] : null;
    const showP2 = !inSelection || !BattleState.amPlayer1 || (BattleState.player1HasSelected && BattleState.player2HasSelected);
    if (p2 && showP2) {
        if (DOM.battleP2Sprite) { DOM.battleP2Sprite.src = p2.sprite_url || ''; DOM.battleP2Sprite.classList.toggle('fainted', !!p2.is_fainted); DOM.battleP2Sprite.classList.remove('hidden-selection'); }
        if (DOM.battleP2PokemonName) DOM.battleP2PokemonName.textContent = p2.name;
        updateHpBar('p2', p2.current_hp, p2.max_hp);
        updatePokemonStats('p2', p2);
    } else if (inSelection && BattleState.player2HasSelected) {
        if (DOM.battleP2Sprite) { DOM.battleP2Sprite.src = ''; DOM.battleP2Sprite.classList.add('hidden-selection'); }
        if (DOM.battleP2PokemonName) DOM.battleP2PokemonName.textContent = '???';
        clearPokemonStats('p2');
    } else {
        if (DOM.battleP2Sprite) DOM.battleP2Sprite.src = '';
        if (DOM.battleP2PokemonName) DOM.battleP2PokemonName.textContent = '---';
        clearPokemonStats('p2');
    }
}

function updateHpBar(player, currentHp, maxHp) {
    const bar = player === 'p1' ? DOM.battleP1HpBar : DOM.battleP2HpBar;
    const text = player === 'p1' ? DOM.battleP1HpText : DOM.battleP2HpText;
    if (!bar || !text) return;
    const pct = Math.max(0, (currentHp / maxHp) * 100);
    bar.style.width = `${pct}%`;
    text.textContent = `${currentHp}/${maxHp}`;
    bar.classList.remove('medium', 'low');
    if (pct <= 20) bar.classList.add('low');
    else if (pct <= 50) bar.classList.add('medium');
}

function updatePokemonStats(player, pokemon) {
    const atkEl = player === 'p1' ? DOM.battleP1Attack : DOM.battleP2Attack;
    const spdEl = player === 'p1' ? DOM.battleP1Speed : DOM.battleP2Speed;
    const typeAtkEl = player === 'p1' ? DOM.battleP1TypeAtk : DOM.battleP2TypeAtk;
    const typeDefEl = player === 'p1' ? DOM.battleP1TypeDef : DOM.battleP2TypeDef;
    const statsEl = player === 'p1' ? DOM.battleP1Stats : DOM.battleP2Stats;
    if (statsEl) statsEl.classList.remove('hidden');
    // battle_pokemon snapshot has 'attack' and 'speed' directly (already includes bonuses)
    const atkValue = pokemon.attack || pokemon.base_attack || 0;
    const baseDmg = Math.ceil(atkValue * 0.1);
    if (atkEl) atkEl.textContent = baseDmg;
    const spdValue = pokemon.speed || pokemon.base_speed || 0;
    if (spdEl) spdEl.textContent = spdValue;
    const atkType = pokemon.type_attack || '???';
    const defType = pokemon.type_defense || '???';
    if (typeAtkEl) { typeAtkEl.textContent = `⚔️ ${atkType}`; typeAtkEl.className = `type-badge ${atkType.toLowerCase()}`; }
    if (typeDefEl) { typeDefEl.textContent = `🛡️ ${defType}`; typeDefEl.className = `type-badge ${defType.toLowerCase()}`; }
}

function clearPokemonStats(player) {
    const statsEl = player === 'p1' ? DOM.battleP1Stats : DOM.battleP2Stats;
    if (statsEl) statsEl.classList.add('hidden');
}

function renderBattleTeamPreviews() {
    if (DOM.battleP1Team) {
        DOM.battleP1Team.innerHTML = '';
        BattleState.player1Team.forEach((pk, i) => {
            const icon = document.createElement('div');
            icon.className = `team-pokemon-icon ${i === BattleState.player1Active ? 'active' : ''} ${pk.is_fainted ? 'fainted' : ''}`;
            icon.innerHTML = `<img src="${pk.sprite_url || ''}" alt="${pk.name}">`;
            DOM.battleP1Team.appendChild(icon);
        });
    }
    if (DOM.battleP2Team) {
        DOM.battleP2Team.innerHTML = '';
        BattleState.player2Team.forEach((pk, i) => {
            const icon = document.createElement('div');
            icon.className = `team-pokemon-icon ${i === BattleState.player2Active ? 'active' : ''} ${pk.is_fainted ? 'fainted' : ''}`;
            icon.innerHTML = `<img src="${pk.sprite_url || ''}" alt="${pk.name || '?'}">`;
            DOM.battleP2Team.appendChild(icon);
        });
    }
}

function updateBattleStatus() {
    if (!DOM.battleStatus) return;
    if (BattleState.phase === 'selection') {
        if (BattleState.isMyBattle) {
            const mySelected = BattleState.amPlayer1 ? BattleState.player1HasSelected : BattleState.player2HasSelected;
            DOM.battleStatus.textContent = mySelected ? 'Aguardando oponente...' : 'Escolha seu Pokémon!';
            DOM.battleStatus.className = `battle-status ${mySelected ? 'waiting' : 'your-turn'}`;
        } else {
            DOM.battleStatus.textContent = '👁️ Assistindo...';
            DOM.battleStatus.className = 'battle-status spectating';
        }
    } else if (BattleState.phase === 'combat') {
        const attackerName = BattleState.currentTurn === 'player1' ? BattleState.player1?.name : BattleState.player2?.name;
        DOM.battleStatus.textContent = `Vez de ${attackerName || '?'}`;
        DOM.battleStatus.className = 'battle-status';
    } else if (BattleState.phase === 'finished') {
        DOM.battleStatus.textContent = 'Batalha finalizada!';
        DOM.battleStatus.className = 'battle-status';
    }
}

function showPokemonSelectionPanel(isReplacement = false) {
    if (!DOM.battleSelectionPanel || !DOM.battleSelectionGrid) return;
    DOM.battleSelectionPanel.classList.remove('hidden', 'waiting');
    DOM.battleSelectionTitle.textContent = isReplacement ? 'Escolha seu próximo Pokémon!' : 'Escolha seu Pokémon!';
    const myTeam = BattleState.amPlayer1 ? BattleState.player1Team : BattleState.player2Team;
    DOM.battleSelectionGrid.innerHTML = '';
    myTeam.forEach((pk, index) => {
        const card = document.createElement('div');
        card.className = 'battle-select-pokemon';
        if (pk.is_fainted) card.classList.add('fainted');
        const atkType = pk.type_attack || '???';
        const defType = pk.type_defense || '???';
        card.innerHTML = `
            <img src="${pk.sprite_url || ''}" alt="${pk.name}">
            <span class="pokemon-name">${pk.name}</span>
            <span class="pokemon-hp">${pk.is_fainted ? 'Desmaiado' : `HP: ${pk.current_hp}/${pk.max_hp}`}</span>
            <div class="pokemon-select-types">
                <span class="type-badge ${atkType.toLowerCase()}">⚔️ ${atkType}</span>
                <span class="type-badge ${defType.toLowerCase()}">🛡️ ${defType}</span>
            </div>
        `;
        if (!pk.is_fainted) card.addEventListener('click', () => selectBattlePokemon(index, isReplacement));
        DOM.battleSelectionGrid.appendChild(card);
    });
}

function hidePokemonSelectionPanel() {
    DOM.battleSelectionPanel?.classList.add('hidden');
}

function showWaitingForOpponent() {
    if (!DOM.battleSelectionPanel) return;
    DOM.battleSelectionPanel.classList.remove('hidden');
    DOM.battleSelectionPanel.classList.add('waiting');
    DOM.battleSelectionTitle.textContent = 'Aguardando oponente...';
    DOM.battleSelectionGrid.innerHTML = '<p style="color:var(--text-secondary)">Seu Pokémon está pronto!</p>';
}

async function selectBattlePokemon(teamIndex, isReplacement = false) {
    setLoading(true);
    const result = await apiCall('/battle/select-pokemon', { team_index: teamIndex });
    setLoading(false);
    if (result.success) {
        showToast('Pokémon selecionado!', 'success');
        if (BattleState.amPlayer1) BattleState.player1Active = teamIndex;
        else BattleState.player2Active = teamIndex;
        renderBattleArena();
        renderBattleTeamPreviews();
        if (result.both_selected) {
            hidePokemonSelectionPanel();
            BattleState.phase = 'combat';
        } else {
            showWaitingForOpponent();
        }
        updateBattleStatus();
    } else {
        showToast(result.error || 'Erro', 'error');
    }
}

function handleBattleEvent(eventType, data) {
    switch (eventType) {
        case 'pokemon_selected':
            if (data.both_selected) {
                // Both selected — combat will start via 'combat_started' event
                BattleState.player1HasSelected = true;
                BattleState.player2HasSelected = true;
            } else {
                addBattleLog(`${data.player_name} escolheu seu Pokémon!`, 'info');
                if (data.side === 'player1') BattleState.player1HasSelected = true;
                else BattleState.player2HasSelected = true;
            }
            renderBattleArena();
            renderBattleTeamPreviews();
            updateBattleStatus();
            break;

        case 'combat_started':
            BattleState.phase = 'combat';
            BattleState.currentTurn = data.first_turn;
            // Update active pokemon from the combat_started data
            if (data.player1_pokemon) {
                // Find index by matching name/sprite in team
                const p1Idx = BattleState.player1Team.findIndex(p => p.name === data.player1_pokemon.name);
                if (p1Idx >= 0) BattleState.player1Active = p1Idx;
            }
            if (data.player2_pokemon) {
                const p2Idx = BattleState.player2Team.findIndex(p => p.name === data.player2_pokemon.name);
                if (p2Idx >= 0) BattleState.player2Active = p2Idx;
            }
            BattleState.player1HasSelected = true;
            BattleState.player2HasSelected = true;
            hidePokemonSelectionPanel();
            addBattleLog(`Batalha começa! ${data.first_turn === 'player1' ? BattleState.player1?.name : BattleState.player2?.name} ataca primeiro!`);
            // Refresh full battle state to get accurate indices
            refreshBattleState();
            break;

        case 'attack':
            handleAttackEvent(data);
            break;

        case 'pokemon_fainted':
            // Backend sends { side, pokemon_name }
            // Determine if the fainted side is the current player's side
            const myBattleSide = BattleState.amPlayer1 ? 'player1' : 'player2';
            const needsSelection = data.side === myBattleSide && BattleState.isMyBattle;
            if (needsSelection) {
                BattleState.phase = 'selection';
                showPokemonSelectionPanel(true);
            }
            renderBattleArena();
            renderBattleTeamPreviews();
            break;

        case 'needs_replacement':
            // Backend sends { side, remaining }
            const mySide = BattleState.amPlayer1 ? 'player1' : 'player2';
            if (data.side === mySide && BattleState.isMyBattle) {
                // Update the team with remaining info
                if (data.remaining) {
                    data.remaining.forEach(rp => {
                        const existing = (mySide === 'player1' ? BattleState.player1Team : BattleState.player2Team)[rp.team_index];
                        if (existing) Object.assign(existing, rp);
                    });
                }
                showPokemonSelectionPanel(true);
            }
            break;

        case 'pokemon_sent':
            addBattleLog(`${data.player_name || (data.side === 'player1' ? BattleState.player1?.name : BattleState.player2?.name)} envia ${data.pokemon_name}!`, 'switch');
            if (data.side === 'player1' || data.is_player1) {
                BattleState.player1Active = data.pokemon?.team_index ?? data.team_index ?? BattleState.player1Active;
                // Update the team entry with fresh data if provided
                if (data.pokemon && BattleState.player1Team[BattleState.player1Active]) {
                    Object.assign(BattleState.player1Team[BattleState.player1Active], data.pokemon);
                }
            } else {
                BattleState.player2Active = data.pokemon?.team_index ?? data.team_index ?? BattleState.player2Active;
                if (data.pokemon && BattleState.player2Team[BattleState.player2Active]) {
                    Object.assign(BattleState.player2Team[BattleState.player2Active], data.pokemon);
                }
            }
            BattleState.phase = 'combat';
            hidePokemonSelectionPanel();
            renderBattleArena();
            renderBattleTeamPreviews();
            updateBattleStatus();
            break;

        case 'battle_ended':
            BattleState.phase = 'finished';
            const isWinner = data.winner_id == GameState.playerId;
            const isNpcWin = data.winner_is_npc;
            let msg;
            if (isWinner) {
                msg = '🏆 Você venceu! (+1 Insígnia, +R$2)';
            } else if (isNpcWin) {
                msg = `${data.winner_name} (Líder de Ginásio) venceu!`;
            } else {
                msg = `${data.winner_name} venceu!`;
            }
            addBattleLog(msg, 'victory');
            showToast(msg, isWinner ? 'success' : 'info');
            updateBattleStatus();
            setTimeout(() => {
                handleGameStateChange('tournament');
                refreshTournamentState();
            }, 3500);
            break;
    }
}

function handleAttackEvent(data) {
    const isPlayer1Attacking = data.attacker_side === 'player1';
    // Animations
    const targetDisplay = isPlayer1Attacking ? DOM.battleP2Pokemon : DOM.battleP1Pokemon;
    const attackerDisplay = isPlayer1Attacking ? DOM.battleP1Pokemon : DOM.battleP2Pokemon;

    if (attackerDisplay) {
        attackerDisplay.classList.add('attacking');
        setTimeout(() => attackerDisplay.classList.remove('attacking'), 300);
    }

    // Get attacker's type for visual effects
    const attackerPokemon = isPlayer1Attacking
        ? BattleState.player1Team[BattleState.player1Active]
        : BattleState.player2Team[BattleState.player2Active];
    const attackType = attackerPokemon?.type_attack || 'normal';
    showTypeAttackEffect(attackType, data.type_multiplier || 1, isPlayer1Attacking);

    if (targetDisplay) {
        setTimeout(() => {
            targetDisplay.classList.add('hit');
            setTimeout(() => targetDisplay.classList.remove('hit'), 400);
        }, 200);
    }

    showBattleAction(data.damage, data.type_multiplier);

    // Update HP
    if (isPlayer1Attacking) {
        const p2 = BattleState.player2Team[BattleState.player2Active];
        if (p2) { p2.current_hp = data.defender_hp; if (data.is_fainted) p2.is_fainted = true; }
        updateHpBar('p2', data.defender_hp, data.defender_max_hp);
    } else {
        const p1 = BattleState.player1Team[BattleState.player1Active];
        if (p1) { p1.current_hp = data.defender_hp; if (data.is_fainted) p1.is_fainted = true; }
        updateHpBar('p1', data.defender_hp, data.defender_max_hp);
    }

    let effectText = data.type_multiplier > 1 ? " Super efetivo!" : (data.type_multiplier < 1 ? " Pouco efetivo..." : '');
    const logClass = data.type_multiplier > 1 ? 'super-effective' : (data.type_multiplier < 1 ? 'not-effective' : 'attack');
    addBattleLog(`${data.attacker_pokemon} causa ${data.damage} dano em ${data.defender_pokemon}!${effectText}`, logClass);
    if (data.is_fainted) addBattleLog(`${data.defender_pokemon} desmaiou!`, 'faint');

    if (!data.is_fainted) {
        BattleState.currentTurn = isPlayer1Attacking ? 'player2' : 'player1';
        updateBattleStatus();
    }

    renderBattleArena();
    renderBattleTeamPreviews();
}

function showTypeAttackEffect(attackType, typeMultiplier, isPlayer1Attacking) {
    const arena = document.querySelector('.battle-arena');
    if (!arena) return;

    let intensity = 'normal';
    if (typeMultiplier >= 2) intensity = 'super';
    else if (typeMultiplier <= 0.5) intensity = 'weak';

    const typeConfig = {
        fire: { particles: ['🔥', '💥', '✨'] },
        water: { particles: ['💧', '🌊', '💦'] },
        grass: { particles: ['🍃', '🌿', '✨'] },
        electric: { particles: ['⚡', '💛', '✨'] },
        ice: { particles: ['❄️', '💎', '✨'] },
        fighting: { particles: ['👊', '💥', '⭐'] },
        poison: { particles: ['☠️', '💀', '💜'] },
        ground: { particles: ['🪨', '💨', '🟤'] },
        flying: { particles: ['🌪️', '💨', '🪶'] },
        psychic: { particles: ['🔮', '💫', '✨'] },
        bug: { particles: ['🐛', '🦗', '✨'] },
        rock: { particles: ['🪨', '💥', '⬛'] },
        ghost: { particles: ['👻', '💀', '🌑'] },
        dragon: { particles: ['🐉', '💜', '✨'] },
        dark: { particles: ['🌑', '💀', '⬛'] },
        steel: { particles: ['⚙️', '🔩', '✨'] },
        fairy: { particles: ['🧚', '💖', '✨'] },
        normal: { particles: ['⭐', '💥', '✨'] },
    };

    const config = typeConfig[attackType] || typeConfig.normal;
    const particleCount = intensity === 'super' ? 10 : (intensity === 'weak' ? 3 : 5);

    const effectContainer = document.createElement('div');
    effectContainer.className = `type-attack-effect effect-${attackType} intensity-${intensity} ${isPlayer1Attacking ? 'from-left' : 'from-right'}`;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'attack-particle';
        particle.textContent = config.particles[Math.floor(Math.random() * config.particles.length)];
        const randomY = Math.random() * 60 - 30;
        particle.style.setProperty('--particle-y', `${randomY}px`);
        particle.style.setProperty('--particle-delay', `${Math.random() * 0.2}s`);
        particle.style.setProperty('--particle-duration', `${0.4 + Math.random() * 0.3}s`);
        particle.style.fontSize = intensity === 'super' ? '2rem' : (intensity === 'weak' ? '1rem' : '1.5rem');
        effectContainer.appendChild(particle);
    }

    if (intensity === 'super') {
        const flash = document.createElement('div');
        flash.className = `battle-flash flash-${attackType}`;
        arena.appendChild(flash);
        setTimeout(() => flash.remove(), 300);
        arena.classList.add('screen-shake');
        setTimeout(() => arena.classList.remove('screen-shake'), 400);
    }

    arena.appendChild(effectContainer);
    setTimeout(() => effectContainer.remove(), 800);
}

function showBattleAction(damage, multiplier) {
    if (!DOM.battleActionDisplay || !DOM.battleActionText) return;
    DOM.battleActionDisplay.classList.remove('hidden', 'super-effective', 'not-effective');
    let text = `-${damage}`;
    if (multiplier > 1) { text += ' Super Efetivo!'; DOM.battleActionDisplay.classList.add('super-effective'); }
    else if (multiplier < 1) { text += ' Pouco Efetivo'; DOM.battleActionDisplay.classList.add('not-effective'); }
    DOM.battleActionText.textContent = text;
    setTimeout(() => DOM.battleActionDisplay.classList.add('hidden'), 1500);
}

function addBattleLog(message, type = '') {
    if (!DOM.battleLogMessages) return;
    const el = document.createElement('div');
    el.className = `battle-log-message ${type}`;
    el.textContent = message;
    DOM.battleLogMessages.appendChild(el);
    DOM.battleLogMessages.scrollTop = DOM.battleLogMessages.scrollHeight;
    while (DOM.battleLogMessages.children.length > 50) DOM.battleLogMessages.removeChild(DOM.battleLogMessages.firstChild);
}

// ============================================
// VICTORY
// ============================================

async function loadVictoryScreen() {
    try {
        const result = await apiCall(`/game/state`, {}, 'GET');
        if (result.success && result.room) {
            const winnerName = result.room.winner_name || 'Vencedor';
            if (DOM.winnerName) DOM.winnerName.textContent = `🏆 ${winnerName} Venceu! 🏆`;
            if (DOM.victoryMessage) {
                DOM.victoryMessage.textContent = result.room.winner_id == GameState.playerId
                    ? 'Parabéns! Você é o campeão!'
                    : `${winnerName} se tornou o campeão!`;
            }
        }
    } catch (err) {
        console.error('Error loading victory:', err);
    }
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', () => disconnectWebSocket());
