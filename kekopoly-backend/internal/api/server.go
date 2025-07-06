package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/go-redis/redis/v8"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/api/handlers"
	"github.com/kekopoly/backend/internal/api/middleware/auth"
	"github.com/kekopoly/backend/internal/config"
	"github.com/kekopoly/backend/internal/db/mongodb"
	"github.com/kekopoly/backend/internal/game/manager"
	"github.com/kekopoly/backend/internal/game/websocket"
	"github.com/kekopoly/backend/internal/queue"
)

// CustomValidator is the request validator for Echo
type CustomValidator struct {
	validator *validator.Validate
}

// Validate validates the request
func (cv *CustomValidator) Validate(i interface{}) error {
	if err := cv.validator.Struct(i); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return nil
}

// RequestMetrics tracks metrics for API requests
type RequestMetrics struct {
	RequestCount      map[string]int
	DurationSum       map[string]float64
	GameActions       map[string]int
	ActiveConnections int
	mutex             sync.RWMutex // Add mutex for thread safety
}

// Server represents the API server
type Server struct {
	echo         *echo.Echo
	cfg          *config.Config
	gameManager  *manager.GameManager
	wsHub        *websocket.Hub
	logger       *zap.SugaredLogger
	metrics      *RequestMetrics
	mongoClient  *mongo.Client
	redisClient  *redis.Client
	messageQueue *queue.RedisQueue
	userStore    *mongodb.UserStore
}

// NewServer creates a new API server
func NewServer(cfg *config.Config, gameManager *manager.GameManager, logger *zap.SugaredLogger) *Server {
	// For backward compatibility, allow nil clients - they will be set later if needed
	return NewServerWithClients(cfg, gameManager, nil, nil, logger)
}

// NewServerWithClients creates a new API server with DB clients
func NewServerWithClients(cfg *config.Config, gameManager *manager.GameManager, mongoClient *mongo.Client, redisClient *redis.Client, logger *zap.SugaredLogger) *Server {
	e := echo.New()

	// Set up validator
	e.Validator = &CustomValidator{validator: validator.New()}

	// Initialize UserStore if mongoClient is available
	var userStore *mongodb.UserStore
	if mongoClient != nil {
		userStore = mongodb.NewUserStore(mongoClient.Database(cfg.MongoDB.Database))
		logger.Info("UserStore initialized")
	}

	// Initialize Redis queue if Redis is enabled and client is available
	var redisQueue *queue.RedisQueue
	if redisClient != nil {
		// Use the existing client to create the queue
		redisQueue = queue.NewRedisQueue(redisClient, logger.Desugar())
		logger.Info("Redis queue initialized using existing client")
	} else {
		logger.Info("Redis disabled, running in single-instance mode")
	}

	// Create WebSocket Hub with message queue
	wsHub := websocket.NewHub(context.Background(), gameManager, mongoClient, redisClient, logger, redisQueue)

	// Set the WebSocket hub in the game manager
	gameManager.SetWebSocketHub(wsHub)

	// Set the message queue in the game manager if available
	if redisQueue != nil {
		gameManager.SetMessageQueue(redisQueue)
		logger.Info("Message queue set in game manager")
	}

	// Initialize simple metrics
	metrics := &RequestMetrics{
		RequestCount:      make(map[string]int),
		DurationSum:       make(map[string]float64),
		GameActions:       make(map[string]int),
		ActiveConnections: 0,
	}

	server := &Server{
		echo:         e,
		cfg:          cfg,
		gameManager:  gameManager,
		wsHub:        wsHub,
		logger:       logger,
		metrics:      metrics,
		mongoClient:  mongoClient,
		redisClient:  redisClient,
		messageQueue: redisQueue,
		userStore:    userStore,
	}

	// Configure middleware
	server.configureMiddleware()

	// Configure routes
	server.configureRoutes()

	// Start WebSocket hub
	go wsHub.Run()

	// Note: Queue worker is started in main.go, not here
	// This prevents starting multiple workers

	return server
}

// configureMiddleware sets up Echo middleware
func (s *Server) configureMiddleware() {
	s.echo.Use(middleware.Logger())
	s.echo.Use(middleware.Recover())
	// Configure CORS with WebSocket support and proper preflight handling
	s.echo.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{echo.GET, echo.PUT, echo.POST, echo.DELETE, echo.OPTIONS, echo.PATCH},
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			echo.HeaderXRequestID,
			"Upgrade",
			"Connection",
			"Sec-WebSocket-Key",
			"Sec-WebSocket-Version",
			"Sec-WebSocket-Extensions",
			"Sec-WebSocket-Protocol",
			"Cache-Control",
			"X-Requested-With",
		},
		AllowCredentials: false, // Set to false for wildcard origins
		ExposeHeaders: []string{
			"Upgrade",
			"Connection",
			"Sec-WebSocket-Accept",
			"Sec-WebSocket-Protocol",
		},
		MaxAge: 86400, // 24 hours preflight cache
	}))
	s.echo.Use(middleware.RequestID())

	// Add metrics middleware
	s.echo.Use(s.metricsMiddleware)

	// Custom middleware to set request ID in context and structured logging
	s.echo.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			requestID := c.Response().Header().Get(echo.HeaderXRequestID)
			c.Set("requestID", requestID)

			// Add request ID to logger
			requestLogger := s.logger.With(
				"requestID", requestID,
				"method", c.Request().Method,
				"path", c.Request().URL.Path,
				"userAgent", c.Request().UserAgent(),
				"clientIP", c.RealIP(),
			)
			c.Set("logger", requestLogger)

			return next(c)
		}
	})
}

// metricsMiddleware records metrics for each request
func (s *Server) metricsMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		start := time.Now()

		// Execute the request
		err := next(c)

		// Record metrics after the request is processed
		duration := time.Since(start).Seconds()
		method := c.Request().Method
		path := c.Request().URL.Path
		status := c.Response().Status

		// Record request count and duration in our simple metrics map
		key := method + ":" + path + ":" + strconv.Itoa(status)

		// Lock before updating shared maps
		s.metrics.mutex.Lock()
		s.metrics.RequestCount[key]++
		s.metrics.DurationSum[key] += duration
		s.metrics.mutex.Unlock()

		return err
	}
}

// configureRoutes sets up API routes
func (s *Server) configureRoutes() {
	// Create handlers
	gameHandler := handlers.NewGameHandler(s.gameManager, s.wsHub, s.logger)
	authHandler := handlers.NewAuthHandler(s.cfg, s.userStore, s.logger)
	userHandler := handlers.NewUserHandler(s.logger)
	wsHandler := handlers.NewWebSocketHandler(s.wsHub, s.logger, s.cfg)
	healthHandler := handlers.NewHealthHandler(s.mongoClient, s.redisClient, s.logger)

	// Configure static file serving with proper MIME types
	staticConfig := middleware.StaticConfig{
		Root:   "frontend/dist",
		Index:  "index.html",
		HTML5:  true,
		Browse: false,
	}
	s.echo.Use(middleware.StaticWithConfig(staticConfig))

	// Add middleware to set correct Content-Type headers
	s.echo.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path
			switch {
			case strings.HasSuffix(path, ".js"):
				c.Response().Header().Set(echo.HeaderContentType, "application/javascript")
			case strings.HasSuffix(path, ".css"):
				c.Response().Header().Set(echo.HeaderContentType, "text/css")
			case strings.HasSuffix(path, ".png"):
				c.Response().Header().Set(echo.HeaderContentType, "image/png")
			case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
				c.Response().Header().Set(echo.HeaderContentType, "image/jpeg")
			case strings.HasSuffix(path, ".svg"):
				c.Response().Header().Set(echo.HeaderContentType, "image/svg+xml")
			}
			return next(c)
		}
	})

	// SPA routing - serve index.html for all unmatched routes
	s.echo.GET("/*", func(c echo.Context) error {
		// Skip API routes
		if strings.HasPrefix(c.Request().URL.Path, "/api/") {
			return echo.NotFoundHandler(c)
		}
		return c.File("frontend/dist/index.html")
	})

	// Start the ping/pong monitor for inactive client detection
	wsHandler.StartPingPongMonitor()

	// API version group
	apiV1 := s.echo.Group("/api/v1")

	// Authentication routes (no JWT required)
	authGroup := apiV1.Group("/auth")
	authGroup.POST("/register", authHandler.Register)
	authGroup.POST("/login", authHandler.Login)
	authGroup.GET("/refresh-token", authHandler.RefreshToken)
	authGroup.POST("/logout", authHandler.Logout)

	// JWT middleware for protected routes
	jwtMiddleware := auth.JWTMiddleware(s.cfg.JWT.Secret)

	// User routes (JWT required)
	userGroup := apiV1.Group("/user", jwtMiddleware)
	userGroup.GET("/profile", userHandler.GetProfile)
	userGroup.PATCH("/profile", userHandler.UpdateProfile)

	// Game routes (JWT required)
	gameGroup := apiV1.Group("/games", jwtMiddleware)
	gameGroup.POST("", gameHandler.CreateGame)
	gameGroup.GET("", gameHandler.ListGames)
	gameGroup.GET("/:gameId", gameHandler.GetGameDetails)
	gameGroup.POST("/:gameId/join", gameHandler.JoinGame)
	gameGroup.POST("/:gameId/leave", gameHandler.LeaveGame)
	gameGroup.POST("/:gameId/start", gameHandler.StartGame)
	gameGroup.GET("/:gameId/state", gameHandler.GetGameState)
	gameGroup.POST("/:gameId/sync", gameHandler.SyncGameState)
	gameGroup.POST("/cleanup", gameHandler.CleanupStaleGames)
	gameGroup.POST("/fix-codes", gameHandler.FixGamesWithoutCodes) // Fix for games without room codes

	// Game actions routes (JWT required)
	actionGroup := apiV1.Group("/games/:gameId/actions", jwtMiddleware)
	actionGroup.POST("/roll-dice", gameHandler.RollDice)
	actionGroup.POST("/buy-property", gameHandler.BuyProperty)
	actionGroup.POST("/pay-rent", gameHandler.PayRent)
	actionGroup.POST("/draw-card", gameHandler.DrawCard)
	actionGroup.POST("/use-card", gameHandler.UseCard)
	actionGroup.POST("/mortgage-property", gameHandler.MortgageProperty)
	actionGroup.POST("/unmortgage-property", gameHandler.UnmortgageProperty)
	actionGroup.POST("/build-engagement", gameHandler.BuildEngagement)
	actionGroup.POST("/build-checkmark", gameHandler.BuildCheckmark)
	actionGroup.POST("/end-turn", gameHandler.EndTurn)
	actionGroup.POST("/trade", gameHandler.InitiateTrade)
	actionGroup.POST("/trade/:tradeId/respond", gameHandler.RespondToTrade)
	actionGroup.POST("/special/:actionId", gameHandler.SpecialAction)

	// WebSocket routes (JWT required)
	wsGroup := s.echo.Group("/ws")
	wsGroup.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"},
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			"Upgrade",
			"Connection",
			"Sec-WebSocket-Key",
			"Sec-WebSocket-Version",
			"Sec-WebSocket-Extensions",
			"Sec-WebSocket-Protocol",
		},
		AllowMethods:     []string{"GET", "OPTIONS"},
		AllowCredentials: true,
		ExposeHeaders: []string{
			"Upgrade",
			"Connection",
			"Sec-WebSocket-Accept",
			"Sec-WebSocket-Protocol",
		},
	}))

	// Apply JWT middleware to WebSocket routes
	wsGroup.Use(jwtMiddleware)
	wsGroup.GET("/:gameId", wsHandler.HandleConnection)
	wsGroup.GET("/lobby", wsHandler.HandleLobbyConnection)

	// Health check endpoints (no auth required)
	s.echo.GET("/health", healthHandler.Check)
	s.echo.GET("/health/detailed", healthHandler.DetailedCheck)

	// Metrics endpoint - simplified version that returns our basic metrics
	s.echo.GET("/metrics", func(c echo.Context) error {
		s.metrics.mutex.RLock()
		defer s.metrics.mutex.RUnlock()
		return c.JSON(http.StatusOK, s.metrics)
	})
}

// Start starts the API server
func (s *Server) Start() error {
	address := s.cfg.Server.Host + ":" + strconv.Itoa(s.cfg.Server.Port)
	return s.echo.Start(address)
}

// Shutdown gracefully shuts down the API server
func (s *Server) Shutdown(ctx context.Context) error {
	// Close the message queue if it exists
	if s.messageQueue != nil {
		if err := s.messageQueue.Close(); err != nil {
			s.logger.Errorf("Failed to close message queue: %v", err)
		} else {
			s.logger.Info("Message queue closed")
		}
	}

	// Shutdown the Echo server
	return s.echo.Shutdown(ctx)
}
