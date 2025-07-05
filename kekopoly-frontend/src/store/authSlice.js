import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { publicApiPost } from '../utils/apiUtils';
import { isValidJWTFormat } from '../utils/tokenUtils';

export const login = createAsyncThunk(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      const data = await publicApiPost('/api/v1/auth/login', credentials);
      return data;
    } catch (error) {
      return rejectWithValue(error.toString());
    }
  }
);

export const register = createAsyncThunk(
  'auth/register',
  async (userData, { rejectWithValue }) => {
    try {
      const data = await publicApiPost('/api/v1/auth/register', userData);
      return data;
    } catch (error) {
      return rejectWithValue(error.toString());
    }
  }
);

const storedToken = localStorage.getItem('kekopoly_token');

// Validate the stored token format before using it
const validToken = storedToken && isValidJWTFormat(storedToken) ? storedToken : null;

// If we had an invalid token, clean it up
if (storedToken && !validToken) {
  console.warn('Invalid JWT format in localStorage, cleaning up');
  localStorage.removeItem('kekopoly_token');
  localStorage.removeItem('kekopoly_user');
}

const initialState = {
  isAuthenticated: !!validToken,
  token: validToken,
  user: validToken ? JSON.parse(localStorage.getItem('kekopoly_user') || '{}') : null,
  error: null,
  loading: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout: (state) => {
      state.isAuthenticated = false;
      state.token = null;
      state.user = null;
      localStorage.removeItem('kekopoly_token');
      localStorage.removeItem('kekopoly_user');
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        
        // Validate token format before storing
        if (action.payload.token && isValidJWTFormat(action.payload.token)) {
          state.isAuthenticated = true;
          state.token = action.payload.token;
          state.user = action.payload;
          localStorage.setItem('kekopoly_token', action.payload.token);
          localStorage.setItem('kekopoly_user', JSON.stringify(action.payload));
        } else {
          console.error('Received invalid JWT token from login');
          console.error('Token value:', action.payload.token);
          state.error = 'Invalid authentication token received';
        }
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(register.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(register.fulfilled, (state, action) => {
        state.loading = false;
        
        // Validate token format before storing
        if (action.payload.token && isValidJWTFormat(action.payload.token)) {
          state.isAuthenticated = true;
          state.token = action.payload.token;
          state.user = action.payload;
          localStorage.setItem('kekopoly_token', action.payload.token);
          localStorage.setItem('kekopoly_user', JSON.stringify(action.payload));
        } else {
          console.error('Received invalid JWT token from registration');
          console.error('Token value:', action.payload.token);
          state.error = 'Invalid authentication token received';
        }
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;