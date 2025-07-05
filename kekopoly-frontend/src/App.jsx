import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Box,
} from '@chakra-ui/react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import GameBoard from './components/game/GameBoard';
import GameLobby from './components/lobby/GameLobby';
import GameRoom from './components/lobby/GameRoom';
import { store } from './store/store';
import { setGameStarted, setGamePhase, syncGameStatus } from './store/gameSlice';
import { clearGameStorageData } from './utils/storageUtils';
import { v4 as uuidv4 } from 'uuid';
import { connectSuccess } from './store/authSlice';

function App() {
  const gameState = useSelector((state) => state.game);
  const { gameStarted, gamePhase } = gameState;
  const { isAuthenticated } = useSelector((state) => state.auth);
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Add checked state to prevent redirect loop
  const [checked, setChecked] = React.useState(false);

  // Check localStorage for game state on component mount
  useEffect(() => {
    try {
      const storedGameStarted = localStorage.getItem('kekopoly_game_started') === 'true';
      const storedGameId = localStorage.getItem('kekopoly_game_id');
      const forceRedirect = localStorage.getItem('kekopoly_force_redirect') === 'true';
      const navTimestamp = localStorage.getItem('kekopoly_navigation_timestamp');

      // console.log('[APP] Checking localStorage for game state:', {
      //   storedGameStarted,
      //   storedGameId,
      //   forceRedirect,
      //   navTimestamp,
      //   currentPath: location.pathname
      // });

      // Only use localStorage data if timestamp is recent (last 2 minutes)
      // Increased from 30 seconds to 2 minutes to prevent unnecessary clearing
      const isTimestampRecent = navTimestamp &&
        (Date.now() - parseInt(navTimestamp, 10) < 120000);

      if (storedGameStarted && storedGameId && isTimestampRecent) {
        // console.log('[APP] Found recent game state in localStorage');

        // Before navigating, verify the game exists by making an API call
        const verifyGameExists = async () => {
          try {
            // Get the auth token from localStorage
            const token = localStorage.getItem('kekopoly_token');
            if (!token) {
              console.warn('[APP] No auth token found, cannot verify game exists');
              return false;
            }

            // Make an API call to verify the game exists
            const response = await fetch(`/api/games/${storedGameId}`, {
              headers: {
                'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
              }
            });

            if (!response.ok) {
              console.warn(`[APP] Game ${storedGameId} does not exist or cannot be accessed`);

              // Clear the localStorage data for this non-existent game
              clearGameStorageData(storedGameId);

              return false;
            }

            // Game exists, proceed with navigation
            return true;
          } catch (error) {
            console.error('[APP] Error verifying game exists:', error);
            return false;
          }
        };

        // Update Redux state
        dispatch(setGameStarted(true));
        dispatch(setGamePhase('playing'));
        dispatch(syncGameStatus('PLAYING'));

        // If we're not already on the game page and forceRedirect is set
        const targetPath = `/game/${storedGameId}`;
        if (location.pathname !== targetPath && (forceRedirect || !location.pathname.includes('/room/'))) {
          // console.log(`[APP] Checking if game ${storedGameId} exists before navigation`);

          // Clear the force redirect flag
          localStorage.removeItem('kekopoly_force_redirect');

          // Verify the game exists before navigating
          verifyGameExists().then(gameExists => {
            if (gameExists) {
              // console.log(`[APP] Game ${storedGameId} exists, navigating`);
              // Navigate to the game
              navigate(targetPath);
            } else {
              console.warn(`[APP] Game ${storedGameId} does not exist, not navigating`);
              // If on home page, stay there; otherwise navigate to home
              if (location.pathname !== '/') {
                navigate('/');
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('[APP] Error checking localStorage:', e);
    }
  }, [navigate, dispatch]); // Removed location.pathname from dependencies to prevent infinite loop

  // Log game state for debugging
  // console.log('App.jsx - Current game state:', { gameStarted, gamePhase });

  // Get the previous location if redirected from protected route
  const from = location.state?.from?.pathname || '/';

  useEffect(() => {
    setChecked(true);
  }, []);

  // On mount, generate a random user ID and set isAuthenticated to true
  useEffect(() => {
    let userId = localStorage.getItem('kekopoly_user_id');
    if (!userId) {
      userId = uuidv4();
      localStorage.setItem('kekopoly_user_id', userId);
    }
    // Use a dummy JWT for local development
    const dummyJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkZW1vIn0.dummysignature';
    dispatch(connectSuccess({ token: dummyJwt, user: { id: userId } }));
  }, [dispatch]);

  return (
    <Routes>
      {/* Auth Routes */}
      <Route path="/connect" element={<GameLobby />} />

      {/* Protected Routes */}
      <Route path="/" element={<GameLobby />} />

      <Route path="/room/:roomId" element={<GameRoom />} />

      <Route path="/game/:gameId" element={(() => {
        // Get the latest state directly from the store
        const latestState = store.getState().game;
        const effectiveGameStarted = gameStarted || latestState.gameStarted;
        const effectiveGamePhase = gamePhase || latestState.gamePhase;

        // Also check localStorage as additional fallback
        let localStorageGameStarted = false;
        let storedGameId = null;
        let navTimestamp = null;

        try {
          localStorageGameStarted = localStorage.getItem('kekopoly_game_started') === 'true';
          storedGameId = localStorage.getItem('kekopoly_game_id');
          navTimestamp = localStorage.getItem('kekopoly_navigation_timestamp');
          const isTimestampRecent = navTimestamp &&
            (Date.now() - parseInt(navTimestamp, 10) < 120000);
          if (!isTimestampRecent) {
            localStorageGameStarted = localStorageGameStarted && storedGameId === window.location.pathname.split('/').pop();
          }
        } catch (e) {
          console.warn('[ROUTING] Error reading localStorage:', e);
        }

        const shouldRenderGameBoard =
          (effectiveGameStarted && effectiveGamePhase === 'playing') ||
          localStorageGameStarted;

        if (!checked) {
          return null; // Wait for initial check
        }
        if (shouldRenderGameBoard) {
          return <GameBoard />;
        }
        return <GameLobby />;
      })()} />

      {/* 404 Route */}
      <Route path="*" element={<GameLobby />} />
    </Routes>
  );
}

export default App;