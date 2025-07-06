package manager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/game/models"
	"github.com/kekopoly/backend/internal/game/utils"
)

// Storage interface for game persistence
type Storage interface {
	RemoveGames(ids []string) error
}

// GameManager is responsible for managing game sessions
type GameManager struct {
	ctx              context.Context
	mongoClient      *mongo.Client
	redisClient      *redis.Client
	logger           *zap.SugaredLogger
	activeGames      map[string]*GameSession
	activeGamesMutex sync.RWMutex
	dbName           string
	mutex            sync.RWMutex
	games            map[string]*models.Game
	storage          Storage
	wsHub            WebSocketHub
	messageQueue     MessageQueue
}

// WebSocketHub defines the interface for broadcasting messages to clients
type WebSocketHub interface {
	BroadcastToGame(gameID string, message []byte)
	BroadcastToLobby(message []byte)
}

// MessageQueue defines the interface for the message queue
type MessageQueue interface {
	EnqueuePlayerTokenUpdate(gameID, playerID string, tokenData map[string]interface{}) error
	EnqueueGameStateUpdate(gameID string, gameState map[string]interface{}) error
	EnqueueGameStart(gameID string, hostID string, data map[string]interface{}) error
}

// GameSession represents an active game session
type GameSession struct {
	Game              *models.Game
	ConnectedPlayers  map[string]string // playerID -> sessionID
	PlayerConnections map[string]PlayerConnection
	mutex             sync.RWMutex
}

// PlayerConnection holds a player's connection information
type PlayerConnection struct {
	PlayerID       string
	SessionID      string
	IsConnected    bool
	DisconnectedAt *time.Time
}

// NewGameManager creates a new game manager instance
func NewGameManager(ctx context.Context, mongoClient *mongo.Client, redisClient *redis.Client, logger *zap.SugaredLogger, wsHub WebSocketHub, messageQueue MessageQueue) *GameManager {
	manager := &GameManager{
		ctx:          ctx,
		mongoClient:  mongoClient,
		redisClient:  redisClient,
		logger:       logger,
		activeGames:  make(map[string]*GameSession),
		dbName:       "kekopoly", // This would come from config in a real implementation
		games:        make(map[string]*models.Game),
		wsHub:        wsHub,
		messageQueue: messageQueue,
	}

	// First cleanup lobby games immediately on server start (synchronously)
	// and then load active games to ensure we don't load any lobby games
	manager.cleanupLobbyGamesAndLoadActive()

	// Begin background cleanup task
	go manager.runCleanupTask()

	return manager
}

// SetWebSocketHub sets the WebSocket hub for the game manager
func (gm *GameManager) SetWebSocketHub(hub WebSocketHub) {
	gm.wsHub = hub
	gm.logger.Info("WebSocket hub set for game manager")
}

// SetMessageQueue sets the message queue for the game manager
func (gm *GameManager) SetMessageQueue(queue MessageQueue) {
	gm.messageQueue = queue
	gm.logger.Info("Message queue set for game manager")
}

// cleanupLobbyGamesAndLoadActive ensures lobby games are cleaned up before loading active games
func (gm *GameManager) cleanupLobbyGamesAndLoadActive() {
	gm.logger.Info("Cleaning up lobby games and loading active games")

	// First clean up lobby games
	gm.cleanupLobbyGamesOnRestart()

	// Then load active games after cleanup is complete
	gm.loadActiveGamesFromDB()
}

// cleanupLobbyGamesOnRestart marks all games in LOBBY status as COMPLETED
// This ensures that no lobby games are preserved across server restarts
func (gm *GameManager) cleanupLobbyGamesOnRestart() {
	gm.logger.Info("Cleaning up lobby games on server restart")

	// Check if the MongoDB client is available
	if gm.mongoClient == nil {
		gm.logger.Warn("MongoDB client is nil, skipping cleanup of lobby games.")
		return
	}

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")

	// Find all games in LOBBY state
	lobbyFilter := bson.M{
		"status": models.GameStatusLobby,
	}

	// Update them to COMPLETED
	update := bson.M{
		"$set": bson.M{
			"status":    models.GameStatusCompleted,
			"updatedAt": time.Now(),
		},
	}

	result, err := collection.UpdateMany(gm.ctx, lobbyFilter, update)
	if err != nil {
		gm.logger.Errorf("Failed to clean up lobby games on restart: %v", err)
	} else {
		gm.logger.Infof("Cleaned up %d lobby games on server restart", result.ModifiedCount)
	}
}

// loadActiveGamesFromDB loads active games from the database into memory
func (gm *GameManager) loadActiveGamesFromDB() {
	gm.logger.Info("Loading active games from database")

	// Check if the MongoDB client is available
	if gm.mongoClient == nil {
		gm.logger.Warn("MongoDB client is nil, skipping loading active games from DB.")
		return
	}

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	filter := bson.M{
		"status": bson.M{
			"$in": []models.GameStatus{
				// Only include ACTIVE and PAUSED games, never LOBBY games
				models.GameStatusActive,
				models.GameStatusPaused,
			},
		},
	}

	cursor, err := collection.Find(gm.ctx, filter)
	if err != nil {
		gm.logger.Errorf("Failed to query active games: %v", err)
		return
	}
	defer cursor.Close(gm.ctx)

	var games []models.Game
	if err := cursor.All(gm.ctx, &games); err != nil {
		gm.logger.Errorf("Failed to decode games: %v", err)
		return
	}

	for _, game := range games {
		gameSession := &GameSession{
			Game:              &game,
			ConnectedPlayers:  make(map[string]string),
			PlayerConnections: make(map[string]PlayerConnection),
		}

		gm.activeGamesMutex.Lock()
		gm.activeGames[game.ID.Hex()] = gameSession
		gm.activeGamesMutex.Unlock()

		gm.logger.Infof("Loaded game %s with status %s", game.ID.Hex(), game.Status)
	}

	gm.logger.Infof("Loaded %d active games", len(games))
}

// runCleanupTask periodically cleans up expired game sessions
func (gm *GameManager) runCleanupTask() {
	ticker := time.NewTicker(3 * time.Minute) // Run every 3 minutes instead of 15
	defer ticker.Stop()

	for {
		select {
		case <-gm.ctx.Done():
			return
		case <-ticker.C:
			gm.cleanupExpiredSessions()
			// Also clean up stale games
			if _, err := gm.CleanupStaleGames(); err != nil {
				gm.logger.Errorf("Error cleaning up stale games: %v", err)
			}
		}
	}
}

// cleanupExpiredSessions removes expired game sessions
func (gm *GameManager) cleanupExpiredSessions() {
	gm.logger.Info("Running cleanup of expired game sessions")

	// Threshold for inactive games (24 hours)
	inactivityThreshold := time.Now().Add(-24 * time.Hour)

	gm.activeGamesMutex.Lock()
	defer gm.activeGamesMutex.Unlock()

	for gameID, session := range gm.activeGames {
		session.mutex.RLock()
		lastActivity := session.Game.LastActivity
		status := session.Game.Status
		session.mutex.RUnlock()

		// If game is in LOBBY or PAUSED status and has been inactive for 24+ hours
		if (status == models.GameStatusLobby || status == models.GameStatusPaused) &&
			lastActivity.Before(inactivityThreshold) {
			gm.logger.Infof("Removing expired game session: %s", gameID)

			// Update game status in database to COMPLETED
			collection := gm.mongoClient.Database(gm.dbName).Collection("games")
			_, err := collection.UpdateOne(
				gm.ctx,
				bson.M{"_id": session.Game.ID},
				bson.M{"$set": bson.M{
					"status":    models.GameStatusCompleted,
					"updatedAt": time.Now(),
				}},
			)

			if err != nil {
				gm.logger.Errorf("Failed to update expired game status: %v", err)
			}

			// Remove from active games
			delete(gm.activeGames, gameID)
		}
	}
}

// CreateGame creates a new game
func (gm *GameManager) CreateGame(hostPlayerID, gameName string, maxPlayers int) (string, error) {
	gameID := primitive.NewObjectID()
	now := time.Now()

	// Generate a unique room code
	roomCode, err := utils.GenerateRoomCode()
	if err != nil {
		return "", fmt.Errorf("failed to generate room code: %w", err)
	}

	// Ensure the code is unique by checking the database
	for {
		collection := gm.mongoClient.Database(gm.dbName).Collection("games")
		count, err := collection.CountDocuments(gm.ctx, bson.M{"code": roomCode})
		if err != nil {
			return "", fmt.Errorf("failed to check room code uniqueness: %w", err)
		}

		if count == 0 {
			// Code is unique, we can use it
			break
		}

		// Generate a new code and try again
		roomCode, err = utils.GenerateRoomCode()
		if err != nil {
			return "", fmt.Errorf("failed to generate room code: %w", err)
		}
	}

	// If no game name is provided, use a default name with the room code
	if gameName == "" {
		gameName = "Game " + roomCode
	}

	// Ensure maxPlayers is within a reasonable range (e.g., 2-6)
	if maxPlayers < 2 {
		maxPlayers = 2
	} else if maxPlayers > 6 {
		maxPlayers = 6
	}

	game := &models.Game{
		ID:         gameID,
		Code:       roomCode, // Set the room code
		Name:       gameName,
		Status:     models.GameStatusLobby,
		CreatedAt:  now,
		UpdatedAt:  now,
		Players:    []models.Player{},
		HostID:     hostPlayerID, // Explicitly set the host ID
		MaxPlayers: maxPlayers,   // Set the maximum players
		BoardState: models.BoardState{
			Properties: []models.Property{},
			CardsRemaining: models.CardCount{
				Meme:    16,
				Redpill: 16,
				Eegi:    16,
			},
		},
		LastActivity:     now,
		MarketCondition:  models.MarketConditionNormal,
		SettlementStatus: models.SettlementStatusPending,
	}

	// Create host player
	hostPlayer := models.Player{
		ID:             hostPlayerID,
		Status:         models.PlayerStatusActive,
		Balance:        1500, // Initial balance, should come from config
		Position:       0,    // Start position
		Cards:          []models.Card{},
		Properties:     []string{},
		InitialDeposit: 0,    // No deposit yet
		NetWorth:       1500, // Same as initial balance
	}

	game.Players = append(game.Players, hostPlayer)
	game.TurnOrder = []string{hostPlayerID}

	// Store in MongoDB
	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	_, err = collection.InsertOne(gm.ctx, game)
	if err != nil {
		return "", fmt.Errorf("failed to store game: %w", err)
	}

	// Create game session
	gameSession := &GameSession{
		Game:              game,
		ConnectedPlayers:  make(map[string]string),
		PlayerConnections: make(map[string]PlayerConnection),
	}

	// Add player connection
	sessionID := uuid.New().String()
	gameSession.ConnectedPlayers[hostPlayerID] = sessionID
	gameSession.PlayerConnections[sessionID] = PlayerConnection{
		PlayerID:    hostPlayerID,
		SessionID:   sessionID,
		IsConnected: true,
	}

	// Store in active games
	gm.activeGamesMutex.Lock()
	gm.activeGames[gameID.Hex()] = gameSession
	gm.activeGamesMutex.Unlock()

	gm.logger.Infof("Created new game %s with code %s and host %s", gameID.Hex(), roomCode, hostPlayerID)

	return gameID.Hex(), nil
}

// GetGame retrieves a game by ID
func (gm *GameManager) GetGame(gameID string) (*models.Game, error) {
	// Normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)
	//gm.logger.Debugf("GetGame: Normalized gameID from %s to %s", gameID, normalizedGameID)

	// Try to get from active games first
	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[normalizedGameID]
	gm.activeGamesMutex.RUnlock()

	if exists {
		session.mutex.RLock()
		defer session.mutex.RUnlock()
		return session.Game, nil
	}

	// If not in active games, try to get from database
	objID, err := primitive.ObjectIDFromHex(normalizedGameID)
	if err != nil {
		// Try to find by room code if it's not a valid ObjectID
		if len(normalizedGameID) == 6 {
			gm.logger.Debugf("GetGame: Trying to find game by room code: %s", normalizedGameID)
			return gm.GetGameByRoomCode(normalizedGameID)
		}
		return nil, fmt.Errorf("invalid game ID: %w", err)
	}

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	var game models.Game
	err = collection.FindOne(gm.ctx, bson.M{"_id": objID}).Decode(&game)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("game not found")
		}
		return nil, fmt.Errorf("failed to get game: %w", err)
	}

	return &game, nil
}

// GetGameByRoomCode retrieves a game by room code
func (gm *GameManager) GetGameByRoomCode(roomCode string) (*models.Game, error) {
	// Normalize room code to uppercase (room codes are stored in uppercase)
	normalizedRoomCode := strings.ToUpper(roomCode)
	gm.logger.Debugf("GetGameByRoomCode: Normalized roomCode from %s to %s", roomCode, normalizedRoomCode)

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	var game models.Game
	err := collection.FindOne(gm.ctx, bson.M{"code": normalizedRoomCode}).Decode(&game)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("game not found with room code: %s", normalizedRoomCode)
		}
		return nil, fmt.Errorf("failed to get game by room code: %w", err)
	}

	return &game, nil
}

// JoinGame adds a player to a game
func (gm *GameManager) JoinGame(gameID, playerID string) (string, error) {
	// Normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)
	gm.logger.Debugf("JoinGame: Normalized gameID from %s to %s", gameID, normalizedGameID)

	// Get game session
	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[normalizedGameID]
	gm.activeGamesMutex.RUnlock()

	if !exists {
		// Try to find by room code if it's not found by ID
		if len(normalizedGameID) == 6 {
			gm.logger.Debugf("JoinGame: Trying to find game by room code: %s", normalizedGameID)
			game, err := gm.GetGameByRoomCode(normalizedGameID)
			if err == nil {
				// Found game by room code, now get the session
				gm.activeGamesMutex.RLock()
				session, exists = gm.activeGames[game.ID.Hex()]
				gm.activeGamesMutex.RUnlock()

				if exists {
					normalizedGameID = game.ID.Hex()
				}
			}
		}

		if !exists {
			return "", fmt.Errorf("game session not found")
		}
	}

	session.mutex.Lock()
	defer session.mutex.Unlock()

	// Check if game is in LOBBY status
	if session.Game.Status != models.GameStatusLobby {
		return "", fmt.Errorf("cannot join game that is not in LOBBY status")
	}

	// Check if player is already in game
	for _, player := range session.Game.Players {
		if player.ID == playerID {
			// Player is already in game, generate new session ID
			sessionID := uuid.New().String()
			session.ConnectedPlayers[playerID] = sessionID
			session.PlayerConnections[sessionID] = PlayerConnection{
				PlayerID:    playerID,
				SessionID:   sessionID,
				IsConnected: true,
			}
			return sessionID, nil
		}
	}

	// Check if game is full
	if len(session.Game.Players) >= session.Game.MaxPlayers { // Use MaxPlayers from game data
		return "", fmt.Errorf("game is full")
	}

	// Create new player
	newPlayer := models.Player{
		ID:             playerID,
		Status:         models.PlayerStatusActive,
		Balance:        1500, // Initial balance, should come from config
		Position:       0,    // Start position
		Cards:          []models.Card{},
		Properties:     []string{},
		InitialDeposit: 0,    // No deposit yet
		NetWorth:       1500, // Same as initial balance
	}

	// Add player to game
	session.Game.Players = append(session.Game.Players, newPlayer)
	session.Game.TurnOrder = append(session.Game.TurnOrder, playerID)
	session.Game.UpdatedAt = time.Now()
	session.Game.LastActivity = time.Now()

	// Update game in database
	objID, err := primitive.ObjectIDFromHex(normalizedGameID)
	if err != nil {
		return "", fmt.Errorf("invalid game ID: %w", err)
	}

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	_, err = collection.UpdateOne(
		gm.ctx,
		bson.M{"_id": objID},
		bson.M{
			"$set": bson.M{
				"players":      session.Game.Players,
				"turnOrder":    session.Game.TurnOrder,
				"updatedAt":    session.Game.UpdatedAt,
				"lastActivity": session.Game.LastActivity,
			},
		},
	)

	if err != nil {
		return "", fmt.Errorf("failed to update game: %w", err)
	}

	// Add player connection
	sessionID := uuid.New().String()
	session.ConnectedPlayers[playerID] = sessionID
	session.PlayerConnections[sessionID] = PlayerConnection{
		PlayerID:    playerID,
		SessionID:   sessionID,
		IsConnected: true,
	}

	gm.logger.Infof("Player %s joined game %s", playerID, normalizedGameID)

	return sessionID, nil
}

// StartGame starts a game
func (gm *GameManager) StartGame(gameID string, requestingPlayerID string) error {
	// Normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)
	gm.logger.Debugf("StartGame: Normalized gameID from %s to %s", gameID, normalizedGameID)

	// Get game session
	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[normalizedGameID]
	gm.activeGamesMutex.RUnlock()

	if !exists {
		// Try to find by room code if it's not found by ID
		if len(normalizedGameID) == 6 {
			gm.logger.Debugf("StartGame: Trying to find game by room code: %s", normalizedGameID)
			game, err := gm.GetGameByRoomCode(normalizedGameID)
			if err == nil {
				// Found game by room code, now get the session
				gm.activeGamesMutex.RLock()
				session, exists = gm.activeGames[game.ID.Hex()]
				gm.activeGamesMutex.RUnlock()

				if exists {
					normalizedGameID = game.ID.Hex()
				}
			}
		}

		if !exists {
			return fmt.Errorf("game session not found")
		}
	}

	session.mutex.Lock()
	defer session.mutex.Unlock()

	// Check if game is in LOBBY status
	if session.Game.Status != models.GameStatusLobby {
		return fmt.Errorf("game is not in LOBBY status")
	}

	// Check if there are enough players
	if len(session.Game.Players) < 2 { // Minimum players should come from config
		return fmt.Errorf("not enough players to start the game")
	}

	// Verify that the requesting player is the host
	if requestingPlayerID != session.Game.HostID {
		gm.logger.Warnf("Player %s attempted to start game %s but is not the host. Host is %s",
			requestingPlayerID, gameID, session.Game.HostID)
		return fmt.Errorf("only the host can start the game")
	}

	// First, enqueue the game start operation in the message queue
	// This ensures that even if there's a connection issue during the transition,
	// the game start operation will be processed
	if gm.messageQueue != nil {
		// Create game state data for the queue
		gameStartData := map[string]interface{}{
			"gameId":    normalizedGameID,
			"hostId":    requestingPlayerID,
			"players":   session.Game.Players,
			"timestamp": time.Now().Format(time.RFC3339),
		}

		// Enqueue the game start operation
		err := gm.messageQueue.EnqueueGameStart(normalizedGameID, requestingPlayerID, gameStartData)
		if err != nil {
			gm.logger.Errorf("Failed to enqueue game start operation: %v", err)
			// Continue with the normal flow even if queue fails
		} else {
			gm.logger.Infof("Game start operation enqueued for game %s", normalizedGameID)
		}
	}

	// Set game status to ACTIVE
	// Randomize turn order before starting
	if len(session.Game.TurnOrder) > 1 {
		// Use a more modern approach for random shuffling
		r := rand.New(rand.NewSource(time.Now().UnixNano()))
		r.Shuffle(len(session.Game.TurnOrder), func(i, j int) {
			session.Game.TurnOrder[i], session.Game.TurnOrder[j] = session.Game.TurnOrder[j], session.Game.TurnOrder[i]
		})
	}
	session.Game.Status = models.GameStatusActive
	session.Game.CurrentTurn = session.Game.TurnOrder[0]
	session.Game.UpdatedAt = time.Now()
	session.Game.LastActivity = time.Now()

	// Update game in database
	objID, err := primitive.ObjectIDFromHex(gameID)
	if err != nil {
		return fmt.Errorf("invalid game ID format: %w", err)
	}

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	_, updateErr := collection.UpdateOne(
		gm.ctx,
		bson.M{"_id": objID},
		bson.M{
			"$set": bson.M{
				"status":       session.Game.Status,
				"currentTurn":  session.Game.CurrentTurn,
				"turnOrder":    session.Game.TurnOrder,
				"players":      session.Game.Players,
				"updatedAt":    session.Game.UpdatedAt,
				"lastActivity": session.Game.LastActivity,
			},
		},
	)
	if updateErr != nil {
		return fmt.Errorf("failed to update game: %w", updateErr)
	}

	gm.logger.Infof("Game %s started with %d players", gameID, len(session.Game.Players))

	// Broadcast game_started event to all clients in the game
	if gm.wsHub != nil {
		// Create game state to include in the broadcast
		gameState := map[string]interface{}{
			"type":        "game_started",
			"gameId":      gameID,
			"status":      string(session.Game.Status),
			"currentTurn": session.Game.CurrentTurn,
			"players":     session.Game.Players,
			"turnOrder":   session.Game.TurnOrder,
			"timestamp":   time.Now().Format(time.RFC3339),
		}

		// Also enqueue the game state update in the message queue for resilience
		if gm.messageQueue != nil {
			err := gm.messageQueue.EnqueueGameStateUpdate(gameID, gameState)
			if err != nil {
				gm.logger.Errorf("Failed to enqueue game state update: %v", err)
			} else {
				gm.logger.Infof("Game state update enqueued for game %s", gameID)
			}
		}

		// Marshal to JSON
		msgBytes, jsonErr := json.Marshal(gameState)
		if jsonErr != nil {
			gm.logger.Errorf("Failed to marshal game_started message: %v", jsonErr)
		} else {
			// Broadcast to all clients in the game
			gm.wsHub.BroadcastToGame(gameID, msgBytes)
			gm.logger.Infof("Broadcasted game_started event to all clients in game %s", gameID)
		}

		// Immediately broadcast the first turn
		turnMsg := map[string]interface{}{
			"type":        "game_turn",
			"currentTurn": session.Game.CurrentTurn,
			"turnOrder":   session.Game.TurnOrder,
			"gameId":      gameID,
			"timestamp":   time.Now().Format(time.RFC3339),
		}
		if turnBytes, err := json.Marshal(turnMsg); err == nil {
			gm.wsHub.BroadcastToGame(gameID, turnBytes)
			gm.logger.Infof("Broadcasted game_turn event to all clients in game %s", gameID)
		} else {
			gm.logger.Errorf("Failed to marshal game_turn message: %v", err)
		}
	} else {
		gm.logger.Warnf("WebSocket hub is nil, cannot broadcast game_started event")
	}

	return nil
}

// PlayerDisconnected handles a player disconnecting from a game.
// It returns the new host ID if the host disconnected, and an error if something went wrong.
func (gm *GameManager) PlayerDisconnected(gameID, playerID string) (string, error) {
	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[gameID]
	gm.activeGamesMutex.RUnlock()

	if !exists {
		return "", fmt.Errorf("game session not found for gameID: %s", gameID)
	}

	session.mutex.Lock()
	defer session.mutex.Unlock()

	// Find the player and remove them
	playerIndex := -1
	for i, p := range session.Game.Players {
		if p.ID == playerID {
			playerIndex = i
			break
		}
	}

	if playerIndex == -1 {
		// Player not found in the game, maybe already removed.
		// This can happen in race conditions, so we don't return an error.
		gm.logger.Warnf("PlayerDisconnected: Player %s not found in game %s. Might have been already removed.", playerID, gameID)
		return "", nil // Return current host and no error
	}

	// Remove player from the Players slice
	session.Game.Players = append(session.Game.Players[:playerIndex], session.Game.Players[playerIndex+1:]...)

	// Remove player from the TurnOrder slice
	turnOrderIndex := -1
	for i, id := range session.Game.TurnOrder {
		if id == playerID {
			turnOrderIndex = i
			break
		}
	}
	if turnOrderIndex != -1 {
		session.Game.TurnOrder = append(session.Game.TurnOrder[:turnOrderIndex], session.Game.TurnOrder[turnOrderIndex+1:]...)
	}

	newHostID := ""
	// If the disconnected player was the host, assign a new host.
	if session.Game.HostID == playerID {
		if len(session.Game.Players) > 0 {
			// Assign the next player in the original turn order as the new host.
			// If the host was the last in turn order, assign the first player.
			if turnOrderIndex != -1 && turnOrderIndex < len(session.Game.TurnOrder) {
				newHostID = session.Game.TurnOrder[turnOrderIndex]
			} else if len(session.Game.TurnOrder) > 0 {
				newHostID = session.Game.TurnOrder[0]
			} else {
				// Fallback to the first player in the remaining player list
				newHostID = session.Game.Players[0].ID
			}
			session.Game.HostID = newHostID
			gm.logger.Infof("Host %s disconnected from game %s. New host is %s.", playerID, gameID, newHostID)
		} else {
			// No players left, mark game for cleanup
			session.Game.HostID = ""
			gm.logger.Infof("Last player (host) %s disconnected from game %s. Game will be marked as completed.", playerID, gameID)
			session.Game.Status = models.GameStatusCompleted
		}
	}

	// Update the game in the database
	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	filter := bson.M{"_id": session.Game.ID}
	update := bson.M{"$set": bson.M{
		"players":   session.Game.Players,
		"turnOrder": session.Game.TurnOrder,
		"hostId":    session.Game.HostID,
		"status":    session.Game.Status,
		"updatedAt": time.Now(),
	}}

	_, err := collection.UpdateOne(gm.ctx, filter, update)
	if err != nil {
		gm.logger.Errorf("Failed to update game %s after player %s disconnected: %v", gameID, playerID, err)
		return "", fmt.Errorf("failed to update game state: %w", err)
	}

	gm.logger.Infof("Player %s successfully removed from game %s.", playerID, gameID)

	// If the game is now empty, remove it from active games
	if len(session.Game.Players) == 0 {
		gm.activeGamesMutex.Lock()
		delete(gm.activeGames, gameID)
		gm.activeGamesMutex.Unlock()
		gm.logger.Infof("Game %s is now empty and has been removed from active sessions.", gameID)
	}

	return newHostID, nil
}

// GetActivePlayers retrieves the list of active players for a game
func (gm *GameManager) GetActivePlayers(gameID string) ([]models.Player, error) {
	var players []models.Player

	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[gameID]
	gm.activeGamesMutex.RUnlock()

	if !exists {
		return players, fmt.Errorf("game session not found")
	}

	session.mutex.RLock()
	defer session.mutex.RUnlock()

	for _, player := range session.Game.Players {
		if player.Status == models.PlayerStatusActive {
			players = append(players, player)
		}
	}

	return players, nil
}

// CleanupStaleGames removes stale or duplicate game records
func (gm *GameManager) CleanupStaleGames() ([]string, error) {
	gm.activeGamesMutex.Lock()
	defer gm.activeGamesMutex.Unlock()

	removedGames := []string{}

	// Get current time
	now := time.Now()

	// Track unique game IDs to identify duplicates
	uniqueGameIDs := make(map[string]bool)

	// Define timeout thresholds
	inactivityThreshold := now.Add(-24 * time.Hour)
	noJoinThreshold := now.Add(-15 * time.Minute)  // 15 minutes threshold for no joins
	noStartThreshold := now.Add(-30 * time.Minute) // 30 minutes threshold for not starting
	// We don't need this variable since we're using the connection status directly
	// hostInactiveThreshold := now.Add(-5 * time.Minute)

	// First pass - find duplicates and old games
	gamesToRemove := []string{}
	for gameID, gameSession := range gm.activeGames {
		gameSession.mutex.RLock()
		lastActivity := gameSession.Game.LastActivity
		status := gameSession.Game.Status
		createdAt := gameSession.Game.CreatedAt
		playerCount := len(gameSession.Game.Players)
		gameSession.mutex.RUnlock()

		shouldRemove := false
		removalReason := ""

		// Check if game is inactive for 24+ hours
		if lastActivity.Before(inactivityThreshold) {
			shouldRemove = true
			removalReason = "inactive for 24+ hours"
		} else if status == models.GameStatusLobby && playerCount <= 1 && createdAt.Before(noJoinThreshold) {
			// Check if game is in LOBBY and has only 1 player (host) after 15 minutes
			shouldRemove = true
			removalReason = "no players joined within 15 minutes"
		} else if status == models.GameStatusLobby && createdAt.Before(noStartThreshold) {
			// Check if game is in LOBBY after 30 minutes (not started)
			shouldRemove = true
			removalReason = "game not started within 30 minutes"
		} else {
			// Check for inactive host and transfer host status if needed
			gameSession.mutex.Lock()

			// Find the host player
			var hostPlayerID string
			if len(gameSession.Game.TurnOrder) > 0 {
				hostPlayerID = gameSession.Game.TurnOrder[0] // First player in turn order is the host
			}

			// Check if host is inactive
			if hostPlayerID != "" {
				hostSessionID, hostExists := gameSession.ConnectedPlayers[hostPlayerID]
				hostIsActive := false

				if hostExists {
					hostConnection, exists := gameSession.PlayerConnections[hostSessionID]
					if exists && hostConnection.IsConnected {
						// Host is still connected
						hostIsActive = true
					}
				}

				// If host is inactive, find a new host
				if !hostIsActive && len(gameSession.Game.Players) > 1 {
					// Find the first active player to be the new host
					newHostID := ""
					for _, player := range gameSession.Game.Players {
						if player.ID != hostPlayerID && player.Status == models.PlayerStatusActive {
							playerSessionID, exists := gameSession.ConnectedPlayers[player.ID]
							if exists {
								playerConn, exists := gameSession.PlayerConnections[playerSessionID]
								if exists && playerConn.IsConnected {
									newHostID = player.ID
									break
								}
							}
						}
					}

					// If we found a new host, update the turn order
					if newHostID != "" {
						gm.logger.Infof("Transferring host status from %s to %s in game %s",
							hostPlayerID, newHostID, gameID)

						// Move the new host to the front of the turn order
						newTurnOrder := []string{newHostID}
						for _, pid := range gameSession.Game.TurnOrder {
							if pid != newHostID {
								newTurnOrder = append(newTurnOrder, pid)
							}
						}
						gameSession.Game.TurnOrder = newTurnOrder

						// Update the game in the database
						collection := gm.mongoClient.Database(gm.dbName).Collection("games")
						_, err := collection.UpdateOne(
							gm.ctx,
							bson.M{"_id": gameSession.Game.ID},
							bson.M{"$set": bson.M{
								"turnOrder":    gameSession.Game.TurnOrder,
								"updatedAt":    time.Now(),
								"lastActivity": time.Now(),
							}},
						)

						if err != nil {
							gm.logger.Errorf("Failed to update host transfer: %v", err)
						}
					} else if status == models.GameStatusLobby {
						// If no active players and game is in lobby, remove it
						shouldRemove = true
						removalReason = "host inactive and no active players in lobby"
					}
				}
			}

			gameSession.mutex.Unlock()
		}

		if shouldRemove {
			gamesToRemove = append(gamesToRemove, gameID)
			removedGames = append(removedGames, gameID)

			// Update game status in database to COMPLETED
			if gm.mongoClient != nil {
				collection := gm.mongoClient.Database(gm.dbName).Collection("games")
				_, err := collection.UpdateOne(
					gm.ctx,
					bson.M{"_id": gameSession.Game.ID},
					bson.M{"$set": bson.M{
						"status":    models.GameStatusCompleted,
						"updatedAt": time.Now(),
					}},
				)

				if err != nil {
					gm.logger.Errorf("Failed to update stale game status: %v", err)
				} else {
					gm.logger.Infof("Removed game %s: %s", gameID, removalReason)
				}
			}

			continue
		}

		// Check for duplicates (store first occurrence, mark others for removal)
		lowercaseID := strings.ToLower(gameID)
		if uniqueGameIDs[lowercaseID] {
			gamesToRemove = append(gamesToRemove, gameID)
			removedGames = append(removedGames, gameID)
			gm.logger.Infof("Removed game %s: duplicate ID", gameID)
		} else {
			uniqueGameIDs[lowercaseID] = true
		}
	}

	// Second pass - remove the identified games
	for _, gameID := range gamesToRemove {
		delete(gm.activeGames, gameID)
	}

	gm.logger.Infof("Cleaned up %d stale/duplicate games", len(removedGames))

	// If the storage implementation is available, remove the games from there too
	if gm.storage != nil && len(removedGames) > 0 {
		if err := gm.storage.RemoveGames(removedGames); err != nil {
			gm.logger.Errorf("Failed to remove games from storage: %v", err)
		}
	}

	return removedGames, nil
}

// CleanupAbandonedGame removes an abandoned game from memory and optionally from database
func (gm *GameManager) CleanupAbandonedGame(gameID string, deleteFromDB bool) error {
	gm.logger.Infof("[CleanupAbandonedGame] Starting cleanup for abandoned game %s (deleteFromDB: %t)", gameID, deleteFromDB)

	// Remove from active games in memory
	gm.activeGamesMutex.Lock()
	_, exists := gm.activeGames[gameID]
	if exists {
		delete(gm.activeGames, gameID)
		gm.logger.Debugf("[CleanupAbandonedGame] Removed game %s from active games in memory", gameID)
	}
	gm.activeGamesMutex.Unlock()

	// Clean up any remaining WebSocket connections for this game
	if exists && gm.wsHub != nil {
		// Notify any remaining clients that the game has been deleted
		deleteMsg := map[string]interface{}{
			"type":    "game_deleted",
			"gameId":  gameID,
			"reason":  "abandoned",
			"message": "Game has been removed due to inactivity",
		}
		msgBytes, _ := json.Marshal(deleteMsg)
		gm.wsHub.BroadcastToGame(gameID, msgBytes)

		// Give a brief moment for the message to be sent before cleanup
		time.Sleep(500 * time.Millisecond)
	}

	// Delete from database if requested
	if deleteFromDB && gm.mongoClient != nil {
		objID, err := primitive.ObjectIDFromHex(gameID)
		if err != nil {
			gm.logger.Errorf("[CleanupAbandonedGame] Invalid game ID format %s: %v", gameID, err)
			return fmt.Errorf("invalid game ID format: %w", err)
		}

		collection := gm.mongoClient.Database(gm.dbName).Collection("games")
		result, err := collection.DeleteOne(gm.ctx, bson.M{"_id": objID})
		if err != nil {
			gm.logger.Errorf("[CleanupAbandonedGame] Failed to delete game %s from database: %v", gameID, err)
			return fmt.Errorf("failed to delete game from database: %w", err)
		}

		if result.DeletedCount > 0 {
			gm.logger.Infof("[CleanupAbandonedGame] Successfully deleted game %s from database", gameID)
		} else {
			gm.logger.Warnf("[CleanupAbandonedGame] Game %s was not found in database (may have been deleted already)", gameID)
		}
	}

	// Broadcast updated lobby state to all lobby clients
	if gm.wsHub != nil {
		gm.broadcastLobbyUpdate()
	}

	gm.logger.Infof("[CleanupAbandonedGame] Cleanup completed for game %s", gameID)
	return nil
}

// ListAvailableGames retrieves all games that are currently in the LOBBY state.
func (gm *GameManager) ListAvailableGames() ([]models.Game, error) {
	gm.logger.Info("Fetching available games for lobby")

	if gm.mongoClient == nil {
		gm.logger.Warn("MongoDB client is nil, cannot fetch available games.")
		return nil, fmt.Errorf("database connection not available")
	}

	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	filter := bson.M{
		"status": models.GameStatusLobby,
	}

	// Find all games in LOBBY state
	cursor, err := collection.Find(gm.ctx, filter)
	if err != nil {
		gm.logger.Errorf("Failed to query available games: %v", err)
		return nil, fmt.Errorf("failed to query database: %w", err)
	}
	defer cursor.Close(gm.ctx)

	var games []models.Game
	if err := cursor.All(gm.ctx, &games); err != nil {
		gm.logger.Errorf("Failed to decode available games: %v", err)
		return nil, fmt.Errorf("failed to decode game data: %w", err)
	}

	gm.logger.Infof("Found %d available games", len(games))
	return games, nil
}

// ProcessGameAction handles incoming game actions from players.
func (gm *GameManager) ProcessGameAction(action models.GameAction) error {
	gm.logger.Infof("Processing game action: %s for game %s, player %s", action.Type, action.GameID, action.PlayerID)

	// Here you would have a switch statement or other logic to handle different action types.
	// For example:
	switch action.Type {
	case "roll_dice":
		// Logic for rolling dice
		gm.logger.Infof("Player %s is rolling the dice.", action.PlayerID)
	case "buy_property":
		// Logic for buying a property
		gm.logger.Infof("Player %s is buying a property.", action.PlayerID)
	default:
		return fmt.Errorf("unknown game action type: %s", action.Type)
	}

	// After processing the action, you might need to broadcast the new game state.
	// For example:
	// gm.broadcastGameState(action.GameID)

	return nil
}

// broadcastLobbyUpdate sends the current list of available games to all lobby clients
func (gm *GameManager) broadcastLobbyUpdate() {
	games, err := gm.ListAvailableGames()
	if err != nil {
		gm.logger.Errorf("[broadcastLobbyUpdate] Failed to get available games: %v", err)
		return
	}

	updateMsg := map[string]interface{}{
		"type":  "lobby_update",
		"games": games,
	}

	msgBytes, err := json.Marshal(updateMsg)
	if err != nil {
		gm.logger.Errorf("[broadcastLobbyUpdate] Failed to marshal lobby update message: %v", err)
		return
	}

	gm.logger.Debugf("[broadcastLobbyUpdate] Broadcasting lobby update with %d games", len(games))
	if gm.wsHub != nil {
		gm.wsHub.BroadcastToLobby(msgBytes)
	}
}

// UpdateGame updates an existing game in both memory and database
func (gm *GameManager) UpdateGame(game *models.Game) error {
	if game == nil {
		return errors.New("game cannot be nil")
	}

	gm.mutex.Lock()
	defer gm.mutex.Unlock()

	// Update in-memory game
	gm.games[game.ID.Hex()] = game

	// Update in database
	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	filter := bson.M{"_id": game.ID}

	_, err := collection.UpdateOne(
		gm.ctx,
		filter,
		bson.M{"$set": game},
	)

	if err != nil {
		gm.logger.Errorf("Failed to update game in database: %v", err)
		return fmt.Errorf("failed to update game in database: %w", err)
	}

	gm.logger.Debugf("Successfully updated game %s in memory and database", game.ID.Hex())
	return nil
}

// RejoinGame allows a player to rejoin a game they were previously connected to
func (gm *GameManager) RejoinGame(gameID, playerID, sessionID string) error {
	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[gameID]
	gm.activeGamesMutex.RUnlock()

	if !exists {
		return fmt.Errorf("game session not found")
	}

	session.mutex.Lock()
	defer session.mutex.Unlock()

	// Check if the game is still in progress
	if session.Game.Status != models.GameStatusActive {
		return fmt.Errorf("cannot rejoin game that is not active")
	}

	// Check if the player is already in the game
	if _, ok := session.ConnectedPlayers[playerID]; ok {
		return fmt.Errorf("player is already in the game")
	}

	// Add the player back to the game
	player := models.Player{
		ID:             playerID,
		Status:         models.PlayerStatusActive,
		Balance:        1500, // Reset balance, or fetch from saved state
		Position:       0,    // Reset position, or fetch from saved state
		Cards:          []models.Card{},
		Properties:     []string{},
		InitialDeposit: 0,    // No deposit yet
		NetWorth:       1500, // Same as initial balance
	}

	session.Game.Players = append(session.Game.Players, player)
	session.Game.TurnOrder = append(session.Game.TurnOrder, playerID)
	session.Game.LastActivity = time.Now()

	// Update the game state in the database
	collection := gm.mongoClient.Database(gm.dbName).Collection("games")
	_, err := collection.UpdateOne(
		gm.ctx,
		bson.M{"_id": session.Game.ID},
		bson.M{
			"$set": bson.M{
				"players":      session.Game.Players,
				"turnOrder":    session.Game.TurnOrder,
				"lastActivity": session.Game.LastActivity,
			},
		},
	)

	if err != nil {
		return fmt.Errorf("failed to update game in database: %w", err)
	}

	// Restore the player's connection
	session.ConnectedPlayers[playerID] = sessionID
	session.PlayerConnections[sessionID] = PlayerConnection{
		PlayerID:    playerID,
		SessionID:   sessionID,
		IsConnected: true,
	}

	gm.logger.Infof("Player %s rejoined game %s", playerID, gameID)

	// Notify the player of the current game state
	gameState := map[string]interface{}{
		"type":        "game_state",
		"gameId":      gameID,
		"status":      string(session.Game.Status),
		"currentTurn": session.Game.CurrentTurn,
		"players":     session.Game.Players,
		"turnOrder":   session.Game.TurnOrder,
		"timestamp":   time.Now().Format(time.RFC3339),
	}

	// Marshal to JSON
	msgBytes, err := json.Marshal(gameState)
	if err != nil {
		return fmt.Errorf("failed to marshal game state message: %w", err)
	}

	// Send the current game state to the rejoining player
	if gm.wsHub != nil {
		gm.wsHub.BroadcastToGame(gameID, msgBytes)
		gm.logger.Infof("Broadcasted game state to rejoining player %s in game %s", playerID, gameID)
	} else {
		gm.logger.Warnf("WebSocket hub is nil, cannot send game state to rejoining player")
	}

	return nil
}

// HandlePlayerMessage processes a message from a player
func (gm *GameManager) HandlePlayerMessage(gameID, playerID string, message []byte) error {
	gm.logger.Debugf("Received message from player %s in game %s: %s", playerID, gameID, string(message))

	gm.activeGamesMutex.RLock()
	session, exists := gm.activeGames[gameID]
	gm.activeGamesMutex.RUnlock()

	if !exists {
		return fmt.Errorf("game session not found")
	}

	session.mutex.Lock()
	defer session.mutex.Unlock()

	// Handle different message types
	var msgData map[string]interface{}
	if err := json.Unmarshal(message, &msgData); err != nil {
		return fmt.Errorf("failed to unmarshal message: %w", err)
	}

	msgType, ok := msgData["type"].(string)
	if !ok {
		return fmt.Errorf("message type not specified or invalid")
	}

	switch msgType {
	case "player_action":
		// Handle player action (e.g., make a move, buy property, etc.)
		return gm.handlePlayerAction(session, playerID, msgData)
	case "chat_message":
		// Handle chat message
		return gm.handleChatMessage(session, playerID, msgData)
	default:
		return fmt.Errorf("unknown message type: %s", msgType)
	}
}

// handlePlayerAction processes a player action message
func (gm *GameManager) handlePlayerAction(session *GameSession, playerID string, msgData map[string]interface{}) error {
	// Implement action handling logic (e.g., update game state, validate moves, etc.)
	gm.logger.Infof("Processing player action from %s in game %s: %v", playerID, session.Game.ID.Hex(), msgData)

	// For example, let's just update the last activity time for now
	session.Game.LastActivity = time.Now()

	// TODO: Add actual game action processing logic here

	return nil
}

// handleChatMessage processes a chat message from a player
func (gm *GameManager) handleChatMessage(session *GameSession, playerID string, msgData map[string]interface{}) error {
	// Implement chat message handling (e.g., broadcast to other players, etc.)
	gm.logger.Infof("Received chat message from %s in game %s: %v", playerID, session.Game.ID.Hex(), msgData)

	// For now, let's just broadcast the chat message to all players in the game
	if gm.wsHub != nil {
		chatMsg := map[string]interface{}{
			"type":      "chat_message",
			"playerId":  playerID,
			"message":   msgData["message"],
			"timestamp": time.Now().Format(time.RFC3339),
		}

		// Marshal to JSON
		msgBytes, err := json.Marshal(chatMsg)
		if err != nil {
			return fmt.Errorf("failed to marshal chat message: %w", err)
		}

		// Broadcast to all clients in the game
		gm.wsHub.BroadcastToGame(session.Game.ID.Hex(), msgBytes)
		gm.logger.Infof("Broadcasted chat message from %s to all clients in game %s", playerID, session.Game.ID.Hex())
	} else {
		gm.logger.Warnf("WebSocket hub is nil, cannot broadcast chat message")
	}

	return nil
}
