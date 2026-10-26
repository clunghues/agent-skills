# Thin entry point: node apply/apply.mjs with the same arguments.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node (>= 22) not found on PATH' }
& node (Join-Path $root 'apply\apply.mjs') @args
exit $LASTEXITCODE
