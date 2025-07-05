# Kekopoly - Multiplayer Monopoly Game

Kekopoly is a multiplayer online version of Monopoly with a meme-themed twist. Built with a Go backend and React frontend, it supports real-time gameplay through WebSocket connections.

## 🎮 How to Play

### Game Overview
Kekopoly follows traditional Monopoly rules with meme-themed properties and characters. Players move around the board, buy properties, collect rent, and try to bankrupt their opponents.

### Getting Started
1. **Create an Account**: Register with a username and password
2. **Join the Lobby**: Browse available games or create a new one
3. **Create or Join a Game**: 
   - Create: Set game name and max players (2-8)
   - Join: Enter a room code or click on an available game
4. **Choose Your Character**: Select from 8 meme-themed tokens:
   - 🐸 Pepe
   - 💪 Chad
   - 😢 Wojak
   - 🐕 Doge
   - 🐱 Cat
   - 👹 Troll
   - 🌕 Moon
   - 🚀 Rocket

### Game Flow
1. **Wait for Players**: Host waits for 2-8 players to join
2. **Ready Up**: All players mark themselves as ready
3. **Start Game**: Host starts the game when everyone is ready
4. **Take Turns**: Players take turns rolling dice and moving around the board
5. **Buy Properties**: Land on unowned properties to purchase them
6. **Pay Rent**: Pay rent when landing on other players' properties
7. **Manage Money**: Start with $1500, manage your finances wisely
8. **Win Condition**: Last player standing with money wins!

### Game Rules
- **Starting Money**: Each player starts with $1500
- **Turn Order**: Determined randomly at game start
- **Dice Rolling**: Roll two dice, move clockwise around the board
- **Property Purchase**: Buy unowned properties you land on
- **Rent Collection**: Collect rent from other players landing on your properties
- **Special Spaces**: 
  - GO: Collect $200 when passing
  - Jail: Get sent to jail or just visiting
  - Cards: Draw Meme, Redpill, or Eegi cards for special effects
- **Doubles**: Roll again if you roll doubles (up to 3 times)
- **Bankruptcy**: Eliminated when you can't pay debts

### Controls
- **Roll Dice**: Click the dice button on your turn
- **Buy Property**: Click "Buy" when landing on available properties
- **End Turn**: Automatically ends after completing actions
- **Chat**: Use the chat feature to communicate with other players

## 🛠 Technology Stack

### Backend (Go)
- **Framework**: Go with Gin web framework
- **Database**: MongoDB for game state persistence
- **Real-time**: WebSocket connections for live gameplay
- **Authentication**: JWT tokens
- **Cache**: Redis for session management

### Frontend (JavaScript/React)
- **Framework**: React 18 with Vite
- **State Management**: Redux Toolkit
- **UI Components**: Chakra UI
- **Real-time**: WebSocket client for game updates
- **Routing**: React Router

## 🚀 Setup Instructions

### Prerequisites
- **Go**: Version 1.19 or higher
- **Node.js**: Version 16 or higher
- **MongoDB**: Version 5.0 or higher
- **Redis**: Version 6.0 or higher (optional, for session caching)

### Backend Setup (Go)

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd kekopoly-master/kekopoly-backend
   ```

2. **Install Dependencies**
   ```bash
   go mod download
   ```

3. **Configuration**
   ```bash
   # Copy example config
   cp config/config.example.yaml config/config.yaml
   
   # Edit config.yaml with your settings
   nano config/config.yaml
   ```

4. **Database Setup**
   ```bash
   # Start MongoDB
   sudo systemctl start mongod
   
   # Start Redis (optional)
   sudo systemctl start redis
   ```

5. **Run the Backend**
   ```bash
   # Development mode
   go run cmd/server/main.go
   
   # Or build and run
   go build -o kekopoly-server cmd/server/main.go
   ./kekopoly-server
   ```

   The backend will start on `http://localhost:8080`

### Frontend Setup (JavaScript/React)

1. **Navigate to Frontend Directory**
   ```bash
   cd ../kekopoly-frontend
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   ```bash
   # Create environment file
   cp .env.example .env
   
   # Edit with your backend URL
   echo "VITE_API_BASE_URL=http://localhost:8080" > .env
   ```

4. **Run the Frontend**
   ```bash
   # Development mode
   npm run dev
   
   # Or build for production
   npm run build
   npm run preview
   ```

   The frontend will start on `http://localhost:5173`

### Docker Setup (Alternative)

1. **Backend with Docker**
   ```bash
   cd kekopoly-backend
   docker build -t kekopoly-backend .
   docker run -p 8080:8080 kekopoly-backend
   ```

2. **Frontend with Docker**
   ```bash
   cd kekopoly-frontend
   docker build -t kekopoly-frontend .
   docker run -p 5173:5173 kekopoly-frontend
   ```

3. **Full Stack with Docker Compose**
   ```bash
   # From project root
   docker-compose up -d
   ```

## 🏗 Project Structure

### Backend Structure
```
kekopoly-backend/
├── cmd/
│   ├── server/          # Main server entry point
│   ├── testdb/          # Database test utilities
│   └── testserver/      # Server test utilities
├── internal/
│   ├── api/             # HTTP handlers and routes
│   ├── auth/            # Authentication logic
│   ├── config/          # Configuration management
│   ├── db/              # Database connections (MongoDB/Redis)
│   ├── game/            # Game logic and models
│   │   ├── manager/     # Game state management
│   │   ├── models/      # Data models
│   │   └── websocket/   # WebSocket handlers
│   ├── models/          # Shared data models
│   └── queue/           # Background job processing
├── config/              # Configuration files
└── docs/                # Documentation
```

### Frontend Structure
```
kekopoly-frontend/
├── src/
│   ├── components/      # React components
│   │   ├── auth/        # Login/register components
│   │   ├── lobby/       # Game lobby components
│   │   ├── game/        # Game board components
│   │   ├── board/       # Board rendering
│   │   ├── cards/       # Game cards
│   │   ├── dice/        # Dice components
│   │   ├── player/      # Player components
│   │   └── properties/  # Property components
│   ├── services/        # API and WebSocket services
│   ├── store/           # Redux store and slices
│   ├── utils/           # Utility functions
│   ├── styles/          # CSS styles
│   └── assets/          # Images and static files
├── public/              # Public assets
└── docs/                # Frontend documentation
```

## 🔧 Configuration

### Backend Configuration (config.yaml)
```yaml
server:
  port: 8080
  host: "0.0.0.0"
  
database:
  mongodb:
    uri: "mongodb://localhost:27017"
    database: "kekopoly"
  redis:
    addr: "localhost:6379"
    password: ""
    db: 0

auth:
  jwt_secret: "your-secret-key"
  token_expiry: "24h"

game:
  max_players: 8
  turn_timeout: "300s"
```

### Frontend Environment Variables
```bash
# API Configuration
VITE_API_BASE_URL=http://localhost:8080

# WebSocket Configuration  
VITE_WS_URL=ws://localhost:8080/ws

# Environment
VITE_NODE_ENV=development
```

## 🧪 Testing

### Backend Tests
```bash
cd kekopoly-backend

# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Test specific package
go test ./internal/game/manager
```

### Frontend Tests
```bash
cd kekopoly-frontend

# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run e2e tests
npm run test:e2e
```

## 🐛 Troubleshooting

### Common Issues

1. **"Failed to join game" Error**
   - Check if MongoDB is running
   - Verify backend logs for detailed error messages
   - Ensure room code is correct

2. **Players Can't See Each Other**
   - Check WebSocket connection in browser dev tools
   - Verify JWT tokens are valid
   - Clear browser localStorage and refresh

3. **Redirect Loops**
   - Clear browser localStorage: `localStorage.clear()`
   - Check if game exists in database
   - Verify API endpoints are correct

4. **Connection Issues**
   - Check firewall settings
   - Verify MongoDB/Redis are accessible
   - Check CORS configuration in backend

### Debug Mode
```bash
# Backend debug logs
LOG_LEVEL=debug go run cmd/server/main.go

# Frontend debug mode
VITE_DEBUG=true npm run dev
```

## 🚀 Deployment

### Production Build
```bash
# Backend
cd kekopoly-backend
go build -o kekopoly-server cmd/server/main.go

# Frontend
cd kekopoly-frontend
npm run build
```

### Environment Setup
- Set production environment variables
- Configure reverse proxy (nginx/Apache)
- Set up SSL certificates
- Configure database connections
- Set up monitoring and logging

## 📝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and test thoroughly
4. Commit your changes: `git commit -m 'Add feature'`
5. Push to your branch: `git push origin feature-name`
6. Create a Pull Request

## 🎯 Features

### Current Features
- ✅ Real-time multiplayer gameplay
- ✅ Meme-themed tokens and properties
- ✅ WebSocket-based communication
- ✅ JWT authentication
- ✅ Game state persistence
- ✅ Responsive UI design
- ✅ Chat functionality
- ✅ Game lobby system

### Planned Features
- 🔄 Spectator mode
- 🔄 Game replay system
- 🔄 Tournament mode
- 🔄 Custom game rules
- 🔄 Mobile app (React Native)
- 🔄 AI players
- 🔄 Statistics tracking
- 🔄 Leaderboards
---

**Have fun playing Kekopoly!** 🎲🐸
