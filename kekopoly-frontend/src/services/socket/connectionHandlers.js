/**
 * Connection Handlers
 * 
 * This module contains methods for handling WebSocket connections,
 * including connecting, disconnecting, and handling connection events.
 */

import { log, logError, logWarning } from '../../utils/logger';
import { store } from '../../store/store';
import { isTokenExpired } from '../../utils/tokenUtils';

/**
 * Establishes a WebSocket connection to the game server
 * @param {string} gameId - The ID of the game to connect to
 * @param {string} playerId - The ID of the player
 * @param {string} [token] - DEPRECATED. The token is now retrieved from the Redux store.
 * @param {Object} initialPlayerData - Initial player data to send on connection
 * @returns {Promise} - Resolves when connection is established
 */
export function connect(gameId, playerId, token, initialPlayerData) {
  // Validate inputs
  if (!gameId || gameId === 'null' || gameId === 'undefined') {
    const errorMessage = `Invalid gameId provided for WebSocket connection: ${gameId}`;
    logError('CONNECT', errorMessage);
    return Promise.reject(new Error(errorMessage));
  }

  if (!playerId || playerId === 'null' || playerId === 'undefined') {
    const errorMessage = `Invalid playerId provided for WebSocket connection: ${playerId}`;
    logError('CONNECT', errorMessage);
    return Promise.reject(new Error(errorMessage));
  }

  // Ensure roomId is properly normalized (backend expects uppercase, frontend uses lowercase)
  const normalizedRoomId = gameId.toUpperCase().trim(); // Backend expects uppercase
  this.gameId = normalizedRoomId;
  this.playerId = playerId;

  // Always get the latest token from the Redux store or localStorage
  const state = store.getState();
  const freshToken = state.auth.token || localStorage.getItem('kekopoly_token');

  if (!freshToken || freshToken === 'null' || freshToken === 'undefined') {
    const errorMessage = 'No authentication token available for WebSocket connection.';
    logError('CONNECT', errorMessage);
    
    // Don't automatically dispatch logout - let the user continue
    // The token might be temporarily unavailable due to a race condition
    
    return Promise.reject(new Error(errorMessage));
  }

  // Check if token is expired
  if (isTokenExpired(freshToken)) {
    const errorMessage = 'Authentication token has expired.';
    logError('CONNECT', errorMessage);
    
    // Only dispatch logout if the token is truly expired (not just a parsing error)
    if (store && store.dispatch) {
      store.dispatch({ type: 'auth/logout' });
    }
    
    return Promise.reject(new Error(errorMessage));
  }

  this.token = freshToken; // Store the fresh token

  // Check if we have stored player token data from a previous session
  try {
    const storedTokenData = localStorage.getItem('kekopoly_player_token_data');
    if (storedTokenData) {
      const parsedTokenData = JSON.parse(storedTokenData);
      log('CONNECT', 'Found stored player token data', parsedTokenData);

      // Merge stored token data with initialPlayerData if provided
      if (initialPlayerData) {
        initialPlayerData = {
          ...initialPlayerData,
          token: initialPlayerData.token || parsedTokenData.token || '',
          emoji: initialPlayerData.emoji || parsedTokenData.emoji || '👤',
          color: initialPlayerData.color || parsedTokenData.color || 'gray.500',
          name: initialPlayerData.name || parsedTokenData.name || `Player_${playerId.substring(0, 4)}`
        };
        log('CONNECT', 'Merged initialPlayerData with stored token data', initialPlayerData);
      } else {
        // If no initialPlayerData was provided, create it from stored data
        initialPlayerData = {
          id: playerId,
          token: parsedTokenData.token || '',
          emoji: parsedTokenData.emoji || '👤',
          color: parsedTokenData.color || 'gray.500',
          name: parsedTokenData.name || `Player_${playerId.substring(0, 4)}`,
          position: 0,
          balance: 1500,
          properties: [],
          status: 'ACTIVE'
        };
        log('CONNECT', 'Created initialPlayerData from stored token data', initialPlayerData);
      }
    }
  } catch (e) {
    logWarning('CONNECT', 'Error restoring player token data from localStorage:', e);
  }

  // Store initial data if provided and save to persistent state
  this.initialPlayerDataToSend = initialPlayerData;

  // Save to connection state for potential reconnection during navigation
  if (initialPlayerData) {
    this.saveState('initialPlayerData', initialPlayerData);
  }

  log('CONNECT', 'Set this.initialPlayerDataToSend:', this.initialPlayerDataToSend);
  this.localPlayerId = playerId; // Set local player ID

  // Simplified Session ID Logic
  let sessionId = localStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = this.generateSessionId();
    localStorage.setItem('sessionId', sessionId);
  }
  this.sessionId = sessionId; // Assign to the class property

  // Return a Promise to allow async/await usage
  return new Promise((resolve, reject) => {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.onConnectionChange('connected');
      resolve(); // Already connected
      return;
    }

    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      // We might want to wait for the existing connection attempt or reject
      reject(new Error('Connection attempt already in progress.'));
      return;
    }

    // Construct the WebSocket URL, including the token
    // Ensure we have a valid token
    if (!this.token) {
      logError('CONNECT', 'No token available for WebSocket connection');
      reject(new Error('No authentication token available for WebSocket connection'));
      return;
    }

    // Ensure token is properly formatted for Authorization header
    let tokenValue = this.token;
    if (!tokenValue.startsWith('Bearer ')) {
      tokenValue = `Bearer ${tokenValue}`;
    }

    // Double check that token is not empty after processing
    if (!tokenValue || tokenValue.trim() === '') {
      logError('CONNECT', 'Token is empty after processing');
      reject(new Error('Empty authentication token'));
      return;
    }

    // Use protocol based on current page protocol (ws or wss)
    const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Determine the host for WebSocket connection
    let host;
    if (import.meta.env.VITE_API_URL) {
      // Use API URL environment variable and convert to WebSocket host
      const apiUrl = import.meta.env.VITE_API_URL;
      host = apiUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
      log('CONNECT', `Using VITE_API_URL for WebSocket host: ${host}`);
    } else if (window.location.hostname === 'localhost') {
      // Development mode
      host = 'localhost:8080';
    } else if (window.location.hostname.includes('onrender.com')) {
      // Render.com deployment - both frontend and backend are on the same service
      host = window.location.host;
      log('CONNECT', `Using render.com host: ${host}`);
    } else {
      // Production mode - use current host
      host = window.location.host;
    }

    // Prepare token for URL (remove 'Bearer ' prefix when using in query parameter)
    const urlToken = tokenValue.replace('Bearer ', '');

    // Construct WebSocket URL with both sessionId and token parameters
    // We pass token in query param as fallback for browsers that don't support WebSocket headers
    let wsUrl;
    if (this.gameId && this.gameId.trim() !== '') {
      // Connect to specific game
      wsUrl = `${socketProtocol}//${host}/ws/${this.gameId}?sessionId=${this.sessionId}&token=${encodeURIComponent(urlToken)}`;
    } else {
      // Connect to lobby if no specific game ID
      wsUrl = `${socketProtocol}//${host}/ws/lobby?sessionId=${this.sessionId}&token=${encodeURIComponent(urlToken)}`;
    }
    log('CONNECT', `Connecting to WebSocket URL: ${wsUrl}`);
    
    // Store both versions of the token
    this.authToken = tokenValue;  // Full token with 'Bearer ' prefix for Authorization header
    this.urlToken = urlToken;     // Token without prefix for URL parameters

    this.onConnectionChange('connecting');

    try {
      // Close existing socket if it exists
      if (this.socket) {
        try {
          this.socket.close();
        } catch (e) {
          logWarning('CONNECT', 'Error closing existing socket:', e);
        }
      }

      // For WebSocket connections, we need to add headers during connection
      const wsHeaders = {
        'Authorization': tokenValue
      };

      // Create new WebSocket connection with headers
      try {
        // Try first with the headers option (supported in some browsers)
        this.socket = new WebSocket(wsUrl, [], { headers: wsHeaders });
      } catch (e) {
        // If headers option fails, fallback to query parameter only
        logWarning('CONNECT', 'WebSocket with headers not supported, using query parameter only', e);
        this.socket = new WebSocket(wsUrl);
      }

      // Clear previous listeners to avoid duplicates
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;

      // Assign new listeners
      this.socket.onopen = () => {
        // Connection established logging
        const timestamp = new Date().toISOString();
        log('CONNECT', `WebSocket connection opened at ${timestamp}`);
        log('CONNECT', `Connection details - GameID: ${this.gameId}, PlayerID: ${this.playerId}, SessionID: ${this.sessionId}`);
        log('CONNECT', `Token used (prefix only): ${this.token ? this.token.substring(0, 10) + '...' : 'none'}`);

        // Send auth message immediately after connection
        if (this.urlToken) {  // Use the URL version of the token without 'Bearer ' prefix
          try {
            this.sendMessage('auth', { 
              token: this.urlToken,
              playerId: this.playerId,
              sessionId: this.sessionId
            });
            log('CONNECT', 'Sent authentication message');
          } catch (e) {
            logWarning('CONNECT', 'Failed to send auth message:', e);
          }
        }

        // Store successful connection info in localStorage for recovery
        try {
          localStorage.setItem('kekopoly_last_successful_connection', timestamp);
          localStorage.setItem('kekopoly_game_id', this.gameId);
          localStorage.setItem('kekopoly_player_id', this.playerId);
          localStorage.setItem('kekopoly_session_id', this.sessionId);
          localStorage.setItem('kekopoly_auth_token', this.token);
        } catch (e) {
          logWarning('CONNECT', 'Error storing connection info in localStorage:', e);
        }

        // Send initial player data if available (used for the first connection)
        if (initialPlayerData) {
          log('CONNECT', 'Sending initial player data on connection:', initialPlayerData);

          // CRITICAL: Send player_joined message FIRST to establish player in backend
          this.sendMessage('player_joined', {
            player: initialPlayerData // Use correct format that backend expects
          });

          // Wait briefly to ensure player_joined is processed before sending updates
          setTimeout(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
              // Now send token update if player has a token
              if (initialPlayerData.token || initialPlayerData.characterToken || initialPlayerData.emoji) {
                this.sendMessage('update_player_info', {
                  playerId: this.playerId,
                  token: initialPlayerData.token || initialPlayerData.characterToken || initialPlayerData.emoji,
                  characterToken: initialPlayerData.token || initialPlayerData.characterToken || initialPlayerData.emoji,
                  emoji: initialPlayerData.emoji || initialPlayerData.token || '👤'
                });
                log('CONNECT', 'Sent token update after player join confirmation');
              }
            }
          }, 250); // Small delay to ensure proper order

        } else if (this.initialPlayerDataToSend) {
          log('CONNECT', 'Sending stored player data on connection:', this.initialPlayerDataToSend);

          // CRITICAL: Send player_joined message FIRST to establish player in backend
          this.sendMessage('player_joined', {
            player: this.initialPlayerDataToSend // Use correct format that backend expects
          });

          // Wait briefly to ensure player_joined is processed before sending updates
          setTimeout(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
              // Now send token update if player has a token
              if (this.initialPlayerDataToSend.token || this.initialPlayerDataToSend.characterToken || this.initialPlayerDataToSend.emoji) {
                this.sendMessage('update_player_info', {
                  playerId: this.playerId,
                  token: this.initialPlayerDataToSend.token || this.initialPlayerDataToSend.characterToken || this.initialPlayerDataToSend.emoji,
                  characterToken: this.initialPlayerDataToSend.token || this.initialPlayerDataToSend.characterToken || this.initialPlayerDataToSend.emoji,
                  emoji: this.initialPlayerDataToSend.emoji || this.initialPlayerDataToSend.token || '👤'
                });
                log('CONNECT', 'Sent token update after stored player join confirmation');
              }
            }
          }, 250); // Small delay to ensure proper order

          // Store in connection state before clearing
          this.saveState('lastSentPlayerData', this.initialPlayerDataToSend);

          // Don't clear initialPlayerDataToSend to allow for reconnection during navigation
          // Instead, mark it as sent so we don't send duplicate data
          this.saveState('initialPlayerDataSent', true);
        }

        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        clearTimeout(this.reconnectTimer); // Clear any existing reconnect timer

        // Set socket as ready immediately after auth message is sent
        this.socketReady = true;
        log('CONNECT', 'Socket marked as ready for messages');

        // Notify about the connection status change
        this.onConnectionChange('connected');
        
        // Dispatch a custom event that components can listen for
        window.dispatchEvent(new CustomEvent('websocket-connected', {
          detail: {
            gameId: this.gameId,
            playerId: this.playerId,
            timestamp: timestamp
          }
        }));

        // Send any queued messages immediately after socket becomes ready
        setTimeout(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
            this.sendQueuedMessages();
          }
        }, 100);

        // Request initial game state after socket is ready
        setTimeout(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
            log('CONNECT', 'Requesting active players after connection');
            this.sendMessage('get_active_players');

            // Request game state after active players
            setTimeout(() => {
              if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
                log('CONNECT', 'Requesting full game state after connection');
                this.sendMessage('get_game_state', { full: true });

                // Request current turn information
                setTimeout(() => {
                  if (this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady) {
                    log('CONNECT', 'Requesting current turn information');
                    this.sendMessage('get_current_turn', {});

                    // Start periodic state synchronization
                    if (this.startPeriodicStateSync) {
                      this.startPeriodicStateSync();
                    }
                  }
                }, 100);
              }
            }, 100);
          }
        }, 200); // Wait 200ms for auth to process

        resolve(); // Resolve the promise on successful connection
      };

      this.socket.onclose = (event) => {
        this.socketReady = false; // Mark socket as not ready when closed
        this.handleDisconnect(event);
        // Don't automatically reject on close, let reconnect logic handle it if needed
      };

      this.socket.onerror = (error) => {
        this.socketReady = false; // Mark socket as not ready on error
        logError('SOCKET', 'WebSocket Error:', error);
        this.onConnectionChange('error');
        this.onConnectionError(error); // Call the error callback
        reject(error); // Reject the promise on error
      };

      this.socket.onmessage = this.handleMessage;

    } catch (error) {
      logError('SOCKET', 'Failed to create WebSocket:', error);
      this.onConnectionChange('error');
      this.onConnectionError(error); // Call the error callback
      reject(error);
    }
  });
}

/**
 * Disconnects from the WebSocket server
 * @param {boolean} preserve - Whether to preserve the connection state for reconnection
 */
export function disconnect(preserve = false) {
  this.preserveConnection = preserve;
  log('SOCKET', `Disconnect called with preserve=${preserve}`);

  // Save current connection state before potential disconnect
  this.saveState('connectionActive', !!this.socket);
  this.saveState('gameId', this.gameId);
  this.saveState('playerId', this.playerId);
  this.saveState('token', this.token);
  this.saveState('sessionId', this.sessionId);

  if (this.socket && !this.preserveConnection) {
    log('SOCKET', 'Closing socket connection');

    // Send a clean disconnect message if possible
    if (this.socket.readyState === WebSocket.OPEN) {
      try {
        this.sendMessage('client_navigating', {
          playerId: this.playerId,
          gameId: this.gameId,
          willReconnect: false
        });
      } catch (e) {
        logWarning('SOCKET', 'Failed to send navigation message:', e);
      }
    }

    this.socket.close();
    this.socket = null;
    this.onConnectionChange('disconnected');
  } else if (this.preserveConnection) {
    log('SOCKET', 'Preserving socket connection during navigation');

    // Set navigation flag to true to handle reconnection differently
    this.isNavigating = true;
    this.saveState('isNavigating', true);

    // Send a navigation message to the server if possible
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.sendMessage('client_navigating', {
          playerId: this.playerId,
          gameId: this.gameId,
          willReconnect: true
        });
      } catch (e) {
        logWarning('SOCKET', 'Failed to send navigation message:', e);
      }
    }
  }
}

/**
 * Preserves socket connection during navigation
 */
export function preserveSocketForNavigation() {
  log('SOCKET', 'Preserving socket connection for navigation');

  // Set the navigation flags to preserve connection
  this.isNavigating = true;
  this.preserveConnection = true;
  this.isTransitioningToGame = true;

  // Store connection info in localStorage for reconnection
  try {
    localStorage.setItem('kekopoly_socket_preserve', 'true');
    localStorage.setItem('kekopoly_socket_gameId', this.gameId);
    localStorage.setItem('kekopoly_socket_playerId', this.playerId);
    localStorage.setItem('kekopoly_socket_timestamp', Date.now().toString());

    // Also store critical game state information
    localStorage.setItem('kekopoly_game_started', 'true');
    localStorage.setItem('kekopoly_game_id', this.gameId);
    localStorage.setItem('kekopoly_game_phase', 'playing');
    localStorage.setItem('kekopoly_game_status', 'ACTIVE');

    log('SOCKET', 'Stored connection and game state info in localStorage for reconnection');
  } catch (e) {
    logWarning('SOCKET', 'Could not store socket preservation info in localStorage:', e);
  }

  // Save current connection state for potential reconnection
  this.saveState('connectionActive', true);
  this.saveState('gameId', this.gameId);
  this.saveState('playerId', this.playerId);
  this.saveState('token', this.token);
  this.saveState('sessionId', this.sessionId);
  this.saveState('isNavigating', true);
  this.saveState('preserveConnection', true);
  this.saveState('isTransitioningToGame', true);

  // Send a navigation message to the server if possible
  if (this.socket && this.socket.readyState === WebSocket.OPEN) {
    try {
      this.sendMessage('client_navigating', {
        playerId: this.playerId,
        gameId: this.gameId,
        willReconnect: true,
        timestamp: Date.now()
      });

      // Also request the latest game state to ensure we have it after navigation
      this.sendMessage('get_game_state', { full: true });
      this.sendMessage('get_active_players', {});
    } catch (e) {
      logWarning('SOCKET', 'Failed to send navigation message:', e);
    }
  }
}

/**
 * Handles WebSocket connection event
 */
export function handleConnect() {
  const timestamp = new Date().toISOString();
  log('CONNECT', `WebSocket connected at ${timestamp} for player ${this.playerId} in game ${this.gameId}`);
  log('CONNECT', `Connection details - GameID: ${this.gameId}, PlayerID: ${this.playerId}, SessionID: ${this.sessionId}`);
  log('CONNECT', `Token used (prefix): ${this.token ? this.token.substring(0, 10) + '...' : 'none'}`);

  // Reset reconnect attempts on successful connection
  this.reconnectAttempts = 0;

  // Request current game state and active players
  setTimeout(() => {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendMessage('get_game_state', {});
      log('CONNECT', 'Requested game state');

      // Also request active players list to ensure we have all connected players
      this.sendMessage('get_active_players', {});
      log('CONNECT', 'Requested active players list');

      // Check if game has already started
      if (this.checkIfGameAlreadyStarted) {
        this.checkIfGameAlreadyStarted();
      }

      // Start periodic state synchronization to ensure consistent state across clients
      log('CONNECT', 'Starting periodic state synchronization');
      if (this.startPeriodicStateSync) {
        this.startPeriodicStateSync();
      }
    } else {
      logWarning('CONNECT', 'Cannot request game state: socket not open');
    }
  }, 500);
}

/**
 * Handles WebSocket disconnection event
 * @param {Event} event - The close event
 */
export function handleDisconnect(event) {
  const timestamp = new Date().toISOString();
  log('DISCONNECT', `WebSocket disconnected at ${timestamp}: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);
  log('DISCONNECT', `Disconnection details - GameID: ${this.gameId}, PlayerID: ${this.playerId}, SessionID: ${this.sessionId}`);
  log('DISCONNECT', `Navigation state: isNavigating=${this.isNavigating}, preserveConnection=${this.preserveConnection}`);

  // Save disconnection state
  this.saveState('lastDisconnectTime', timestamp);
  this.saveState('lastDisconnectReason', event.reason);
  this.saveState('lastDisconnectCode', event.code);
  this.saveState('lastDisconnectWasClean', event.wasClean);

  // Stop periodic state synchronization
  if (this.stopPeriodicStateSync) {
    this.stopPeriodicStateSync();
  }

  // Call connection change callback
  this.onConnectionChange('disconnected');

  // Check if we're in the middle of a navigation or if the connection should be preserved
  if (this.isNavigating || this.preserveConnection || this.loadState('isNavigating', false)) {
    log('NAVIGATION_DISCONNECT', 'Disconnection occurred during navigation or with preserve flag, will reconnect immediately');

    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Reset reconnect attempts since this is a navigation-related disconnect
    this.reconnectAttempts = 0;

    // Attempt to reconnect immediately with minimal delay
    this.reconnectTimer = setTimeout(() => {
      log('NAVIGATION_DISCONNECT', 'Immediate reconnection attempt after navigation');

      // Check if we're on the game board page now
      const isOnGameBoard = window.location.pathname.includes('/game/');
      log(`NAVIGATION_DISCONNECT', 'Current location: ${window.location.pathname}, isOnGameBoard: ${isOnGameBoard}`);

      // Retrieve connection information from state if not available directly
      const gameId = this.gameId || this.loadState('gameId');
      const playerId = this.playerId || this.loadState('playerId');
      const token = this.token || this.loadState('token');

      // Retrieve player data that might have been saved before navigation
      const savedPlayerData = this.loadState('initialPlayerData') || this.loadState('lastSentPlayerData');

      // Only attempt reconnection if we have the necessary information
      if (gameId && playerId && token) {
        log(`NAVIGATION_DISCONNECT', 'Reconnecting with gameId=${gameId}, playerId=${playerId}`);
        log(`NAVIGATION_DISCONNECT', 'Using saved player data:`, savedPlayerData);

        // Pass required arguments to connect, including saved player data if available
        this.connect(gameId, playerId, token, savedPlayerData)
          .then(() => {
            log('NAVIGATION_DISCONNECT', 'Reconnection successful after navigation');

            // Reset navigation flags after successful reconnection
            this.isNavigating = false;
            this.saveState('isNavigating', false);

            // Request game state and active players to ensure we're in sync
            setTimeout(() => {
              if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                log('NAVIGATION_DISCONNECT', 'Requesting game state and active players after reconnection');
                this.sendMessage('get_game_state', { full: true });
                this.sendMessage('get_active_players');

                // Also send player data again to ensure server has latest state
                if (savedPlayerData) {
                  log('NAVIGATION_DISCONNECT', 'Re-sending player data after reconnection');
                  this.sendMessage('update_player', {
                    playerId: playerId,
                    ...savedPlayerData
                  });
                }
              }
            }, 200);
          })
          .catch(err => {
            logError("NAVIGATION_DISCONNECT", "Reconnect after navigation failed:", err);

            // Try again after a short delay if we're still on the game board
            if (window.location.pathname.includes('/game/')) {
              log('NAVIGATION_DISCONNECT', 'Will try reconnecting again in 1 second');
              setTimeout(() => {
                this.connect(gameId, playerId, token, savedPlayerData)
                  .catch(err => {
                    logError("NAVIGATION_DISCONNECT", "Second reconnect attempt failed:", err);
                    // If second attempt fails, try with a clean connection
                    setTimeout(() => {
                      log('NAVIGATION_DISCONNECT', 'Trying final reconnect with clean connection');
                      this.connect(gameId, playerId, token)
                        .catch(err => logError("NAVIGATION_DISCONNECT", "Final reconnect attempt failed:", err));
                    }, 1000);
                  });
              }, 1000);
            }
          });
      } else {
        logError('NAVIGATION_DISCONNECT', 'Missing required information for reconnection');
        log(`gameId: ${gameId}, playerId: ${playerId}, token: ${token ? 'present' : 'missing'}`);

        // Try to recover from localStorage as a last resort
        const lastGameId = localStorage.getItem('kekopoly_game_id');
        const lastPlayerId = localStorage.getItem('kekopoly_player_id');
        const lastToken = localStorage.getItem('kekopoly_auth_token');

        if (lastGameId && lastPlayerId && lastToken) {
          log('NAVIGATION_DISCONNECT', 'Attempting recovery using localStorage data');
          this.connect(lastGameId, lastPlayerId, lastToken)
            .catch(err => logError("NAVIGATION_DISCONNECT", "Recovery attempt failed:", err));
        }
      }
    }, 100);

    return;
  }

  // Standard reconnection logic for non-navigation disconnects
  if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
    this.reconnectAttempts++;

    log(`RECONNECT', 'Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    // Exponential backoff
    const delay = this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);

    this.reconnectTimer = setTimeout(() => {
      log(`RECONNECT', 'Reconnection attempt ${this.reconnectAttempts} at ${new Date().toISOString()}`);

      // Try to use saved player data for reconnection
      const savedPlayerData = this.loadState('initialPlayerData') || this.loadState('lastSentPlayerData');

      // Pass required arguments to connect
      this.connect(this.gameId, this.playerId, this.token, savedPlayerData)
        .catch(err => {
          logError(`RECONNECT', 'Reconnection attempt ${this.reconnectAttempts} failed:`, err);

          // If we have saved player data but reconnection failed, try without it
          if (savedPlayerData && this.reconnectAttempts < this.maxReconnectAttempts) {
            log(`RECONNECT', 'Trying reconnection without saved player data`);
            setTimeout(() => {
              this.connect(this.gameId, this.playerId, this.token)
                .catch(err => logError(`RECONNECT', 'Clean reconnection attempt failed:`, err));
            }, 1000);
          }
        });
    }, delay);
  } else if (event.wasClean) {
    log("DISCONNECT", "Clean disconnection, not attempting reconnect.");
  } else {
    log("DISCONNECT", "Max reconnect attempts reached, giving up.");
    this.onConnectionChange('failed'); // Indicate final failure
  }
}

/**
 * Handles WebSocket error event
 * @param {Event} error - The error event
 */
export function handleError(error) {
  logError('WS_ERROR', 'WebSocket error:', error);
  log('WS_ERROR', `Connection details - GameID: ${this.gameId}, PlayerID: ${this.playerId}`);

  const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  // Determine the host for error diagnostics
  let host;
  if (import.meta.env.VITE_API_URL) {
    // Use API URL environment variable and convert to WebSocket host
    const apiUrl = import.meta.env.VITE_API_URL;
    host = apiUrl.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
  } else if (window.location.hostname === 'localhost') {
    host = 'localhost:8080';
  } else if (window.location.hostname.includes('onrender.com')) {
    // Render.com deployment - both frontend and backend are on the same service
    host = window.location.host;
  } else {
    host = window.location.host;
  }
  
  const wsUrl = `${socketProtocol}//${host}/ws`;
  log('WS_ERROR', `Auth token: ${this.token ? (this.token.substring(0, 10) + '...') : 'none'}, URL base: ${wsUrl}`);

  // Try to detect the specific issue - use correct protocol for health check
  const healthUrl = `${window.location.protocol}//${host}/health`;
  fetch(healthUrl)
    .then(response => {
      log('WS_ERROR', 'Backend health check response:', response.status);
    })
    .catch(err => {
      if (window.location.hostname.includes('onrender.com')) {
        logError('WS_ERROR', 'Backend appears to be unreachable on render.com. Check if the service is running and properly configured:', err);
      } else {
        logError('WS_ERROR', 'Backend appears to be unreachable. Check if the server is running on the expected port:', err);
      }
    });
}

/**
 * Setup socket event handlers
 */
export function setupSocketEventHandlers() {
  if (!this.socket) {
    logError('SOCKET', 'Cannot set up event handlers: socket is not initialized');
    return;
  }

  this.socket.onopen = this.handleConnect;
  this.socket.onclose = this.handleDisconnect;
  this.socket.onerror = this.handleError;
  this.socket.onmessage = this.handleMessage;

  log('SOCKET', 'WebSocket event handlers set up');
}

/**
 * Get current connection state as a string
 * @returns {string} - The connection state
 */
export function getConnectionState() {
  if (!this.socket) return 'disconnected';
  switch (this.socket.readyState) {
    case WebSocket.CONNECTING: return 'connecting';
    case WebSocket.OPEN: return 'connected';
    case WebSocket.CLOSING: return 'disconnected'; // Treat closing as disconnected
    case WebSocket.CLOSED: return 'disconnected';
    default: return 'disconnected';
  }
}

/**
 * Check if the socket is connected and ready
 * @returns {boolean} - True if connected and ready
 */
export function isConnected() {
  return this.socket && this.socket.readyState === WebSocket.OPEN && this.socketReady;
}

/**
 * Generate a simple session ID
 * @returns {string} - A random session ID
 */
export function generateSessionId() {
  return Math.random().toString(36).substring(2, 15);
}
