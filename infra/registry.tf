# The image registry (WU-21 plan D3). The cleanup policy keeps the 5 most recent images, enough
# to roll back (infra/README.md), and deletes the rest, to stay near the free storage tier.

resource "google_artifact_registry_repository" "api" {
  repository_id = local.repository_name
  location      = var.region
  format        = "DOCKER"
  description   = "api-nextjs images, pushed by the deploy workflow."

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-older"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "86400s"
    }
  }

  depends_on = [google_project_service.apis]
}
