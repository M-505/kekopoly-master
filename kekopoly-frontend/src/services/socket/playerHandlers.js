/**
 * Player Handlers
 *
 * This module contains methods for handling player-specific WebSocket messages,
 * such as player joining, disconnecting, and property changes.
 */

import { log, logError, logWarning } from '../../utils/logger';
import { store } from '../../store/store';
import {
  setHost
} from '../../store/gameSlice';
import {
  addPlayer,
  updatePlayer,
  updatePlayerPosition,
  updatePlayerBalance,
  addPlayerCard,
  removePlayerCard,
  addPlayerProperty,
  removePlayerProperty,
  removePlayer,
  setPlayerReady,
  setPlayers
} from '../../store/playerSlice';

/**
 * Handles active players messages
 * @param {Object} data - The message data
 */
export function handleActivePlayers(data) {
  const { dispatch } = store;

  log('ACTIVE_PLAYERS', `Received ${data.players?.length || 0} active players`);

  if (Array.isArray(data.players)) {
    // The backend now sends the full list. Replace the local list.
    dispatch(setPlayers(data.players));

    // The host can be derived from the player list, but if hostId is sent, use it.
    if (data.hostId) {
      dispatch(setHost(data.hostId));
    } else {
      const hostPlayer = data.players.find(p => p.isHost);
      if (hostPlayer) {
        dispatch(setHost(hostPlayer.id));
      }
    }
  }
}

/**
 * Handles player joined messages
 * @param {Object} player - The player data
 */
export function handlePlayerJoined(player) {
  const { dispatch, getState } = store;

  if (!player || !player.id) {
    logWarning('PLAYER', 'Received player_joined event with invalid player data');
    return;
  }

  log('PLAYER', `Player joined: ${player.id} (${player.name})`);

  // It's better to request a full list to ensure synchronization
  // This avoids race conditions where clients have different player lists.
  const { socketService } = getState().game;
  if (socketService) {
    log('PLAYER', 'Requesting active players to ensure sync after a player joined.');
    socketService.sendMessage('get_active_players', {});
  } else {
    // Fallback to adding the player directly if socketService is not available
    dispatch(addPlayer({
      playerId: player.id,
      playerData: player
    }));
  }
}

/**
 * Handles player disconnected messages
 * @param {string} playerId - The player ID
 */
export function handlePlayerDisconnected(playerId) {
  const { dispatch } = store;

  log('PLAYER', `Player disconnected: ${playerId}`);

  // Remove player from Redux store
  dispatch(removePlayer(playerId));
}

/**
 * Handles player ready messages
 * @param {string} playerId - The player ID
 * @param {boolean} isReady - Whether the player is ready
 * @param {string} messageId - Optional message ID
 * @param {number} timestamp - Optional timestamp
 */
export function handlePlayerReady(playerId, isReady, messageId, timestamp) {
  const { dispatch } = store;

  log('PLAYER', `Player ${playerId} ready state changed to: ${isReady}`);

  // Update player ready state in Redux store
  dispatch(setPlayerReady({
    playerId,
    isReady
  }));
}

/**
 * Handles player balance messages
 * @param {Object} data - The message data
 */
export function handlePlayerBalance(data) {
  const { dispatch } = store;

  log('PLAYER', `Player ${data.playerId} balance changed to: ${data.balance}`);

  // Update player balance in Redux store
  dispatch(updatePlayerBalance({
    playerId: data.playerId,
    balance: data.balance
  }));
}

/**
 * Handles player card messages
 * @param {Object} data - The message data
 */
export function handlePlayerCard(data) {
  const { dispatch } = store;

  if (data.action === 'add') {
    log('PLAYER', `Player ${data.playerId} received card: ${data.card.id}`);

    // Add card to player in Redux store
    dispatch(addPlayerCard({
      playerId: data.playerId,
      card: data.card
    }));
  } else if (data.action === 'remove') {
    log('PLAYER', `Player ${data.playerId} lost card: ${data.cardId}`);

    // Remove card from player in Redux store
    dispatch(removePlayerCard({
      playerId: data.playerId,
      cardId: data.cardId
    }));
  }
}

/**
 * Handles player property messages
 * @param {Object} data - The message data
 */
export function handlePlayerProperty(data) {
  const { dispatch } = store;

  if (data.action === 'add') {
    log('PLAYER', `Player ${data.playerId} acquired property: ${data.property.id}`);

    // Add property to player in Redux store
    dispatch(addPlayerProperty({
      playerId: data.playerId,
      property: data.property
    }));
  } else if (data.action === 'remove') {
    log('PLAYER', `Player ${data.playerId} lost property: ${data.propertyId}`);

    // Remove property from player in Redux store
    dispatch(removePlayerProperty({
      playerId: data.playerId,
      propertyId: data.propertyId
    }));
  }
}

/**
 * Handles host changed messages
 * @param {string} hostId - The new host ID
 * @param {string} gameId - The game ID
 */
export function handleHostChanged(hostId, gameId) {
  const { dispatch } = store;

  log('HOST', `Host changed to: ${hostId} for game: ${gameId}`);

  // Update host in Redux store
  dispatch(setHost(hostId));

  // Also update the isHost flag for all players
  const state = store.getState();
  const players = state.players.players;

  // Update each player's isHost flag based on the hostId
  Object.entries(players).forEach(([playerId, player]) => {
    const isHost = playerId === hostId;

    // Only dispatch if the isHost flag needs to change
    if (player.isHost !== isHost) {
      dispatch(updatePlayer({
        ...player,
        isHost
      }));
    }
  });
}

/**
 * Handles set host messages
 * @param {string} hostId - The host ID
 * @param {string} gameId - The game ID
 */
export function handleSetHost(hostId, gameId) {
  const { dispatch } = store;

  log('HOST', `Host set to: ${hostId} for game: ${gameId}`);

  // Update host in Redux store
  dispatch(setHost(hostId));

  // Also update the isHost flag for all players
  const state = store.getState();
  const players = state.players.players;

  // Update each player's isHost flag based on the hostId
  Object.entries(players).forEach(([playerId, player]) => {
    const isHost = playerId === hostId;

    // Only dispatch if the isHost flag needs to change
    if (player.isHost !== isHost) {
      dispatch(updatePlayer({
        ...player,
        isHost
      }));
    }
  });
}

/**
 * Handles host info messages
 * @param {string} hostId - The host ID
 * @param {string} gameId - The game ID
 */
export function handleHostInfo(hostId, gameId) {
  const { dispatch } = store;

  log('HOST', `Received host info: ${hostId} for game: ${gameId}`);

  // Update host in Redux store
  dispatch(setHost(hostId));

  // Also update the isHost flag for all players
  const state = store.getState();
  const players = state.players.players;

  // Update each player's isHost flag based on the hostId
  Object.entries(players).forEach(([playerId, player]) => {
    const isHost = playerId === hostId;

    // Only dispatch if the isHost flag needs to change
    if (player.isHost !== isHost) {
      dispatch(updatePlayer({
        ...player,
        isHost
      }));
    }
  });
}
