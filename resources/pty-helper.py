#!/usr/bin/env python3
"""
PTY helper for obsidian-claude-code plugin.

Allocates a pseudo-terminal, spawns the given command inside it,
and bridges stdin/stdout. Terminal resize events are received
on file descriptor 3 as 8-byte packed structs (rows, cols, 0, 0)
matching the struct winsize format for TIOCSWINSZ.

Usage: python3 pty-helper.py <command> [args...]
"""

import termios
import select
import struct
import fcntl
import errno
import pty
import sys
import os


def main():
    if len(sys.argv) < 2:
        print("Usage: pty-helper.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd_path = sys.argv[1]
    cmd_argv = sys.argv[1:]

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["FORCE_COLOR"] = "1"

    pid, fd = pty.fork()
    if pid == 0:
        os.execve(cmd_path, cmd_argv, env)

    fds = [fd, 0, 3]

    try:
        while True:
            rfds, _, _ = select.select(fds, [], [])

            if fd in rfds:
                try:
                    buf = os.read(fd, 32768)
                    if len(buf) == 0:
                        break
                    sys.stdout.buffer.write(buf)
                    sys.stdout.buffer.flush()
                except OSError as e:
                    if e.errno in (errno.EINTR, errno.EAGAIN):
                        continue
                    if e.errno == errno.EIO:
                        break
                    break

            if 0 in rfds:
                try:
                    buf = os.read(0, 32768)
                    if len(buf) == 0:
                        break
                    os.write(fd, buf)
                except OSError as e:
                    if e.errno in (errno.EINTR, errno.EAGAIN):
                        continue
                    break

            if 3 in rfds:
                try:
                    winsize = os.read(3, 8)
                    if len(winsize) == 0:
                        fds = [fd, 0]
                    elif len(winsize) == 8:
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
                except OSError as e:
                    if e.errno in (errno.EINTR, errno.EAGAIN):
                        continue
                    break

    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass


if __name__ == "__main__":
    main()
