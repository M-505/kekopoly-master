/**
 * API Utilities for making authenticated requests
 */

import { isTokenExpired } from './tokenUtils';

/**
 * Helper function to safely access the Redux store
 * @returns {any} The Redux store or null if not available
 */
const getReduxStore = () => {
  // @ts-ignore - window.store is set in our app
  if (typeof window !== 'undefined' && window.store) {
    // @ts-ignore - window.store is set in our app
    return window.store;
  }
  return null;
};

/**
 * Get the authentication token from Redux store or localStorage
 * @returns {string|null} The formatted authentication token or null if not available
 */
export const getAuthToken = () => {
  // Try to get token from Redux store first
  let token = null;

  // If Redux store is available, get token from there
  const store = getReduxStore();
  if (store && store.getState && store.getState().auth && store.getState().auth.token) {
    token = store.getState().auth.token;
  }

  // If token not found in Redux, try localStorage
  if (!token) {
    const storedToken = localStorage.getItem('kekopoly_token');
    if (storedToken) {
      token = storedToken;
    }
  }

  // Ensure token is properly formatted with 'Bearer ' prefix
  if (token && !token.startsWith('Bearer ')) {
    token = `Bearer ${token}`;
  }

  return token;
};

/**
 * Make an authenticated API request
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} The fetch response
 */
export const apiRequest = async (url, options = {}) => {
  const token = getAuthToken();

  // Enhanced token validation
  if (!token || token === 'null' || token === 'undefined' || token === 'Bearer null' || token === 'Bearer undefined') {
    console.error('No valid authentication token available for API request');
    
    // Only clear invalid token from storage, but don't automatically logout
    // The user might be in the middle of logging in
    if (token === 'null' || token === 'undefined' || token === 'Bearer null' || token === 'Bearer undefined') {
      localStorage.removeItem('kekopoly_token');
    }
    
    throw new Error('Authentication required');
  }

  // Check if token is expired before making the request
  if (isTokenExpired(token)) {
    console.warn('Authentication token has expired');
    
    // Clear expired session
    if (store && store.dispatch) {
      store.dispatch({ type: 'auth/logout' });
    }
    localStorage.removeItem('kekopoly_token');
    localStorage.removeItem('kekopoly_user');
    
    throw new Error('Session expired. Please log in again.');
  }

  // Set up headers with authentication
  const headers = {
    'Authorization': token,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Make the request with authentication header
  const response = await fetch(url, {
    ...options,
    headers
  });

  // Handle authentication errors (e.g., token expired)
  if (response.status === 401) {
    console.error('Authentication failed (401). Checking if token is actually expired...');
    
    // Check if the token is actually expired before clearing it
    const token = getAuthToken();
    const shouldLogout = !token || isTokenExpired(token);
    
    if (!shouldLogout) {
      console.warn('Token appears valid but server returned 401. Not logging out automatically.');
    }
    
    if (shouldLogout) {
      const store = getReduxStore();
      if (store) {
        // Dispatch logout action to clear user session
        store.dispatch({ type: 'auth/logout' });
      }
      
      // Redirect to login page
      window.location.href = '/login'; 
    }
    
    // Throw an error to stop the promise chain of the original caller.
    const error = new Error(shouldLogout ? 'Session expired. Please log in again.' : 'Authentication failed. Please try again.');
    // Attach the response so the caller can inspect it if needed
    // @ts-ignore
    error.response = response;
    throw error;
  }

  // Handle other errors
  if (!response.ok) {
    console.error(`API request failed with status ${response.status}:`, url);
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response;
};

/**
 * Make a GET request to the API
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The parsed JSON response
 */
export const apiGet = async (url, options = {}) => {
  const response = await apiRequest(url, {
    method: 'GET',
    ...options
  });

  return await response.json();
};

/**
 * Make a POST request to the API
 * @param {string} url - The API endpoint URL
 * @param {Object} data - The data to send in the request body
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The parsed JSON response
 */
export const apiPost = async (url, data, options = {}) => {
  const response = await apiRequest(url, {
    method: 'POST',
    body: JSON.stringify(data),
    ...options
  });

  return await response.json();
};

/**
 * Make a PUT request to the API
 * @param {string} url - The API endpoint URL
 * @param {Object} data - The data to send in the request body
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The parsed JSON response
 */
export const apiPut = async (url, data, options = {}) => {
  const response = await apiRequest(url, {
    method: 'PUT',
    body: JSON.stringify(data),
    ...options
  });

  return await response.json();
};

/**
 * Make a DELETE request to the API
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The parsed JSON response
 */
export const apiDelete = async (url, options = {}) => {
  const response = await apiRequest(url, {
    method: 'DELETE',
    ...options
  });

  return await response.json();
};

/**
 * Make a public API request (no authentication required)
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} The fetch response
 */
export const publicApiRequest = async (url, options = {}) => {
  // Set up headers without authentication
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Make the request without authentication header
  const response = await fetch(url, {
    ...options,
    headers
  });

  // Handle errors
  if (!response.ok) {
    console.error(`Public API request failed with status ${response.status}:`, url);
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response;
};

/**
 * Make a public POST request (no authentication required)
 * @param {string} url - The API endpoint URL
 * @param {Object} data - The data to send in the request body
 * @param {Object} options - Additional fetch options
 * @returns {Promise<any>} The parsed JSON response
 */
export const publicApiPost = async (url, data, options = {}) => {
  const response = await publicApiRequest(url, {
    method: 'POST',
    body: JSON.stringify(data),
    ...options
  });

  return await response.json();
};
