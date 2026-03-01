# Patch Notes

This file now tracks only short operator-facing notes. Historical narrative writeups were removed because they drifted from the codebase.

Recent operational changes:
- repo-local live secrets and cookie jars were removed
- secret paths now default to external directories
- Docker Compose binds Postgres to loopback only in dev
- bootstrap, compose, and helper scripts now use the same DB user defaults
- stale scorecard-style documentation was replaced with current operational docs
