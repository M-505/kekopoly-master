# Test Plan for Enhanced Multiplayer Fixes

## Overview
This test plan covers the enhanced fixes for player visibility, room validation, and error handling in the Kekopoly multiplayer system.

## Test Environment Setup
- Two different browser sessions (incognito/private mode recommended)
- Two different user accounts
- Stable internet connection
- Access to browser developer console for debugging

## Test 1: Enhanced Player Visibility

### Objective
Verify that players in the same room can see each other properly and host status is correctly displayed.

### Steps
1. **Setup**:
   - Open two browser windows/tabs
   - Log in with different accounts in each window
   - Keep developer console open in both windows

2. **Create Room**:
   - In Window 1: Create a new game room
   - Note the room code displayed
   - Verify that Window 1 shows the player as host

3. **Join Room**:
   - In Window 2: Join the room using the room code from step 2
   - Wait for connection to establish (watch console logs)

4. **Verify Player Visibility**:
   - Both windows should show both players in the players list
   - Only Window 1 should show "Host" badge
   - Window 2 should show Window 1's player as host
   - Each player should see their own ready status controls

5. **Test Synchronization**:
   - In Window 2: Toggle ready status
   - Verify Window 1 sees the ready status change
   - In Window 1: Change player token/character
   - Verify Window 2 sees the token change

### Expected Results
- ✅ Both players visible in both windows
- ✅ Host status correctly displayed (only one host)
- ✅ Ready status synchronizes between players
- ✅ Character token changes are visible to other players
- ✅ Console logs show successful player synchronization

### Debug Information
Look for these console messages:
- `[PLAYER_SYNC] Performing player synchronization`
- `[PLAYER_DISPLAY] Broadcasting player info using data:`
- `Player joined: [playerId] ([playerName])`

## Test 2: Room Validation and Error Handling

### Objective
Verify that the system properly handles non-existent rooms and provides appropriate error messages.

### Steps
1. **Non-Existent Room URL**:
   - Manually navigate to `/room/INVALID123` in browser
   - Should see error message about room not found
   - Should automatically redirect to lobby after 2 seconds

2. **Deleted Room Scenario**:
   - Create a room and note the room code
   - (Simulate deletion by using a made-up room code)
   - Try to join the non-existent room from lobby
   - Should see "Game not found" error
   - Game list should refresh automatically

3. **Network Error Handling**:
   - Disconnect internet briefly
   - Try to join a room
   - Should see connection error message
   - Reconnect internet and verify system recovers

### Expected Results
- ✅ Clear error messages for non-existent rooms
- ✅ Automatic redirect to lobby on room validation failure
- ✅ Game list refreshes when stale entries detected
- ✅ Proper error messages for different failure scenarios

## Test 3: Connection Stability and Recovery

### Objective
Verify that the enhanced synchronization maintains stable connections and recovers from interruptions.

### Steps
1. **Initial Connection**:
   - Both players join the same room
   - Verify stable connection for 2 minutes
   - Check that periodic sync occurs (every 15 seconds)

2. **Browser Refresh Test**:
   - In Window 2: Refresh the page
   - Should reconnect automatically
   - Both players should still see each other after reconnection

3. **Network Interruption**:
   - Briefly disconnect one player's internet
   - Reconnect and verify synchronization restores
   - Both players should be visible again

### Expected Results
- ✅ Stable connection maintained
- ✅ Automatic reconnection after refresh
- ✅ Recovery from network interruptions
- ✅ Periodic synchronization prevents drift

## Test 4: Room Code Consistency

### Objective
Verify that all players use the same room identifier consistently.

### Steps
1. **Create Room**:
   - Create room and note both game ID and room code
   - Share room code with second player

2. **Join via Room Code**:
   - Second player joins using room code
   - Verify both players end up in same room instance
   - Check browser URL shows same room identifier

3. **Host Functions**:
   - Only host should be able to start game
   - Non-host should see appropriate UI (no start button)

### Expected Results
- ✅ All players use same room identifier
- ✅ Host privileges work correctly
- ✅ URL consistency across all players

## Test 5: Edge Cases and Error Scenarios

### Objective
Test various edge cases and error scenarios.

### Steps
1. **Multiple Room Joins**:
   - Try to join multiple rooms quickly
   - Verify only last room connection is maintained

2. **Invalid Characters in Room Code**:
   - Try joining room with special characters
   - Should handle gracefully with appropriate error

3. **Empty Room Code**:
   - Try joining with empty room code
   - Should prevent navigation and show error

### Expected Results
- ✅ Graceful handling of edge cases
- ✅ Appropriate error messages
- ✅ No crashes or undefined behavior

## Debugging Tips

### Console Messages to Monitor
- `[PLAYER_SYNC] Performing player synchronization`
- `[PLAYER_DISPLAY] Broadcasting player info`
- `Room [roomId] validated successfully`
- `Player joined: [playerId]`

### Common Issues and Solutions
1. **Players not seeing each other**: Check console for WebSocket connection errors
2. **Both players showing as host**: Look for host synchronization messages
3. **Room validation failing**: Check network connection and server status

### Performance Monitoring
- WebSocket connection should be stable (readyState: 1)
- Periodic sync should occur every 15 seconds
- Player data should broadcast within 1 second of changes

## Success Criteria
All tests must pass with:
- ✅ Clear error messages for all failure scenarios
- ✅ Automatic recovery from network issues
- ✅ Consistent player visibility across all clients
- ✅ Proper host designation and privileges
- ✅ Stable multiplayer synchronization

## Rollback Plan
If issues are discovered:
1. Check console logs for specific error messages
2. Verify WebSocket connection status
3. Test with simplified scenarios (single player first)
4. Report specific error messages and browser/network conditions
