/**
 * Navigation utility functions for safe game navigation
 */

/**
 * Safely navigate to the game board with proper state management and error handling
 * @param {Function} navigate - React Router navigate function
 * @param {string} gameId - The game ID to navigate to
 * @param {Function} dispatch - Redux dispatch function
 * @param {Function} toast - Chakra UI toast function for notifications
 * @returns {boolean} - Whether navigation was successful
 */
export const safeNavigateToGame = (navigate, gameId, dispatch, toast) => {
  try {
    // Validate inputs
    if (!navigate || typeof navigate !== 'function') {
      console.error('[NAVIGATION] Invalid navigate function provided');
      return false;
    }

    if (!gameId || gameId === 'null' || gameId === 'undefined') {
      console.error('[NAVIGATION] Invalid gameId provided:', gameId);
      
      if (toast) {
        toast({
          title: "Navigation Error",
          description: "Invalid game ID. Cannot navigate to game.",
          status: "error",
          duration: 3000,
          isClosable: true,
        });
      }
      return false;
    }

    // Clean up the game ID (ensure it's a string and trimmed)
    const cleanGameId = String(gameId).trim().toLowerCase();
    
    if (!cleanGameId) {
      console.error('[NAVIGATION] Empty gameId after cleaning:', gameId);
      return false;
    }

    console.log(`[NAVIGATION] Navigating to game: ${cleanGameId}`);

    // Set localStorage flags to indicate navigation
    try {
      localStorage.setItem('kekopoly_game_started', 'true');
      localStorage.setItem('kekopoly_game_id', cleanGameId);
      localStorage.setItem('kekopoly_navigation_timestamp', Date.now().toString());
      localStorage.setItem('kekopoly_game_phase', 'playing');
      localStorage.setItem('kekopoly_game_status', 'ACTIVE');
    } catch (e) {
      console.warn('[NAVIGATION] Could not set localStorage flags:', e);
    }

    // Update Redux state if dispatch is available
    if (dispatch && typeof dispatch === 'function') {
      try {
        dispatch({ type: 'game/setGameStarted', payload: true });
        dispatch({ type: 'game/setGamePhase', payload: 'playing' });
        dispatch({ type: 'game/syncGameStatus', payload: 'ACTIVE' });
      } catch (e) {
        console.warn('[NAVIGATION] Could not update Redux state:', e);
      }
    }

    // Perform the navigation
    const targetPath = `/game/${cleanGameId}`;
    
    // Check if we're already on the target path
    if (window.location.pathname === targetPath) {
      console.log('[NAVIGATION] Already on target path, skipping navigation');
      return true;
    }

    // Navigate to the game board
    navigate(targetPath);

    // Optional success toast
    if (toast) {
      toast({
        title: "Navigating to Game",
        description: "Loading game board...",
        status: "info",
        duration: 2000,
        isClosable: true,
      });
    }

    console.log(`[NAVIGATION] Successfully initiated navigation to ${targetPath}`);
    return true;

  } catch (error) {
    console.error('[NAVIGATION] Error during navigation:', error);
    
    if (toast) {
      toast({
        title: "Navigation Error",
        description: "Failed to navigate to game. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
    
    return false;
  }
};

/**
 * Safely navigate back to lobby with cleanup
 * @param {Function} navigate - React Router navigate function
 * @param {Function} dispatch - Redux dispatch function
 * @param {Function} toast - Chakra UI toast function for notifications
 * @returns {boolean} - Whether navigation was successful
 */
export const safeNavigateToLobby = (navigate, dispatch, toast) => {
  try {
    console.log('[NAVIGATION] Navigating to lobby with cleanup');

    // Clear game-related localStorage
    try {
      localStorage.removeItem('kekopoly_game_started');
      localStorage.removeItem('kekopoly_game_id');
      localStorage.removeItem('kekopoly_navigation_timestamp');
      localStorage.removeItem('kekopoly_game_phase');
      localStorage.removeItem('kekopoly_game_status');
      localStorage.removeItem('kekopoly_socket_preserve');
      localStorage.removeItem('kekopoly_socket_gameId');
      localStorage.removeItem('kekopoly_socket_playerId');
      localStorage.removeItem('kekopoly_socket_timestamp');
    } catch (e) {
      console.warn('[NAVIGATION] Could not clear localStorage:', e);
    }

    // Clear Redux game state if dispatch is available
    if (dispatch && typeof dispatch === 'function') {
      try {
        dispatch({ type: 'game/setGameStarted', payload: false });
        dispatch({ type: 'game/setGamePhase', payload: '' });
        dispatch({ type: 'game/syncGameStatus', payload: '' });
      } catch (e) {
        console.warn('[NAVIGATION] Could not clear Redux state:', e);
      }
    }

    // Navigate to lobby
    navigate('/lobby');

    console.log('[NAVIGATION] Successfully navigated to lobby');
    return true;

  } catch (error) {
    console.error('[NAVIGATION] Error navigating to lobby:', error);
    
    if (toast) {
      toast({
        title: "Navigation Error", 
        description: "Failed to navigate to lobby. Please refresh the page.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
    
    return false;
  }
};
