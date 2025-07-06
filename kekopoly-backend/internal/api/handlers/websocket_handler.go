package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/api/middleware/auth" // Import auth claims
	"github.com/kekopoly/backend/internal/config"              // Import config
	gameWs "github.com/kekopoly/backend/internal/game/websocket"
)

// WebSocketHandler handles WebSocket connections
type WebSocketHandler struct {
	hub    *gameWs.Hub
	logger *zap.SugaredLogger
	cfg    *config.Config // Added config field
}

// NewWebSocketHandler creates a new WebSocketHandler
func NewWebSocketHandler(hub *gameWs.Hub, logger *zap.SugaredLogger, cfg *config.Config) *WebSocketHandler { // Added cfg parameter
	return &WebSocketHandler{
		hub:    hub,
		logger: logger,
		cfg:    cfg, // Store config
	}
}

// Upgrader is used to upgrade HTTP connections to WebSocket connections
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow connections from any origin
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// StartPingPongMonitor starts a background goroutine that periodically checks for inactive clients
func (h *WebSocketHandler) StartPingPongMonitor() {
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				// Check for inactive clients every minute
				// h.hub.CheckInactiveClients(90 * time.Second)
			}
		}
	}()

	h.logger.Info("Started ping/pong monitor for inactive client detection")
}

// validateToken manually validates the JWT from query param
func (h *WebSocketHandler) validateToken(tokenString string) (*auth.Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("token string is empty")
	}
	if h.cfg == nil || h.cfg.JWT.Secret == "" {
		return nil, fmt.Errorf("JWT secret not configured")
	}

	token, err := jwt.ParseWithClaims(tokenString, &auth.Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(h.cfg.JWT.Secret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("token parsing failed: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(*auth.Claims)
	if !ok {
		return nil, fmt.Errorf("failed to extract claims")
	}

	return claims, nil
}

// HandleConnection handles WebSocket connections
func (h *WebSocketHandler) HandleConnection(c echo.Context) error {
	h.logger.Infof("WebSocket connection attempt received")

	// Get game ID from path parameter and normalize to lowercase
	gameID := strings.ToLower(c.Param("gameId"))
	h.logger.Infof("Original gameID: %s, Normalized: %s", c.Param("gameId"), gameID)
	if gameID == "" {
		h.logger.Warn("Connection attempt missing gameId")
		return echo.NewHTTPError(http.StatusBadRequest, "Missing game ID")
	}
	h.logger.Infof("Connection for game: %s", gameID)

	// Special handling for lobby connections
	if gameID == "lobby" {
		return h.HandleLobbyConnection(c)
	}

	var userID string

	// For WebSocket connections, prioritize query parameter token
	tokenString := c.QueryParam("token")
	if tokenString != "" {
		claims, err := h.validateToken(tokenString)
		if err != nil {
			h.logger.Warnf("WebSocket connection rejected: Token validation failed: %v", err)
			return echo.NewHTTPError(http.StatusUnauthorized, fmt.Sprintf("Unauthorized: Invalid token (%v)", err))
		}
		userID = claims.UserID
		h.logger.Infof("UserID from query parameter token: %s", userID)
	} else if id, ok := c.Get("userID").(string); ok && id != "" {
		// Fallback to JWT middleware context if available
		userID = id
		h.logger.Infof("UserID from JWT middleware: %s", userID)
	} else {
		h.logger.Warn("WebSocket connection rejected: No valid user ID found")
		return echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized: Missing or invalid token")
	}
	// --- End Token Validation ---

	// Get session ID from query parameter
	sessionID := c.QueryParam("sessionId")
	if sessionID == "" {
		h.logger.Warn("Missing sessionID in query")
		return echo.NewHTTPError(http.StatusBadRequest, "Missing session ID")
	}
	h.logger.Infof("SessionID: %s", sessionID)

	// Log complete connection parameters
	h.logger.Infof("Attempting to upgrade connection - GameID: %s (lowercase), PlayerID: %s, SessionID: %s",
		gameID, userID, sessionID)

	// Upgrade HTTP connection to WebSocket with generous CORS settings
	upgrader.CheckOrigin = func(r *http.Request) bool {
		return true // Accept all origins for now
	}

	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		h.logger.Errorf("Failed to upgrade connection: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to establish WebSocket connection")
	}

	h.logger.Infof("Connection successfully upgraded to WebSocket")

	// Handle WebSocket connection
	h.hub.HandleWebSocketConnection(conn, gameID, userID, sessionID)
	h.logger.Infof("WebSocket connection handed to hub")

	return nil
}

// HandleLobbyConnection handles WebSocket connections specifically for the lobby
func (h *WebSocketHandler) HandleLobbyConnection(c echo.Context) error {
	h.logger.Infof("Lobby WebSocket connection attempt received")

	var userID string
	// Try to get userID from context first (set by JWT middleware)
	if id, ok := c.Get("userID").(string); ok && id != "" {
		userID = id
		h.logger.Infof("Lobby UserID found in context: %s", userID)
	} else {
		// Fallback: Try to get token from Authorization header
		authHeader := c.Request().Header.Get("Authorization")
		var tokenString string

		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenString = strings.TrimPrefix(authHeader, "Bearer ")
			h.logger.Infof("Found token in Authorization header")
		} else {
			// Final fallback: Try query parameter token
			tokenString = c.QueryParam("token")
			if tokenString != "" {
				h.logger.Infof("Found token in query parameter")
			}
		}

		if tokenString == "" {
			h.logger.Warn("No token found in Authorization header or query parameter")
			return echo.NewHTTPError(http.StatusUnauthorized, "Unauthorized: No token provided")
		}

		claims, err := h.validateToken(tokenString)
		if err != nil {
			h.logger.Warnf("Token validation failed: %v", err)
			return echo.NewHTTPError(http.StatusUnauthorized, fmt.Sprintf("Unauthorized: Invalid token (%v)", err))
		}
		userID = claims.UserID
		h.logger.Infof("UserID obtained from token: %s", userID)
	}

	// Get session ID from query parameter
	sessionID := c.QueryParam("sessionId")
	if sessionID == "" {
		h.logger.Warn("Missing sessionID in query for lobby connection")
		return echo.NewHTTPError(http.StatusBadRequest, "Missing session ID")
	}
	h.logger.Infof("Lobby SessionID: %s", sessionID)

	// Log complete connection parameters
	h.logger.Infof("Attempting to upgrade lobby connection - PlayerID: %s, SessionID: %s", userID, sessionID)

	// Upgrade HTTP connection to WebSocket
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		h.logger.Errorf("Failed to upgrade lobby connection: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to establish WebSocket connection")
	}

	h.logger.Infof("Lobby connection successfully upgraded to WebSocket")

	// Handle WebSocket connection using special lobby game ID prefix
	h.hub.HandleWebSocketConnection(conn, "lobby", userID, sessionID)
	h.logger.Infof("Lobby WebSocket connection handed to hub")

	return nil
}
