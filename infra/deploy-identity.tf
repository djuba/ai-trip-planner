# How the deploy workflow reaches Google Cloud without a stored key (ADR 0005 §6; WU-21 plan D4,
# WU-23b plan D7). GitHub's OIDC token is exchanged through Workload Identity Federation for a
# short-lived token of a service account. Only .github/workflows/deploy.yml, run from main of this
# repository (matched by numeric ID), passes the provider's condition.
#
# Two identities, so the jobs that install dependencies and build images never hold the power to
# deploy the services users reach (whose runtime account reads the API key from WU-23c on):
# - build (github-deploy): pushes images, deploys the replay twin, mints the contract check's ID token.
# - promote (github-promote): deploys `api` and `web`. Only a job in the GitHub Environment `live`
#   gets it, and that job runs no install or build.
# Which one a token may become is the mapped attribute `deployer`, below.

locals {
  deploy_workflow_path = ".github/workflows/deploy.yml"

  # The refs whose deploy.yml may run: main, plus at most one ref for proving a workflow change
  # before merge (var.extra_deploy_ref, empty by default).
  deploy_refs = compact(["refs/heads/main", var.extra_deploy_ref])

  deploy_ref_clauses = [
    for ref in local.deploy_refs :
    "(assertion.ref == \"${ref}\" && assertion.workflow_ref == \"${var.github_repository}/${local.deploy_workflow_path}@${ref}\")"
  ]

  deploy_condition = "assertion.repository_id == \"${var.github_repository_id}\" && (${join(" || ", local.deploy_ref_clauses)})"

  # GitHub adds the `environment` claim only to jobs that name an environment. The condition above
  # already limits tokens to deploy.yml on the allowed refs; this tells its jobs apart.
  deployer_mapping = "(\"environment\" in assertion) ? (assertion.environment == \"live\" ? \"promote\" : \"none\") : \"build\""

  pool_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}"
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
    "attribute.deployer"      = local.deployer_mapping
  }

  attribute_condition = local.deploy_condition

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ---------------------------------------------------------------------------------------------------
# The build identity. Every grant is on one resource; it has no project-level role and no key.
# ---------------------------------------------------------------------------------------------------

resource "google_service_account" "deploy" {
  account_id   = "github-deploy"
  display_name = "GitHub deploy workflow: build"

  depends_on = [google_project_service.apis]
}

resource "google_service_account_iam_member" "deploy_federation_build" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.pool_principal}/attribute.deployer/build"
}

# Push images to the two repositories.
resource "google_artifact_registry_repository_iam_member" "deploy_push" {
  repository = google_artifact_registry_repository.api.name
  location   = google_artifact_registry_repository.api.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deploy.member
}

resource "google_artifact_registry_repository_iam_member" "deploy_push_web" {
  repository = google_artifact_registry_repository.web.name
  location   = google_artifact_registry_repository.web.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deploy.member
}

# Deploy revisions of the replay twin and read its URL and env. It can't change who may invoke it.
resource "google_cloud_run_v2_service_iam_member" "deploy_replay" {
  name     = google_cloud_run_v2_service.api_replay.name
  location = google_cloud_run_v2_service.api_replay.location
  role     = "roles/run.developer"
  member   = google_service_account.deploy.member
}

# A twin revision runs as the twin's runtime account, which has no roles.
resource "google_service_account_iam_member" "deploy_act_as_replay_runtime" {
  service_account_id = google_service_account.replay_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deploy.member
}

# Read `api`'s URL, which the build job bakes into the web image. Read only.
resource "google_cloud_run_v2_service_iam_member" "deploy_view_api" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.viewer"
  member   = google_service_account.deploy.member
}

# The twin-check job mints a Google ID token of this account for the contract suite (WU-23a plan
# D4), so no invite code is stored in GitHub. Its audience is the API's ID_TOKEN_AUDIENCE, and the
# twin accepts it only for this account's email.
resource "google_service_account_iam_member" "deploy_id_token_build" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.serviceAccountOpenIdTokenCreator"
  member             = "${local.pool_principal}/attribute.deployer/build"
}

# ---------------------------------------------------------------------------------------------------
# The promote identity: deploys the services users reach, and nothing else.
# ---------------------------------------------------------------------------------------------------

resource "google_service_account" "promote" {
  account_id   = "github-promote"
  display_name = "GitHub deploy workflow: promote"

  depends_on = [google_project_service.apis]
}

resource "google_service_account_iam_member" "promote_federation" {
  service_account_id = google_service_account.promote.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.pool_principal}/attribute.deployer/promote"
}

resource "google_cloud_run_v2_service_iam_member" "promote_api" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.developer"
  member   = google_service_account.promote.member
}

resource "google_cloud_run_v2_service_iam_member" "promote_web" {
  name     = google_cloud_run_v2_service.web.name
  location = google_cloud_run_v2_service.web.location
  role     = "roles/run.developer"
  member   = google_service_account.promote.member
}

resource "google_service_account_iam_member" "promote_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.promote.member
}

resource "google_service_account_iam_member" "promote_act_as_web_runtime" {
  service_account_id = google_service_account.web_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.promote.member
}

# ---------------------------------------------------------------------------------------------------
# Rollout only (WU-23b plan D8): what today's deploy.yml on main needs until the new pipeline has run
# there. Apply with rollout_wu23b = false after that; the WU-23b close commit removes this section.
# ---------------------------------------------------------------------------------------------------

moved {
  from = google_service_account_iam_member.deploy_federation
  to   = google_service_account_iam_member.deploy_federation[0]
}

moved {
  from = google_cloud_run_v2_service_iam_member.deploy_service
  to   = google_cloud_run_v2_service_iam_member.deploy_service[0]
}

moved {
  from = google_service_account_iam_member.deploy_act_as_runtime
  to   = google_service_account_iam_member.deploy_act_as_runtime[0]
}

moved {
  from = google_service_account_iam_member.deploy_id_token
  to   = google_service_account_iam_member.deploy_id_token[0]
}

# Any token of this repository could become the build identity.
resource "google_service_account_iam_member" "deploy_federation" {
  count              = var.rollout_wu23b ? 1 : 0
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.pool_principal}/attribute.repository_id/${var.github_repository_id}"
}

# Deploy `api` and run as its runtime account.
resource "google_cloud_run_v2_service_iam_member" "deploy_service" {
  count    = var.rollout_wu23b ? 1 : 0
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.developer"
  member   = google_service_account.deploy.member
}

resource "google_service_account_iam_member" "deploy_act_as_runtime" {
  count              = var.rollout_wu23b ? 1 : 0
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deploy.member
}

resource "google_service_account_iam_member" "deploy_id_token" {
  count              = var.rollout_wu23b ? 1 : 0
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.serviceAccountOpenIdTokenCreator"
  member             = "${local.pool_principal}/attribute.repository_id/${var.github_repository_id}"
}
