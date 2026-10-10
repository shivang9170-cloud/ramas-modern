# Builds the React app and packs it with the API into one zip for Azure App Service (Linux, Node 22).
# The API serves the built React app itself (CLIENT_DIST), so the whole site is one web app on one address.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-azure-package.ps1
#
# Output: azure-package.zip in the project folder (upload it with "Deploy" in docs/HOSTING-AZURE.md).
# Nothing secret goes in the zip: .env, node_modules, tests, uploads and the dev database scripts' demo data stay out.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'azure-package'
$zip = Join-Path $root 'azure-package.zip'

Write-Host 'Building the React app...'
npm --prefix (Join-Path $root 'client') run build
if ($LASTEXITCODE -ne 0) { throw 'The React build failed.' }

if (Test-Path $out) { Get-ChildItem $out -Force | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

# API: source, database scripts (for db:cloud), package files
$server = Join-Path $root 'server'
foreach ($item in 'src', 'db', 'scripts', 'package.json', 'package-lock.json') {
  Copy-Item -Path (Join-Path $server $item) -Destination $out -Recurse -Force
}
# React build next to it; the app setting CLIENT_DIST points here
Copy-Item -Path (Join-Path $root 'client\dist') -Destination (Join-Path $out 'client-dist') -Recurse -Force

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Ready: $zip ($size MB)"
