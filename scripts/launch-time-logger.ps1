# This script launches the Jira time logging functionality in a new window
# No parameters needed - we'll check the commit message directly

# Get the project root directory
$projectRoot = (Get-Location).Path

# Set window title
$host.UI.RawUI.WindowTitle = "Journyy - Jira Time Logging"

# Show header
Write-Host "================================" -ForegroundColor Cyan
Write-Host "     JIRA TIME LOGGING TOOL     " -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Execute the time logging script
try {
    Write-Host "Executing time logging script..." -ForegroundColor Blue
    # Run the Node.js script
    node "$projectRoot\scripts\log-time.cjs"
}
catch {
    Write-Host "Error executing time logging script: $_" -ForegroundColor Red
}

# Keep the window open until user presses a key
Write-Host "`nPress any key to close this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
