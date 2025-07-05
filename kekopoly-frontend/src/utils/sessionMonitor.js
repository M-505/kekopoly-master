/**
 * Session Monitor - Monitors JWT token expiration and handles session renewal
 */

import { isTokenExpired, getTokenTimeRemaining } from './tokenUtils';

class SessionMonitor {
  constructor() {
    this.checkInterval = null;
    this.onSessionExpired = null;
    this.onSessionWarning = null;
    this.warningThreshold = 300; // 5 minutes in seconds
    this.warningShown = false;
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
    const token = localStorage.getItem('kekopoly_token');
    
    if (!token) {
      if (this.onSessionExpired) {
        this.onSessionExpired('No token found');
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
}

// Export a singleton instance
export default new SessionMonitor();
