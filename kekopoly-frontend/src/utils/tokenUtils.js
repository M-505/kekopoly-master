/**
 * Token utility functions for JWT handling
 */

/**
 * Validate if a string looks like a valid JWT token format
 * @param {string} token - The token to validate
 * @returns {boolean} True if it looks like a valid JWT format
 */
export const isValidJWTFormat = (token) => {
  if (!token || typeof token !== 'string') return false;
  
  // Remove Bearer prefix if present
  const cleanToken = token.replace('Bearer ', '').trim();
  
  // JWT should have exactly 3 parts separated by dots
  const parts = cleanToken.split('.');
  if (parts.length !== 3) return false;
  
  // Each part should be non-empty and contain valid base64 characters
  // Allow both standard base64 (+/) and URL-safe base64 (-_) characters
  const base64Regex = /^[A-Za-z0-9+/\-_]+=*$/;
  return parts.every(part => part.length > 0 && base64Regex.test(part));
};

/**
 * Check if a JWT token is expired
 * @param {string} token - The JWT token to check
 * @returns {boolean} True if expired, false if valid
 */
export const isTokenExpired = (token) => {
  if (!token || typeof token !== 'string') return true;
  
  try {
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace('Bearer ', '').trim();
    
    // Basic JWT format validation (should have 3 parts separated by dots)
    const parts = cleanToken.split('.');
    if (parts.length !== 3) {
      console.warn('Invalid JWT format: should have 3 parts');
      return true;
    }
    
    // Get the payload (middle part)
    let payloadPart = parts[1];
    
    // Ensure proper base64 padding
    while (payloadPart.length % 4) {
      payloadPart += '=';
    }
    
    // Validate base64 characters before attempting to decode
    const base64Regex = /^[A-Za-z0-9+/\-_]*={0,2}$/;
    if (!base64Regex.test(payloadPart)) {
      console.warn('Invalid base64 characters in JWT payload');
      return true;
    }
    
    // Parse the JWT payload
    const payload = JSON.parse(atob(payloadPart));
    
    // Check if payload has required fields
    if (!payload || typeof payload !== 'object') {
      console.warn('Invalid JWT payload structure');
      return true;
    }
    
    // Check expiration (exp is in seconds, Date.now() is in milliseconds)
    if (!payload.exp || typeof payload.exp !== 'number') {
      console.warn('No valid expiration time in token');
      return true;
    }
    
    const currentTime = Date.now() / 1000;
    
    // Add a small buffer (30 seconds) to account for clock skew
    const isExpired = (payload.exp - 30) < currentTime;
    
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
  if (!token || typeof token !== 'string') return null;
  
  try {
    const cleanToken = token.replace('Bearer ', '').trim();
    const parts = cleanToken.split('.');
    if (parts.length !== 3) return null;
    
    let payloadPart = parts[1];
    while (payloadPart.length % 4) {
      payloadPart += '=';
    }
    
    const base64Regex = /^[A-Za-z0-9+/\-_]*={0,2}$/;
    if (!base64Regex.test(payloadPart)) return null;
    
    const payload = JSON.parse(atob(payloadPart));
    
    if (payload.exp && typeof payload.exp === 'number') {
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
  if (!token || typeof token !== 'string') return 0;
  
  try {
    const cleanToken = token.replace('Bearer ', '').trim();
    const parts = cleanToken.split('.');
    if (parts.length !== 3) return 0;
    
    let payloadPart = parts[1];
    while (payloadPart.length % 4) {
      payloadPart += '=';
    }
    
    const base64Regex = /^[A-Za-z0-9+/\-_]*={0,2}$/;
    if (!base64Regex.test(payloadPart)) return 0;
    
    const payload = JSON.parse(atob(payloadPart));
    
    if (payload.exp && typeof payload.exp === 'number') {
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
  if (!token || typeof token !== 'string') return null;
  
  try {
    const cleanToken = token.replace('Bearer ', '').trim();
    const parts = cleanToken.split('.');
    if (parts.length !== 3) return null;
    
    let payloadPart = parts[1];
    while (payloadPart.length % 4) {
      payloadPart += '=';
    }
    
    const base64Regex = /^[A-Za-z0-9+/\-_]*={0,2}$/;
    if (!base64Regex.test(payloadPart)) return null;
    
    const payload = JSON.parse(atob(payloadPart));
    
    return payload.userId || payload.userID || null;
  } catch (error) {
    console.warn('Error parsing token for user ID:', error);
    return null;
  }
};
