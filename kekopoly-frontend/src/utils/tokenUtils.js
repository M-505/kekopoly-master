/**
 * Token utility functions for JWT handling
 */

/**
 * Check if a JWT token is expired
 * @param {string} token - The JWT token to check
 * @returns {boolean} True if expired, false if valid
 */
export const isTokenExpired = (token) => {
  if (!token) return true;
  
  try {
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace('Bearer ', '');
    
    // Parse the JWT payload
    const payload = JSON.parse(atob(cleanToken.split('.')[1]));
    
    // Check expiration (exp is in seconds, Date.now() is in milliseconds)
    const currentTime = Date.now() / 1000;
    
    // Add a small buffer (30 seconds) to account for clock skew
    const isExpired = payload.exp && (payload.exp - 30) < currentTime;
    
    return isExpired;
  } catch (error) {
    console.warn('Error parsing token for expiration check:', error);
    return true; // If we can't parse it, consider it expired
  }
};

/**
 * Get the expiration time of a JWT token
 * @param {string} token - The JWT token
 * @returns {Date|null} The expiration date or null if invalid
 */
export const getTokenExpiration = (token) => {
  if (!token) return null;
  
  try {
    const cleanToken = token.replace('Bearer ', '');
    const payload = JSON.parse(atob(cleanToken.split('.')[1]));
    
    if (payload.exp) {
      return new Date(payload.exp * 1000); // Convert from seconds to milliseconds
    }
    
    return null;
  } catch (error) {
    console.warn('Error parsing token for expiration date:', error);
    return null;
  }
};

/**
 * Get the time remaining until token expiration
 * @param {string} token - The JWT token
 * @returns {number} Time remaining in seconds, or 0 if expired
 */
export const getTokenTimeRemaining = (token) => {
  if (!token) return 0;
  
  try {
    const cleanToken = token.replace('Bearer ', '');
    const payload = JSON.parse(atob(cleanToken.split('.')[1]));
    
    if (payload.exp) {
      const currentTime = Date.now() / 1000;
      const remaining = payload.exp - currentTime;
      return Math.max(0, remaining);
    }
    
    return 0;
  } catch (error) {
    console.warn('Error parsing token for time remaining:', error);
    return 0;
  }
};

/**
 * Extract user ID from JWT token
 * @param {string} token - The JWT token
 * @returns {string|null} The user ID or null if invalid
 */
export const getUserIdFromToken = (token) => {
  if (!token) return null;
  
  try {
    const cleanToken = token.replace('Bearer ', '');
    const payload = JSON.parse(atob(cleanToken.split('.')[1]));
    
    return payload.userId || payload.userID || null;
  } catch (error) {
    console.warn('Error parsing token for user ID:', error);
    return null;
  }
};
