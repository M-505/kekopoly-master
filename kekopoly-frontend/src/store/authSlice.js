import { createSlice } from '@reduxjs/toolkit';

// Check if token exists in localStorage
const storedToken = localStorage.getItem('kekopoly_token');

// Ensure the token is properly formatted with 'Bearer ' prefix
const formattedToken = storedToken 
  ? (storedToken.startsWith('Bearer ') ? storedToken : `Bearer ${storedToken}`)
  : null;

const initialState = {
  isAuthenticated: !!storedToken,
  token: formattedToken,
  user: storedToken ? JSON.parse(localStorage.getItem('kekopoly_user') || '{}') : null,
  error: null,
  loading: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    connectStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    connectSuccess: (state, action) => {
      state.isAuthenticated = true;
      const token = action.payload.token.startsWith('Bearer ') 
        ? action.payload.token 
        : `Bearer ${action.payload.token}`;
      state.token = token;
      state.user = action.payload.user;
      state.loading = false;
      state.error = null;
      localStorage.setItem('kekopoly_token', token);
      localStorage.setItem('kekopoly_user', JSON.stringify(action.payload.user));
    },
    connectFailure: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },
    disconnect: (state) => {
      state.isAuthenticated = false;
      state.token = null;
      state.user = null;
      localStorage.removeItem('kekopoly_token');
      localStorage.removeItem('kekopoly_user');
    },
  },
});

export const { connectStart, connectSuccess, connectFailure, disconnect } = authSlice.actions;
export default authSlice.reducer;