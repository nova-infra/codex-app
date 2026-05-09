package main

import (
	"fmt"
	"io"
	"os"

	"github.com/nova-infra/codex-app/internal/command"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	return command.Run(args, out)
}
