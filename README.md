# Adaptive AI Games Platform

A full-stack web application featuring two adaptive AI games that learn from player behavior. Built with React, Express, and MongoDB.

## Project Structure

```
/
├── frontend/          # React + Vite + TypeScript
│   ├── src/
│   │   ├── pages/     # Game pages and landing page
│   │   ├── components/# Shared components
│   │   ├── services/  # API calls and session management
│   │   ├── hooks/     # Custom React hooks
│   │   ├── styles/    # CSS files
│   │   └── App.tsx    # Main app with routing
│   └── package.json
├── backend/           # Express + Node.js
│   ├── db/            # Database connection
│   ├── models/        # Mongoose schemas
│   ├── routes/        # API endpoints
│   ├── server.ts      # Express server setup
│   └── package.json
└── README.md
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, React Router
- **Backend**: Express.js, Node.js, TypeScript
- **Database**: MongoDB Atlas (free M0 cluster)
- **Hosting**: Vercel (frontend) + Railway (backend)

## Games Included

### WARDEN
Real-time dodging game where the boss learns your dodge patterns. Memory tracks dodge directions, timing, and recovery strategies.

### THE FIVE
Squad-based 5v1 battles where your team learns the boss's attack patterns and adapts their tactics accordingly.

## Local Development Setup

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (free tier available)
- Git

### Step 1: MongoDB Atlas Setup

1. Go to https://www.mongodb.com/cloud/atlas
2. Sign up for a free account
3. Create a new M0 cluster
4. Create a database user (save credentials)
5. Add your IP to IP Access List
6. Get your connection string from "Connect" → "Drivers"

### Step 2: Backend Setup

```bash
cd backend

# Copy env template and add your MongoDB connection string
cp .env.example .env

# Edit .env and add:
# MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/adaptive-games?retryWrites=true&w=majority
# MONGODB_DB_NAME=adaptive-games
# NODE_ENV=development
# PORT=5000
# CORS_ORIGIN=http://localhost:5173

# Install dependencies
npm install

# Start dev server
npm run dev
```

Backend runs on `http://localhost:5000`

### Step 3: Frontend Setup

```bash
cd frontend

# Copy env template
cp .env.example .env

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs on `http://localhost:5173`

### Step 4: Test the Application

1. Navigate to `http://localhost:5173`
2. Enter a player name
3. Click into WARDEN or THE FIVE
4. Click "Test Save Memory" to verify backend connectivity
5. Click "Test Log Match" to log a match result
6. Refresh the page — memory should persist

## API Endpoints

### Authentication
- `POST /api/player` - Create/get player by session ID
- `GET /api/player/:sessionId` - Fetch player info

### Memory Management
- `GET /api/memory/:playerId/:gameType` - Load game memory
- `POST /api/memory/:playerId/:gameType` - Save game memory
- `POST /api/match` - Log a completed match
- `GET /api/stats/:playerId/:gameType` - Get player statistics

### Health
- `GET /api/health` - Server health check

## Environment Variables

### Backend (.env)
```
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=adaptive-games
NODE_ENV=development
PORT=5000
CORS_ORIGIN=http://localhost:5173
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:5000/api
```

## Database Schema

### Players Collection
```javascript
{
  _id: ObjectId,
  sessionId: string,
  name: string,
  createdAt: Date,
  updatedAt: Date
}
```

### GameMemory Collection
```javascript
{
  _id: ObjectId,
  playerId: ObjectId,
  gameType: "warden" | "five",
  data: { /* game-specific memory */ },
  updatedAt: Date,
  createdAt: Date
}
```

### GameSessions Collection
```javascript
{
  _id: ObjectId,
  playerId: ObjectId,
  gameType: "warden" | "five",
  matchNumber: number,
  won: boolean,
  duration: number,
  timestamp: Date
}
```

## Build & Deployment

### Build Frontend
```bash
cd frontend
npm run build
# Output in dist/
```

### Build Backend
```bash
cd backend
npm run build
# Output in dist/
```

### Deploy to Vercel (Frontend)
1. Push to GitHub
2. Connect repo to Vercel
3. Set `VITE_API_URL` environment variable
4. Deploy

### Deploy to Railway (Backend)
1. Push to GitHub
2. Connect repo to Railway
3. Set environment variables:
   - `MONGODB_URI`
   - `MONGODB_DB_NAME`
   - `NODE_ENV=production`
   - `PORT=5000`
4. Deploy

## Development Workflow

### Adding a New Feature
1. Create a new branch
2. Make changes to frontend or backend
3. Test locally
4. Commit and push
5. Deploy (frontend to Vercel, backend to Railway)

### Working with Game Logic
Game logic is located in the canvas-based game components. To integrate new game code:
1. Extract HTML game files
2. Convert to React hooks
3. Wrap with memory persistence
4. Test memory sync end-to-end

## Troubleshooting

### MongoDB Connection Failed
- Verify connection string in .env
- Check IP Access List in MongoDB Atlas
- Ensure database user has correct credentials

### CORS Errors
- Verify `CORS_ORIGIN` in backend .env matches frontend URL
- Check that backend is running

### Memory Not Persisting
- Verify backend is connected to MongoDB
- Check browser console for errors
- Verify player ID is being set correctly

## Phase Checklist

- [x] Phase 1: Foundation (Complete)
  - [x] React + Express + MongoDB boilerplate
  - [x] Environment setup
  - [x] Player session system
  - [x] CORS configuration
  - [x] Health check endpoint

- [ ] Phase 2: Landing Page
- [ ] Phase 3: Game Containerization
- [ ] Phase 4: Backend Memory API (Partial - endpoints created)
- [ ] Phase 5: Integration & Testing
- [ ] Phase 6: Deployment

## Contributing

This is an MVP project. Focus on core functionality first, polish later.

## License

MIT
