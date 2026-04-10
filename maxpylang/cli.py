"""Command-line interface for maxpylang."""
from __future__ import annotations

import argparse
import sys
from importlib.resources import files
from pathlib import Path


def setup_claude(args: argparse.Namespace) -> int:
    """Copy the CLAUDE.md template into the current working directory."""
    dest = Path.cwd() / "CLAUDE.md"

    if dest.exists() and not args.force:
        print(
            f"CLAUDE.md already exists at {dest}\n"
            "Use --force to overwrite.",
            file=sys.stderr,
        )
        return 1

    try:
        template = files("maxpylang").joinpath("data", "CLAUDE_TEMPLATE.md").read_text(encoding="utf-8")
    except FileNotFoundError:
        print("Error: CLAUDE_TEMPLATE.md not found in package data. Reinstall maxpylang.", file=sys.stderr)
        return 1

    try:
        dest.write_text(template, encoding="utf-8")
    except OSError as exc:
        print(f"Error writing {dest}: {exc}", file=sys.stderr)
        return 1

    print(f"Created {dest}")
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="maxpylang",
        description="MaxPyLang command-line tools.",
    )
    subparsers = parser.add_subparsers(dest="command")

    sp = subparsers.add_parser(
        "setup-claude",
        help="Copy the CLAUDE.md template into the current directory.",
    )
    sp.add_argument(
        "--force", "-f",
        action="store_true",
        help="Overwrite existing CLAUDE.md if present.",
    )
    sp.set_defaults(func=setup_claude)

    args = parser.parse_args(argv)

    if not hasattr(args, "func"):
        parser.print_help()
        raise SystemExit(1)

    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
