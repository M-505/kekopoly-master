package mongodb

import (
	"context"

	"github.com/kekopoly/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// UserStore handles database operations for users
type UserStore struct {
	users *mongo.Collection
}

// NewUserStore creates a new UserStore
func NewUserStore(db *mongo.Database) *UserStore {
	return &UserStore{
		users: db.Collection("users"),
	}
}

// CreateUser inserts a new user into the database
func (s *UserStore) CreateUser(ctx context.Context, user *models.User) error {
	_, err := s.users.InsertOne(ctx, user)
	return err
}

// GetUserByEmail finds a user by their email address
func (s *UserStore) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := s.users.FindOne(ctx, bson.M{"email": email}).Decode(&user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserByUsername finds a user by their username
func (s *UserStore) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	var user models.User
	err := s.users.FindOne(ctx, bson.M{"username": username}).Decode(&user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserByID finds a user by their ID
func (s *UserStore) GetUserByID(ctx context.Context, id primitive.ObjectID) (*models.User, error) {
	var user models.User
	err := s.users.FindOne(ctx, bson.M{"_id": id}).Decode(&user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}
