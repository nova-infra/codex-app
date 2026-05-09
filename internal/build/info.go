package build

var Version = "0.1.0"
var GitSHA = "dev"

func Info() map[string]string {
	return map[string]string{
		"version": Version,
		"git_sha": GitSHA,
		"runtime": "go",
		"entry":   "./cmd/codex-app",
	}
}
