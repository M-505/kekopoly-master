package handlers

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/api/middleware/auth"
	"github.com/kekopoly/backend/internal/config"
	"github.com/kekopoly/backend/internal/db/mongodb"
	"github.com/kekopoly/backend/internal/models"
)

// AuthHandler handles authentication-related requests
type AuthHandler struct {
	cfg       *config.Config
	logger    *zap.SugaredLogger
	userStore *mongodb.UserStore
}

// NewAuthHandler creates a new AuthHandler
func NewAuthHandler(cfg *config.Config, userStore *mongodb.UserStore, logger *zap.SugaredLogger) *AuthHandler {
	return &AuthHandler{
		cfg:       cfg,
		logger:    logger,
		userStore: userStore,
	}
}

// RegisterRequest represents a user registration request
type RegisterRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Username string `json:"username" validate:"required,min=3,max=20"`
	Password string `json:"password" validate:"required,min=8"`
}

// LoginRequest represents a user login request
type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

// AuthResponse represents an authentication response
type AuthResponse struct {
	UserID   string `json:"userId"`
	Username string `json:"username,omitempty"`
	Email    string `json:"email,omitempty"`
	Token    string `json:"token"`
}

// Register handles user registration
func (h *AuthHandler) Register(c echo.Context) error {
	var req RegisterRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if err := c.Validate(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	ctx := c.Request().Context()

	// Check if user already exists
	_, err := h.userStore.GetUserByEmail(ctx, req.Email)
	if err == nil {
		return echo.NewHTTPError(http.StatusConflict, "User with this email already exists")
	}
	if err != mongo.ErrNoDocuments {
		h.logger.Errorf("Error checking for existing user by email: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to register user")
	}

	_, err = h.userStore.GetUserByUsername(ctx, req.Username)
	if err == nil {
		return echo.NewHTTPError(http.StatusConflict, "User with this username already exists")
	}
	if err != mongo.ErrNoDocuments {
		h.logger.Errorf("Error checking for existing user by username: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to register user")
	}

	// Create and store user
	user := &models.User{
		Username:  req.Username,
		Email:     req.Email,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := user.HashPassword(req.Password); err != nil {
		h.logger.Errorf("Failed to hash password: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to register user")
	}

	if err := h.userStore.CreateUser(ctx, user); err != nil {
		h.logger.Errorf("Failed to create user: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to register user")
	}

	// Generate JWT token
	token, err := auth.GenerateJWT(user.ID.Hex(), h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
	if err != nil {
		h.logger.Errorf("Failed to generate JWT: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	return c.JSON(http.StatusCreated, AuthResponse{
		UserID:   user.ID.Hex(),
		Username: user.Username,
		Email:    user.Email,
		Token:    token,
	})
}

// Login handles user login
func (h *AuthHandler) Login(c echo.Context) error {
	var req LoginRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if err := c.Validate(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	ctx := c.Request().Context()

	// Retrieve user from database
	user, err := h.userStore.GetUserByEmail(ctx, req.Email)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return echo.NewHTTPError(http.StatusUnauthorized, "Invalid email or password")
		}
		h.logger.Errorf("Failed to get user by email: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to log in")
	}

	// Verify password hash
	if !user.CheckPassword(req.Password) {
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid email or password")
	}

	// Generate JWT token
	token, err := auth.GenerateJWT(user.ID.Hex(), h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
	if err != nil {
		h.logger.Errorf("Failed to generate JWT: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	return c.JSON(http.StatusOK, AuthResponse{
		UserID:   user.ID.Hex(),
		Username: user.Username,
		Email:    user.Email,
		Token:    token,
	})
}

// RefreshToken handles token refresh
func (h *AuthHandler) RefreshToken(c echo.Context) error {
	// Get user ID from context (set by JWT middleware)
	userID := c.Get("userID").(string)

	// Generate new token
	token, err := auth.GenerateJWT(userID, h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
	if err != nil {
		h.logger.Errorf("Failed to generate JWT: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	return c.JSON(http.StatusOK, map[string]string{
		"token": token,
	})
}

// Logout handles user logout
func (h *AuthHandler) Logout(c echo.Context) error {
	// In a real implementation, we would:
	// 1. Add the token to a blacklist
	// 2. Possibly invalidate any sessions

	// For this simplified implementation, we'll just return success
	return c.NoContent(http.StatusNoContent)
}
