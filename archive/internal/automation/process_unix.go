//go:build !windows

package automation

import "os/exec"

func hideConsole(cmd *exec.Cmd) {}
