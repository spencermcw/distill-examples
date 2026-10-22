#!/bin/sh
# Adds Distill to Claude Code (user scope) as a remote streamable-HTTP MCP server.
claude mcp add --transport http --scope user distill 'https://data.spencermcw.com/mcp?via=examples'
