package main

import (
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the JWT claims - same as in the auth package
type Claims struct {
	UserID string `json:"userId"`
	jwt.RegisteredClaims
}

func main() {
	// Check for JWT_SECRET environment variable first, then fall back to config default
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "SkipTheSecret!!!!"
		fmt.Println("Using default JWT secret from config file")
	} else {
		fmt.Println("Using JWT_SECRET environment variable")
	}

	userID := "demo"
	expirationHours := 24

	// Create expiration time
	expirationTime := time.Now().Add(time.Duration(expirationHours) * time.Hour)

	// Create claims
	claims := &Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	// Create token with claims
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Sign token with secret
	tokenString, err := token.SignedString([]byte(secret))
	if err != nil {
		fmt.Printf("Error generating token: %v\n", err)
		return
	}

	fmt.Printf("Valid JWT token for user 'demo':\n%s\n", tokenString)
}
