package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"go.uber.org/zap"
)

// UserHandler handles user-related requests
type UserHandler struct {
	logger *zap.SugaredLogger
}

// NewUserHandler creates a new UserHandler
func NewUserHandler(logger *zap.SugaredLogger) *UserHandler {
	return &UserHandler{
		logger: logger,
	}
}

// UserProfileResponse represents a user profile response
type UserProfileResponse struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	Email    string `json:"email"`
	AvatarURL     string `json:"avatarUrl,omitempty"`
}

// UpdateProfileRequest represents a profile update request
type UpdateProfileRequest struct {
	Username  string `json:"username,omitempty" validate:"omitempty,min=3,max=20"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

// GetProfile gets the user's profile
func (h *UserHandler) GetProfile(c echo.Context) error {
	// Get user ID from context (set by JWT middleware)
	userID := c.Get("userID").(string)

	// In a real implementation, we would fetch user profile from database
	// For this simplified implementation, we'll just return mock data
	return c.JSON(http.StatusOK, UserProfileResponse{
		UserID:   userID,
		Username: "player_" + userID[:6],
		Email:    "user@example.com",
	})
}

// UpdateProfile updates the user's profile
func (h *UserHandler) UpdateProfile(c echo.Context) error {
	// Get user ID from context (set by JWT middleware)
	userID := c.Get("userID").(string)

	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request body")
	}

	if err := c.Validate(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	// In a real implementation, we would update user profile in database
	// For this simplified implementation, we'll just return success
	h.logger.Infof("User %s updated profile", userID)

	return c.NoContent(http.StatusNoContent)
}
