package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/db/redis"
)

func main() {
	// Load .env file if it exists
	_ = godotenv.Load()

	// Get Redis URI from environment variable
	uri := os.Getenv("REDIS_URI")
	if uri == "" {
		fmt.Println("Error: REDIS_URI environment variable is not set")
		os.Exit(1)
	}

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create logger
	logger, _ := zap.NewDevelopment()
	sugar := logger.Sugar()
	defer logger.Sync()

	// Try to connect
	fmt.Println("Attempting to connect to Redis...")
	client, err := redis.Connect(ctx, uri, sugar)
	if err != nil {
		fmt.Printf("Failed to connect to Redis: %v\n", err)
		os.Exit(1)
	}
	defer client.Close()

	// Try to ping
	fmt.Println("Connection established, attempting to ping...")
	pong, err := client.Ping(ctx).Result()
	if err != nil {
		fmt.Printf("Failed to ping Redis: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Successfully connected to Redis! Response: %s\n", pong)

	// Try to set and get a value
	fmt.Println("\nTrying to set and get a test value...")
	
	testKey := "test_connection"
	testValue := fmt.Sprintf("Test value at %s", time.Now().Format(time.RFC3339))
	
	err = client.Set(ctx, testKey, testValue, 5*time.Minute).Err()
	if err != nil {
		fmt.Printf("Failed to set test value: %v\n", err)
		os.Exit(1)
	}
	
	// Try to get the value back
	val, err := client.Get(ctx, testKey).Result()
	if err != nil {
		fmt.Printf("Failed to get test value: %v\n", err)
		os.Exit(1)
	}

	if val == testValue {
		fmt.Println("Successfully set and retrieved test value!")
	} else {
		fmt.Printf("Warning: Retrieved value doesn't match: got %s, want %s\n", val, testValue)
	}
}
