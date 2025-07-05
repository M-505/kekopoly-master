import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  players: {},
  selectedToken: null,
  selectedColor: null,
  localPlayerId: null,
};

const playerSlice = createSlice({
  name: 'players',
  initialState,
  reducers: {
    setSelectedToken: (state, action) => {
      state.selectedToken = action.payload;
    },
    setSelectedColor: (state, action) => {
      state.selectedColor = action.payload;
    },
    setLocalPlayerId: (state, action) => {
      state.localPlayerId = action.payload;
    },
    addPlayer: (state, action) => {
      const { playerId, playerData } = action.payload;
      state.players[playerId] = playerData;
    },
    updatePlayer: (state, action) => {
      // Handle two different payload formats:
      // 1. { playerId, updates } - Traditional format
      // 2. A player object with id property - Direct player object format

      // Check if the payload is a player object with an id
      if (action.payload && action.payload.id) {
        const player = action.payload;
        const playerId = player.id;

        if (playerId) {
          // If the player doesn't exist yet, add it
          if (!state.players[playerId]) {
            state.players[playerId] = player;
          } else {
            // Otherwise update the existing player
            state.players[playerId] = { ...state.players[playerId], ...player };
          }
        } else {
          console.warn('Attempted to update player with undefined id:', player);
        }
      }
      // Handle the traditional format
      else if (action.payload && action.payload.playerId) {
        const { playerId, updates } = action.payload;

        if (playerId) {
          if (state.players[playerId]) {
            state.players[playerId] = { ...state.players[playerId], ...updates };
          } else {
            // If player doesn't exist but we have updates, create the player
            if (updates) {
              state.players[playerId] = updates;
            } else {
              console.warn(`Attempted to update non-existent player: ${playerId}`);
            }
          }
        } else {
          console.warn('Attempted to update player with undefined playerId');
        }
      } else {
        console.warn('Invalid payload format for updatePlayer:', action.payload);
      }
    },
    updatePlayerPosition: (state, action) => {
      const { playerId, position } = action.payload;
      if (state.players[playerId]) {
        state.players[playerId].position = position;
      }
    },
    updatePlayerBalance: (state, action) => {
      const { playerId, amount, operation } = action.payload;
      if (state.players[playerId]) {
        if (operation === 'add') {
          state.players[playerId].balance += amount;
        } else if (operation === 'subtract') {
          state.players[playerId].balance -= amount;
        } else if (operation === 'set') {
          state.players[playerId].balance = amount;
        }
      }
    },
    addPlayerCard: (state, action) => {
      const { playerId, card } = action.payload;
      if (state.players[playerId]) {
        if (!state.players[playerId].cards) {
          state.players[playerId].cards = [];
        }
        state.players[playerId].cards.push(card);
      }
    },
    removePlayerCard: (state, action) => {
      const { playerId, cardId } = action.payload;
      if (state.players[playerId] && state.players[playerId].cards) {
        state.players[playerId].cards = state.players[playerId].cards.filter(
          (card) => card.cardId !== cardId
        );
      }
    },
    addPlayerProperty: (state, action) => {
      const { playerId, propertyId } = action.payload;
      if (state.players[playerId]) {
        if (!state.players[playerId].properties) {
          state.players[playerId].properties = [];
        }
        state.players[playerId].properties.push(propertyId);
      }
    },
    removePlayerProperty: (state, action) => {
      const { playerId, propertyId } = action.payload;
      if (state.players[playerId] && state.players[playerId].properties) {
        state.players[playerId].properties = state.players[playerId].properties.filter(
          (id) => id !== propertyId
        );
      }
    },
    setPlayerReady: (state, action) => {
      const { playerId, isReady } = action.payload;
      if (state.players[playerId]) {
        state.players[playerId].isReady = isReady;
      }
    },
    removePlayer: (state, action) => {
      const playerId = action.payload;
      if (state.players[playerId]) {
        delete state.players[playerId];
      }
    },
    resetPlayers: () => initialState,
  },
});

export const {
  setSelectedToken,
  setSelectedColor,
  setLocalPlayerId,
  addPlayer,
  updatePlayer,
  updatePlayerPosition,
  updatePlayerBalance,
  addPlayerCard,
  removePlayerCard,
  addPlayerProperty,
  removePlayerProperty,
  setPlayerReady,
  removePlayer,
  resetPlayers
} = playerSlice.actions;

export default playerSlice.reducer;