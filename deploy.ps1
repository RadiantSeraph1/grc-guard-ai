Write-Host "Waiting for GKE cluster to be ready..."
while ($true) {
    try {
        $status = (gcloud.cmd container clusters describe grc-guard-cluster --region=us-central1 --format="value(status)" 2>$null)
        if ($status -eq "RUNNING") {
            Write-Host "GKE cluster is ready."
            break
        }
        Write-Host "Still waiting for GKE cluster... (current status: $status)"
    } catch {
        Write-Host "Transient network error, continuing to wait..."
    }
    Start-Sleep -Seconds 30
}

Write-Host "Fetching GKE credentials..."
gcloud.cmd container clusters get-credentials grc-guard-cluster --region=us-central1

Write-Host "Submitting Cloud Build job to build, push, and deploy..."
gcloud.cmd builds submit --config cloudbuild.yaml .

Write-Host "Deployment completed!"
