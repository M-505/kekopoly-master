import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { publicApiPost } from '../utils/apiUtils';

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

const initialState = {
  isAuthenticated: !!storedToken,
  token: storedToken,
  user: storedToken ? JSON.parse(localStorage.getItem('kekopoly_user') || '{}') : null,
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
        state.isAuthenticated = true;
        state.token = action.payload.token;
        state.user = action.payload;
        localStorage.setItem('kekopoly_token', action.payload.token);
        localStorage.setItem('kekopoly_user', JSON.stringify(action.payload));
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
        state.isAuthenticated = true;
        state.token = action.payload.token;
        state.user = action.payload;
        localStorage.setItem('kekopoly_token', action.payload.token);
        localStorage.setItem('kekopoly_user', JSON.stringify(action.payload));
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;