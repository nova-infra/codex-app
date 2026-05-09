package config

// RuntimeConfig contains the small amount of runtime state needed by the
// first Go rewrite milestone. Keep this package dependency-free so later
// project/provider loading can grow here without dragging channel code into
// the CLI boundary.
type RuntimeConfig struct {
	DefaultChannel  string
	EnabledChannels []string
}

// Default returns the social-channel focused baseline used by render-demo.
func Default() RuntimeConfig {
	return RuntimeConfig{
		DefaultChannel:  "all",
		EnabledChannels: []string{"telegram", "wechat", "lark"},
	}
}
