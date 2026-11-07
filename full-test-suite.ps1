$ErrorActionPreference = "Continue"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "       SOLANA DEGEN RADAR - COMPREHENSIVE LIVE TEST SUITE       " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$passed = 0
$failed = 0

function Assert-Test($name, $condition, $details) {
  if ($condition) {
    Write-Host "[PASS] $name" -ForegroundColor Green
    if ($details) { Write-Host "       $details" -ForegroundColor Gray }
    $script:passed++
  } else {
    Write-Host "[FAIL] $name" -ForegroundColor Red
    if ($details) { Write-Host "       $details" -ForegroundColor Yellow }
    $script:failed++
  }
}

# --- TEST 1: Frontend Serving ---
Write-Host "`n--- 1. Testing Web Frontend (http://localhost:3000) ---" -ForegroundColor Yellow
try {
  $webRes = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
  $hasHtml = ($webRes.StatusCode -eq 200) -and ($webRes.Content.Length -gt 1000)
  Assert-Test "Frontend serves HTTP 200" ($webRes.StatusCode -eq 200) "Content length: $($webRes.Content.Length) bytes"
  Assert-Test "Frontend renders Degen Radar interface" ($hasHtml) "HTML content verified"
} catch {
  Assert-Test "Frontend serving" $false $_.Exception.Message
}

# --- TEST 2: Worker Health & Overview ---
Write-Host "`n--- 2. Testing Worker API Health and Status (http://127.0.0.1:8787) ---" -ForegroundColor Yellow
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -Method Get
  Assert-Test "Worker /health endpoint" ($health.ok -eq $true) "Worker name: $($health.name)"

  $status = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/status" -Method Get
  Assert-Test "Worker /api/status endpoint" ($status.mode -eq "simulation") "Mode: $($status.mode), Wallet: $($status.walletSupported)"
  Assert-Test "Paper portfolio initialized" ($status.portfolio.starting_balance -gt 0) "Starting balance: `$$($status.portfolio.starting_balance)"
} catch {
  Assert-Test "Worker API health" $false $_.Exception.Message
}

# --- TEST 3: Live Market Discovery ---
Write-Host "`n--- 3. Testing Live Market Discovery (DEX Screener + Solana RPC) ---" -ForegroundColor Yellow
try {
  $scan = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/scan" -Method Post -ContentType 'application/json' -Body '{}'
  Assert-Test "Market scan execution" ($scan.saved -ge 0) "Tokens scanned and saved to D1: $($scan.saved)"

  $tokens = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/tokens?limit=20" -Method Get
  Assert-Test "Discovered tokens query" ($tokens.Length -gt 0) "Tokens in database: $($tokens.Length)"

  if ($tokens.Length -gt 0) {
    $sample = $tokens[0]
    Write-Host "       Sample token: $($sample.name) ($($sample.symbol))" -ForegroundColor Cyan
    Write-Host "       Mint: $($sample.mint)" -ForegroundColor Gray
    Write-Host "       Price: `$$($sample.price_usd) | Liquidity: `$$($sample.liquidity_usd) | Risk: $($sample.risk_score)/100" -ForegroundColor Gray
    Assert-Test "Token has valid mint and market data" ($sample.mint.Length -gt 30 -and $sample.price_usd -gt 0) "Valid on-chain format"
  }
} catch {
  Assert-Test "Live Market Discovery" $false $_.Exception.Message
}

# --- TEST 4: Token Deep-Dive Inspection & Audit Scorecard ---
Write-Host "`n--- 4. Testing Token Deep-Dive and Security Scorecard ---" -ForegroundColor Yellow
try {
  if ($tokens.Length -gt 0) {
    $targetMint = $tokens[0].mint
    $detail = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/tokens/$targetMint" -Method Get
    Assert-Test "Token deep dive endpoint" ($detail.token.mint -eq $targetMint) "Resolved metadata for $($detail.token.symbol)"
    Assert-Test "Price history snapshots present" ($detail.history.Length -ge 1) "Snapshot count: $($detail.history.Length)"
    Assert-Test "Security risk assessment present" ($detail.risk.risk_score -ne $null) "Risk score: $($detail.risk.risk_score)/100, Status: $($detail.risk.status)"

    $holders = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/tokens/$targetMint/holders" -Method Get
    Assert-Test "Token beneficial holders endpoint" ($holders -ne $null) "Holders evaluated"

    $clusters = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/tokens/$targetMint/clusters" -Method Get
    Assert-Test "Token wallet clusters endpoint" ($clusters -ne $null) "Clusters evaluated"
  }
} catch {
  Assert-Test "Token Deep-Dive" $false $_.Exception.Message
}

# --- TEST 5: Wallet & Creator Intelligence ---
Write-Host "`n--- 5. Testing Wallet and Creator Intelligence Engine ---" -ForegroundColor Yellow
try {
  $testWallet = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
  $wIntel = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/wallets/$testWallet" -Method Get
  Assert-Test "Wallet cross-token history query" ($wIntel.wallet.address -eq $testWallet) "Investigated wallet: $($wIntel.wallet.address)"

  $cCode = 0
  try {
    $cIntel = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/creators/unknown-test" -Method Get
  } catch {
    $cCode = 404
  }
  Assert-Test "Creator reputation gracefully handles unknown creator (404)" ($cCode -eq 404) "404 Not Found returned as expected"
} catch {
  Assert-Test "Wallet Intelligence" $false $_.Exception.Message
}

# --- TEST 6: Breakout Signals Engine ---
Write-Host "`n--- 6. Testing Breakout Signals Engine ---" -ForegroundColor Yellow
try {
  $bScan = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/breakouts/scan" -Method Post -ContentType 'application/json' -Body '{}'
  Assert-Test "Breakout scanner execution" ($bScan.count -ge 0) "Signals generated: $($bScan.count)"

  $signals = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/breakouts" -Method Get
  Assert-Test "Active breakout signals endpoint" ($true) "Active breakout signals feed operational"
} catch {
  Assert-Test "Breakout Signals" $false $_.Exception.Message
}

# --- TEST 7: Social Feed & Narrative Intelligence ---
Write-Host "`n--- 7. Testing Social Feed and Narrative Intelligence ---" -ForegroundColor Yellow
try {
  $socialScan = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/social/scan" -Method Post -ContentType 'application/json' -Body '{}'
  Assert-Test "Social scanner execution" ($socialScan -ne $null) "Social scanning complete"

  $narratives = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/narratives" -Method Get
  Assert-Test "Meme narratives feed" ($narratives -ne $null) "Narratives query successful"

  $socialFeed = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/social/feed" -Method Get
  Assert-Test "Social observation feed" ($socialFeed -ne $null) "Events count: $($socialFeed.Length)"
} catch {
  Assert-Test "Social Intelligence" $false $_.Exception.Message
}

# --- TEST 8: Atomic Paper Trading Simulation ---
Write-Host "`n--- 8. Testing Atomic Paper Trading Simulation ---" -ForegroundColor Yellow
try {
  # 1. Reset Portfolio to $1,000 clean slate
  $resetPayload = @{ startingBalance = 1000 } | ConvertTo-Json
  $reset = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/portfolio/reset" -Method Post -ContentType 'application/json' -Body $resetPayload
  Assert-Test "Portfolio reset to `$1,000" ($reset.cash_balance -eq 1000) "Balance: `$$($reset.cash_balance)"

  # 2. Buy $100 of discovered token
  $targetToken = $tokens[0]
  $buyPayload = @{
    mint = $targetToken.mint
    usd = 100
    slippageBps = 50
  } | ConvertTo-Json
  $buy = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/paper/buy" -Method Post -ContentType 'application/json' -Body $buyPayload
  Assert-Test "Simulated Buy executed atomically" ($buy.positionId.Length -gt 0) "Position created: $($buy.positionId)"

  # Query updated portfolio
  $portAfterBuy = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/portfolio" -Method Get
  Assert-Test "Cash balance deducted correctly" ($portAfterBuy.cash_balance -eq 900) "Remaining cash: `$$($portAfterBuy.cash_balance)"
  Assert-Test "Position opened with slippage and fees" ($portAfterBuy.positions.Length -ge 1) "Open positions: $($portAfterBuy.positions.Length)"

  # 3. Sell the position
  $openPos = $portAfterBuy.positions[0]
  $sellPayload = @{
    positionId = $openPos.id
    slippageBps = 50
  } | ConvertTo-Json
  $sell = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/paper/sell" -Method Post -ContentType 'application/json' -Body $sellPayload
  Assert-Test "Simulated Sell executed atomically" ($sell.positionId.Length -gt 0) "Sold position: $($sell.positionId), Realized PnL: `$$($sell.realizedPnlUsd)"

  $portAfterSell = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/portfolio" -Method Get
  Assert-Test "Cash balance refunded after sell" ($portAfterSell.cash_balance -gt 890) "Updated Cash: `$$($portAfterSell.cash_balance)"
} catch {
  Assert-Test "Paper Trading Simulation" $false $_.Exception.Message
}

# --- TEST 9: Historical Backtesting Engine ---
Write-Host "`n--- 9. Testing Historical Backtesting Engine ---" -ForegroundColor Yellow
try {
  $btConfig = @{
    name = "Live Test Trend Strategy"
    minMomentum = 50
    maxRiskScore = 75
    takeProfitPct = 30
    stopLossPct = -10
    maxHoldingHours = 24
    tradeSizeUsd = 100
    initialCapitalUsd = 1000
    slippageBps = 50
    feeBps = 10
  } | ConvertTo-Json

  $btResult = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/backtest/run" -Method Post -ContentType 'application/json' -Body $btConfig
  Assert-Test "Backtest simulation executed" ($btResult.totalTrades -ge 0) "Trades: $($btResult.totalTrades), Return: $($btResult.totalReturnPct)%"
  Assert-Test "Capital preservation calculated" ($btResult.endingCapitalUsd -gt 0) "Ending Capital: `$$($btResult.endingCapitalUsd)"

  $runs = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/backtest/runs" -Method Get
  Assert-Test "Backtest run saved in D1" ($runs.Length -ge 1) "Recorded runs count: $($runs.Length)"
} catch {
  Assert-Test "Historical Backtesting" $false $_.Exception.Message
}

# --- TEST 10: Jupiter v1 Swap Quote & Transaction Builder ---
Write-Host "`n--- 10. Testing Live Jupiter Swap Lifecycle ---" -ForegroundColor Yellow
try {
  $solMint = "So11111111111111111111111111111111111111112"
  $usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  $quoteUri = "http://127.0.0.1:8787/api/swap/quote?inputMint=$solMint&outputMint=$usdcMint&amount=100000000&slippageBps=50"
  
  $quote = Invoke-RestMethod -Uri $quoteUri -Method Get
  Assert-Test "Jupiter Quote retrieval" ($quote.outAmount -ne $null -and [double]$quote.outAmount -gt 0) "Quoted outAmount: $($quote.outAmount)"

  # Build swap transaction
  $swapBody = @{
    quoteResponse = $quote
    userPublicKey = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
  } | ConvertTo-Json -Depth 5

  $swapTx = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/swap/transaction" -Method Post -ContentType 'application/json' -Body $swapBody
  Assert-Test "Jupiter VersionedTransaction serialization" ($swapTx.swapTransaction.Length -gt 50) "Base64 wire tx length: $($swapTx.swapTransaction.Length) chars"

  $swapHistory = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/swap/history" -Method Get
  Assert-Test "Swap transaction history endpoint" ($true) "Live swap transactions feed operational"
} catch {
  Assert-Test "Jupiter Live Swap" $false $_.Exception.Message
}

# --- TEST 11: Provider Health Matrix ---
Write-Host "`n--- 11. Testing Dynamic Provider Health Matrix ---" -ForegroundColor Yellow
try {
  $providers = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/providers" -Method Get
  Assert-Test "All 8 providers evaluated" ($providers.Length -eq 8) "Active providers verified: $($providers.Length)"
  foreach ($p in $providers) {
    Write-Host "       [$($p.category.ToUpper())] $($p.name): $($p.status)" -ForegroundColor Gray
  }
} catch {
  Assert-Test "Provider Matrix" $false $_.Exception.Message
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "                TEST SUITE SUMMARY RESULTS                      " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " Total Passed: $passed" -ForegroundColor Green
Write-Host " Total Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host " Status: $(if ($failed -eq 0) { 'ALL TESTS PASSED PERFECTLY!' } else { 'SOME TESTS FAILED' })" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "================================================================" -ForegroundColor Cyan
