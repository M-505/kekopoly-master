package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
	"go.uber.org/zap"

	"github.com/kekopoly/backend/internal/db/mongodb"
)

func main() {
	// Load .env file if it exists
	_ = godotenv.Load()

	// Get MongoDB URI from environment variable
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		fmt.Println("Error: MONGODB_URI environment variable is not set")
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
	fmt.Println("Attempting to connect to MongoDB...")
	client, err := mongodb.Connect(ctx, uri, sugar)
	if err != nil {
		fmt.Printf("Failed to connect to MongoDB: %v\n", err)
		os.Exit(1)
	}
	defer client.Disconnect(context.Background())

	// Try to ping
	fmt.Println("Connection established, attempting to ping...")
	err = client.Ping(ctx, nil)
	if err != nil {
		fmt.Printf("Failed to ping MongoDB: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Successfully connected to MongoDB!")

	// Try to access the database
	dbName := "kekopoly" // Replace with your actual database name
	fmt.Printf("\nTrying to access database: %s\n", dbName)
	
	db := client.Database(dbName)
	
	// Try to create a test collection and insert a document
	fmt.Println("Attempting to create a test collection...")
	testColl := db.Collection("test_connection")
	
	doc := map[string]interface{}{
		"test": "connection",
		"timestamp": time.Now(),
	}
	
	_, err = testColl.InsertOne(ctx, doc)
	if err != nil {
		fmt.Printf("Failed to insert test document: %v\n", err)
		os.Exit(1)
	}
	
	fmt.Println("Successfully inserted test document!")
	
	// Now try to list collections
	collections, err := db.ListCollectionNames(ctx, nil)
	if err != nil {
		fmt.Printf("Failed to list collections: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\nCollections in database:")
	if len(collections) == 0 {
		fmt.Println("No collections found. Database is empty or not initialized.")
	} else {
		for _, collection := range collections {
			fmt.Printf("- %s\n", collection)
		}
	}
}
