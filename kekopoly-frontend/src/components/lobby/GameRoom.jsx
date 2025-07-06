import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import {
  setHost,
  setGameStarted,
  setGamePhase,
  syncGameStatus,
  startGameAsync
} from '../../store/gameSlice';
import ResetGameButton from '../game/ResetGameButton';
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Flex,
  Avatar,
  Badge,
  Input,
  Select,
  FormControl,
  FormLabel,
  useToast,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Divider,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  SimpleGrid,
  Spinner,
} from '@chakra-ui/react';
import { FaCheck, FaUserCheck, FaCopy, FaPlay, FaUserEdit, FaUserPlus, FaSpinner } from 'react-icons/fa';
import { addPlayer, setPlayerReady, removePlayer } from '../../store/playerSlice';
import socketService from '../../services/socket';
import { store } from '../../store/store';
import { isTokenExpired } from '../../utils/tokenUtils';
import sessionMonitor from '../../utils/sessionMonitor';
import { safeNavigateToGame } from '../../utils/navigationUtils';

// Available tokens for players to choose from
const PLAYER_TOKENS = [
  { id: 'pepe', name: 'Pepe', emoji: '🐸', color: 'green.500' },
  { id: 'chad', name: 'Chad', emoji: '💪', color: 'blue.500' },
  { id: 'wojak', name: 'Wojak', emoji: '😢', color: 'yellow.500' },
  { id: 'doge', name: 'Doge', emoji: '🐕', color: 'orange.500' },
  { id: 'cat', name: 'Cat', emoji: '🐱', color: 'pink.500' },
  { id: 'troll', name: 'Troll', emoji: '👹', color: 'red.500' },
  { id: 'moon', name: 'Moon', emoji: '🌕', color: 'purple.500' },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', color: 'teal.500' },
];

// Simplified player selector that relies on server as source of truth for host status
const playerSelector = (state) => {
  // console.log("playerSelector called with state");

  const playerEntries = Object.entries(state.players.players || {});

  // Get hostId from game state - server is the source of truth
  const hostId = state.game.hostId;
  // console.log("hostId from game state (server source of truth):", hostId);

  // If there are no players in the state but we have a hostId, create a temporary player entry
  // This ensures we always have at least the host player visible
  if (playerEntries.length === 0 && hostId) {
    // Get the gameId/roomId either from Redux state or from the URL
    const gameId = state.game.gameId || window.location.pathname.split('/').pop();
    const currentPlayerId = localStorage.getItem(`kekopoly_player_${gameId}`);
    const playerName = localStorage.getItem(`kekopoly_player_name_${gameId}`) || 'Player';
    const playerToken = localStorage.getItem(`kekopoly_player_token_${gameId}`);

    // Try to get token details if available
    let emoji = '👑';
    let color = 'green.500';
    if (playerToken) {
      const tokenData = PLAYER_TOKENS.find(t => t.id === playerToken);
      if (tokenData) {
        emoji = tokenData.emoji;
        color = tokenData.color;
      }
    }

    if (currentPlayerId && currentPlayerId === hostId) {
      // console.log(`No players in state but found hostId ${hostId} matching currentPlayerId, creating temporary player entry`);

      // Use a new mock entry for the host until the Redux store properly updates
      return [{
        id: hostId,
        name: playerName || `Player ${hostId.substring(0, 4).replace('play', '')}`,
        isHost: true,
        isReady: false,
        color: color,
        emoji: emoji,
        token: playerToken,
        status: 'ACTIVE',
      }];
    }
  }

  // Map players with host status based on the current hostId
  const result = playerEntries.map(([id, player]) => {
    // Ensure isHost flag matches the current hostId
    return {
      ...player,
      isHost: id === hostId,
      // Ensure status is set
      status: player.status || 'ACTIVE'
    };
  });

  // console.log("playerSelector result:", result);
  return result;
};

const GameRoom = () => {
  const { gameId: rawGameId } = useParams();
  // Keep lowercase for frontend UI consistency, but use uppercase for backend communication
  const roomId = rawGameId ? rawGameId.toLowerCase().trim() : '';
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Get auth token from Redux store
  const { token, user } = useSelector((state) => state.auth);

  // Check for session expiration on component mount and when token changes
  useEffect(() => {
    if (!token || isTokenExpired(token)) {
      console.warn('Session expired or no token available');
      toast({
        title: "Session Expired",
        description: "Your session has expired. Please log in again.",
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      
      // Clear any game-related localStorage items
      localStorage.removeItem('kekopoly_game_started');
      localStorage.removeItem('kekopoly_game_id');
      
      // Redirect to login
      navigate('/login');
      return;
    }

    // Validate roomId
    if (!roomId || roomId === 'null' || roomId === 'undefined') {
      console.error('Invalid roomId in GameRoom:', roomId);
      toast({
        title: "Invalid Room",
        description: "Invalid room ID. Redirecting to lobby.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      navigate('/lobby');
      return;
    }
  }, [token, roomId, navigate, toast]);

  // Use the player selector with memoization
  const players = useSelector(playerSelector, shallowEqual);
  const gameState = useSelector((state) => state.game);

  // Get raw players object for debugging
  const rawPlayersObject = useSelector(state => state.players.players);

  // Log the players to see what's happening
  useEffect(() => {
    // console.log("Current players in store:", players);
    // console.log("Players array length:", players.length);
    // console.log("Raw players object:", rawPlayersObject);
    // console.log("Game state hostId:", gameState.hostId);

    // Debug the player with isHost flag
    const hostPlayer = players.find(p => p.isHost);
    // console.log("Host player from players array:", hostPlayer || 'No host player found');

    // Debug the player selector function
    const state = store.getState();
    // console.log("hostId in Redux state:", state.game.hostId);
    // console.log("playerSelector result:", playerSelector(state));
  }, [players, rawPlayersObject, gameState.hostId]);

  const {
    gameStarted,
    gamePhase,
    hostId,
    loading,
    error,
    gameInfo
  } = gameState;

  // Local state
  const [playerName, setPlayerName] = useState('');
  const [selectedToken, setSelectedToken] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isReadyLoading, setIsReadyLoading] = useState(false);



  // Enhanced host check that relies on server as source of truth
  const hostPlayer = players.find(p => p.isHost);



  // Get the current player object from the players array
  const currentPlayerObj = players.find(p => p.id === currentPlayerId);

  // Enhanced host check - use multiple sources of truth:
  // 1. Check if currentPlayerId matches hostId from gameState
  // 2. Check if the current player has isHost flag set to true
  // 3. Check if currentPlayerId matches the ID of a player with isHost flag
  const isHost =
    currentPlayerId === hostId ||
    (currentPlayerObj && currentPlayerObj.isHost === true) ||
    (currentPlayerId && hostPlayer && currentPlayerId === hostPlayer.id);

  // Request host info from server if needed
  useEffect(() => {
    if (currentPlayerId && !isHost) {
      if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
        socketService.sendMessage('get_host', { gameId: roomId });
      }
    }
  }, [currentPlayerId, hostId, hostPlayer, isHost, players, currentPlayerObj, roomId, socketService]);

  // Check if current player is registered
  // Log values used for isRegistered check
  // console.log(`[Render Check] Checking isRegistered: currentPlayerId=${currentPlayerId}`);
  const isRegistered = Boolean(currentPlayerId);
  // console.log(`[Render Check] Final isRegistered value: ${isRegistered}`);

  // Current player data
  const currentPlayer = players.find(p => p.id === currentPlayerId);

  // Check if all players are ready - only count active players
  const activePlayers = players.filter(p => p.status !== 'DISCONNECTED');
  // Enhanced check for all players ready - ensure we have at least 2 players and all are ready
  const allPlayersReady = activePlayers.length >= 2 && activePlayers.every(p => p.isReady === true);

  // Get maxPlayers from the active players response or use a default
  const maxPlayers = useMemo(() => {
    // Try to get maxPlayers from the game info in the active_players response
    const gameInfo = gameState.gameInfo || {};
    return gameInfo.maxPlayers || 2; // Default to 2 if not specified
  }, [gameState.gameInfo]);

  const isRoomFull = activePlayers.length >= maxPlayers;

  // Count of players who have readied up - only count active players
  const readyPlayersCount = activePlayers.filter(p => p.isReady).length;

  // Broadcast current player information to other clients with debouncing
  const broadcastPlayerInfo = useCallback((initialPlayerData = null) => {

    // Enhanced validation for currentPlayerId
    if (!currentPlayerId || currentPlayerId === 'null' || currentPlayerId === 'undefined') {
      console.log('[PLAYER_DISPLAY] Cannot broadcast player info: Invalid or missing currentPlayerId', { 
        currentPlayerId,
        type: typeof currentPlayerId 
      });
      return;
    }

    if (!socketService || !socketService.isConnected()) {
      console.log('[PLAYER_DISPLAY] Cannot broadcast: Socket not connected');
      return;
    }

    // CRITICAL FIX: Ensure room code case consistency
    const normalizedRoomId = roomId.toUpperCase(); // Backend expects uppercase

    // Check if socket is ready for messages
    if (!socketService.socketReady) {
      console.log('[PLAYER_DISPLAY] Socket not ready for messages, queuing broadcast');
      // Queue the message for when socket becomes ready
      setTimeout(() => {
        if (socketService && socketService.isConnected() && socketService.socketReady) {
          broadcastPlayerInfo(initialPlayerData);
        }
      }, 500);
      return;
    }

    // Enhanced debounce check with global debounce tracking
    const debounceKey = `lastBroadcast_${currentPlayerId}`;
    const globalDebounceKey = 'lastAnyPlayerBroadcast';
    
    if (!window[debounceKey]) { window[debounceKey] = 0; }
    if (!window[globalDebounceKey]) { window[globalDebounceKey] = 0; }
    
    const now = Date.now();
    
    // Per-player debounce: 2 seconds
    if (now - window[debounceKey] < 2000) {
      console.log('[PLAYER_DISPLAY] Skipping broadcast due to per-player debounce');
      return;
    }
    
    // Global debounce: 500ms (prevent any player broadcasts too close together)
    if (now - window[globalDebounceKey] < 500) {
      console.log('[PLAYER_DISPLAY] Skipping broadcast due to global debounce');
      return;
    }
    
    // Update debounce timestamps
    window[debounceKey] = now;
    window[globalDebounceKey] = now;

    // --- Use initialPlayerData if provided, otherwise get from Redux store ---
    let dataToSend = initialPlayerData;
    if (!dataToSend) {
      // Get player data from Redux store
      const currentState = store.getState();
      const playersInStore = currentState.players.players || {};
      dataToSend = playersInStore[currentPlayerId];
      
      if (!dataToSend) {
        // Create minimal player data as fallback
        const playerName = localStorage.getItem(`kekopoly_player_name_${roomId}`) || 'Player';
        const playerToken = localStorage.getItem(`kekopoly_player_token_${roomId}`) || 'pepe';
        
        dataToSend = {
          id: currentPlayerId,
          name: playerName,
          token: playerToken,
          isHost: false,
          isReady: false
        };
        
        console.log('[PLAYER_DISPLAY] Created fallback player data:', dataToSend);
      }
    }
    
    // Final validation of dataToSend
    if (!dataToSend || !dataToSend.id) {
      console.error('[PLAYER_DISPLAY] Cannot broadcast: Invalid player data', dataToSend);
      return;
    }
    
    console.log('[PLAYER_DISPLAY] Broadcasting player info using data:', dataToSend);

    // Always try to get emoji and color from token first for consistency
    let emoji = '👤';
    let color = 'gray.500';

    // Use the dataToSend object
    if (dataToSend.token) {
      const tokenData = PLAYER_TOKENS.find(t => t.id === dataToSend.token);
      if (tokenData) {
        emoji = tokenData.emoji;
        color = tokenData.color;
        console.log(`[PLAYER_DISPLAY] Found token data for ${dataToSend.token}:`, tokenData);
      }
    }

    // Fallback to player's emoji and color if token data wasn't found
    if (emoji === '👤' && dataToSend.emoji) {
      emoji = dataToSend.emoji;
    }

    if (color === 'gray.500' && dataToSend.color) {
      color = dataToSend.color;
    }

    const playerMessage = {
      player: {
        id: dataToSend.id,
        name: dataToSend.name || `Player ${dataToSend.id.substring(0, 4)}`, // Fallback
        token: dataToSend.token || '',
        emoji: emoji || '👤',  // Ensure emoji is never empty
        color: color || 'gray.500',
        isHost: dataToSend.isHost || false,
        isReady: dataToSend.isReady || false
      }
    };

    console.log('[PLAYER_DISPLAY] Sending player_joined message:', playerMessage);
    
    try {
      const success = socketService.sendMessage('player_joined', playerMessage);
      if (!success) {
        console.warn('[PLAYER_DISPLAY] Failed to send player_joined message - message may be queued');
      }
    } catch (error) {
      console.error('[PLAYER_DISPLAY] Error sending player_joined message:', error);
      return; // Exit early if broadcast failed
    }

    // After broadcasting, also request the current active players to ensure sync
    setTimeout(() => {
      if (socketService && socketService.isConnected()) {
        console.log('[PLAYER_DISPLAY] Requesting active players after broadcast');
        try {
          socketService.sendMessage('get_active_players', {});
        } catch (error) {
          console.warn('[PLAYER_DISPLAY] Error requesting active players:', error);
        }
      }
    }, 500);

    console.log('[PLAYER_DISPLAY] Player info broadcast complete');
  }, [currentPlayerId, socketService, roomId]); // Added roomId to dependency array

  // Setup navigation function in window object for socketService to use
  useEffect(() => {
    // Expose navigate function to window object for socketService to use
    window.navigateToGame = (gameId) => {
      return safeNavigateToGame(navigate, gameId || roomId, dispatch, toast);
    };

    // Add event listener for game-started custom event
    const handleGameStarted = (event) => {
      const targetGameId = event.detail?.gameId || roomId;
      const fromHost = event.detail?.hostId !== currentPlayerId;

      // All players (including host) should navigate when they receive game-started event
      console.log('[GAME_STARTED] Received game-started event, navigating to game board');

      // Update Redux state
      dispatch(setGameStarted(true));
      dispatch(setGamePhase('playing'));
      dispatch(syncGameStatus('ACTIVE'));

      // Store in localStorage
      try {
        localStorage.setItem('kekopoly_game_started', 'true');
        localStorage.setItem('kekopoly_game_id', targetGameId);
        localStorage.setItem('kekopoly_navigation_timestamp', Date.now().toString());
      } catch (e) {
        console.warn('Could not use localStorage:', e);
      }

      // Navigate to game board
      navigate(`/game/${targetGameId}`);

      // Preserve socket connection during navigation
      if (socketService) {
        socketService.preserveSocketForNavigation();
      }

      toast({
        title: "Game Starting",
        description: "Game has been started. Joining game board...",
        status: "info",
        duration: 3000,
        isClosable: true,
      });
    };

    // Add event listener
    window.addEventListener('game-started', handleGameStarted);

    // Cleanup
    return () => {
      window.removeEventListener('game-started', handleGameStarted);
    };
  }, [navigate, dispatch, roomId, currentPlayerId, socketService]);

  // Game state change effect
  useEffect(() => {
    // React to game state changes
    // Only transition to game board in response to a real 'game started' event (WebSocket or custom event)
    // Do NOT auto-navigate just because gameStarted/gamePhase are set locally
    // This prevents premature navigation when a player joins or is selected
    //
    // If you want to debug, uncomment the following:
    // console.log("Game state changed - gameStarted:", gameStarted, "gamePhase:", gamePhase);
    // console.log(`Player ${currentPlayerId} checking game state. Is host: ${isHost}`);
    //
    // Navigation is now handled ONLY by handleGameStarted and window.navigateToGame
  }, [gameStarted, gamePhase, navigate, roomId, currentPlayerId, isHost]);



  // Room validation effect - check if room exists before allowing entry
  useEffect(() => {
    const validateRoom = async () => {
      if (!roomId || !token) {
        console.log(`[ROOM_VALIDATION] Skipping validation - roomId: ${roomId}, token: ${!!token}`);
        return;
      }

      try {
        console.log(`[ROOM_VALIDATION] Validating room: ${roomId}`);
        
        // Check if the room/game exists by calling the backend API
        const apiBaseUrl = import.meta.env.VITE_API_URL || 
                         (window.location.hostname === 'localhost' ? 'http://localhost:8080' : `${window.location.protocol}//${window.location.host}`);
        const response = await fetch(`${apiBaseUrl}/api/v1/games/${roomId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        console.log(`[ROOM_VALIDATION] API response status: ${response.status}`);

        if (!response.ok) {
          // Room doesn't exist or error occurred
          console.error(`[ROOM_VALIDATION] Room ${roomId} not found or inaccessible:`, response.status, response.statusText);
          
          // Handle different error cases
          let errorMessage = `The room "${roomId}" does not exist or is no longer available.`;
          
          if (response.status === 404) {
            errorMessage = `Game room "${roomId}" was not found. It may have been deleted or never existed.`;
          } else if (response.status === 401 || response.status === 403) {
            errorMessage = `Access denied to room "${roomId}". Your session may have expired.`;
            
            // For auth errors, redirect to login instead of lobby
            toast({
              title: 'Access Denied',
              description: errorMessage + ' Redirecting to login...',
              status: 'error',
              duration: 5000,
              isClosable: true,
            });
            
            setTimeout(() => {
              navigate('/login');
            }, 2000);
            return;
          }
          
          toast({
            title: 'Room Not Found',
            description: errorMessage + ' Redirecting to lobby...',
            status: 'error',
            duration: 5000,
            isClosable: true,
          });

          // Navigate back to lobby after a short delay
          setTimeout(() => {
            navigate('/lobby');
          }, 2000);
          return;
        }

        // Room exists, we can proceed
        const gameData = await response.json();
        console.log(`[ROOM_VALIDATION] Room ${roomId} validated successfully:`, gameData);
        
        // Check if the game is in a joinable state
        const joinableStatuses = ['LOBBY', 'ACTIVE', 'PAUSED'];
        const currentStatus = gameData.status;
        
        if (!joinableStatuses.includes(currentStatus)) {
          console.log(`[ROOM_VALIDATION] Game ${roomId} is not joinable. Status: ${currentStatus}`);
          
          let statusMessage = '';
          if (currentStatus === 'COMPLETED') {
            statusMessage = 'This game has already finished.';
          } else if (currentStatus === 'ABANDONED') {
            statusMessage = 'This game has been abandoned.';
          } else {
            statusMessage = `This game is currently in "${currentStatus}" status and cannot be joined.`;
          }
          
          toast({
            title: 'Game Not Available',
            description: `${statusMessage} Redirecting to lobby...`,
            status: 'warning',
            duration: 5000,
            isClosable: true,
          });

          // Navigate back to lobby after a short delay
          setTimeout(() => {
            navigate('/lobby');
          }, 2000);
          return;
        }
        
        console.log(`[ROOM_VALIDATION] Game ${roomId} is joinable with status: ${currentStatus}`);
        
        // Store room data in Redux for use by other components
        if (gameData.code && gameData.code.toUpperCase() !== roomId.toUpperCase()) {
          console.log(`[ROOM_VALIDATION] Room code mismatch detected. URL: ${roomId}, Actual: ${gameData.code}`);
          
          // Show warning about room code mismatch but don't redirect
          toast({
            title: 'Room Code Notice',
            description: `You accessed this room via "${roomId}" but the actual room code is "${gameData.code}".`,
            status: 'info',
            duration: 3000,
            isClosable: true,
          });
        }
        
      } catch (error) {
        console.error('[ROOM_VALIDATION] Error validating room:', error);
        
        // Handle network errors vs other errors differently
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          toast({
            title: 'Connection Error',
            description: 'Unable to connect to the server. Please check your internet connection.',
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
        } else {
          toast({
            title: 'Validation Error',
            description: 'Unable to verify room status. Redirecting to lobby...',
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
          
          setTimeout(() => {
            navigate('/lobby');
          }, 2000);
        }
      }
    };

    // Add a small delay to ensure component is fully mounted
    const timeoutId = setTimeout(validateRoom, 500);
    
    return () => clearTimeout(timeoutId);
  }, [roomId, token, navigate, toast]);

  // Effect to initialize player connection when first joining OR reconnecting after load
  useEffect(() => {
    // Clear the game_started flag in localStorage when entering the game room
    // This ensures players don't automatically navigate to the game board
    // until the host explicitly starts the game
    try {
      // Only clear if we're in the room page and not navigating from game board
      if (window.location.pathname.includes('/room/') &&
          !document.referrer.includes('/game/')) {
        localStorage.removeItem('kekopoly_game_started');
      }
    } catch (e) {
      console.warn('Error clearing localStorage:', e);
    }

    // Extract the player ID and token from local storage for this room
    const storedPlayerId = localStorage.getItem(`kekopoly_player_${roomId}`);
    // --- RENAME storedToken to avoid confusion ---
    const storedCharacterToken = localStorage.getItem(`kekopoly_player_token_${roomId}`);
    // ---

    // Validate stored player ID
    if (storedPlayerId && storedPlayerId !== 'null' && storedPlayerId !== 'undefined' && storedPlayerId.trim() !== '') {
      console.log('[PLAYER_RECOVERY] Found valid stored player ID:', storedPlayerId);
    } else {
      console.log('[PLAYER_RECOVERY] No valid stored player ID found:', storedPlayerId);
    }

    // Request active players immediately to ensure we have the latest player list
    if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
      socketService.sendMessage('get_active_players', {});

      // Also explicitly request host information
      if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
        socketService.sendMessage('get_host', { gameId: roomId });
      }
    }

    if (storedPlayerId && storedPlayerId !== 'null' && storedPlayerId !== 'undefined' && storedPlayerId.trim() !== '') {
      console.log('[PLAYER_RECOVERY] Attempting to recover player session:', storedPlayerId);
      setCurrentPlayerId(storedPlayerId); // Set the state

      // --- Attempt connection ONLY if we found a valid player ID AND the AUTH token ---
      if (roomId && token && socketService) { // Use the 'token' (JWT) from Redux state, NOT storedCharacterToken
        // console.log('Attempting initial connection/reconnection for existing player:', storedPlayerId);
        // console.log(`Using Auth Token: ${token.substring(0,10)}...`);
        // CRITICAL FIX: Use uppercase room ID for backend consistency
        const normalizedRoomIdForBackend = roomId.toUpperCase();
        // --- PASS THE CORRECT AUTH TOKEN (JWT) ---
        socketService.connect(normalizedRoomIdForBackend, storedPlayerId, token)
        // ---
          .then(() => {
            // Request host information immediately after connection
            if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
              socketService.sendMessage('get_host', { gameId: roomId });
            }

            // Optionally retrieve full player data from store and broadcast
            setTimeout(() => { // Add slight delay for state to potentially update
                const latestPlayerData = store.getState().players.players[storedPlayerId];
                if (latestPlayerData) {
                    // --- Pass player data to broadcast for initial info sync ---
                    // Ensure the character token is included if available
                    const playerDataForBroadcast = {
                        ...latestPlayerData,
                        token: storedCharacterToken || latestPlayerData.token // Prioritize localStorage character token
                    };
                    broadcastPlayerInfo(playerDataForBroadcast);
                    // ---

                    // Request host information again after player data is updated
                    if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
                      socketService.sendMessage('get_host', { gameId: roomId });
                    }
                } else {
                     console.warn("Could not get player data from store after reconnect to broadcast.");
                }
            }, 1000);
          })
          .catch(err => {
            console.error("Initial connection attempt failed for existing player:", err);
            // No need to reject here, connection status handling will show error
          });
      } else {
         // console.log('Skipping initial connection: Missing roomId, AUTH token from Redux, or socketService.');
      }
      // ---
    } else {
      // console.log('No existing player ID found in localStorage for this room.');
      // User will be prompted to join via modal
    }

    // Expose navigate function to window object for WebSocket callbacks
    window.navigateToGame = (gameId) => {
      if (!gameId || gameId === 'null' || gameId === 'undefined') {
        console.error('[NAVIGATION] Invalid gameId provided:', gameId);
        return false;
      }
      return safeNavigateToGame(navigate, gameId, dispatch, toast);
    };

    return () => {
      // Check if we're navigating to the game board
      const isNavigatingToGame = window.location.pathname.includes('/game/');

      // console.log(`GameRoom component unmounting, current path: ${window.location.pathname}`);
      // console.log(`Is navigating to game: ${isNavigatingToGame}`);

      // If we're navigating to the game board, preserve the connection
      // Otherwise, disconnect normally
      if (isNavigatingToGame) {
        // console.log('Navigating to game board, setting navigation flags in socketService');
        // Set the navigation flags in socketService
        socketService.isNavigating = true;
        socketService.preserveConnection = true;

        // Store connection info in localStorage as a backup
        try {
          localStorage.setItem('kekopoly_socket_preserve', 'true');
          localStorage.setItem('kekopoly_socket_gameId', roomId);
          localStorage.setItem('kekopoly_socket_playerId', currentPlayerId);
          localStorage.setItem('kekopoly_socket_timestamp', Date.now().toString());
        } catch (e) {
          console.warn('Could not store socket preservation info in localStorage:', e);
        }
      }

      // Call disconnect with the preserve flag
      socketService.disconnect(isNavigatingToGame);
      // console.log(`Socket disconnection called with preserveForNavigation=${isNavigatingToGame}`);

      // Clean up the global navigate function
      delete window.navigateToGame;
    };
  }, [roomId, navigate, token]);

  // Effect to handle socket reconnection
  useEffect(() => {
    // Check socket status every 5 seconds
    const intervalId = setInterval(() => {
      if (currentPlayerId && roomId && token &&
          (!socketService.socket || socketService.socket.readyState !== WebSocket.OPEN)) {
        // console.log('[SOCKET_RECONNECT] Socket disconnected, attempting to reconnect...');
        // console.log('[SOCKET_RECONNECT] Room ID (normalized):', roomId);
        // console.log('[SOCKET_RECONNECT] Player ID:', currentPlayerId);

        // Check if player exists in state before reconnecting
        const currentState = store.getState();
        const playersInStore = currentState.players.players || {};
        const playerExists = !!playersInStore[currentPlayerId];

        // console.log(`[SOCKET_RECONNECT] Player exists in state: ${playerExists}`);
        // console.log(`[SOCKET_RECONNECT] Current players in state: ${Object.keys(playersInStore).length}`,
        //   Object.keys(playersInStore).map(id => ({
        //     id,
        //     name: playersInStore[id].name
        //   }))
        // );

        if (playerExists) {
          // console.log('[SOCKET_RECONNECT] Player confirmed in state, proceeding with reconnection');
          socketService.initialize();
          // console.log(`[SOCKET_RECONNECT] Connection attempt at ${new Date().toISOString()}`);

          // Get the player data from state to include in reconnection
          const playerData = playersInStore[currentPlayerId];

          // CRITICAL FIX: Use uppercase room ID for backend consistency
          const normalizedRoomIdForBackend = roomId.toUpperCase();
          
          // Connect with player data to ensure proper synchronization
          socketService.connect(normalizedRoomIdForBackend, currentPlayerId, token, playerData)
            .then(() => {
              // console.log('[SOCKET_RECONNECT] Reconnection successful');

              // Request active players to ensure everyone is in sync
              setTimeout(() => {
                if (socketService.isConnected()) {
                  // console.log('[SOCKET_RECONNECT] Requesting active players after reconnection');
                  socketService.sendMessage('get_active_players');
                }
              }, 200);
            })
            .catch(err => {
              console.error('[SOCKET_RECONNECT] Reconnection failed:', err);
            });

          // Set a flag in localStorage to indicate we're reconnecting
          localStorage.setItem('reconnecting', 'true');
        } else {
          // console.log('[SOCKET_RECONNECT] Player not found in state, delaying reconnection attempt');
          // Don't attempt reconnection until player is in state
          localStorage.setItem('reconnection_pending', 'true');
        }
      }

      // Check if we have a pending reconnection and player is now in state
      if (localStorage.getItem('reconnection_pending') === 'true') {
        const currentState = store.getState();
        const playersInStore = currentState.players.players || {};
        const playerExists = !!playersInStore[currentPlayerId];

        if (playerExists) {
          // console.log('[SOCKET_RECONNECT] Player now in state, proceeding with delayed reconnection');
          localStorage.removeItem('reconnection_pending');

          // Get the player data from state to include in reconnection
          const playerData = playersInStore[currentPlayerId];

          socketService.initialize();
          socketService.connect(roomId, currentPlayerId, token, playerData)
            .then(() => {
              // console.log('[SOCKET_RECONNECT] Delayed reconnection successful');

              // Request active players to ensure everyone is in sync
              setTimeout(() => {
                if (socketService.isConnected()) {
                  // console.log('[SOCKET_RECONNECT] Requesting active players after delayed reconnection');
                  socketService.sendMessage('get_active_players');
                }
              }, 200);
            })
            .catch(err => {
              console.error('[SOCKET_RECONNECT] Delayed reconnection failed:', err);
            });

          localStorage.setItem('reconnecting', 'true');
        }
      }

      // If we've just reconnected, broadcast player info
      if (localStorage.getItem('reconnecting') === 'true' &&
          socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
        // console.log('Socket reconnected, broadcasting player info');
        // Clear the reconnection flag
        localStorage.removeItem('reconnecting');

        // Verify player exists in state before broadcasting
        const currentState = store.getState();
        const playersInStore = currentState.players.players || {};

        if (playersInStore[currentPlayerId]) {
          // console.log('Player confirmed in state after reconnection, broadcasting info');
          // Use a direct function call to avoid dependency issues
          setTimeout(() => {
            if (socketService?.socket?.readyState === WebSocket.OPEN) {
              broadcastPlayerInfo();
            }
          }, 500);
        } else {
          // console.log('Player not yet in state after reconnection, delaying broadcast');
          setTimeout(() => {
            if (socketService?.socket?.readyState === WebSocket.OPEN) {
              broadcastPlayerInfo();
            }
          }, 1500);
        }
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [currentPlayerId, roomId, token, broadcastPlayerInfo]);

  // Effect to check and log network status
  useEffect(() => {
    const checkNetwork = () => {
      // console.log(`Network status: ${navigator.onLine ? 'Online' : 'Offline'}`);
      // console.log(`Socket status: ${socketService.socket ?
      //   ['Connecting', 'Open', 'Closing', 'Closed'][socketService.socket.readyState] : 'Not initialized'}`);
      // console.log(`Room ID: ${roomId}, Current player: ${currentPlayerId}`);
      // console.log(`Players in room: ${players.length}`);
      // players.forEach(p => console.log(`- ${p.name} (${p.id}): ${p.isReady ? 'Ready' : 'Not ready'}`));
    };

    checkNetwork();
    const intervalId = setInterval(checkNetwork, 10000);

    return () => clearInterval(intervalId);
  }, [roomId, currentPlayerId, players]);

  // Effect to broadcast player info when connected - with reduced frequency
  useEffect(() => {
    if (currentPlayerId && socketService && socketService.socket &&
        socketService.socket.readyState === WebSocket.OPEN) {
      // Add a delay to ensure Redux state is fully updated
      setTimeout(() => {
        const currentState = store.getState();
        const playersInStore = currentState.players.players || {};

        if (playersInStore[currentPlayerId]) {
          // console.log("Broadcasting player info after ensuring player exists in state");
          broadcastPlayerInfo();
        } else {
          // console.log("Player still not in state, delaying broadcast");
          // Try again after another delay, but only once
          setTimeout(() => {
            const updatedState = store.getState();
            const updatedPlayersInStore = updatedState.players.players || {};

            if (updatedPlayersInStore[currentPlayerId]) {
              broadcastPlayerInfo();
            } else {
              // console.log("Player still not in state after delay, creating minimal broadcast");
              // Create minimal player data for broadcast if still not in state
              const playerName = localStorage.getItem(`kekopoly_player_name_${roomId}`) || 'Player';
              const playerToken = localStorage.getItem(`kekopoly_player_token_${roomId}`) || 'pepe';
              const tokenData = PLAYER_TOKENS.find(t => t.id === playerToken);
              
              const minimalPlayerData = {
                id: currentPlayerId,
                name: playerName,
                token: playerToken,
                emoji: tokenData ? tokenData.emoji : '👤',
                color: tokenData ? tokenData.color : 'gray.500',
                isReady: false,
                status: 'ACTIVE'
              };
              
              broadcastPlayerInfo(minimalPlayerData);
            }
          }, 1500);
        }
      }, 1000);
    }
  }, [currentPlayerId, socketService?.socket?.readyState, broadcastPlayerInfo]);

  // Effect to ensure player info is broadcast after successful WebSocket connection - with reduced frequency
  useEffect(() => {
    if (isRegistered && currentPlayerId && players.length > 0 &&
        socketService && socketService.socket &&
        socketService.socket.readyState === WebSocket.OPEN) {

      // console.log('Connection established and player registered. Broadcasting current player info.');
      // Broadcast current player info to ensure all players can see each other
      broadcastPlayerInfo();

      // Don't determine host status locally - server is the source of truth
      // console.log('Relying on server for player state synchronization.');
    }
  }, [isRegistered, currentPlayerId, players.length, socketService?.socket?.readyState, broadcastPlayerInfo]);

  // Effect to set up a consolidated player sync heartbeat
  useEffect(() => {
    let heartbeatInterval = null;
    if (isRegistered && connectionStatus === 'connected' && socketService?.socket?.readyState === WebSocket.OPEN) {
      // Re-enable heartbeat interval with a reasonable frequency
      heartbeatInterval = setInterval(() => {
        socketService.sendMessage('get_active_players');

        // Also request host information periodically
        if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
          socketService.sendMessage('get_host', { gameId: roomId });
        }
      }, 5000); // Every 5 seconds to ensure player list and host info stays in sync

      return () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      };
    }
  }, [isRegistered, connectionStatus, socketService?.socket?.readyState, roomId]);

  // Effect to automatically open registration modal if not registered
  useEffect(() => {
    // If there's no current player ID and the modal isn't open, open it
    if (!currentPlayerId && !isRegistered && !isOpen) {
      // Short delay to ensure everything is loaded
      const timer = setTimeout(() => {
        onOpen();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [currentPlayerId, isRegistered, isOpen, onOpen]);

  // Effect for handling WebSocket connection status updates
  useEffect(() => {
    if (!socketService) return;

    const handleStatusChange = (status) => {
      // console.log(`[GameRoom Effect] WebSocket Connection Status Changed: ${status}`);
      setConnectionStatus(status); // Update React state
    };

    const handleError = (error) => {
      console.error("[GameRoom Effect] WebSocket Error:", error);
      // Optionally set status to 'error' or show a toast
      setConnectionStatus('error');
    };

    // Assign the handlers
    socketService.onConnectionChange = handleStatusChange;
    socketService.onConnectionError = handleError;

    // Initial check in case connection happened before effect ran
    if (socketService.socket) {
      const initialState = socketService.getConnectionState(); // Assume getConnectionState exists
      // console.log(`[GameRoom Effect] Setting initial connection status based on socketService: ${initialState}`);
      setConnectionStatus(initialState);
    } else {
       // console.log(`[GameRoom Effect] Setting initial connection status: disconnected`);
       setConnectionStatus('disconnected');
    }

    // Cleanup function
    return () => {
      // Reset callbacks on unmount to avoid potential leaks
      if (socketService) {
        socketService.onConnectionChange = () => {};
        socketService.onConnectionError = () => {};
      }
    };
  }, [socketService]); // Depend only on socketService instance

  // Cleanup effect - handle leaving game when component unmounts or navigating away
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Send leave_game message when page is being unloaded
      if (socketService && currentPlayerId && roomId) {
        socketService.leaveGame();
      }
    };

    // Add event listener for page unload
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup function - called when component unmounts or dependencies change
    return () => {
      // Remove event listener
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Send leave_game message when navigating away from GameRoom
      if (socketService && currentPlayerId && roomId) {
        console.log(`[GameRoom Cleanup] Player ${currentPlayerId} leaving game ${roomId}`);
        socketService.leaveGame();
      }
    };
  }, [socketService, currentPlayerId, roomId]); // Dependencies ensure cleanup runs when these change

  // Send leave_game message on unmount or navigation
  useEffect(() => {
    return () => {
      if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
        const playerId = localStorage.getItem(`kekopoly_player_${roomId}`) || currentPlayerId;
        socketService.sendMessage('leave_game', {
          gameId: roomId,
          playerId: playerId
        });
      }
    };
  }, [roomId, currentPlayerId, socketService]);

  // Handle player registration
  const handleRegisterPlayer = async () => {
    if (!playerName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a player name",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    if (!selectedToken) {
      toast({
        title: "Token required",
        description: "Please select a player token",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Check if token is already taken
    if (players.some(p => p.token === selectedToken)) {
      toast({
        title: "Token unavailable",
        description: "This token has already been chosen by another player",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsJoining(true);

    try {
      // Pause session monitoring during player registration to prevent interference
      sessionMonitor.pauseFor(10000); // Pause for 10 seconds
      
      // Get token data
      const tokenData = PLAYER_TOKENS.find(t => t.id === selectedToken);

      // Extract user ID from JWT token, but generate a unique player ID for this session
      const tokenPayload = JSON.parse(atob(token.split('.')[1]));
      const jwtUserId = tokenPayload.userId;
      
      // Check if we have a valid JWT userId (not all zeros which indicates a problem)
      if (!jwtUserId || jwtUserId === '000000000000000000000000' || jwtUserId.length < 10) {
        console.error('[PLAYER_REGISTRATION] Invalid JWT userId detected:', jwtUserId);
        
        toast({
          title: "Authentication Error",
          description: "Your session is invalid. Please log in again.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        
        // Clear localStorage and redirect to login
        localStorage.clear();
        navigate('/login');
        return;
      }
      
      // CRITICAL FIX: Ensure room code case consistency - use uppercase for backend
      const normalizedRoomIdForBackend = roomId.toUpperCase();
      
      // Generate a consistent player ID based on JWT userId and room
      // This ensures the same user gets the same player ID for a specific room
      const uniquePlayerId = `${jwtUserId}_${normalizedRoomIdForBackend}`;
      
      console.log('[PLAYER_REGISTRATION] Generated consistent player ID:', {
        jwtUserId,
        uniquePlayerId,
        roomId: normalizedRoomIdForBackend,
        tokenValid: !isTokenExpired(token)
      });

      // Create player data object with guaranteed emoji
      const playerData = {
        id: uniquePlayerId, // Use the unique player ID instead of JWT userId
        name: playerName,
        token: selectedToken || '',
        emoji: tokenData ? tokenData.emoji : '👤',  // Ensure emoji is never empty
        color: tokenData ? tokenData.color : 'gray.500',
        isReady: false,
        position: 0,
        balance: 1500,
        properties: [],
        status: 'ACTIVE'
      };

      // Log the token data to verify it's being set correctly
      console.log("Player registration with token data:", {
        selectedToken,
        tokenData,
        resultingEmoji: playerData.emoji,
        uniquePlayerId,
        jwtUserId
      });

      // console.log("Adding player to Redux:", playerData);

      // Add player to Redux store
      dispatch(addPlayer({
        playerId: uniquePlayerId, // Use the unique player ID
        playerData
      }));

      // Save player ID to local storage for reconnection
      // roomId is already normalized at the top of the component
      localStorage.setItem(`kekopoly_player_${roomId}`, uniquePlayerId);
      localStorage.setItem(`kekopoly_player_name_${roomId}`, playerName);
      localStorage.setItem(`kekopoly_player_token_${roomId}`, selectedToken);

      // Force an immediate update of the local state to ensure UI updates
      setCurrentPlayerId(uniquePlayerId);

      // Force immediate re-render to show the player in the list
      // No need to create updatedPlayerData as it's handled by Redux now
      // console.log("Manually updating players array with:", updatedPlayerData);

      // Log the player data *just before* connecting
      // console.log("[REGISTER] Player data before connect:", playerData);

      // Close modal
      onClose();

      // --- Connect to WebSocket and wait for it to open ---
      try {
        // CRITICAL FIX: Use uppercase room ID for backend consistency
        await socketService.connect(normalizedRoomIdForBackend, uniquePlayerId, token, playerData);
        
        // Verify connection was successful
        if (!socketService.socket || socketService.socket.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket connection failed to establish');
        }
        
        console.log('[PLAYER_REGISTRATION] WebSocket connection successful');
        
      } catch (connectionError) {
        console.error('[PLAYER_REGISTRATION] WebSocket connection failed:', connectionError);
        
        // Remove player from Redux store since connection failed
        // (This prevents showing the player in the UI when they're not actually connected)
        dispatch(removePlayer(uniquePlayerId));
        
        // Clear localStorage only for non-recoverable errors
        if (connectionError.message.includes('401') || connectionError.message.includes('403')) {
          // Clear localStorage for auth errors
          localStorage.removeItem(`kekopoly_player_${roomId}`);
          localStorage.removeItem(`kekopoly_player_name_${roomId}`);
          localStorage.removeItem(`kekopoly_player_token_${roomId}`);
          
          // Reset state for auth errors
          setCurrentPlayerId(null);
        } else if (connectionError.message.includes('409')) {
          // Handle registration conflict (409 error)
          console.log('[PLAYER_REGISTRATION] Registration conflict detected, clearing and retrying');
          
          // Clear conflicting registration
          if (socketService.handleRegistrationConflict) {
            socketService.handleRegistrationConflict(uniquePlayerId, roomId);
          }
          
          // Show user-friendly message
          toast({
            title: "Registration Conflict",
            description: "Another session was detected. Please try joining again.",
            status: "warning",
            duration: 3000,
            isClosable: true,
          });
          
          // Don't clear player ID for 409 errors - allow retry
          return;
        } else {
          // For non-auth errors, preserve player ID for retry
          console.log('[PLAYER_REGISTRATION] Preserving player ID for retry after connection error');
        }
        
        // Show specific error message
        if (connectionError.message.includes('401') || connectionError.message.includes('403')) {
          toast({
            title: "Authentication Failed",
            description: "Your session has expired. Please log in again.",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
          
          // Redirect to login for auth errors
          setTimeout(() => {
            navigate('/login');
          }, 2000);
        } else {
          toast({
            title: "Connection Failed",
            description: "Unable to connect to the game room. Please try again.",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        }
        
        throw connectionError; // Re-throw to be caught by outer try-catch
      }

      // Ensure Redux store is updated before broadcasting
      setTimeout(() => {
        // Broadcast host/player info to server and other clients
        broadcastPlayerInfo(playerData);
      }, 300);

      // Request player list after broadcasting (keep this, maybe with a slightly longer delay)
      setTimeout(() => {
         if (socketService?.socket?.readyState === WebSocket.OPEN) {
             socketService.sendMessage('get_active_players', {});
         }
      }, 500); // Small delay after broadcasting

      toast({
        title: "Joined game",
        description: "You've successfully joined the game room",
        status: "success",
        duration: 3000,
        isClosable: true,
      });

      // DO NOT set gameStarted or gamePhase here. Navigation to game board is handled ONLY by game-started event.
      // DO NOT call navigate(`/game/${roomId}`) here;
    } catch (error) {
      console.error("Error joining game or connecting WebSocket:", error);
      setConnectionStatus('error'); // Update connection status on error
      toast({
        title: "Error",
        description: `Failed to join the game: ${error.message || 'Connection failed'}`,
        status: "error",
        duration: 5000, // Longer duration for errors
        isClosable: true,
      });
    } finally {
      setIsJoining(false);
    }
  };

  // Handle player ready status
  const handleToggleReady = () => {
    if (!currentPlayerId) {
      console.error('Cannot toggle ready: No current player ID');
      return;
    }

    // Prevent multiple simultaneous toggle attempts
    if (isReadyLoading) {
      console.log('Toggle ready already in progress, skipping...');
      return;
    }

    // Set loading state
    setIsReadyLoading(true);

    // Toggle ready status
    const isCurrentlyReady = currentPlayer?.isReady || false;
    const newReadyStatus = !isCurrentlyReady;

    // Create a unique message ID for tracking this specific ready toggle
    const messageId = `ready_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // OPTIMIZATION: Update local state (Redux) immediately for responsive UI
    dispatch(setPlayerReady({
      playerId: currentPlayerId,
      isReady: newReadyStatus
    }));

    // OPTIMIZATION: Send ready status to server with high priority
    if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
      // Send with message ID for tracking
      socketService.sendMessage('player_ready', {
        playerId: currentPlayerId,
        isReady: newReadyStatus,
        messageId: messageId,
        timestamp: Date.now(),
        priority: 'high' // Hint to the server this should be high priority
      });
    } else {
      console.warn('Cannot send ready status: WebSocket not open');

      // Fallback retry mechanism if socket is not open
      setTimeout(() => {
        if (socketService?.socket?.readyState === WebSocket.OPEN) {
          socketService.sendMessage('player_ready', {
            playerId: currentPlayerId,
            isReady: newReadyStatus,
            messageId: `${messageId}_retry`,
            timestamp: Date.now(),
            priority: 'high'
          });
        }
      }, 500);
    }

    // OPTIMIZATION: Also broadcast via BroadcastChannel for local development
    // This helps with immediate feedback in development environments
    try {
      const broadcastChannel = new BroadcastChannel(`game_${roomId}`);
      broadcastChannel.postMessage({
        type: 'player_ready',
        playerId: currentPlayerId,
        isReady: newReadyStatus,
        roomId,
        messageId: messageId
      });
      broadcastChannel.close(); // Close immediately, no need for timeout
    } catch (err) {
      // Ignore broadcast channel errors, they're not critical
    }

    // Reset loading state after a reasonable timeout
    setTimeout(() => {
      setIsReadyLoading(false);
    }, 2000);
  };

  // Handle game start (host only)
  const handleStartGame = async () => {

    // Check if current player is the host
    if (!isHost) {
      toast({
        title: "Not Authorized",
        description: "Only the host can start the game",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Check if all players are ready
    const allPlayersReady = players.every((player) => player.isReady || player.id === currentPlayerId);
    if (!allPlayersReady) {
      toast({
        title: "Players Not Ready",
        description: "All players must be ready before starting the game",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Check if we have enough players
    if (players.length < 2) {
      toast({
        title: "Not Enough Players",
        description: "At least 2 players are required to start the game",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      // First, set the localStorage flag to indicate that the host has explicitly started the game
      try {
        localStorage.setItem('kekopoly_game_started', 'true');
        localStorage.setItem('kekopoly_game_id', roomId);
        localStorage.setItem('kekopoly_navigation_timestamp', Date.now().toString());
      } catch (e) {
        console.warn('[START_GAME] Could not use localStorage:', e);
      }

      // Send start game messages to server
      if (socketService?.isConnected()) {
        // Send a game:start message to server
        socketService.sendMessage('game:start', {
          gameId: roomId,
          hostId: currentPlayerId,
          timestamp: Date.now(),
          forceNavigate: false // All players wait for WebSocket message
        });

        // Send broadcast_game_started to notify all players (including host)
        socketService.sendMessage('broadcast_game_started', {
          gameId: roomId,
          hostId: currentPlayerId,
          timestamp: Date.now(),
          forceNavigate: false // All players will navigate when they receive this message
        });
      }

      // Update Redux state
      dispatch(setGameStarted(true));
      dispatch(setGamePhase('playing'));
      dispatch(syncGameStatus('ACTIVE'));

      // Host will now wait for WebSocket message like all other players
      console.log('[START_GAME] Host initiated game start, waiting for WebSocket confirmation');
      
      toast({
        title: "Game Starting",
        description: "Starting game for all players...",
        status: "info",
        duration: 3000,
        isClosable: true,
      });
    } catch (error) {
      console.error("Error starting game:", error);
      toast({
        title: "Error",
        description: "Failed to start the game",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Handle copying room code to clipboard
  const handleCopyRoomCode = () => {
    navigator.clipboard.writeText(roomId);
    toast({
      title: "Copied",
      description: "Room code copied to clipboard",
      status: "success",
      duration: 2000,
      isClosable: true,
    });
  };

  // Player list section
  // Enhanced helper function to get host name for display
  const getHostName = () => {
    // Check if game is abandoned
    if (gameState.status === 'ABANDONED') {
      // Find the player who was previously the host (likely the only player in the list)
      const disconnectedPlayer = players.find(p => p.status === 'DISCONNECTED');
      if (disconnectedPlayer) {
        return `${disconnectedPlayer.name || `Player_${disconnectedPlayer.id.substring(0, 4)}`} (Disconnected)`;
      }
    }

    // First priority: Trust the server's hostId from gameState
    if (hostId) {
      // Look for a player with this ID in the players array
      const hostPlayer = players.find(p => p.id === hostId);
      if (hostPlayer) {
        return hostPlayer.name || `Player_${hostPlayer.id.substring(0, 4)}`;
      }

      // If we still can't find the host but the current player is the host
      if (currentPlayerId === hostId) {
        // Use the current player's name from localStorage or Redux
        const currentPlayerObj = players.find(p => p.id === currentPlayerId);
        if (currentPlayerObj && currentPlayerObj.name) {
          return currentPlayerObj.name;
        }

        // Fallback to localStorage
        const playerName = localStorage.getItem(`kekopoly_player_name_${roomId}`) || 'You';
        return playerName;
      }

      // We have a hostId but no matching player - return a placeholder with the ID
      return `Host (${hostId.substring(0, 4)})`;
    }

    // Second priority: Find a player with isHost flag
    const hostByFlag = players.find(p => p.isHost);
    if (hostByFlag) {
      return hostByFlag.name || `Player_${hostByFlag.id.substring(0, 4)}`;
    }

    // Third priority: If there's only one player, assume they're the host
    if (players.length === 1) {
      return players[0].name || `Player_${players[0].id.substring(0, 4)}`;
    }

    // Last resort: Request host info from server and return placeholder
    if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
      socketService.sendMessage('get_host', { gameId: roomId });
    }

    return "Waiting for host...";
  };

  const renderPlayersList = () => {
    // console.log("Rendering player list with players:", players);

    // Use the players array directly from the selector
    let displayPlayers = [...players];

    // Filter out players with status DISCONNECTED
    displayPlayers = displayPlayers.filter(player => player.status !== 'DISCONNECTED');

    // Sort players: host first, then by name
    displayPlayers.sort((a, b) => {
      // First sort by host status
      if (a.isHost && !b.isHost) return -1;
      if (!a.isHost && b.isHost) return 1;

      // Then sort by name with null/undefined checks
      const nameA = a?.name || '';
      const nameB = b?.name || '';
      return nameA.localeCompare(nameB);
    });

    if (!displayPlayers || displayPlayers.length === 0) {
      return <Text color="gray.500">No players have joined yet</Text>;
    }

    return (
      <VStack align="stretch" spacing={2} w="100%">
        {displayPlayers.map(player => {
          // console.log("Rendering player:", player);

          // Get token data if it exists
          // Always try to get emoji and color from token first for consistency
          let emoji = '👤';
          let color = 'gray.500';

          // If token exists, try to get emoji and color from PLAYER_TOKENS
          if (player.token) {
            const tokenData = PLAYER_TOKENS.find(t => t.id === player.token);
            if (tokenData) {
              emoji = tokenData.emoji;
              color = tokenData.color;
            }
          }

          // Fallback to player's emoji and color if token data wasn't found
          if (emoji === '👤' && player.emoji) {
            emoji = player.emoji;
          }

          if (color === 'gray.500' && player.color) {
            color = player.color;
          }

          return (
            <HStack
              key={player.id}
              p={3}
              bg={player.id === currentPlayerId ? 'blue.50' : 'white'}
              borderRadius="md"
              borderWidth="1px"
              borderColor={player.id === currentPlayerId ? 'blue.200' : 'gray.200'}
              justify="space-between"
            >
              <HStack>
                <Text fontSize="lg" mr={2} color={color}>{emoji}</Text>
                <Text fontWeight={player.id === currentPlayerId ? 'bold' : 'normal'}>
                  {player.name || `Player ${player.id.substring(0, 4).replace('play', '')}`} {player.isHost && (
                    <Badge colorScheme="purple" ml={1} px={2} py={1} borderRadius="md">
                      Host
                    </Badge>
                  )}
                </Text>
              </HStack>
              <Badge colorScheme={player.isReady ? 'green' : 'gray'}>
                {/* {console.log(`Rendering badge for ${player.id}, isReady: ${player.isReady}`)} */}
                {player.isReady ? 'Ready' : 'Not Ready'}
              </Badge>
            </HStack>
          );
        })}
      </VStack>
    );
  };

  // Enhanced polling mechanism for game state changes
  useEffect(() => {
    // Setup polling only if not already on game board
    if (!window.location.pathname.includes('/game/')) {
      // console.log('[ENHANCED_POLLING] Setting up enhanced game state polling');

      // Set up polling to detect when game starts via WebSocket messages
      // This is for ALL players (including host) to detect game start confirmation
      let gameStatePollingInterval = null;

      // Only set up polling if player is registered, socket is connected, and we have a valid player ID
      if (currentPlayerId && 
          currentPlayerId !== 'null' && 
          currentPlayerId !== 'undefined' &&
          socketService && 
          socketService.isConnected() &&
          isRegistered) {
        
        console.log('[GAME_POLLING] Setting up game state polling for registered player:', currentPlayerId);

        // Wait a bit before starting polling to ensure everything is initialized
        const pollingTimeout = setTimeout(() => {
          if (socketService && socketService.isConnected()) {
            // Poll for game start detection every 2 seconds (reduced frequency)
            gameStatePollingInterval = setInterval(() => {
              // Only poll if socket is still connected and ready
              if (socketService && socketService.isConnected()) {
                try {
                  socketService.sendMessage('get_game_state', { full: true });
                  socketService.sendMessage('check_game_started', { gameId: roomId });
                } catch (error) {
                  console.warn('[GAME_POLLING] Error sending polling messages:', error);
                }
              }
            }, 2000); // Increased to 2 seconds to reduce load
          }
        }, 1000); // Wait 1 second before starting polling

        return () => {
          clearTimeout(pollingTimeout);
          if (gameStatePollingInterval) {
            clearInterval(gameStatePollingInterval);
          }
        };
      } else {
        console.log('[GAME_POLLING] Skipping polling setup - prerequisites not met:', {
          currentPlayerId: !!currentPlayerId,
          socketConnected: socketService?.isConnected(),
          isRegistered
        });
      }

      // Function to check game state and navigate if needed
      const checkGameState = () => {
        // console.log('[ENHANCED_POLLING] Checking if game has been started by server');

        // Get the most up-to-date state from Redux
        const state = store.getState();
        const gameState = state.game;
        const slicesGameState = state.slices?.game || {};

        // Comprehensive check for game started state
        const gameStarted =
          gameState.gameStarted ||
          gameState.gamePhase === 'playing' ||
          gameState.status === 'ACTIVE' ||
          slicesGameState.status === 'ACTIVE';

        // Also check localStorage as a backup mechanism
        let localStorageGameStarted = false;
        try {
          localStorageGameStarted = localStorage.getItem('kekopoly_game_started') === 'true';
          const storedGameId = localStorage.getItem('kekopoly_game_id');
          const timestamp = localStorage.getItem('kekopoly_navigation_timestamp');

          // Only consider localStorage if the timestamp is recent (within last 30 seconds)
          const isRecent = timestamp && (Date.now() - parseInt(timestamp, 10) < 30000);
          localStorageGameStarted = localStorageGameStarted && isRecent && storedGameId === roomId;
        } catch (e) {
          console.warn('[ENHANCED_POLLING] Error accessing localStorage:', e);
        }

        // console.log('[ENHANCED_POLLING] Current game state:', {
        //   gameStarted: gameState.gameStarted,
        //   gamePhase: gameState.gamePhase,
        //   status: gameState.status,
        //   slicesStatus: slicesGameState.status,
        //   localStorageGameStarted,
        //   result: gameStarted || localStorageGameStarted
        // });

        // Navigate if game has started (from any source)
        // MODIFIED: Make navigation more reliable for non-host players
        // Check if game has started based on Redux state OR localStorage
        if ((gameStarted || localStorageGameStarted) && !window.location.pathname.includes('/game/')) {
          // console.log('[ENHANCED_POLLING] Game detected as started, navigating to game board');

          // For non-host players, we need to ensure the host has explicitly started the game
          // We should NOT navigate just because all players are ready
          const shouldNavigate =
            // ONLY navigate if the localStorage flag is set (host explicitly started)
            // This is the primary indicator that the host pressed "Start Game"
            localStorage.getItem('kekopoly_game_started') === 'true' &&
            // AND ALSO verify the game state in Redux indicates the game has started
            (gameState.gameStarted === true || gameState.gamePhase === 'playing');

          if (shouldNavigate) {
            // console.log('[ENHANCED_POLLING] Navigation conditions met, proceeding to game board');

            // Ensure game state is properly set in Redux before navigation
            dispatch(setGameStarted(true));
            dispatch(setGamePhase('playing'));
            dispatch(syncGameStatus('PLAYING'));

            // Set localStorage flag to ensure consistent behavior
            try {
              localStorage.setItem('kekopoly_game_started', 'true');
              localStorage.setItem('kekopoly_game_id', roomId);
              localStorage.setItem('kekopoly_navigation_timestamp', Date.now().toString());
            } catch (e) {
              console.warn('[ENHANCED_POLLING] Error setting localStorage:', e);
            }

            // Force navigation for non-host players
            // console.log('[NON_HOST_NAVIGATION] Forcing navigation to game board');
            safeNavigateToGame(navigate, roomId, dispatch, toast);

            // Preserve socket connection for navigation
            if (socketService) {
              socketService.preserveSocketForNavigation();
            }

            return true;
          }
        }

        // Request fresh game state from server
        if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
          socketService.sendMessage('get_game_state', {});

          // Also check if game has started directly
          socketService.sendMessage('check_game_started', { gameId: roomId });
        }

        return false;
      };

      // Initial check
      const gameStarted = checkGameState();

      // Setup multiple polling intervals with different frequencies
      let fastIntervalId, slowIntervalId;

      if (!gameStarted) {
        // Fast polling for immediate response (every 1 second)
        fastIntervalId = setInterval(checkGameState, 1000);

        // Slower polling as a backup (every 5 seconds)
        slowIntervalId = setInterval(() => {
          // console.log('[ENHANCED_POLLING] Performing deep game state check');

          // Force a full game state refresh from server
          if (socketService && socketService.socket && socketService.socket.readyState === WebSocket.OPEN) {
            socketService.sendMessage('get_game_state', { full: true });

            // Also request active players to ensure we have the latest host information
            socketService.sendMessage('get_active_players', {});
          }
        }, 5000);
      }

      // Cleanup on component unmount
      return () => {
        if (fastIntervalId) clearInterval(fastIntervalId);
        if (slowIntervalId) clearInterval(slowIntervalId);
        if (gameStatePollingInterval) clearInterval(gameStatePollingInterval);
      };
    }
  }, [navigate, roomId, dispatch, isHost, currentPlayerId, toast, socketService, isRegistered]);

  // Enhanced player synchronization effect - ensures all players see each other
  useEffect(() => {
    let syncInterval;
    
    if (currentPlayerId && socketService && socketService.socket && 
        socketService.socket.readyState === WebSocket.OPEN) {
      
      // Function to perform synchronization
      const performSync = () => {
        console.log('[PLAYER_SYNC] Performing player synchronization');
        
        // 1. Request active players list
        socketService.sendMessage('get_active_players', {});
        
        // 2. Request host information
        socketService.sendMessage('get_host', { gameId: roomId });
        
        // 3. Broadcast own player information
        const currentState = store.getState();
        const playersInStore = currentState.players.players || {};
        const myPlayerData = playersInStore[currentPlayerId];
        
        if (myPlayerData) {
          broadcastPlayerInfo(myPlayerData);
        } else {
          // Create and broadcast minimal player data
          const playerName = localStorage.getItem(`kekopoly_player_name_${roomId}`) || 'Player';
          const playerToken = localStorage.getItem(`kekopoly_player_token_${roomId}`) || 'pepe';
          const tokenData = PLAYER_TOKENS.find(t => t.id === playerToken);
          
          const minimalPlayerData = {
            id: currentPlayerId,
            name: playerName,
            token: playerToken,
            emoji: tokenData ? tokenData.emoji : '👤',
            color: tokenData ? tokenData.color : 'gray.500',
            isHost: false,
            isReady: false
          };
          
          broadcastPlayerInfo(minimalPlayerData);
        }
      };

      // Perform initial sync after a short delay
      setTimeout(performSync, 1000);
      
      // Set up periodic sync (every 15 seconds) to ensure players stay in sync
      syncInterval = setInterval(performSync, 15000);
    }

    return () => {
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [currentPlayerId, socketService?.socket?.readyState, roomId, broadcastPlayerInfo]);

  return (
    <Box minH="100vh" bg="gray.100">
      <Container maxW="container.lg" py={8}>
        <VStack spacing={6} align="stretch">
          {/* Room Header */}
          <HStack justify="space-between" align="center">
            <Heading size="lg">Game Room</Heading>
            <HStack>
              {connectionStatus === 'connecting' && <Spinner size="sm" color="blue.500" />}
              <Badge
                colorScheme={
                  connectionStatus === 'connected' ? 'green' :
                  connectionStatus === 'connecting' ? 'blue' : 'red'
                }
              >
                {connectionStatus}
              </Badge>
            </HStack>
            <HStack>
              <Text fontWeight="bold">Room Code:</Text>
              <Badge colorScheme="green" fontSize="lg" py={1} px={3}>
                {roomId}
              </Badge>
              <Button size="sm" onClick={handleCopyRoomCode} leftIcon={<FaCopy />}>
                Copy
              </Button>
            </HStack>
          </HStack>

          {/* Add logging inside the render return */}
          {/* {console.log(`[Render] Rendering GameRoom. isRegistered=${isRegistered}, isHost=${isHost}`)} */}
          {/* {console.log(`[Render] Current Player ID: ${currentPlayerId}`)} */}
          {/* {console.log(`[Render] Host ID: ${hostId}`)} */}
          {/* {console.log(`[Render] Players:`, players)} */}

          {/* Error display */}
          {error && (
            <Alert status="error">
              <AlertIcon />
              <AlertTitle>Error!</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Main Join Game Button (only shown if not registered) */}
          {!isRegistered && (
            <Box textAlign="center" py={4}>
              <Button
                size="lg"
                colorScheme="blue"
                onClick={onOpen}
                width="50%"
                height="60px"
                fontSize="xl"
                leftIcon={<FaUserPlus size={24} />}
                boxShadow="md"
              >
                Join Game
              </Button>
            </Box>
          )}

          {/* Main Room Content */}
          <Flex direction={{ base: 'column', md: 'row' }} gap={6}>
            {/* Left Column - Players List */}
            <Box
              flex="1"
              bg="white"
              p={6}
              borderRadius="md"
              boxShadow="md"
            >
              <VStack align="stretch" spacing={4}>
                <Heading size="md">Players ({activePlayers.length}/{maxPlayers})</Heading>

                {/* Players List */}
                {renderPlayersList()}
              </VStack>
            </Box>

            {/* Right Column - Controls */}
            <Box
              flex="1"
              bg="white"
              p={6}
              borderRadius="md"
              boxShadow="md"
                       >
              <VStack align="stretch" spacing={5}>
                <Heading size="md">Game Setup</Heading>

                {/* Status Information */}
                <Alert
                  status={gamePhase === 'setup' ? 'info' : 'success'}
                  borderRadius="md"
                >
                  <AlertIcon />
                  <Box>
                    <AlertTitle>
                      {gamePhase === 'setup' ? 'Waiting for players' : 'Game ready to start'}
                    </AlertTitle>
                    <AlertDescription>
                      {gamePhase === 'setup' ? 'Join the game and get ready!' : 'All players are ready!'}
                    </AlertDescription>
                  </Box>
                </Alert>

                {/* Ready Button */}
                {isRegistered && (
                  <Button
                    colorScheme={currentPlayer?.isReady ? "red" : "green"}
                    size="lg"
                    onClick={handleToggleReady}
                    leftIcon={currentPlayer?.isReady ? <FaUserEdit /> : <FaUserCheck />}
                    isLoading={isReadyLoading}
                    loadingText={currentPlayer?.isReady ? "Canceling..." : "Getting ready..."}
                  >
                    {currentPlayer?.isReady ? "Cancel Ready" : "Ready Up"}
                  </Button>
                )}

                {/* Start Game Button - Only for host */}
                {isHost && (
                  <VStack spacing={2} align="stretch">
                    <Button
                      colorScheme="green"
                      size="lg"
                      isDisabled={!allPlayersReady || players.length < 2}
                      onClick={handleStartGame}
                      isLoading={loading}
                      leftIcon={<FaPlay />}
                      mt={4}
                      width="full"
                    >
                      {allPlayersReady && players.length >= 2 ? "Start Game" : "Waiting for players to ready up"}
                    </Button>
                    <Badge colorScheme="purple" p={2} textAlign="center">
                      You are the host of this game
                    </Badge>
                  </VStack>
                )}

                {/* Non-host waiting message */}
                {!isHost && isRegistered && (
                  <VStack spacing={2} align="stretch">
                    <Text color="gray.500" mt={4} textAlign="center">
                      Waiting for host to start the game...
                    </Text>
                    <Text fontSize="sm" color="gray.400" textAlign="center">
                      Only the host ({getHostName()}) can start the game
                    </Text>
                  </VStack>
                )}

                <Divider />

                {/* Game Information */}
                <Box>
                  <Text fontWeight="bold" mb={2}>Game Information:</Text>
                  <VStack align="start" spacing={1}>
                    <Text>• Minimum Players: 2</Text>
                    <Text>• Maximum Players: {maxPlayers}</Text>
                    <Text>• All players must ready up before the game can start</Text>
                    <Text>• Only the host can start the game</Text>
                  </VStack>
                </Box>

                {/* Leave Game Button */}
                <Button
                  variant="outline"
                  colorScheme="red"
                  mt={4}
                  onClick={() => navigate("/")}
                >
                  Leave Room
                </Button>

                {/* Reset Game Button - Only show for abandoned games */}
                {gameState.status === 'ABANDONED' && (
                  <ResetGameButton />
                )}
              </VStack>
            </Box>
          </Flex>
        </VStack>
      </Container>

      {/* Join Game Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Join Game</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={6} align="stretch">
              <FormControl isRequired>
                <FormLabel>Player Name</FormLabel>
                <Input
                  placeholder="Enter your name"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                />
              </FormControl>

              <FormControl isRequired>
                <FormLabel>Choose a Token</FormLabel>
                <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
                  {PLAYER_TOKENS.map((token) => {
                    const isSelected = selectedToken === token.id;
                    const isUnavailable = players.some(p => p.token === token.id);

                    return (
                      <Button
                        key={token.id}
                        height="80px"
                        onClick={() => !isUnavailable && setSelectedToken(token.id)}
                        colorScheme={isSelected ? "blue" : "gray"}
                        variant={isSelected ? "solid" : "outline"}
                        isDisabled={isUnavailable}
                        opacity={isUnavailable ? 0.6 : 1}
                        _disabled={{ cursor: "not-allowed" }}
                      >
                        <VStack>
                          <Text fontSize="2xl">{token.emoji}</Text>
                          <Text fontSize="xs">{token.name}</Text>
                          {isUnavailable && (
                            <Badge colorScheme="red" fontSize="9px">
                              Taken
                            </Badge>
                          )}
                        </VStack>
                      </Button>
                    );
                  })}
                </SimpleGrid>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={handleRegisterPlayer}
              isLoading={isJoining}
              loadingText="Joining..."
              isDisabled={!playerName || !selectedToken || isJoining}
            >
              Join Game
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

export default GameRoom;