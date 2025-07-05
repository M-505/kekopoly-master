package handlers

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/config"
	"github.com/kekopoly/backend/internal/api/middleware/auth"
)

// AuthHandler handles authentication-related requests
type AuthHandler struct {
	cfg    *config.Config
	logger *zap.SugaredLogger
}

// NewAuthHandler creates a new AuthHandler
func NewAuthHandler(cfg *config.Config, logger *zap.SugaredLogger) *AuthHandler {
	return &AuthHandler{
		cfg:    cfg,
		logger: logger,
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

	// In a real implementation, we would:
	// 1. Check if user already exists
	// 2. Hash the password
	// 3. Store user in database

	// For this simplified implementation, we'll just generate a token
	userID := uuid.New().String()

	// Generate JWT token
	token, err := auth.GenerateJWT(userID, h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
	if err != nil {
		h.logger.Errorf("Failed to generate JWT: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	return c.JSON(http.StatusCreated, AuthResponse{
		UserID:   userID,
		Username: req.Username,
		Email:    req.Email,
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

	// In a real implementation, we would:
	// 1. Retrieve user from database
	// 2. Verify password hash

	// For this simplified implementation, we'll just generate a token
	userID := uuid.New().String() // In a real implementation, this would be the actual user ID

	// Generate JWT token
	token, err := auth.GenerateJWT(userID, h.cfg.JWT.Secret, h.cfg.JWT.Expiration)
	if err != nil {
		h.logger.Errorf("Failed to generate JWT: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to generate token")
	}

	return c.JSON(http.StatusOK, AuthResponse{
		UserID: userID,
		Email:  req.Email,
		Token:  token,
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
