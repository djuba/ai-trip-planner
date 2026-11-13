# How the deploy workflow reaches Google Cloud without a stored key (ADR 0005 §6, WU-21 plan D4).
# GitHub's OIDC token is exchanged through Workload Identity Federation for a short-lived token of
# the deploy service account. Only .github/workflows/deploy.yml, run from main of this repository
# (matched by numeric ID), passes the provider's condition.

locals {
  deploy_workflow_path = ".github/workflows/deploy.yml"

  # The refs whose deploy.yml may deploy: main, plus at most one ref for proving a workflow change
  # before merge (var.extra_deploy_ref, empty by default).
  deploy_refs = compact(["refs/heads/main", var.extra_deploy_ref])

  deploy_ref_clauses = [
    for ref in local.deploy_refs :
    "(assertion.ref == \"${ref}\" && assertion.workflow_ref == \"${var.github_repository}/${local.deploy_workflow_path}@${ref}\")"
  ]

  deploy_condition = "assertion.repository_id == \"${var.github_repository_id}\" && (${join(" || ", local.deploy_ref_clauses)})"
}

# The pool holds only this one provider.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Deploy workflow of the ai-trip-planner repository."

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
    "attribute.ref"           = "assertion.ref"
    "attribute.workflow_ref"  = "assertion.workflow_ref"
  }

  attribute_condition = local.deploy_condition

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# The identity the deploy workflow becomes. Every grant below is on one resource; it has no
# project-level role and no key.
resource "google_service_account" "deploy" {
  account_id   = "github-deploy"
  display_name = "GitHub deploy workflow"

  depends_on = [google_project_service.apis]
}

resource "google_service_account_iam_member" "deploy_federation" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# Push images to the one repository.
resource "google_artifact_registry_repository_iam_member" "deploy_push" {
  repository = google_artifact_registry_repository.api.name
  location   = google_artifact_registry_repository.api.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deploy.member
}

# Deploy revisions of the one service and read its URL and env. It can't change who may invoke it.
resource "google_cloud_run_v2_service_iam_member" "deploy_service" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.developer"
  member   = google_service_account.deploy.member
}

# A revision runs as the runtime account, so deploying one needs actAs on that account only.
resource "google_service_account_iam_member" "deploy_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deploy.member
}
