# Push to GitHub Script
$TOKEN = "YOUR_GITHUB_TOKEN_HERE"
$REPO_URL = "https://github.com/viztrrx/donnajbe.git"
$REMOTE_URL = "https://$TOKEN@github.com/viztrrx/donnajbe.git"

Write-Host "Preparing to push to GitHub..." -ForegroundColor Cyan

# 1. Initialize Git
git init
git remote add origin $REMOTE_URL

# 2. Add and Commit
git add .
git commit -m "Refactor: Transition to Modular Hub Architecture"

# 3. Push to Main
# We use -f (force) because we are replacing the structure
git push -f origin master

Write-Host "DONE! Your modular Hub is now live on GitHub." -ForegroundColor Green
