<#
.SYNOPSIS
  Manual integration test for the x402 dispute-brief API endpoint.
  Tests the 402 Payment Required flow against a running dev server.

.DESCRIPTION
  1. Sends a request without the PAYMENT-SIGNATURE header
  2. Expects HTTP 402 with a PAYMENT-REQUIRED header
  3. Verifies the PAYMENT-REQUIRED header contains valid base64-encoded JSON
  4. Validates the JSON structure: scheme, network, price, payTo, asset
  5. Reports pass/fail for each check

.PARAMETER BaseUrl
  The base URL of the running dev server (default: http://localhost:3000).

.EXAMPLE
  # Start dev server in another terminal:
  #   npm run dev
  #
  # Run the test:
  #   powershell -ExecutionPolicy Bypass -File scripts/test-x402-dispute-brief.ps1
#>

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$Endpoint = "$BaseUrl/api/x402/dispute-brief"
$PassCount = 0
$FailCount = 0

function Write-Pass($message) {
    Write-Host "  PASS  " -ForegroundColor Green -NoNewline
    Write-Host $message
    $script:PassCount++
}

function Write-Fail($message) {
    Write-Host "  FAIL  " -ForegroundColor Red -NoNewline
    Write-Host $message
    $script:FailCount++
}

# =========================================================================
# STEP 0: Verify the dev server is running
# =========================================================================
Write-Host ""
Write-Host "=== x402 Dispute Brief API Manual Test ===" -ForegroundColor Cyan
Write-Host "Endpoint: $Endpoint"
Write-Host ""

Write-Host "[Step 0] Checking dev server at $BaseUrl..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri $BaseUrl -TimeoutSec 5 -ErrorAction Stop
    Write-Pass "Dev server responded with HTTP $($healthResponse.StatusCode)"
} catch {
    Write-Fail "Dev server not reachable at $BaseUrl. Start it with: npm run dev"
    Write-Host ""
    Write-Host "=== Results: ALL SKIPPED (server not running) ===" -ForegroundColor Yellow
    exit 1
}

# =========================================================================
# STEP 1: Send unpaid request → expect 402 with PAYMENT-REQUIRED header
# =========================================================================
Write-Host ""
Write-Host "[Step 1] Sending request WITHOUT PAYMENT-SIGNATURE header..." -ForegroundColor Yellow

$body = @{
    paymentId      = "1"
    disputeReason  = "Test dispute reason."
    requestedOutcome = "Test requested outcome."
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest `
        -Uri $Endpoint `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 10 `
        -SkipHttpErrorCheck

    if ($response.StatusCode -eq 402) {
        Write-Pass "Received HTTP 402 as expected"
    } else {
        Write-Fail "Expected HTTP 402 but got $($response.StatusCode)"
    }
} catch {
    Write-Fail "Request failed: $($_.Exception.Message)"
}

# =========================================================================
# STEP 2: Verify 402 response body structure
# =========================================================================
Write-Host ""
Write-Host "[Step 2] Verifying 402 response body..." -ForegroundColor Yellow

try {
    $responseBody = $response.Content | ConvertFrom-Json

    if ($responseBody.correlationId) {
        Write-Pass "Response includes correlationId: $($responseBody.correlationId)"
    } else {
        Write-Fail "Response is missing correlationId"
    }

    if ($responseBody.error -like "*Payment required*" -or $responseBody.error -like "*PAYMENT-SIGNATURE*") {
        Write-Pass "Response error message mentions payment requirement"
    } else {
        Write-Fail "Response error message does not mention payment requirement: $($responseBody.error)"
    }
} catch {
    Write-Fail "Failed to parse 402 response body: $($_.Exception.Message)"
}

# =========================================================================
# STEP 3: Verify PAYMENT-REQUIRED header exists
# =========================================================================
Write-Host ""
Write-Host "[Step 3] Verifying PAYMENT-REQUIRED header..." -ForegroundColor Yellow

$paymentRequiredHeader = $response.Headers['PAYMENT-REQUIRED']

if ($paymentRequiredHeader) {
    Write-Pass "PAYMENT-REQUIRED header is present"
} else {
    # Try case-insensitive lookup
    $paymentRequiredHeader = $response.Headers['payment-required']
    if ($paymentRequiredHeader) {
        Write-Pass "PAYMENT-REQUIRED header is present (lowercase key)"
    } else {
        Write-Fail "PAYMENT-REQUIRED header is MISSING"

        # Debug: show all response headers
        Write-Host "  DEBUG: Response headers:" -ForegroundColor Gray
        foreach ($key in $response.Headers.Keys) {
            Write-Host "    $key = $($response.Headers[$key])" -ForegroundColor Gray
        }
    }
}

# =========================================================================
# STEP 4: Decode and validate the PAYMENT-REQUIRED header content
# =========================================================================
Write-Host ""
Write-Host "[Step 4] Validating PAYMENT-REQUIRED header content..." -ForegroundColor Yellow

if ($paymentRequiredHeader) {
    try {
        # Base64 decode
        $decodedBytes = [System.Convert]::FromBase64String($paymentRequiredHeader)
        $decodedJson = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
        $requirements = $decodedJson | ConvertFrom-Json

        Write-Pass "PAYMENT-REQUIRED header is valid base64-encoded JSON"

        # Check accepts array
        if ($requirements.accepts -and $requirements.accepts.Count -ge 1) {
            $scheme = $requirements.accepts[0]

            if ($scheme.scheme -eq "exact") {
                Write-Pass "Payment scheme: exact"
            } else {
                Write-Fail "Payment scheme: expected 'exact', got '$($scheme.scheme)'"
            }

            if ($scheme.network -eq "eip155:11142220") {
                Write-Pass "Network: eip155:11142220 (Celo Sepolia)"
            } else {
                Write-Fail "Network: expected 'eip155:11142220', got '$($scheme.network)'"
            }

            if ($scheme.price -match '^\$[0-9.]+$') {
                Write-Pass "Price: $($scheme.price)"
            } else {
                Write-Fail "Price: expected dollar format, got '$($scheme.price)'"
            }

            if ($scheme.payTo -match '^0x[0-9a-fA-F]{40}$') {
                Write-Pass "payTo address: $($scheme.payTo)"
            } else {
                if ($scheme.payTo -eq "" -or $scheme.payTo -eq $null) {
                    Write-Fail "payTo address is EMPTY — configure X402_PAY_TO_ADDRESS in .env.local"
                } else {
                    Write-Fail "payTo address: invalid format '$($scheme.payTo)'"
                }
            }

            if ($scheme.asset -match '^0x[0-9a-fA-F]{40}$') {
                Write-Pass "Asset (token): $($scheme.asset)"
            } else {
                Write-Fail "Asset (token): invalid format '$($scheme.asset)'"
            }

            if ($scheme.assetDecimals -eq 6) {
                Write-Pass "Asset decimals: 6 (USDC)"
            } else {
                Write-Fail "Asset decimals: expected 6, got $($scheme.assetDecimals)"
            }
        } else {
            Write-Fail "PAYMENT-REQUIRED JSON missing 'accepts' array"
        }

        # Check description and mimeType
        if ($requirements.description) {
            Write-Pass "Description: $($requirements.description)"
        } else {
            Write-Fail "Description is missing"
        }

        if ($requirements.mimeType -eq "application/json") {
            Write-Pass "MIME type: application/json"
        } else {
            Write-Fail "MIME type: expected 'application/json', got '$($requirements.mimeType)'"
        }

    } catch {
        Write-Fail "Failed to decode PAYMENT-REQUIRED header: $($_.Exception.Message)"
    }
}

# =========================================================================
# SUMMARY
# =========================================================================
Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
Write-Host "Passed: $PassCount" -ForegroundColor $(if ($PassCount -gt 0) { "Green" } else { "Gray" })
Write-Host "Failed: $FailCount" -ForegroundColor $(if ($FailCount -gt 0) { "Red" } else { "Gray" })

if ($FailCount -eq 0) {
    Write-Host "All checks passed!" -ForegroundColor Green
} else {
    Write-Host "Some checks FAILED." -ForegroundColor Red
}

exit $FailCount
