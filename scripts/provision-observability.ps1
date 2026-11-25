param(
  [string]$Project = "project-2-pinboard-2026",
  [string]$Service = "project-2-api",
  [string]$Configuration = "partner-backend"
)

$ErrorActionPreference = "Stop"
$metricName = "pinboard_api_5xx"
$providerMetricName = "pinboard_provider_failures"
$policyPath = Join-Path $PSScriptRoot "..\config\monitoring\pinboard-api-5xx-policy.json"

$ErrorActionPreference = "Continue"
$null = & gcloud.cmd --configuration=$Configuration logging metrics describe $metricName --project=$Project 2>&1
$metricDescribeExitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($metricDescribeExitCode -ne 0) {
  & gcloud.cmd --configuration=$Configuration logging metrics create $metricName `
    --project=$Project `
    --description="Count structured Pinboard API 5xx responses" `
    --log-filter='jsonPayload.event="api_5xx" AND resource.labels.service_name="project-2-api"'
  if ($LASTEXITCODE -ne 0) { throw "Could not create the API 5xx log-based metric." }
} else {
  Write-Host "Log-based metric $metricName already exists; leaving it unchanged."
}

$ErrorActionPreference = "Continue"
$null = & gcloud.cmd --configuration=$Configuration logging metrics describe $providerMetricName --project=$Project 2>&1
$providerMetricDescribeExitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($providerMetricDescribeExitCode -ne 0) {
  & gcloud.cmd --configuration=$Configuration logging metrics create $providerMetricName `
    --project=$Project `
    --description="Count failed ADK, Gemini, and Google Photos provider calls" `
    --log-filter='(jsonPayload.event="external_api_call" AND jsonPayload.outcome="failure") OR jsonPayload.event="google_photos_upload_rejected" OR jsonPayload.event="gemini_api_call" AND jsonPayload.outcome="failure"'
  if ($LASTEXITCODE -ne 0) { throw "Could not create the provider failure log-based metric." }
} else {
  Write-Host "Log-based metric $providerMetricName already exists; leaving it unchanged."
}

$existingPolicies = & gcloud.cmd --configuration=$Configuration monitoring policies list `
  --project=$Project --format="value(displayName)"
if ($existingPolicies -notcontains "Pinboard API 5xx responses") {
  & gcloud.cmd --configuration=$Configuration monitoring policies create `
    --project=$Project --policy-from-file=$policyPath
  if ($LASTEXITCODE -ne 0) { throw "Could not create the API 5xx alert policy." }
} else {
  Write-Host "Alert policy already exists; leaving it unchanged."
}

Write-Host "Observability is configured for $Service in $Project."
