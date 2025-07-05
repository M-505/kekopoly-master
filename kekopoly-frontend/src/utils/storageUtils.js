/**
 * Utility functions for managing localStorage
 */

/**
 * Clear all game-related localStorage data
 * @param {string} gameId - Optional game ID to clear only data for a specific game
 */
export const clearGameStorageData = (gameId = null) => {
  try {
    // Keys to clear for all games
    const generalKeys = [
      'kekopoly_game_started',
      'kekopoly_game_phase',
      'kekopoly_navigation_timestamp',
      'kekopoly_force_redirect',
      'kekopoly_socket_preserve',
      'kekopoly_socket_timestamp',
      'kekopoly_game_start_timeout_id'
    ];
    
    // Keys that may have game-specific data
    const gameSpecificKeys = [
      'kekopoly_game_id',
      'kekopoly_socket_gameId',
      'kekopoly_socket_playerId',
      'kekopoly_player_token_data'
    ];
    
    // Clear general keys
    generalKeys.forEach(key => localStorage.removeItem(key));
    
    // Clear game-specific keys
    if (gameId) {
      // Only clear if the stored game ID matches the provided game ID
      gameSpecificKeys.forEach(key => {
        const storedValue = localStorage.getItem(key);
        if (key === 'kekopoly_game_id' && storedValue === gameId) {
          localStorage.removeItem(key);
        } else if (key === 'kekopoly_socket_gameId' && storedValue === gameId) {
          localStorage.removeItem(key);
        } else if (key === 'kekopoly_player_token_data') {
          try {
            const tokenData = JSON.parse(storedValue);
            if (tokenData && tokenData.gameId === gameId) {
              localStorage.removeItem(key);
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
      });
      
      // Also clear any game-specific player data
      localStorage.removeItem(`kekopoly_player_${gameId}`);
      localStorage.removeItem(`kekopoly_player_token_${gameId}`);
      localStorage.removeItem(`kekopoly_player_name_${gameId}`);
    } else {
      // Clear all game-specific keys if no game ID provided
      gameSpecificKeys.forEach(key => localStorage.removeItem(key));
      
      // Find and clear any game-specific player data
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('kekopoly_player_') || key.includes('_game_') || key.startsWith('kekopoly_socket_'))) {
          localStorage.removeItem(key);
        }
      }
    }
    
    // console.log(`[STORAGE] Cleared game storage data${gameId ? ` for game ${gameId}` : ''}`);
    return true;
  } catch (e) {
    console.error('[STORAGE] Error clearing game storage data:', e);
    return false;
  }
};

/**
 * Check if a game exists in localStorage
 * @param {string} gameId - Game ID to check
 * @returns {boolean} - True if the game exists in localStorage
 */
export const gameExistsInStorage = (gameId) => {
  try {
    const storedGameId = localStorage.getItem('kekopoly_game_id');
    return storedGameId === gameId;
  } catch (e) {
    console.error('[STORAGE] Error checking if game exists in storage:', e);
    return false;
  }
};

/**
 * Set game data in localStorage
 * @param {string} gameId - Game ID
 * @param {boolean} started - Whether the game has started
 * @param {string} phase - Game phase (e.g., 'setup', 'playing')
 */
export const setGameStorageData = (gameId, started = true, phase = 'playing') => {
  try {
    localStorage.setItem('kekopoly_game_started', started.toString());
    localStorage.setItem('kekopoly_game_id', gameId);
    localStorage.setItem('kekopoly_game_phase', phase);
    localStorage.setItem('kekopoly_navigation_timestamp', Date.now().toString());
    
    // console.log(`[STORAGE] Set game storage data for game ${gameId}`);
    return true;
  } catch (e) {
    console.error('[STORAGE] Error setting game storage data:', e);
    return false;
  }
};

/**
 * Detect and prevent redirect loops by tracking failed attempts
 * @param {string} gameId - Game ID that failed to load
 * @returns {boolean} - True if this appears to be a redirect loop
 */
export const detectRedirectLoop = (gameId) => {
  try {
    const key = 'kekopoly_failed_redirects';
    const now = Date.now();
    const maxAttempts = 3;
    const timeWindow = 30000; // 30 seconds
    
    // Get previous failed attempts
    const storedData = localStorage.getItem(key);
    let failedAttempts = [];
    
    if (storedData) {
      try {
        failedAttempts = JSON.parse(storedData);
      } catch (e) {
        failedAttempts = [];
      }
    }
    
    // Filter out old attempts (outside time window)
    failedAttempts = failedAttempts.filter(attempt => 
      (now - attempt.timestamp) < timeWindow
    );
    
    // Count attempts for this specific game
    const gameAttempts = failedAttempts.filter(attempt => 
      attempt.gameId === gameId
    );
    
    // Add current attempt
    failedAttempts.push({
      gameId,
      timestamp: now
    });
    
    // Store updated attempts
    localStorage.setItem(key, JSON.stringify(failedAttempts));
    
    // Check if we've exceeded max attempts for this game
    const isLoop = gameAttempts.length >= maxAttempts;
    
    if (isLoop) {
      console.warn(`[REDIRECT_LOOP] Detected redirect loop for game ${gameId}, clearing all game data`);
      // Clear all redirect attempt tracking
      localStorage.removeItem(key);
      // Clear all game data
      clearGameStorageData();
    }
    
    return isLoop;
  } catch (e) {
    console.error('[REDIRECT_LOOP] Error detecting redirect loop:', e);
    return false;
  }
};
