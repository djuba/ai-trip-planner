# Provider and project APIs (WU-21). Applied by hand from a developer machine with user
# credentials (gcloud auth application-default login), never from CI (WU-21 plan D1).

provider "google" {
  project = var.project_id
  region  = var.region

  # The Budget API needs a quota project when called with user credentials.
  billing_project       = var.project_id
  user_project_override = true
}

locals {
  apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
  ])

  service_name    = "api"
  repository_name = "api"
}

resource "google_project_service" "apis" {
  for_each = local.apis

  service = each.value
  # Teardown is deleting the project (infra/README.md), so a destroy never turns APIs off.
  disable_on_destroy = false
}

data "google_project" "this" {}
