package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/websocket"
	"github.com/kekopoly/backend/internal/game/manager"
	"github.com/kekopoly/backend/internal/game/models"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"
)

// Initialize a separate random number generator for dice rolls to ensure consistency
var diceRand = rand.New(rand.NewSource(time.Now().UnixNano()))

// MessageQueue defines the interface for the message queue
type MessageQueue interface {
	EnqueuePlayerTokenUpdate(gameID, playerID string, tokenData map[string]interface{}) error
	EnqueueGameStateUpdate(gameID string, gameState map[string]interface{}) error
	EnqueueGameStart(gameID string, hostID string, data map[string]interface{}) error
}

// No need for init() function with Go 1.20+
// Random number generation is automatically seeded

// Hub maintains the set of active WebSocket connections and broadcasts messages
type Hub struct {
	// Game manager reference
	gameManager *manager.GameManager

	// Registered clients by gameID -> playerID -> client
	clients map[string]map[string]*Client

	// Mutex for clients map
	clientsMutex sync.RWMutex

	// Register requests from clients
	register chan *Client

	// Unregister requests from clients
	unregister chan *Client

	// Broadcast messages to all clients in a game
	broadcast chan *BroadcastMessage

	// Context for cleanup
	ctx context.Context

	// Logger
	logger *zap.SugaredLogger

	// MongoDB client
	mongoClient *mongo.Client

	// Redis client
	redisClient *redis.Client

	// Store player information by gameID -> playerID -> playerInfo
	playerInfo map[string]map[string]map[string]interface{}

	// Mutex for playerInfo map
	playerInfoMutex sync.RWMutex

	// Store game information by gameID -> gameInfo
	gameInfo map[string]map[string]interface{}

	// Mutex for gameInfo map
	gameInfoMutex sync.RWMutex

	// Message queue for resilient state transitions
	messageQueue MessageQueue

	// Session history tracking by gameID -> playerID -> sessionHistory
	sessionHistory map[string]map[string][]SessionInfo

	// Mutex for sessionHistory map
	sessionHistoryMutex sync.RWMutex
}

// SessionInfo stores information about a player's session
type SessionInfo struct {
	SessionID      string    `json:"sessionId"`
	ConnectedAt    time.Time `json:"connectedAt"`
	DisconnectedAt time.Time `json:"disconnectedAt,omitempty"`
	LastActivity   time.Time `json:"lastActivity"`
	ClientInfo     string    `json:"clientInfo,omitempty"`
	Status         string    `json:"status"` // "CONNECTED", "DISCONNECTED", "RECONNECTING"
}

// Message priority levels
const (
	PriorityHigh   = "high"   // Game state updates, player turns, critical events
	PriorityNormal = "normal" // Regular updates, player status changes
	PriorityLow    = "low"    // Chat messages, cosmetic updates, non-critical info
)

// Client represents a WebSocket client connection
type Client struct {
	// Hub reference
	hub *Hub

	// WebSocket connection
	conn *websocket.Conn

	// Priority queues for outbound messages
	highPriorityQueue   chan []byte // Critical game state messages
	normalPriorityQueue chan []byte // Regular updates
	lowPriorityQueue    chan []byte // Chat messages, cosmetic updates

	// Player ID
	playerID string

	// Game ID
	gameID string

	// Session ID
	sessionID string

	// Last time a pong was received from this client
	lastPongTime time.Time

	// Mutex for protecting lastPongTime
	pongMutex sync.RWMutex

	// User agent or client info
	userAgent string

	// Flag indicating if this is a reconnection
	isReconnection bool

	// Previous session ID if this is a reconnection
	previousSessionID string

	// Connection timestamp
	connectedAt time.Time
}

// isActive checks if the client has been active within the given duration
func (c *Client) isActive(duration time.Duration) bool {
	c.pongMutex.RLock()
	defer c.pongMutex.RUnlock()
	return time.Since(c.lastPongTime) <= duration
}

// handleVerifyHost handles a request to verify the host of a game
func (c *Client) handleVerifyHost(msg map[string]interface{}) {
	// Get game info
	gameInfo := c.hub.getGameInfo(c.gameID)
	if gameInfo == nil {
		c.hub.logger.Warnf("No game info found for game %s during host verification", c.gameID)
		return
	}

	// Get current host ID
	hostID, ok := gameInfo["hostId"].(string)
	if !ok {
		c.hub.logger.Warnf("No host ID found in game info for game %s", c.gameID)
		return
	}

	// Create response
	response := map[string]interface{}{
		"type":    "host_verified",
		"gameId":  c.gameID,
		"hostId":  hostID,
		"isHost":  c.playerID == hostID,
		"success": true,
	}

	// Marshal to JSON
	responseJSON, err := json.Marshal(response)
	if err != nil {
		c.hub.logger.Errorf("Failed to marshal host_verified response: %v", err)
		return
	}

	// Send response to the requesting client with high priority
	c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, responseJSON, PriorityHigh)
}

// handleGetActivePlayers handles a request for active players list
func (c *Client) handleGetActivePlayers() {
	// Get list of players in this game
	c.hub.clientsMutex.RLock()
	gamePlayers, exists := c.hub.clients[c.gameID]
	if !exists {
		c.hub.clientsMutex.RUnlock()
		c.hub.logger.Warnf("No players found for game %s", c.gameID)
		return
	}

	activePlayers := make([]map[string]interface{}, 0)
	// Collect active players info
	for playerID := range gamePlayers {
		playerInfo := c.hub.getPlayerInfo(c.gameID, playerID)
		if playerInfo == nil {
			playerInfo = make(map[string]interface{})
			playerInfo["id"] = playerID
		}

		// Add connection status
		playerInfo["isConnected"] = true
		playerInfo["isActive"] = gamePlayers[playerID].isActive(90 * time.Second)

		activePlayers = append(activePlayers, playerInfo)
	}
	c.hub.clientsMutex.RUnlock()

	// Create response
	response := map[string]interface{}{
		"type":          "active_players",
		"activePlayers": activePlayers,
		"gameId":        c.gameID,
		"timestamp":     time.Now().Format(time.RFC3339),
	}

	// Marshal to JSON
	responseJSON, err := json.Marshal(response)
	if err != nil {
		c.hub.logger.Errorf("Failed to marshal active_players response: %v", err)
		return
	}

	// Broadcast active players list to all clients in the game with high priority
	c.hub.BroadcastToGameWithPriority(c.gameID, responseJSON, PriorityHigh)
}

// BroadcastMessage represents a message to be broadcast to clients
type BroadcastMessage struct {
	// Game ID to broadcast to
	gameID string

	// Message data
	data []byte

	// Optional player ID to exclude from broadcast
	excludePlayerID string
}

// NewHub creates a new WebSocket hub
func NewHub(ctx context.Context, gameManager *manager.GameManager, mongoClient *mongo.Client, redisClient *redis.Client, logger *zap.SugaredLogger, messageQueue MessageQueue) *Hub {
	return &Hub{
		gameManager:         gameManager,
		clients:             make(map[string]map[string]*Client),
		register:            make(chan *Client, 128),            // Increased buffer size
		unregister:          make(chan *Client, 128),            // Increased buffer size
		broadcast:           make(chan *BroadcastMessage, 1024), // Significantly increased buffer size
		ctx:                 ctx,
		logger:              logger,
		mongoClient:         mongoClient,
		redisClient:         redisClient,
		playerInfo:          make(map[string]map[string]map[string]interface{}),
		playerInfoMutex:     sync.RWMutex{},
		gameInfo:            make(map[string]map[string]interface{}),
		gameInfoMutex:       sync.RWMutex{},
		messageQueue:        messageQueue,
		sessionHistory:      make(map[string]map[string][]SessionInfo),
		sessionHistoryMutex: sync.RWMutex{},
	}
}

// SetMessageQueue sets the message queue for the hub
func (h *Hub) SetMessageQueue(queue MessageQueue) {
	h.messageQueue = queue
	h.logger.Info("Message queue set for WebSocket hub")
}

// SetGameManager sets the game manager for the hub
func (h *Hub) SetGameManager(gameManager *manager.GameManager) {
	h.gameManager = gameManager
	h.logger.Info("Game manager set for WebSocket hub")
}

// getPlayerInfo retrieves stored player information for a specific player in a game
func (h *Hub) getPlayerInfo(gameID, playerID string) map[string]interface{} {
	h.playerInfoMutex.RLock()
	defer h.playerInfoMutex.RUnlock()

	if gameInfo, ok := h.playerInfo[strings.ToLower(gameID)]; ok {
		if playerInfo, ok := gameInfo[playerID]; ok {
			return playerInfo
		}
	}

	return nil
}

// storePlayerInfo stores player information for a specific player in a game
func (h *Hub) storePlayerInfo(gameID, playerID string, info map[string]interface{}) {
	h.playerInfoMutex.Lock()
	defer h.playerInfoMutex.Unlock()

	// Initialize game map if it doesn't exist
	// Always normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)
	if _, ok := h.playerInfo[normalizedGameID]; !ok {
		h.playerInfo[normalizedGameID] = make(map[string]map[string]interface{})
	}

	// Ensure the player info has an ID field that matches the playerID
	info["id"] = playerID

	// Ensure isHost is correctly set based on the game's hostId
	var hostID string
	gameInfo := h.getGameInfo(normalizedGameID)
	if gameInfo != nil && gameInfo["hostId"] != nil {
		if hostIDStr, ok := gameInfo["hostId"].(string); ok {
			hostID = hostIDStr
		}
	}

	if hostID != "" {
		info["isHost"] = (playerID == hostID)
	}

	// Store player info with normalized gameID
	h.playerInfo[normalizedGameID][playerID] = info
	// h.logger.Infof("Stored player info for player %s in game %s (normalized from %s)", playerID, normalizedGameID, gameID)
}

// getGameInfo retrieves stored game information
func (h *Hub) getGameInfo(gameID string) map[string]interface{} {
	h.gameInfoMutex.RLock()
	defer h.gameInfoMutex.RUnlock()

	normalizedGameID := strings.ToLower(gameID)
	if gameInfo, ok := h.gameInfo[normalizedGameID]; ok {
		return gameInfo
	}

	return nil
}

// storeGameInfo stores information for a specific game
func (h *Hub) storeGameInfo(gameID string, info map[string]interface{}) {
	h.gameInfoMutex.Lock()
	defer h.gameInfoMutex.Unlock()

	// Always normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)

	// Store game info with normalized gameID
	h.gameInfo[normalizedGameID] = info
	// h.logger.Infof("Stored game info for game %s (normalized from %s)", normalizedGameID, gameID)
}

// recordPlayerSession records a new session for a player
func (h *Hub) recordPlayerSession(gameID, playerID, sessionID string, clientInfo string) {
	h.sessionHistoryMutex.Lock()
	defer h.sessionHistoryMutex.Unlock()

	// Normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)

	// Initialize game map if it doesn't exist
	if _, ok := h.sessionHistory[normalizedGameID]; !ok {
		h.sessionHistory[normalizedGameID] = make(map[string][]SessionInfo)
	}

	// Create new session info
	session := SessionInfo{
		SessionID:    sessionID,
		ConnectedAt:  time.Now(),
		LastActivity: time.Now(),
		ClientInfo:   clientInfo,
		Status:       "CONNECTED",
	}

	// Add to session history
	h.sessionHistory[normalizedGameID][playerID] = append(
		h.sessionHistory[normalizedGameID][playerID],
		session,
	)

	h.logger.Infof("[SESSION] Recorded new session for player %s in game %s: Session ID %s",
		playerID, normalizedGameID, sessionID)
}

// updateSessionStatus updates the status of a session in the history
func (h *Hub) updateSessionStatus(gameID, playerID, sessionID, status string) {
	h.sessionHistoryMutex.Lock()
	defer h.sessionHistoryMutex.Unlock()

	// Normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)

	// Check if game and player exist in session history
	if gameSessions, ok := h.sessionHistory[normalizedGameID]; ok {
		if playerSessions, ok := gameSessions[playerID]; ok {
			// Find the session with matching sessionID
			for i, session := range playerSessions {
				if session.SessionID == sessionID {
					// Update session status
					h.sessionHistory[normalizedGameID][playerID][i].Status = status
					h.sessionHistory[normalizedGameID][playerID][i].LastActivity = time.Now()

					// If disconnected, set disconnection time
					if status == "DISCONNECTED" {
						h.sessionHistory[normalizedGameID][playerID][i].DisconnectedAt = time.Now()
					}

					h.logger.Infof("[SESSION] Updated session status for player %s in game %s: Session ID %s, Status: %s",
						playerID, normalizedGameID, sessionID, status)
					return
				}
			}
		}
	}

	h.logger.Warnf("[SESSION] Could not find session to update for player %s in game %s: Session ID %s",
		playerID, normalizedGameID, sessionID)
}

// getPlayerSessions retrieves all sessions for a player in a game
func (h *Hub) getPlayerSessions(gameID, playerID string) []SessionInfo {
	h.sessionHistoryMutex.RLock()
	defer h.sessionHistoryMutex.RUnlock()

	// Normalize gameID to lowercase
	normalizedGameID := strings.ToLower(gameID)

	// Check if game and player exist in session history
	if gameSessions, ok := h.sessionHistory[normalizedGameID]; ok {
		if playerSessions, ok := gameSessions[playerID]; ok {
			// Return a copy of the sessions to avoid race conditions
			sessions := make([]SessionInfo, len(playerSessions))
			copy(sessions, playerSessions)
			return sessions
		}
	}

	return nil
}

// updateGameInfoCache fetches the latest game state from the GameManager and updates the hub's cache.
func (h *Hub) updateGameInfoCache(gameID string) {
	game, err := h.gameManager.GetGame(gameID)
	if err != nil {
		h.logger.Warnf("[updateGameInfoCache] Failed to get game %s from game manager: %v", gameID, err)
		return
	}

	if game == nil {
		h.logger.Warnf("[updateGameInfoCache] Game %s not found by game manager", gameID)
		return
	}

	// Create a map from the game model to store in the cache
	gameInfo := map[string]interface{}{
		"id":         game.ID.Hex(),
		"name":       game.Name,
		"status":     game.Status,
		"hostId":     game.HostID,
		"maxPlayers": game.MaxPlayers,
		"code":       game.Code,
	}

	h.storeGameInfo(gameID, gameInfo)
	h.logger.Infof("[updateGameInfoCache] Updated game info cache for game %s", gameID)
}

// getLatestSession retrieves the most recent session for a player in a game
func (h *Hub) getLatestSession(gameID, playerID string) *SessionInfo {
	sessions := h.getPlayerSessions(gameID, playerID)
	if len(sessions) == 0 {
		return nil
	}

	// Find the most recent session based on ConnectedAt time
	latestSession := sessions[0]
	for _, session := range sessions[1:] {
		if session.ConnectedAt.After(latestSession.ConnectedAt) {
			latestSession = session
		}
	}

	return &latestSession
}

// getActiveSession retrieves the active session for a player in a game, if any
func (h *Hub) getActiveSession(gameID, playerID string) *SessionInfo {
	sessions := h.getPlayerSessions(gameID, playerID)

	// Find any session with CONNECTED status
	for _, session := range sessions {
		if session.Status == "CONNECTED" {
			sessionCopy := session // Create a copy to avoid returning a reference to the slice element
			return &sessionCopy
		}
	}

	return nil
}

// UpdateHostID updates the host ID for a game
func (h *Hub) UpdateHostID(gameID string, hostID string) {
	// Get existing game info or create new
	gameInfo := h.getGameInfo(gameID)
	if gameInfo == nil {
		gameInfo = make(map[string]interface{})
	}

	// Log previous host ID for debugging
	var previousHostID string
	if prevID, ok := gameInfo["hostId"].(string); ok {
		previousHostID = prevID
	}
	// h.logger.Infof("Updating host ID for game %s: previous=%s, new=%s", gameID, previousHostID, hostID)

	// Update host ID
	gameInfo["hostId"] = hostID

	// Store updated game info
	h.storeGameInfo(gameID, gameInfo)

	// Broadcast host change to all clients in the game
	hostChangeMsg := map[string]interface{}{
		"type":   "host_changed",
		"hostId": hostID,
		"gameId": gameID,
	}

	// Marshal to JSON
	msgBytes, err := json.Marshal(hostChangeMsg)
	if err != nil {
		h.logger.Errorf("Failed to marshal host change message: %v", err)
		return
	}

	// Broadcast to all clients in the game
	h.BroadcastToGame(gameID, msgBytes)
	// h.logger.Infof("Broadcasting host change to all clients in game %s: new host %s", gameID, hostID)

	// Also update player info for the new host
	playerInfo := h.getPlayerInfo(gameID, hostID)
	if playerInfo != nil {
		playerInfo["isHost"] = true
		h.storePlayerInfo(gameID, hostID, playerInfo)
		// h.logger.Infof("Updated player info for new host %s in game %s", hostID, gameID)
	}

	// If there was a previous host, update their player info too
	if previousHostID != "" && previousHostID != hostID {
		prevPlayerInfo := h.getPlayerInfo(gameID, previousHostID)
		if prevPlayerInfo != nil {
			prevPlayerInfo["isHost"] = false
			h.storePlayerInfo(gameID, previousHostID, prevPlayerInfo)
			// h.logger.Infof("Updated player info for previous host %s in game %s", previousHostID, gameID)
		}
	}

	// Trigger an active_players update to ensure all clients have the latest host info
	go func() {
		// Give a short delay to ensure the host_changed message is processed first
		time.Sleep(100 * time.Millisecond)

		// Find any client in this game to use for broadcasting
		h.clientsMutex.RLock()
		var client *Client
		if gamePlayers, ok := h.clients[gameID]; ok {
			for _, c := range gamePlayers {
				client = c
				break
			}
		}
		h.clientsMutex.RUnlock()

		// If we found a client, use it to broadcast active players
		if client != nil {
			client.handleGetActivePlayers()
		}
	}()
}

// handlePlayerDisconnected handles a player disconnection
func (h *Hub) handlePlayerDisconnected(gameID, playerID, sessionID string) {
	h.logger.Infof("[Hub handlePlayerDisconnected] Player %s disconnected from game %s with session %s",
		playerID, gameID, sessionID)

	// Ensure gameManager is not nil
	if h.gameManager == nil {
		h.logger.Errorf("[Hub handlePlayerDisconnected] Game manager is nil! Cannot handle player disconnection for Game: %s, Player: %s, Session: %s", gameID, playerID, sessionID)
		return
	}

	// --- REORDERED AND IMPROVED LOGIC ---

	// 1. Immediately and atomically update the player's status in the central GameManager.
	// This makes the GameManager the single source of truth and prevents race conditions.
	newHostID, err := h.gameManager.PlayerDisconnected(gameID, playerID)
	if err != nil {
		h.logger.Warnf("[Hub handlePlayerDisconnected] GameManager failed to process disconnection for player %s in game %s: %v", playerID, gameID, err)
		// We might still continue to try and clean up the hub's state
	}

	// 2. Update the Hub's local session history. This is now a secondary action.
	h.updateSessionStatus(gameID, playerID, sessionID, "DISCONNECTED")

	// 3. Update the Hub's local player info cache.
	playerInfo := h.getPlayerInfo(gameID, playerID)
	if playerInfo != nil {
		playerInfo["status"] = "DISCONNECTED"
		disconnectTime := time.Now().Format(time.RFC3339)
		playerInfo["disconnectedAt"] = disconnectTime
		h.storePlayerInfo(gameID, playerID, playerInfo)
		h.logger.Infof("[Hub handlePlayerDisconnected] Updated hub cache for player %s to DISCONNECTED in game %s at %s",
			playerID, gameID, disconnectTime)
	} else {
		h.logger.Warnf("[Hub handlePlayerDisconnected] Could not find player info in hub cache for %s in game %s",
			playerID, gameID)
	}

	// 4. If a new host was assigned by the GameManager, broadcast the host_changed event.
	if newHostID != "" {
		h.logger.Infof("[Hub handlePlayerDisconnected] New host is %s. Broadcasting host_changed event for game %s.", newHostID, gameID)
		hostChangeMsg := map[string]interface{}{
			"type":   "host_changed",
			"hostId": newHostID,
			"gameId": gameID,
		}
		msgBytes, err := json.Marshal(hostChangeMsg)
		if err != nil {
			h.logger.Errorf("[Hub handlePlayerDisconnected] Failed to marshal host change message for game %s: %v", gameID, err)
		} else {
			h.BroadcastToGame(gameID, msgBytes)
		}
	}

	// 5. Finally, broadcast the updated list of active players to ensure all clients are in sync.
	h.logger.Infof("[Hub handlePlayerDisconnected] Broadcasting active_players update for game %s after disconnection.", gameID)
	// Use a goroutine to avoid blocking the hub's main loop while fetching players
	go func() {
		time.Sleep(250 * time.Millisecond) // Small delay to allow clients to process other messages

		// Find any client in this game to use for broadcasting the active players list.
		// It doesn't matter which client, as handleGetActivePlayers broadcasts to everyone in the game.
		h.clientsMutex.RLock()
		var anyClient *Client
		if gameClients, ok := h.clients[gameID]; ok {
			for _, c := range gameClients {
				// Pick the first available client
				anyClient = c
				break
			}
		}
		h.clientsMutex.RUnlock()

		if anyClient != nil {
			h.logger.Infof("[Hub handlePlayerDisconnected] Using client %s to trigger active players broadcast for game %s", anyClient.playerID, gameID)
			anyClient.handleGetActivePlayers()
		} else {
			h.logger.Warnf("[Hub handlePlayerDisconnected] No clients left in game %s to trigger active players broadcast.", gameID)
		}
	}()
}

// BroadcastToGame sends a message to all clients in a game
func (h *Hub) BroadcastToGame(gameID string, data []byte) {
	h.broadcast <- &BroadcastMessage{
		gameID: gameID,
		data:   data,
	}
}

// BroadcastToGameWithPriority sends a message to all clients in a game with specified priority
func (h *Hub) BroadcastToGameWithPriority(gameID string, message []byte, priority string) {
	// Get all clients for this game
	h.clientsMutex.RLock()
	defer h.clientsMutex.RUnlock()

	if gamePlayers, ok := h.clients[gameID]; ok {
		for playerID, client := range gamePlayers {
			// Send to each client with the specified priority
			switch priority {
			case PriorityHigh:
				select {
				case client.highPriorityQueue <- message:
					// Message sent successfully
				default:
					h.logger.Warnf("Failed to send high priority message to player %s (buffer full)", playerID)
				}
			case PriorityNormal:
				select {
				case client.normalPriorityQueue <- message:
					// Message sent successfully
				default:
					h.logger.Warnf("Failed to send normal priority message to player %s (buffer full)", playerID)
				}
			case PriorityLow:
				select {
				case client.lowPriorityQueue <- message:
					// Message sent successfully
				default:
					h.logger.Warnf("Failed to send low priority message to player %s (buffer full)", playerID)
				}
			default:
				// Default to normal priority
				select {
				case client.normalPriorityQueue <- message:
					// Message sent successfully
				default:
					h.logger.Warnf("Failed to send message to player %s (buffer full)", playerID)
				}
			}
		}
	}
}

// BroadcastCompleteState broadcasts the complete game state to all clients in a game
func (h *Hub) BroadcastCompleteState(gameID string, game *models.Game) {
	if game == nil {
		h.logger.Errorf("Cannot broadcast complete state: game is nil for gameID %s", gameID)
		return
	}

	h.logger.Infof("Broadcasting complete state for game %s with %d players", gameID, len(game.Players))

	// Create a complete state object with all necessary data
	completeState := map[string]interface{}{
		"type":        "complete_state_sync",
		"gameId":      gameID,
		"status":      string(game.Status),
		"currentTurn": game.CurrentTurn,
		"players":     game.Players,
		"turnOrder":   game.TurnOrder,
		"timestamp":   time.Now().Format(time.RFC3339),
	}

	// Log player token data for debugging
	for _, player := range game.Players {
		h.logger.Infof("Player token in complete state sync - Player: %s, Token: %s",
			player.ID, player.CharacterToken)
	}

	// Marshal to JSON
	stateJSON, err := json.Marshal(completeState)
	if err != nil {
		h.logger.Errorf("Failed to marshal complete state: %v", err)
		return
	}

	// Broadcast with high priority
	h.broadcast <- &BroadcastMessage{
		gameID: gameID,
		data:   stateJSON,
	}

	h.logger.Infof("Complete state sync broadcast sent for game %s", gameID)
}

// BroadcastToGameExcept sends a message to all clients in a game except one
func (h *Hub) BroadcastToGameExcept(gameID string, message []byte, excludePlayerID string) {
	h.broadcast <- &BroadcastMessage{
		gameID:          gameID,
		data:            message,
		excludePlayerID: excludePlayerID,
	}
}

// SendToPlayerWithPriority sends a message to a specific player in a game with priority
func (h *Hub) SendToPlayerWithPriority(gameID, playerID string, message []byte, priority string) bool {
	h.clientsMutex.RLock()
	defer h.clientsMutex.RUnlock()

	if gamePlayers, ok := h.clients[gameID]; ok {
		if client, ok := gamePlayers[playerID]; ok {
			// Determine which queue to use based on priority
			var targetQueue chan []byte
			var fallbackQueue chan []byte
			var lastResortQueue chan []byte

			switch priority {
			case PriorityHigh:
				targetQueue = client.highPriorityQueue
				// No fallback for high priority - these must be delivered
			case PriorityNormal:
				targetQueue = client.normalPriorityQueue
				fallbackQueue = client.highPriorityQueue // Try high priority if normal is full
			case PriorityLow:
				targetQueue = client.lowPriorityQueue
				fallbackQueue = client.normalPriorityQueue // Try normal if low is full
				lastResortQueue = client.highPriorityQueue // Last resort for critical low priority messages
			default:
				// Default to normal priority if not specified
				targetQueue = client.normalPriorityQueue
				fallbackQueue = client.highPriorityQueue
			}

			// Try primary queue
			select {
			case targetQueue <- message:
				return true
			default:
				// Primary queue is full
				//h.logger.Debugf("Client %s queue full for priority %s: Game ID: %s", priority, priority, gameID)

				// If this is high priority, try to make space by removing a message
				if priority == PriorityHigh {
					select {
					case <-targetQueue: // Remove oldest message
						// Try again
						select {
						case targetQueue <- message:
							return true
						default:
							h.logger.Warnf("High priority queue still full after clearing space: Game ID: %s", gameID)
						}
					default:
						// Couldn't clear space (shouldn't happen with non-empty buffer)
					}
				}

				// Try fallback queue if available
				if fallbackQueue != nil {
					select {
					case fallbackQueue <- message:
						//h.logger.Debugf("Successfully sent %s priority message using fallback queue: Game ID: %s", priority, gameID)
						return true
					default:
						// Fallback queue also full
					}
				}

				// Try last resort queue if available
				if lastResortQueue != nil {
					select {
					case lastResortQueue <- message:
						return true
					default:
						// All queues full, message dropped
						h.logger.Warnf("All queues full, message dropped: Game ID: %s, Priority: %s", gameID, priority)
					}
				}

				// Message couldn't be sent to any queue
				return false
			}
		}
	}

	return false
}

// SendToPlayer sends a message to a specific player in a game (legacy version for backward compatibility)
func (h *Hub) SendToPlayer(gameID, playerID string, message []byte) bool {
	// Default to normal priority for backward compatibility
	return h.SendToPlayerWithPriority(gameID, playerID, message, PriorityNormal)
}

// HandleWebSocketConnection handles a WebSocket connection
func (h *Hub) HandleWebSocketConnection(conn *websocket.Conn, gameID, playerID, sessionID string) {
	// We can't easily get the user agent from the WebSocket connection
	// in the gorilla/websocket implementation, so we'll just use a placeholder
	userAgent := "WebSocket Client"

	h.logger.Infof("New WebSocket connection: Game ID: %s, Player ID: %s, Session ID: %s, Time: %s",
		gameID, playerID, sessionID, time.Now().Format(time.RFC3339))

	// Check if this is a reconnection
	isReconnection := false
	previousSessionID := ""
	previousSession := h.getLatestSession(gameID, playerID)
	if previousSession != nil && previousSession.SessionID != sessionID {
		isReconnection = true
		previousSessionID = previousSession.SessionID
		h.logger.Infof("[RECONNECTION] Player %s reconnecting to game %s with new session %s (previous: %s)",
			playerID, gameID, sessionID, previousSessionID)
	}

	client := &Client{
		hub:                 h,
		conn:                conn,
		highPriorityQueue:   make(chan []byte, 16384), // Larger buffer for critical messages
		normalPriorityQueue: make(chan []byte, 16384), // Medium buffer for regular updates
		lowPriorityQueue:    make(chan []byte, 8192),  // Smaller buffer for non-critical messages
		playerID:            playerID,
		gameID:              gameID,
		sessionID:           sessionID,
		userAgent:           userAgent,
		isReconnection:      isReconnection,
		previousSessionID:   previousSessionID,
		connectedAt:         time.Now(),
	}

	// Register client
	h.register <- client
	h.logger.Infof("Client registered for game %s, player %s, session %s", gameID, playerID, sessionID)

	// If this is a reconnection, send a reconnection event to the client
	if isReconnection {
		// Create reconnection message
		reconnectMsg := map[string]interface{}{
			"type":            "reconnection_successful",
			"playerId":        playerID,
			"gameId":          gameID,
			"sessionId":       sessionID,
			"previousSession": previousSessionID,
			"timestamp":       time.Now().Format(time.RFC3339),
		}

		// Marshal to JSON
		msgBytes, err := json.Marshal(reconnectMsg)
		if err != nil {
			h.logger.Errorf("Failed to marshal reconnection message: %v", err)
		} else {
			// Send with high priority
			h.SendToPlayerWithPriority(gameID, playerID, msgBytes, PriorityHigh)

			// Also broadcast to other players that this player has reconnected
			reconnectBroadcastMsg := map[string]interface{}{
				"type":      "player_reconnected",
				"playerId":  playerID,
				"gameId":    gameID,
				"timestamp": time.Now().Format(time.RFC3339),
			}

			broadcastBytes, _ := json.Marshal(reconnectBroadcastMsg)
			h.BroadcastToGameExcept(gameID, broadcastBytes, playerID)
		}

		// Request full game state to be sent to the reconnected player
		if h.gameManager != nil {
			game, err := h.gameManager.GetGame(gameID)
			if err == nil && game != nil {
				h.BroadcastCompleteState(gameID, game)
			}
		}
	}

	// Start goroutines for reading and writing
	go client.readPump()
	go client.writePump()
}

// readPump pumps messages from the WebSocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c // Send client to unregister channel
		c.conn.Close()
	}()

	// Initialize lastPongTime to current time
	c.pongMutex.Lock()
	c.lastPongTime = time.Now()
	c.pongMutex.Unlock()

	c.conn.SetReadLimit(4096)                                // Max message size
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) // Adjust as needed
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		// Update lastPongTime when a pong is received
		c.pongMutex.Lock()
		c.lastPongTime = time.Now()
		c.pongMutex.Unlock()

		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.hub.logger.Warnf("WebSocket read error for Game: %s, Player: %s, Session: %s - Error: %v",
					c.gameID, c.playerID, c.sessionID, err)
			} else if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				c.hub.logger.Infof("WebSocket normal close for Game: %s, Player: %s, Session: %s - Code: %v",
					c.gameID, c.playerID, c.sessionID, err)
			} else {
				c.hub.logger.Warnf("WebSocket connection closed for Game: %s, Player: %s, Session: %s - Error: %v",
					c.gameID, c.playerID, c.sessionID, err)
			}
			break
		}

		// Handle incoming message
		c.handleMessage(message)
	}
}

// writePump pumps messages from the hub to the WebSocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second) // Ping interval
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	// Add a rate limiter to prevent sending too many messages too quickly
	rateLimiter := time.NewTicker(5 * time.Millisecond) // Max ~200 messages per second
	defer rateLimiter.Stop()

	// Helper function to send a message with proper error handling
	sendMessage := func(message []byte) bool {
		// Set a reasonable write deadline
		c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

		// Send message as a WebSocket frame
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			c.hub.logger.Errorf("Error writing message to WebSocket for Game: %s, Player: %s, Session: %s - Error: %v",
				c.gameID, c.playerID, c.sessionID, err)
			return false
		}
		return true
	}

	for {
		select {
		// Check high priority queue first
		case message, ok := <-c.highPriorityQueue:
			if !ok {
				// Channel was closed
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Send high priority message
			if !sendMessage(message) {
				return
			}

			// Process any additional high priority messages first
			processMessages(c, c.highPriorityQueue, rateLimiter, sendMessage)

		// Then check normal priority queue
		case message, ok := <-c.normalPriorityQueue:
			if !ok {
				// Channel was closed
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Send normal priority message
			if !sendMessage(message) {
				return
			}

			// First process any high priority messages that arrived
			if processMessages(c, c.highPriorityQueue, rateLimiter, sendMessage) {
				continue // Restart the select to prioritize high priority messages
			}

			// Then process additional normal priority messages
			processMessages(c, c.normalPriorityQueue, rateLimiter, sendMessage)

		// Finally check low priority queue
		case message, ok := <-c.lowPriorityQueue:
			if !ok {
				// Channel was closed
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Send low priority message
			if !sendMessage(message) {
				return
			}

			// First process any high priority messages that arrived
			if processMessages(c, c.highPriorityQueue, rateLimiter, sendMessage) {
				continue // Restart the select to prioritize high priority messages
			}

			// Then process any normal priority messages
			if processMessages(c, c.normalPriorityQueue, rateLimiter, sendMessage) {
				continue // Restart the select to prioritize normal priority messages
			}

			// Finally process additional low priority messages
			processMessages(c, c.lowPriorityQueue, rateLimiter, sendMessage)

		// Send ping to keep connection alive
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.hub.logger.Warnf("Error sending ping to WebSocket for Game: %s, Player: %s, Session: %s - Error: %v",
					c.gameID, c.playerID, c.sessionID, err)
				return
			}
		}
	}
}

// Helper function to process messages from a queue
// Returns true if any messages were processed
func processMessages(c *Client, queue chan []byte, rateLimiter *time.Ticker, sendFunc func([]byte) bool) bool {
	maxBatchSize := 10 // Process up to 10 messages at once
	processed := 0

	// Process messages in the queue, but with limits
	for processed < maxBatchSize {
		select {
		case queuedMsg, ok := <-queue:
			if !ok {
				// Channel was closed
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return true
			}

			// Wait for rate limiter before sending next message
			<-rateLimiter.C

			// Send message
			if !sendFunc(queuedMsg) {
				return true
			}
			processed++

		default:
			// No more messages in this queue
			return processed > 0
		}
	}

	return processed > 0
}

// toStringOrDefault converts an interface{} to a string, returning a default value if conversion fails
func toStringOrDefault(value interface{}, defaultValue string) string {
	if value == nil {
		return defaultValue
	}
	if str, ok := value.(string); ok {
		return str
	}
	return defaultValue
}

// handleMessage processes incoming WebSocket messages
func (c *Client) handleMessage(message []byte) {
	// Parse message and handle different event types

	// +++ Add Raw Message Logging +++
	// c.hub.logger.Infof("[HANDLE_MESSAGE_RAW] Received raw message from %s: %s", c.playerID, string(message))
	// +++

	// Add support for encoding/json
	var msg map[string]interface{}
	err := json.Unmarshal(message, &msg)
	if err != nil {
		// +++ Log Parsing Error +++
		// c.hub.logger.Infof("[HANDLE_MESSAGE_PARSE_ERR] Failed to parse message from %s: %v. Raw: %s", c.playerID, err, string(message))
		// +++
		return
	}

	// Extract message type from the deserialized message
	msgType, ok := msg["type"].(string)
	if !ok {
		// +++ Log Invalid Format Error +++
		// c.hub.logger.Infof("[HANDLE_MESSAGE_TYPE_ERR] Invalid message format - missing type from %s: %s", c.playerID, string(message))
		// +++
		return
	}

	// +++ Log Parsed Type +++
	// c.hub.logger.Infof("[HANDLE_MESSAGE_PARSED] Parsed message type '%s' from %s", msgType, c.playerID)
	// +++

	// Handle different message types
	switch msgType {
	case "verify_host":
		// Handle host verification
		c.handleVerifyHost(msg)
	case "game:start":
		// Handle game start request
		c.hub.logger.Infof("Game start request received from player %s for game %s", c.playerID, c.gameID)

		// Call GameManager to start the game
		// GameManager will handle host verification, state updates, and broadcasting
		err := c.hub.gameManager.StartGame(c.gameID, c.playerID)
		if err != nil {
			c.hub.logger.Warnf("Failed to start game %s requested by %s: %v", c.gameID, c.playerID, err)
			// Send an error message back to the requesting client
			errorMsg := map[string]interface{}{
				"type":    "error",
				"message": fmt.Sprintf("Failed to start game: %v", err),
			}
			errorJSON, _ := json.Marshal(errorMsg) // Ignore marshal error for simplicity here
			c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, errorJSON, PriorityHigh)
		} else {
			c.hub.logger.Infof("GameManager successfully started game %s", c.gameID)

			// Immediately update the game info cache to include the current turn information
			c.hub.updateGameInfoCache(c.gameID)

			// Log the updated game info for debugging
			gameInfo := c.hub.getGameInfo(c.gameID)
			if gameInfo != nil {
				currentTurn, ok := gameInfo["currentTurn"].(string)
				if ok {
					c.hub.logger.Infof("Game %s started with current turn: %s", c.gameID, currentTurn)
				} else {
					c.hub.logger.Warnf("Game %s started but currentTurn not found in cache", c.gameID)
				}
			} else {
				c.hub.logger.Warnf("Game %s started but game info not found in cache", c.gameID)
			}
		}
	case "player_joined":
		// Sent by a client when they join the game
		// Payload should include player details like name, token, etc.
		if playerInfo, ok := msg["player"].(map[string]interface{}); ok {
			// --- Add Detailed Logging ---
			// Log the raw playerInfo received before storing
			infoBytes, _ := json.Marshal(playerInfo) // Log the full structure
			_ = infoBytes                            // Assign to blank identifier to avoid unused variable error
			// c.hub.logger.Infof("[PLAYER_JOINED_HANDLER] Storing player info for %s: %s", c.playerID, string(infoBytes))
			// ---
			c.hub.storePlayerInfo(c.gameID, c.playerID, playerInfo)

			// --- Send acknowledgment back to the joining player ---
			ackMsg := map[string]interface{}{
				"type":    "player_joined_ack",
				"success": true,
				"player":  playerInfo, // Send back the confirmed player info
				"gameId":  c.gameID,
			}
			ackBytes, ackErr := json.Marshal(ackMsg)
			if ackErr == nil {
				// Send directly to the client who just joined
				c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, ackBytes, PriorityNormal)
				// c.hub.logger.Infof("Sent player_joined_ack to player %s", c.playerID)
			} else {
				c.hub.logger.Warnf("Failed to marshal player_joined_ack: %v", ackErr)
			}
			// ---

			// --- CRITICAL FIX: Broadcast the ENTIRE updated player list to ALL clients ---
			// This ensures all clients are in sync.
			c.hub.logger.Infof("Player %s joined, broadcasting updated player list for game %s", c.playerID, c.gameID)
			c.handleGetActivePlayers() // This will get the full list and broadcast it

		}
	case "get_active_players":
		// Handle request for active players list
		c.handleGetActivePlayers()
	case "roll_dice":
		// Log the dice roll request
		c.hub.logger.Infof("Dice roll request received from player %s in game %s", c.playerID, c.gameID)

		// Extract request ID if present
		requestID, _ := msg["requestId"].(string)
		if requestID != "" {
			c.hub.logger.Infof("Dice roll request ID: %s from player %s", requestID, c.playerID)
		}

		// First, check if it's this player's turn by getting the current game state
		game, err := c.hub.gameManager.GetGame(c.gameID)
		if err != nil {
			c.hub.logger.Errorf("Failed to get game state: %v", err)
			errorMsg := map[string]interface{}{
				"type":      "error",
				"message":   fmt.Sprintf("Failed to get game state: %v", err),
				"requestId": requestID,
			}
			errorJSON, _ := json.Marshal(errorMsg)
			c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, errorJSON, PriorityHigh)
			return
		}

		// Check if it's this player's turn
		if game.CurrentTurn != c.playerID {
			c.hub.logger.Errorf("Not player's turn. Current turn: %s, Player: %s", game.CurrentTurn, c.playerID)
			errorMsg := map[string]interface{}{
				"type":        "error",
				"message":     "Not your turn",
				"currentTurn": game.CurrentTurn,
				"requestId":   requestID,
			}
			errorJSON, _ := json.Marshal(errorMsg)
			c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, errorJSON, PriorityHigh)
			return
		}

		// Update the game info cache with the current turn information
		c.hub.updateGameInfoCache(c.gameID)

		// Create a roll dice action with the request ID in the payload
		payload := map[string]interface{}{
			"requestId": requestID,
			"timestamp": time.Now().UnixNano(),
		}

		action := models.GameAction{
			Type:      models.ActionTypeRollDice,
			PlayerID:  c.playerID,
			GameID:    c.gameID,
			Payload:   payload,
			Timestamp: time.Now(),
		}

		// Process the action through the game manager
		err = c.hub.gameManager.ProcessGameAction(action)
		if err != nil {
			c.hub.logger.Errorf("Failed to process dice roll: %v", err)
			// Send error message back to the client
			errorMsg := map[string]interface{}{
				"type":    "error",
				"message": fmt.Sprintf("Failed to roll dice: %v", err),
			}
			errorJSON, _ := json.Marshal(errorMsg)
			c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, errorJSON, PriorityHigh)
			return
		}

		// Get the updated game state
		game, err = c.hub.gameManager.GetGame(c.gameID)
		if err != nil {
			c.hub.logger.Errorf("Failed to get updated game state: %v", err)
			return
		}

		// Find the current player in the game
		var currentPlayer *models.Player
		for i := range game.Players {
			if game.Players[i].ID == c.playerID {
				currentPlayer = &game.Players[i]
				break
			}
		}

		if currentPlayer == nil {
			c.hub.logger.Errorf("Player %s not found in game %s", c.playerID, c.gameID)
			return
		}

		// Extract the actual dice values from the game manager logs
		// We need to parse the log message to get the dice values
		// The log message format is: "Player %s rolled %d and %d, now at position %d"

		// Get the most recent log entries for this game and player
		// For now, we'll use the position from the player object and calculate the dice values
		// based on the old position and new position

		// We don't need to calculate old and new positions here
		// The dice values will be retrieved from Redis

		// Calculate the dice values based on the position change
		// This is a simplified approach - in a real implementation, we would store the dice values
		// in the game state or pass them from the game manager to the hub

		// For now, we'll use a deterministic approach based on the player's position
		// This ensures the frontend and backend show the same dice values

		// Get the dice values from the game manager
		// The game manager logs: "Player %s rolled %d and %d, now at position %d"
		// We'll extract these values from the logs

		// For now, we'll use a simple approach to get the dice values
		// We'll modify the game manager to store the dice values in a temporary Redis key
		// that we can retrieve here

		// Try to get the dice values from Redis
		diceKey := fmt.Sprintf("game:%s:player:%s:lastdice", c.gameID, c.playerID)
		diceValues, err := c.hub.redisClient.Get(c.hub.ctx, diceKey).Result()

		var dice1, dice2 int

		if err == nil && diceValues != "" {
			// Parse the dice values from Redis
			parts := strings.Split(diceValues, ",")
			if len(parts) == 2 {
				dice1Val, err1 := strconv.Atoi(parts[0])
				dice2Val, err2 := strconv.Atoi(parts[1])

				if err1 == nil && err2 == nil {
					dice1 = dice1Val
					dice2 = dice2Val
					c.hub.logger.Infof("Retrieved dice values from Redis for player %s: %d and %d", c.playerID, dice1, dice2)
				} else {
					// Fallback to random dice values
					dice1 = 1 + diceRand.Intn(6)
					dice2 = 1 + diceRand.Intn(6)
					c.hub.logger.Infof("Failed to parse dice values from Redis, using random values for player %s: %d and %d", c.playerID, dice1, dice2)
				}
			} else {
				// Fallback to random dice values
				dice1 = 1 + diceRand.Intn(6)
				dice2 = 1 + diceRand.Intn(6)
				c.hub.logger.Infof("Invalid dice values format in Redis, using random values for player %s: %d and %d", c.playerID, dice1, dice2)
			}
		} else {
			// Fallback to random dice values
			dice1 = 1 + diceRand.Intn(6)
			dice2 = 1 + diceRand.Intn(6)
			c.hub.logger.Infof("No dice values found in Redis, using random values for player %s: %d and %d", c.playerID, dice1, dice2)
		}

		// Extract the request ID from the action payload if available
		var diceRequestID string
		if action.Payload != nil {
			if payload, ok := action.Payload.(map[string]interface{}); ok {
				if reqID, ok := payload["requestId"].(string); ok {
					diceRequestID = reqID
				}
			}
		}

		// Create a response message with the dice roll result
		response := map[string]interface{}{
			"type":      "dice_rolled",
			"playerId":  c.playerID,
			"position":  currentPlayer.Position,
			"balance":   currentPlayer.Balance,
			"timestamp": time.Now().Format(time.RFC3339),
			// Add dice values in both formats to ensure compatibility
			"dice":  []int{dice1, dice2},
			"dice1": dice1,
			"dice2": dice2,
			// Include the request ID if available
			"requestId": diceRequestID,
		}

		// Marshal to JSON
		responseJSON, err := json.Marshal(response)
		if err != nil {
			c.hub.logger.Errorf("Failed to marshal dice roll response: %v", err)
			return
		}

		// Broadcast the result to all players in the game
		c.hub.BroadcastToGame(c.gameID, responseJSON)
		c.hub.logger.Infof("Broadcasted dice roll result for player %s in game %s", c.playerID, c.gameID)
	case "update_player_info", "update_player", "set_player_token":
		// Extract player info from the message
		playerId, ok := msg["playerId"].(string)
		if !ok {
			c.hub.logger.Warnf("Invalid player update message format - missing playerId")
			return
		}

		// Get existing player info or create new
		playerInfo := c.hub.getPlayerInfo(c.gameID, playerId)
		if playerInfo == nil {
			playerInfo = make(map[string]interface{})
			playerInfo["id"] = playerId
		}

		// Update player info with token data
		// Check for token in different formats to ensure compatibility
		if token, ok := msg["token"].(string); ok && token != "" {
			playerInfo["token"] = token
			c.hub.logger.Infof("[TOKEN_UPDATE] Updated token for player %s in game %s: %s", playerId, c.gameID, token)
		}

		if characterToken, ok := msg["characterToken"].(string); ok && characterToken != "" {
			playerInfo["characterToken"] = characterToken
			c.hub.logger.Infof("[TOKEN_UPDATE] Updated characterToken for player %s in game %s: %s", playerId, c.gameID, characterToken)
		}

		if emoji, ok := msg["emoji"].(string); ok && emoji != "" {
			playerInfo["emoji"] = emoji
		}

		if color, ok := msg["color"].(string); ok && color != "" {
			playerInfo["color"] = color
		}

		if name, ok := msg["name"].(string); ok && name != "" {
			playerInfo["name"] = name
		}

		// Store updated player info
		c.hub.storePlayerInfo(c.gameID, playerId, playerInfo)
		c.hub.logger.Infof("[TOKEN_UPDATE] Stored updated player info for %s in game %s", playerId, c.gameID)

		// Enqueue the token update in the message queue for resilience
		if c.hub.messageQueue != nil {
			// Create a copy of the token data for the queue
			tokenData := make(map[string]interface{})
			for k, v := range playerInfo {
				tokenData[k] = v
			}

			// Enqueue the token update
			err := c.hub.messageQueue.EnqueuePlayerTokenUpdate(c.gameID, playerId, tokenData)
			if err != nil {
				c.hub.logger.Errorf("[TOKEN_UPDATE] Failed to enqueue token update: %v", err)
			} else {
				c.hub.logger.Infof("[TOKEN_UPDATE] Token update enqueued for player %s in game %s", playerId, c.gameID)
			}
		}

		// Update the player in the game manager's database
		if c.hub.gameManager != nil && c.gameID != "lobby" {
			// Get the game from the game manager
			game, err := c.hub.gameManager.GetGame(c.gameID)
			if err != nil {
				c.hub.logger.Warnf("[TOKEN_UPDATE] Failed to get game %s from manager: %v", c.gameID, err)
				return
			}
			found := false
			for i, player := range game.Players {
				if player.ID == playerId {
					// Update the player's token
					if token, ok := playerInfo["token"].(string); ok && token != "" {
						game.Players[i].CharacterToken = token
					} else if characterToken, ok := playerInfo["characterToken"].(string); ok && characterToken != "" {
						game.Players[i].CharacterToken = characterToken
					} else if emoji, ok := playerInfo["emoji"].(string); ok && emoji != "" {
						game.Players[i].CharacterToken = emoji
					}
					found = true
					// Note: Game persistence is handled by other mechanisms
					// The token update is applied to the in-memory game state
					c.hub.logger.Infof("[TOKEN_UPDATE] Updated player token for %s in game %s", playerId, c.gameID)
					break
				}
			}
			// Don't auto-register players here to prevent duplicates
			// Players should only be registered through proper join game flow
			if !found {
				c.hub.logger.Warnf("[TOKEN_UPDATE] Player %s not found in game %s - player should join through proper flow", playerId, c.gameID)
			}
		}

		// Broadcast the updated player info to all clients
		updateMsg := map[string]interface{}{
			"type":   "player_updated",
			"player": playerInfo,
		}
		updateJSON, err := json.Marshal(updateMsg)
		if err == nil {
			c.hub.BroadcastToGame(c.gameID, updateJSON)
			c.hub.logger.Infof("[TOKEN_UPDATE] Broadcasted player update for %s to all clients in game %s", playerId, c.gameID)
		}

		// Also update active players list
		go func() {
			time.Sleep(100 * time.Millisecond)
			c.handleGetActivePlayers()
		}()
	case "player_ready":
		// Extract player info from the message
		playerId, ok := msg["playerId"].(string)
		if !ok {
			c.hub.logger.Warnf("Invalid player_ready message format - missing playerId")
			return
		}

		isReady, ok := msg["isReady"].(bool)
		if !ok {
			c.hub.logger.Warnf("Invalid player_ready message format - missing isReady")
			return
		}

		// Extract optional message ID for tracking/debugging
		messageId := ""
		if msgId, ok := msg["messageId"].(string); ok {
			messageId = msgId
		}

		// Extract timestamp if available
		timestamp := time.Now().UnixNano() / int64(time.Millisecond)
		if ts, ok := msg["timestamp"].(float64); ok {
			timestamp = int64(ts)
		}

		c.hub.logger.Infof("[PLAYER_READY] Player %s ready status changed to: %v (messageId: %s, timestamp: %d)",
			playerId, isReady, messageId, timestamp)

		// --- Update Hub's internal playerInfo cache ---
		playerInfo := c.hub.getPlayerInfo(c.gameID, playerId)
		if playerInfo != nil {
			playerInfo["isReady"] = isReady
			playerInfo["lastReadyUpdate"] = timestamp // Track when this was last updated
			c.hub.storePlayerInfo(c.gameID, playerId, playerInfo)
			c.hub.logger.Infof("[PLAYER_READY] Updated existing player info for %s, isReady=%v", playerId, isReady)
		} else {
			c.hub.logger.Warnf("[PLAYER_READY] Player info not found for player %s in game %s. Creating default entry.", playerId, c.gameID)
			// Create a default player info map if not found
			defaultInfo := map[string]interface{}{
				"id":              playerId,
				"name":            fmt.Sprintf("Player_%s", playerId[:4]), // Use a default name
				"isReady":         isReady,                                // Set the received ready status
				"isHost":          false,                                  // Assume not host unless updated later
				"lastReadyUpdate": timestamp,                              // Track when this was created
				// Add other necessary default fields if required by frontend
				"token": "",
				"emoji": "👤",
				"color": "gray.500",
			}
			c.hub.storePlayerInfo(c.gameID, playerId, defaultInfo) // Store the default info with the correct ready status
			c.hub.logger.Infof("[PLAYER_READY] Created new player info for %s, isReady=%v", playerId, isReady)
		}
		// ---
		// Also update the player in the game manager's database if not present
		if c.hub.gameManager != nil {
			game, err := c.hub.gameManager.GetGame(c.gameID)
			if err == nil {
				found := false
				for i, player := range game.Players {
					if player.ID == playerId {
						if isReady {
							game.Players[i].Status = models.PlayerStatusReady
						} else {
							game.Players[i].Status = models.PlayerStatusConnected
						}
						found = true
						break
					}
				}
				if !found {
					// Don't auto-register players here to prevent duplicates
					// Players should only be registered through proper join game flow
					c.hub.logger.Warnf("[PLAYER_READY] Player %s not found in game %s - player should join through proper flow", playerId, c.gameID)
				}
			} else {
				c.hub.logger.Warnf("[PLAYER_READY] Failed to get game %s from manager: %v", c.gameID, err)
			}
		}

		// Broadcast player ready status to all clients with high priority
		responseJSON, err := json.Marshal(msg)
		if err != nil {
			c.hub.logger.Warnf("[PLAYER_READY] Failed to marshal player_ready response: %v", err)
			return
		}

		// OPTIMIZATION: Use BroadcastToGameWithPriority with HIGH priority
		c.hub.BroadcastToGameWithPriority(c.gameID, responseJSON, PriorityHigh)
		c.hub.logger.Infof("[PLAYER_READY] Broadcasted player_ready status to all clients in game %s with HIGH priority", c.gameID)

		// OPTIMIZATION: Reduce delay before sending active_players update
		go func() {
			// Reduced delay to improve responsiveness
			time.Sleep(50 * time.Millisecond)
			c.hub.logger.Infof("[PLAYER_READY] Sending active_players update after player_ready change for player %s", playerId)
			c.handleGetActivePlayers()
		}()
	case "get_game_state":
		// Handle request for current game state
		// c.hub.logger.Infof("Game state request received from player %s for game %s", c.playerID, c.gameID)

		// Get game info from storage
		gameInfo := c.hub.getGameInfo(c.gameID)
		if gameInfo == nil {
			gameInfo = make(map[string]interface{})
		}

		// Create response with game state
		response := map[string]interface{}{
			"type":   "game_state_update",
			"gameId": c.gameID,
			"state": map[string]interface{}{
				"gameId":   c.gameID,
				"gameInfo": gameInfo,
			},
		}

		// Set status based on game state
		stateMap := response["state"].(map[string]interface{})
		if status, ok := gameInfo["status"].(string); ok {
			stateMap["status"] = status
		} else {
			stateMap["status"] = "LOBBY" // Default to LOBBY if not set
		}

		// If game has been started, set status to ACTIVE
		if started, ok := gameInfo["gameStarted"].(bool); ok && started {
			stateMap["status"] = "ACTIVE"
		}

		// Marshal to JSON
		responseJSON, err := json.Marshal(response)
		if err != nil {
			c.hub.logger.Warnf("Failed to marshal game_state_update response: %v", err)
			return
		}

		// Send only to the requesting client
		c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, responseJSON, PriorityNormal)
	case "set_host":
		// Extract host ID from the message
		hostID, ok := msg["hostId"].(string)
		if !ok {
			c.hub.logger.Warnf("Invalid set_host message format - missing hostId: %s", string(message))
			return
		}

		// Extract game ID from the message or use the client's gameID
		gameID, ok := msg["gameId"].(string)
		if !ok {
			gameID = c.gameID
		}

		// Log the request
		// c.hub.logger.Infof("Set host request received: gameID=%s, hostID=%s", gameID, hostID)

		// No need to get game info here, just update the host ID directly

		// Update the host ID
		c.hub.UpdateHostID(gameID, hostID)

		// Send confirmation back to the client
		confirmationMsg := map[string]interface{}{
			"type":   "host_set_confirmed",
			"hostId": hostID,
			"gameId": gameID,
		}

		// Marshal to JSON
		confirmationJSON, err := json.Marshal(confirmationMsg)
		if err != nil {
			c.hub.logger.Warnf("Failed to marshal host_set_confirmed message: %v", err)
			return
		}

		// Send to the client
		c.hub.SendToPlayerWithPriority(gameID, c.playerID, confirmationJSON, PriorityNormal)

		// Also broadcast the updated list of active players to all clients
		c.handleGetActivePlayers()
	case "leave_game":
		// Handle explicit leave game request
		c.hub.logger.Infof("Player %s explicitly leaving game %s", c.playerID, c.gameID)

		// Call game manager to handle player disconnection
		// This will mark the player as disconnected and potentially clean up the game
		c.hub.gameManager.PlayerDisconnected(c.gameID, c.sessionID)

		// Send confirmation back to the leaving player
		leaveConfirmation := map[string]interface{}{
			"type":    "leave_game_confirmed",
			"gameId":  c.gameID,
			"success": true,
			"message": "Successfully left the game",
		}

		confirmationJSON, err := json.Marshal(leaveConfirmation)
		if err == nil {
			c.hub.SendToPlayerWithPriority(c.gameID, c.playerID, confirmationJSON, PriorityHigh)
		}

		// Close the client connection gracefully
		go func() {
			time.Sleep(100 * time.Millisecond) // Give time for the confirmation message to be sent
			if c.conn != nil {
				c.conn.Close()
			}
		}()
	}
}

// BroadcastToLobby sends a message to all lobby clients
func (h *Hub) BroadcastToLobby(message []byte) {
	h.clientsMutex.RLock()
	defer h.clientsMutex.RUnlock()

	lobbyClients, exists := h.clients["lobby"]
	if !exists || len(lobbyClients) == 0 {
		h.logger.Debugf("No lobby clients connected for broadcast")
		return
	}

	h.logger.Infof("Broadcasting to %d lobby clients", len(lobbyClients))

	for _, client := range lobbyClients {
		if client.isActive(90 * time.Second) {
			select {
			case client.normalPriorityQueue <- message:
				// Message sent successfully
			default:
				h.logger.Warnf("Failed to send message to lobby client %s: queue full", client.playerID)
			}
		}
	}
}
