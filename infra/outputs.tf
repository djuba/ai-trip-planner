# The values the deploy workflow reads as GitHub Actions secrets (infra/README.md, "GitHub Actions
# secrets"). None is a credential; they're secrets only so GitHub masks them in the public logs.

output "gcp_project_id" {
  description = "GitHub secret GCP_PROJECT_ID."
  value       = var.project_id
}

output "gcp_wif_provider" {
  description = "GitHub secret GCP_WIF_PROVIDER: the Workload Identity provider's resource name."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "gcp_deploy_sa" {
  description = "GitHub secret GCP_DEPLOY_SA: the deploy service account's email."
  value       = google_service_account.deploy.email
}

output "deploy_condition" {
  description = "The Workload Identity provider's attribute condition, for review."
  value       = local.deploy_condition
}
