package auth

// SolanaValidator handles Solana signature validation
type SolanaValidator struct {
}

// NewSolanaValidator creates a new SolanaValidator
func NewSolanaValidator(rpcURL string) *SolanaValidator {
	return &SolanaValidator{}
}

// IsEnabled returns whether validation is enabled
func (v *SolanaValidator) IsEnabled() bool {
	return false
}

// Enable enables validation
func (v *SolanaValidator) Enable() {
}

// Disable disables validation
func (v *SolanaValidator) Disable() {
}

// VerifySignature verifies a Solana signature
// Returns true if valid, false if invalid
func (v *SolanaValidator) VerifySignature(walletAddress, message, signature string, format string) (bool, error) {
	return false, nil
}
