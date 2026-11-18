# The web client (WU-23b plan D3; ADR 0005 §8). Next inlines the API's URL into the browser bundle
# when the image is built (apps/web-nextjs/Dockerfile), so the service needs no environment, no
# secret and no role. Terraform owns everything except the running image, which the deploy
# workflow's promote job sets, as for the API.

# Runs the web service. No roles: it serves pages and never calls Google Cloud.
resource "google_service_account" "web_runtime" {
  account_id   = "web-runtime"
  display_name = "web-nextjs runtime"

  depends_on = [google_project_service.apis]
}

# Web images, pushed by the deploy workflow's build job. Same cleanup as the API's repository.
resource "google_artifact_registry_repository" "web" {
  repository_id = "web"
  location      = var.region
  format        = "DOCKER"
  description   = "web-nextjs images, pushed by the deploy workflow."

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

resource "google_cloud_run_v2_service" "web" {
  name                = "web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.web_runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = var.placeholder_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # Request-based billing: CPU only while a request is in flight, so idle costs nothing.
        cpu_idle = true
      }

      startup_probe {
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
        http_get {
          path = "/"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # Set by the deploy workflow.
      template[0].containers[0].image,
      # Written by gcloud on every deploy.
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

# A public page: the API's access gate decides who may use it.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = google_cloud_run_v2_service.web.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
