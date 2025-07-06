/**
 * Registration Manager
 * 
 * Prevents duplicate player registrations by tracking registration state
 * and implementing proper sequencing and validation.
 */

import { log, logError, logWarning } from '../../utils/logger';

/**
 * Manages player registration state and prevents duplicates
 */
export class RegistrationManager {
  constructor(socketService) {
    this.socketService = socketService;
    this.isRegistering = false;
    this.registrationAttempts = 0;
    this.maxRegistrationAttempts = 3;
    this.registrationTimeout = null;
    this.registeredPlayers = new Set(); // Track registered player IDs
    this.lastRegistrationTime = 0;
    this.minRegistrationInterval = 5000; // 5 seconds between registrations
  }

  /**
   * Check if a player is already registered
   */
  isPlayerRegistered(playerId, gameId) {
    const key = `${gameId}_${playerId}`;
    return this.registeredPlayers.has(key);
  }

  /**
   * Mark a player as registered
   */
  markPlayerAsRegistered(playerId, gameId) {
    const key = `${gameId}_${playerId}`;
    this.registeredPlayers.add(key);
    this.isRegistering = false;
    this.registrationAttempts = 0;
    this.lastRegistrationTime = Date.now();
    log('REGISTRATION', `Player ${playerId} marked as registered in game ${gameId}`);
  }

  /**
   * Clear registration for a player
   */
  clearPlayerRegistration(playerId, gameId) {
    const key = `${gameId}_${playerId}`;
    this.registeredPlayers.delete(key);
    log('REGISTRATION', `Registration cleared for player ${playerId} in game ${gameId}`);
  }

  /**
   * Attempt to register a player with duplicate prevention
   */
  async attemptRegistration(gameId, playerId, playerData) {
    // Check if already registered
    if (this.isPlayerRegistered(playerId, gameId)) {
      log('REGISTRATION', 'Player already registered, skipping duplicate registration');
      return { success: true, reason: 'already_registered' };
    }

    // Check if currently registering
    if (this.isRegistering) {
      log('REGISTRATION', 'Registration already in progress, preventing duplicate');
      return { success: false, reason: 'registration_in_progress' };
    }

    // Check minimum interval between registrations
    const timeSinceLastRegistration = Date.now() - this.lastRegistrationTime;
    if (timeSinceLastRegistration < this.minRegistrationInterval) {
      log('REGISTRATION', `Too soon since last registration (${timeSinceLastRegistration}ms), waiting...`);
      return { success: false, reason: 'too_soon' };
    }

    // Check maximum attempts
    if (this.registrationAttempts >= this.maxRegistrationAttempts) {
      logError('REGISTRATION', 'Maximum registration attempts exceeded');
      return { success: false, reason: 'max_attempts_exceeded' };
    }

    // Start registration process
    this.isRegistering = true;
    this.registrationAttempts++;

    try {
      log('REGISTRATION', `Starting registration attempt ${this.registrationAttempts} for player ${playerId}`);

      // Send player_joined message
      const success = this.socketService.sendMessage('player_joined', {
        ...playerData,
        gameId,
        playerId,
        timestamp: Date.now(),
        registrationAttempt: this.registrationAttempts
      });

      if (!success) {
        this.isRegistering = false;
        return { success: false, reason: 'send_failed' };
      }

      // Set timeout to reset registration state if no response
      this.registrationTimeout = setTimeout(() => {
        if (this.isRegistering) {
          logWarning('REGISTRATION', 'Registration timeout, resetting state');
          this.isRegistering = false;
        }
      }, 10000); // 10 second timeout

      return { success: true, reason: 'registration_sent' };

    } catch (error) {
      logError('REGISTRATION', 'Registration error:', error);
      this.isRegistering = false;
      return { success: false, reason: 'error', error };
    }
  }

  /**
   * Handle registration acknowledgment from server
   */
  handleRegistrationAck(playerId, gameId) {
    if (this.registrationTimeout) {
      clearTimeout(this.registrationTimeout);
      this.registrationTimeout = null;
    }

    this.markPlayerAsRegistered(playerId, gameId);
    log('REGISTRATION', 'Registration acknowledged by server');
  }

  /**
   * Reset registration state (for cleanup or errors)
   */
  reset() {
    this.isRegistering = false;
    this.registrationAttempts = 0;
    if (this.registrationTimeout) {
      clearTimeout(this.registrationTimeout);
      this.registrationTimeout = null;
    }
    log('REGISTRATION', 'Registration manager reset');
  }

  /**
   * Get registration status
   */
  getStatus() {
    return {
      isRegistering: this.isRegistering,
      registrationAttempts: this.registrationAttempts,
      registeredPlayers: Array.from(this.registeredPlayers),
      lastRegistrationTime: this.lastRegistrationTime
    };
  }
}

/**
 * Enhanced registration prevention for SocketService
 */
export function preventDuplicateRegistration() {
  if (!this.registrationManager) {
    this.registrationManager = new RegistrationManager(this);
  }

  return this.registrationManager;
}

/**
 * Mark player as successfully registered (to be called on server acknowledgment)
 */
export function markPlayerAsRegistered() {
  if (this.registrationManager && this.gameId && this.playerId) {
    this.registrationManager.handleRegistrationAck(this.playerId, this.gameId);
    
    // Also save to localStorage to persist across page reloads
    const registrationKey = `kekopoly_registered_${this.gameId}_${this.playerId}`;
    localStorage.setItem(registrationKey, Date.now().toString());
  }
}

/**
 * Check if player is already registered (including localStorage check)
 */
export function isPlayerAlreadyRegistered(playerId, gameId) {
  // Check in-memory state
  if (this.registrationManager && this.registrationManager.isPlayerRegistered(playerId, gameId)) {
    return true;
  }

  // Check localStorage for persistent state
  const registrationKey = `kekopoly_registered_${gameId}_${playerId}`;
  const lastRegistration = localStorage.getItem(registrationKey);
  
  if (lastRegistration) {
    const registrationTime = parseInt(lastRegistration);
    const timeSinceRegistration = Date.now() - registrationTime;
    
    // Consider registration valid for 1 hour
    if (timeSinceRegistration < 3600000) {
      log('REGISTRATION', 'Found valid registration in localStorage');
      return true;
    } else {
      // Clean up old registration
      localStorage.removeItem(registrationKey);
    }
  }

  return false;
}

/**
 * Clear player registration (for leaving games or cleanup)
 */
export function clearPlayerRegistration(playerId, gameId) {
  if (this.registrationManager) {
    this.registrationManager.clearPlayerRegistration(playerId, gameId);
  }

  // Also clear from localStorage
  const registrationKey = `kekopoly_registered_${gameId}_${playerId}`;
  localStorage.removeItem(registrationKey);
  
  log('REGISTRATION', 'Player registration cleared from all sources');
}
