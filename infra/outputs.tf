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
  description = "GitHub secret GCP_DEPLOY_SA: the build identity's email (deploy workflow's build and twin-check jobs)."
  value       = google_service_account.deploy.email
}

output "gcp_promote_sa" {
  description = "GitHub secret GCP_PROMOTE_SA: the promote identity's email (deploy workflow's promote job)."
  value       = google_service_account.promote.email
}

output "web_url" {
  description = "The web client's URL, the one origin the API allows. Share this one, not another URL Cloud Run lists for the service."
  value       = google_cloud_run_v2_service.web.uri
}

output "deploy_condition" {
  description = "The Workload Identity provider's attribute condition, for review."
  value       = local.deploy_condition
}
