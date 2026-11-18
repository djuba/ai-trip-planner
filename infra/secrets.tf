# The Anthropic API key for live mode (WU-23c plan D2). Terraform creates the secret but never a
# version of it, so the key is never in Terraform state, plan output or the repository. You add the
# value with gcloud (infra/README.md, "The live demo"), and pin the version `api` reads with
# var.anthropic_api_key_version.
resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "anthropic-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# Only `api`'s runtime account can read it, and only this secret. The replay twin and the web
# service run as other accounts and never see it.
resource "google_secret_manager_secret_iam_member" "runtime_api_key" {
  secret_id = google_secret_manager_secret.anthropic_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}
