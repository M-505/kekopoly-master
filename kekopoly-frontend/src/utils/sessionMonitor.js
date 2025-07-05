/**
 * Session Monitor - Monitors JWT token expiration and handles session renewal
 */

import { isTokenExpired, getTokenTimeRemaining, isValidJWTFormat } from './tokenUtils';

class SessionMonitor {
  constructor() {
    this.checkInterval = null;
    this.onSessionExpired = null;
    this.onSessionWarning = null;
    this.warningThreshold = 300; // 5 minutes in seconds
    this.warningShown = false;
    this.isPaused = false; // Add pause functionality
  }

  /**
   * Start monitoring the session
   * @param {Function} onSessionExpired - Callback when session expires
   * @param {Function} onSessionWarning - Callback when session is about to expire
   */
  start(onSessionExpired, onSessionWarning) {
    this.onSessionExpired = onSessionExpired;
    this.onSessionWarning = onSessionWarning;
    
    // Check every minute
    this.checkInterval = setInterval(() => {
      this.checkSession();
    }, 60000);
    
    // Initial check
    this.checkSession();
  }

  /**
   * Stop monitoring the session
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.warningShown = false;
  }

  /**
   * Check the current session status
   */
  checkSession() {
    // Skip checking if paused
    if (this.isPaused) {
      return;
    }
    
    const token = localStorage.getItem('kekopoly_token');
    
    if (!token) {
      if (this.onSessionExpired) {
        this.onSessionExpired('No token found');
      }
      return;
    }

    // First check if token format is valid
    if (!isValidJWTFormat(token)) {
      console.warn('Invalid JWT format detected, clearing token');
      localStorage.removeItem('kekopoly_token');
      if (this.onSessionExpired) {
        this.onSessionExpired('Invalid token format');
      }
      return;
    }

    if (isTokenExpired(token)) {
      if (this.onSessionExpired) {
        this.onSessionExpired('Token expired');
      }
      return;
    }

    // Check if we should show a warning
    const timeRemaining = getTokenTimeRemaining(token);
    if (timeRemaining <= this.warningThreshold && !this.warningShown) {
      this.warningShown = true;
      if (this.onSessionWarning) {
        this.onSessionWarning(timeRemaining);
      }
    }

    // Reset warning if we have more time
    if (timeRemaining > this.warningThreshold) {
      this.warningShown = false;
    }
  }

  /**
   * Reset the warning state (useful after token renewal)
   */
  resetWarning() {
    this.warningShown = false;
  }

  /**
   * Pause session monitoring temporarily
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume session monitoring
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Temporarily pause session monitoring for a duration
   * @param {number} durationMs - Duration to pause in milliseconds
   */
  pauseFor(durationMs = 5000) {
    this.pause();
    setTimeout(() => {
      this.resume();
    }, durationMs);
  }
}

// Export a singleton instance
export default new SessionMonitor();
