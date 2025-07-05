import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Input,
  Flex,
  SimpleGrid,
  Badge,
  Divider,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  FormControl,
  FormLabel,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Select,
  useDisclosure,
  useToast,
  Spinner,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Avatar,
  Tooltip,
} from '@chakra-ui/react';
import { FaPlay, FaPlusCircle, FaDice, FaUsers, FaChevronDown, FaSync, FaTrash } from 'react-icons/fa';
import { useDispatch, useSelector } from 'react-redux';
import { setRoomCode } from '../../store/gameSlice';
import socketService from '../../services/socket';
import { apiGet, apiPost } from '../../utils/apiUtils';
import sessionMonitor from '../../utils/sessionMonitor';
import { clearGameStorageData } from '../../utils/storageUtils';

// Add function to prompt for password
const useCleanupPrompt = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();

  const onOpen = () => {
    setIsOpen(true);
    setPassword('');
  };

  const onClose = () => {
    setIsOpen(false);
    setPassword('');
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
  };

  const validatePassword = (callback) => {
    setIsSubmitting(true);

    // Simple validation - in a real app this would be a secure check
    if (password === 'kekadmin123') {
      onClose();
      callback();
    } else {
      toast({
        title: 'Invalid Password',
        description: 'The admin password is incorrect',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }

    setIsSubmitting(false);
  };

  return {
    isOpen,
    onOpen,
    onClose,
    password,
    handlePasswordChange,
    validatePassword,
    isSubmitting
  };
};

const GameLobby = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Get auth state from Redux
  const { token, user } = useSelector((state) => state.auth);

  // Clear any lingering game state when lobby loads
  useEffect(() => {
    try {
      // Check if user manually navigated to lobby (not from a redirect)
      const fromGamePage = document.referrer.includes('/game/') || 
                           window.history.state?.from?.includes('/game/');
      
      if (!fromGamePage) {
        // User manually navigated to lobby, clear any game state
        const gameStarted = localStorage.getItem('kekopoly_game_started');
        const gameId = localStorage.getItem('kekopoly_game_id');
        
        if (gameStarted === 'true' && gameId) {
          console.log('[LOBBY] User navigated to lobby with active game state, clearing...');
          clearGameStorageData();
          
          // Clear Redux game state as well
          dispatch({ type: 'game/setGameStarted', payload: false });
          dispatch({ type: 'game/setGamePhase', payload: '' });
          dispatch({ type: 'game/syncGameStatus', payload: '' });
        }
      }
    } catch (e) {
      console.warn('[LOBBY] Error clearing game state:', e);
    }
  }, []); // Run only once when component mounts

  // State
  const [roomCode, setLocalRoomCode] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [availableGames, setAvailableGames] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Add this at the end of the GameLobby component, just before return statement
  // Add admin password prompt
  const {
    isOpen: isPasswordPromptOpen,
    onOpen: openPasswordPrompt,
    onClose: closePasswordPrompt,
    password,
    handlePasswordChange,
    validatePassword,
    isSubmitting: isValidatingPassword
  } = useCleanupPrompt();

  // Process the games data to remove duplicates
  const deduplicateGames = (games) => {
    if (!Array.isArray(games)) return [];

    // Use a Map with gameId as the key to ensure uniqueness
    const uniqueGames = new Map();

    games.forEach(game => {
      // Only add if this gameId hasn't been seen yet or if this version is newer
      if (!uniqueGames.has(game.id) || game.updatedAt > uniqueGames.get(game.id).updatedAt) {
        uniqueGames.set(game.id, game);
      }
    });

    // Convert the Map back to an array
    return Array.from(uniqueGames.values());
  }

  // Load available games effect
  useEffect(() => {
    // Log token for debugging
    // console.log('Token value in GameLobby:', token ? token.substring(0, 20) + '...' : 'null');
    // console.log('Is authenticated:', !!token);
    // console.log('GameLobby component mounted at:', new Date().toISOString());

    // Check if we have a valid token
    if (!token) {
      console.warn('No authentication token available. Please connect your wallet first.');
      setIsLoading(false);
      setAvailableGames([]);
      return;
    }

    // Connect to the lobby socket for real-time game updates
    if (user && user.id) {
      // console.log(`Connecting to lobby socket for user ${user.id} at ${new Date().toISOString()}`);
      socketService.connectToLobby(token, user.id);

      // Register callback for new game events
      socketService.onNewGame((newGame) => {
        // console.log(`New game event received in GameLobby at ${new Date().toISOString()}:`, newGame);
        // console.log('Current games before update:', availableGames.map(g => g.id));

        // Update the available games list with the new game
        setAvailableGames(prevGames => {
          // Check if this game already exists in our list
          const exists = prevGames.some(game => game.id === newGame.id);

          if (exists) {
            // console.log(`Game ${newGame.id} already exists, updating`);
            // Replace the existing game with the updated one
            return prevGames.map(game =>
              game.id === newGame.id ? newGame : game
            );
          } else {
            // console.log(`Game ${newGame.id} is new, adding to list`);
            // Add the new game to the list
            return [...prevGames, newGame];
          }
        });

        // Show a notification for new games
        toast({
          title: "New Game Available",
          description: `"${newGame.name}" has been created`,
          status: "info",
          duration: 3000,
          isClosable: true,
        });
      });
    }

    // Make fetchGames available globally for debugging and WebSocket callbacks
    window.refreshGameList = refreshGameList;

    // Fetch available games from the API using our utility function
    const fetchGames = async () => {
      // console.log(`Fetching games from API at ${new Date().toISOString()}`);
      setIsLoading(true);
      try {
        // Use our apiGet utility which handles authentication automatically
        const data = await apiGet('/api/v1/games');
        // console.log(`API returned ${data.games ? data.games.length : 0} games`);

        // Deduplicate the games before setting state
        const dedupedGames = deduplicateGames(data.games || []);
        // console.log(`After deduplication: ${dedupedGames.length} games`);
        setAvailableGames(dedupedGames);
      } catch (error) {
        console.error('Error fetching games:', error);
        toast({
          title: 'Error',
          description: error.message === 'Authentication required'
            ? 'Authentication required. Please reconnect your wallet.'
            : 'Failed to fetch available games',
          status: 'error',
          duration: 3000,
          isClosable: true,
        });

        // Start with an empty array
        setAvailableGames([]);
      } finally {
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchGames();

    // Set up periodic refresh (every 30 seconds)
    // This helps ensure rooms appear for friends even if WebSocket messages are missed
    const refreshInterval = setInterval(() => {
      // console.log(`Auto-refreshing game list at ${new Date().toISOString()}`);
      fetchGames();
    }, 30000);

    // Set up WebSocket connection monitoring
    const wsMonitorInterval = setInterval(() => {
      // Check if WebSocket is connected
      if (socketService.lobbySocket) {
        const state = socketService.getLobbySocketStateString();
        // console.log(`WebSocket connection state: ${state}`);

        // If the connection is closed or closing, attempt to reconnect
        if (state === "CLOSED" || state === "CLOSING") {
          // console.log("WebSocket connection lost, attempting to reconnect...");
          socketService.connectToLobby(token, user.id);
        }
      }
    }, 10000);

    // Cleanup function to disconnect from the lobby socket and clear intervals
    return () => {
      if (socketService) {
        // console.log(`Disconnecting from lobby socket at ${new Date().toISOString()}`);
        socketService.disconnectFromLobby();
      }
      clearInterval(refreshInterval);
      clearInterval(wsMonitorInterval);
      delete window.refreshGameList;
    };
  }, [toast, token, user]);

  // Handle game creation
  const handleCreateGame = async () => {
    if (!newGameName.trim()) {
      toast({
        title: 'Game name required',
        description: 'Please enter a game name',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Check if we have a valid token
    if (!token) {
      toast({
        title: 'Authentication Required',
        description: 'Please connect your wallet first',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsCreatingGame(true);

    try {
      // Pause session monitoring during game creation to prevent interference
      sessionMonitor.pauseFor(10000); // Pause for 10 seconds
      
      // Use our apiPost utility which handles authentication automatically
      const data = await apiPost('/api/v1/games', {
        gameName: newGameName,
        maxPlayers: maxPlayers
      });

      // Log response for debugging
      console.log('Create game response:', data);
      
      // Extract game info from response
      const gameId = data.gameId;
      const roomCode = data.code;

      if (!gameId) {
        throw new Error('No game ID returned from server');
      }

      // Set room code in Redux (use the actual room code, not the game ID)
      dispatch(setRoomCode(roomCode || gameId));

      // Show success message with room code
      toast({
        title: 'Game created',
        description: `Your game "${newGameName}" has been created! Room code: ${roomCode || gameId}`,
        status: 'success',
        duration: 5000,
        isClosable: true,
      });

      // Close modal and navigate to the game room using the room code (not game ID)
      onClose();
      navigate(`/room/${roomCode || gameId}`);
    } catch (error) {
      console.error('Error creating game:', error);
      toast({
        title: 'Error',
        description: 'Failed to create game. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsCreatingGame(false);
    }
  };

  // Handle joining a game by room code
  const handleJoinByCode = async () => {
    if (!roomCode.trim()) {
      toast({
        title: 'Room code required',
        description: 'Please enter a room code',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    // Check if we have a valid token
    if (!token) {
      toast({
        title: 'Authentication Required',
        description: 'Please connect your wallet first',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      // Pause session monitoring during game join to prevent interference
      sessionMonitor.pauseFor(10000); // Pause for 10 seconds
      
      // Use our apiGet utility which handles authentication automatically
      const gameData = await apiGet(`/api/v1/games/${roomCode}`);

      // Log response for debugging
      // console.log('Join by code response:', gameData);

      // Set room code in Redux
      dispatch(setRoomCode(roomCode.toUpperCase()));

      // Navigate to the game room
      navigate(`/room/${roomCode.toUpperCase()}`);
    } catch (error) {
      console.error('Error joining game:', error);
      toast({
        title: 'Error',
        description: 'Invalid room code or game not found',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Handle resetting an abandoned game
  const handleResetGame = async (gameId) => {
    // Check if we have a valid token
    if (!token) {
      toast({
        title: 'Authentication Required',
        description: 'Please connect your wallet first',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      // Use our apiPost utility which handles authentication automatically
      const resetResponse = await apiPost(`/api/v1/games/${gameId}/reset`, {});

      // Log response for debugging
      // console.log('Reset game response:', resetResponse);

      toast({
        title: 'Game Reset',
        description: 'Game has been reset to LOBBY status. You can now join it.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });

      // Refresh the game list
      refreshGameList();
    } catch (error) {
      console.error('Error resetting game:', error);
      toast({
        title: 'Error',
        description: 'Failed to reset game. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    }
  };

  // Handle joining an available game
  const handleJoinGame = async (gameId) => {
    // Check if we have a valid token
    if (!token) {
      toast({
        title: 'Authentication Required',
        description: 'Please connect your wallet first',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    try {
      // First, get the game details to obtain the room code
      const gameDetails = await apiGet(`/api/v1/games/${gameId}`);
      
      // Use our apiPost utility which handles authentication automatically
      const joinResponse = await apiPost(`/api/v1/games/${gameId}/join`, {
        walletAddress: user?.walletAddress
      });

      // Log response for debugging
      console.log('Join game response:', joinResponse);
      console.log('Game details:', gameDetails);

      // Use the room code (short code) instead of the game ID for navigation
      // This ensures consistency with the host who uses the room code
      const roomCode = gameDetails.code || gameId;
      
      // Set room code in Redux
      dispatch(setRoomCode(roomCode));

      // Navigate to the game room using the room code (not the game ID)
      navigate(`/room/${roomCode}`);
    } catch (error) {
      console.error('Error joining game:', error);
      
      // Handle specific error cases
      let errorMessage = 'Failed to join game. Please try again.';
      let shouldShowGenericError = true;
      
      // Check if the game/room doesn't exist (404 or specific error messages)
      if (error.response?.status === 404 || 
          error.message?.includes('Game not found') ||
          error.message?.includes('not found') ||
          error.message?.includes('404')) {
        
        errorMessage = `Game "${gameId}" not found. It may have been deleted or ended.`;
        shouldShowGenericError = false;
        
        toast({
          title: 'Game Not Found',
          description: errorMessage,
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        
        // Refresh the game list to remove any stale entries
        refreshGameList();
        return;
      }
      
      // If getting game details failed, fall back to using gameId directly
      if (error.message && error.message.includes('Failed to get game details')) {
        console.warn('Falling back to gameId for navigation due to API error');
        try {
          const joinResponse = await apiPost(`/api/v1/games/${gameId}/join`, {
            walletAddress: user?.walletAddress
          });
          
          dispatch(setRoomCode(gameId));
          navigate(`/room/${gameId}`);
          return;
        } catch (fallbackError) {
          console.error('Fallback join also failed:', fallbackError);
          
          // Check if fallback also indicates room doesn't exist
          if (fallbackError.response?.status === 404) {
            errorMessage = `Game "${gameId}" not found. It may have been deleted or ended.`;
            shouldShowGenericError = false;
            
            toast({
              title: 'Game Not Found',
              description: errorMessage,
              status: 'error',
              duration: 5000,
              isClosable: true,
            });
            
            // Refresh the game list
            refreshGameList();
            return;
          }
        }
      }
      
      // Show generic error only if no specific error was handled
      if (shouldShowGenericError) {
        toast({
          title: 'Error',
          description: errorMessage,
          status: 'error',
          duration: 3000,
          isClosable: true,
        });
      }
    }
  };

  const truncateAddress = (address) => {
    if (!address) return '';
    return address.slice(0, 6) + '...' + address.slice(-4);
  };

  const refreshGameList = async () => {
    // console.log(`Manual refresh triggered at ${new Date().toISOString()}`);
    setLoading(true);
    setError(null);

    try {
      // Use our apiGet utility which handles authentication automatically
      const data = await apiGet('/api/v1/games');
      // console.log(`Refresh returned ${data.games ? data.games.length : 0} games`);

      const dedupedGames = deduplicateGames(data.games || []);
      // console.log(`After deduplication: ${dedupedGames.length} games`);

      // Compare with current games to see what's new
      const currentGameIds = new Set(availableGames.map(game => game.id));
      const newGames = dedupedGames.filter(game => !currentGameIds.has(game.id));

      if (newGames.length > 0) {
        // console.log(`Found ${newGames.length} new games during refresh:`, newGames.map(g => g.id));
      } else {
        // console.log('No new games found during refresh');
      }

      // Check for updated games (same ID but different player count)
      const updatedGames = dedupedGames.filter(newGame => {
        const existingGame = availableGames.find(g => g.id === newGame.id);
        return existingGame && (
          existingGame.players !== newGame.players ||
          existingGame.status !== newGame.status
        );
      });

      if (updatedGames.length > 0) {
        // console.log(`Found ${updatedGames.length} updated games during refresh`);
      }

      setAvailableGames(dedupedGames);

      // Only show toast if there are actual changes
      if (newGames.length > 0 || updatedGames.length > 0) {
        toast({
          title: "Game list updated",
          description: `Found ${newGames.length} new and ${updatedGames.length} updated games`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      } else {
        // console.log("Game list refreshed - no changes detected");
      }

      // Check WebSocket connection status
      if (socketService.lobbySocket) {
        const wsState = socketService.getLobbySocketStateString();
        // console.log(`WebSocket connection state after refresh: ${wsState}`);

        // If WebSocket is not connected, try to reconnect
        if (wsState !== "OPEN") {
          // console.log("WebSocket not connected, attempting to reconnect...");
          socketService.connectToLobby(token, user.id);
        }
      }
    } catch (error) {
      console.error('Error refreshing games:', error);
      setError('Failed to refresh games. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Add a function to clean up stale games
  const cleanupGames = async () => {
    setLoading(true);

    try {
      // Use our apiPost utility which handles authentication automatically
      const data = await apiPost('/api/v1/games/cleanup', {});
      // console.log('Cleanup response:', data);

      toast({
        title: 'Games cleaned up',
        description: `Removed ${data.gamesRemoved} stale games`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });

      // Refresh the game list
      refreshGameList();
    } catch (error) {
      console.error('Error cleaning up games:', error);
      toast({
        title: 'Error',
        description: 'Failed to clean up games',
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box minH="100vh" bg="gray.100">
      <Container maxW="container.xl" py={8}>
        <VStack spacing={8} align="stretch">
          {/* Header with Wallet Info */}
          <Flex justify="space-between" align="center">
            <Box>
              <Heading size="xl" mb={2}>Kekopoly Game Lobby</Heading>
              <Text fontSize="lg" color="gray.600">Create a new game or join an existing one</Text>
            </Box>

            <Menu>
              <MenuButton
                as={Button}
                rightIcon={<FaChevronDown />}
                colorScheme="purple"
              >
                {truncateAddress(user?.walletAddress)}
              </MenuButton>
              <MenuList>
                <MenuItem onClick={() => {
                  // Dispatch logout action
                  dispatch({ type: 'auth/logout' });
                  // Navigate to login page
                  navigate('/login');
                }}>
                  Log Out
                </MenuItem>
              </MenuList>
            </Menu>
          </Flex>

          {/* Actions */}
          <Flex
            direction={{ base: 'column', md: 'row' }}
            gap={6}
            justify="center"
            align="stretch"
          >
            {/* Create Game */}
            <Box
              flex="1"
              bg="white"
              p={6}
              borderRadius="lg"
              boxShadow="md"
              textAlign="center"
            >
              <VStack spacing={4}>
                <Heading size="md">Create New Game</Heading>
                <Text>Host your own Kekopoly game and invite friends to join</Text>
                <Button
                  size="lg"
                  colorScheme="green"
                  width="full"
                  leftIcon={<FaPlusCircle />}
                  onClick={onOpen}
                >
                  Create Game
                </Button>
              </VStack>
            </Box>

            {/* Join by Code */}
            <Box
              flex="1"
              bg="white"
              p={6}
              borderRadius="lg"
              boxShadow="md"
              textAlign="center"
            >
              <VStack spacing={4}>
                <Heading size="md">Join With Code</Heading>
                <Text>Enter a room code to join an existing game</Text>
                <HStack width="full">
                  <Input
                    placeholder="Enter Room Code"
                    value={roomCode}
                    onChange={(e) => setLocalRoomCode(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                  />
                  <Button
                    colorScheme="blue"
                    onClick={handleJoinByCode}
                    isDisabled={!roomCode}
                  >
                    Join
                  </Button>
                </HStack>
              </VStack>
            </Box>
          </Flex>

          {/* Available Games */}
          <Flex justifyContent="space-between" alignItems="center" mb={4}>
            <Heading size="md">Available Games</Heading>
            <HStack spacing={2}>
              <Button
                size="sm"
                colorScheme="red"
                leftIcon={<FaTrash />}
                onClick={openPasswordPrompt}
                isLoading={loading}
              >
                Clean Up
              </Button>
              <Button
                size="sm"
                leftIcon={<FaSync />}
                onClick={refreshGameList}
                isLoading={loading}
              >
                Refresh
              </Button>
            </HStack>
          </Flex>

          <Box bg="white" p={6} borderRadius="lg" boxShadow="md">
            {isLoading ? (
              <Flex justify="center" align="center" py={10}>
                <Spinner size="xl" color="blue.500" />
              </Flex>
            ) : (
              availableGames.length === 0 ? (
                <Flex direction="column" align="center" justify="center" py={10} textAlign="center">
                  <Text fontSize="lg" color="gray.500" mb={3}>No games available</Text>
                  <Text fontSize="md" color="gray.400">Create a new game to get started!</Text>
                </Flex>
              ) : (
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  {availableGames.map((game) => (
                    <Box
                      key={game.id}
                      p={4}
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor="gray.200"
                      _hover={{ boxShadow: "md", borderColor: "blue.200" }}
                      transition="all 0.2s"
                    >
                      <VStack align="stretch" spacing={3}>
                        <HStack justify="space-between">
                          <Heading size="sm">{game.name}</Heading>
                          <Badge colorScheme={game.status === 'ABANDONED' ? 'red' : 'green'}>
                            {game.status === 'ABANDONED' ? 'Abandoned' :
                             game.status === 'LOBBY' ? 'Waiting' : 'Playing'}
                          </Badge>
                        </HStack>

                        <HStack>
                          <HStack fontSize="sm">
                            <FaUsers />
                            <Text>{game.players}/{game.maxPlayers} Players</Text>
                          </HStack>
                        </HStack>

                        {game.status === 'ABANDONED' ? (
                          <Button
                            colorScheme="red"
                            size="sm"
                            rightIcon={<FaSync />}
                            onClick={() => handleResetGame(game.id)}
                          >
                            Reset Game
                          </Button>
                        ) : (
                          <Button
                            colorScheme="blue"
                            size="sm"
                            rightIcon={<FaPlay />}
                            onClick={() => handleJoinGame(game.id)}
                            isDisabled={game.players >= game.maxPlayers}
                          >
                            {game.players >= game.maxPlayers ? 'Full' : 'Join Game'}
                          </Button>
                        )}
                      </VStack>
                    </Box>
                  ))}
                </SimpleGrid>
              )
            )}
          </Box>
        </VStack>
      </Container>

      {/* Create Game Modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create New Game</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel>Game Name</FormLabel>
                <Input
                  placeholder="Enter a name for your game"
                  value={newGameName}
                  onChange={(e) => setNewGameName(e.target.value)}
                />
              </FormControl>

              <FormControl>
                <FormLabel>Maximum Players</FormLabel>
                <NumberInput
                  min={2}
                  max={6}
                  value={maxPlayers}
                  onChange={(valueString) => setMaxPlayers(parseInt(valueString))}
                >
                  <NumberInputField />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
              </FormControl>

              <FormControl>
                <FormLabel>Game Mode</FormLabel>
                <Select defaultValue="standard">
                  <option value="standard">Standard (Buy & Trade)</option>
                  <option value="quick">Quick Play (60 min)</option>
                  <option value="tothemoon">To The Moon (High Risk)</option>
                </Select>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="green"
              mr={3}
              onClick={handleCreateGame}
              isDisabled={!newGameName.trim()}
              isLoading={isCreatingGame}
              loadingText="Creating..."
            >
              Create Game
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Admin Password Modal */}
      <Modal isOpen={isPasswordPromptOpen} onClose={closePasswordPrompt}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Admin Authentication Required</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text mb={4}>Please enter the admin password to clean up stale games:</Text>
            <Input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={handlePasswordChange}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={() => validatePassword(cleanupGames)}
              isLoading={isValidatingPassword}
            >
              Submit
            </Button>
            <Button variant="ghost" onClick={closePasswordPrompt}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default GameLobby;