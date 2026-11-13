# The API service (WU-21 plan D1-D3). Terraform owns everything about it except the running image,
# which the deploy workflow sets (gcloud run services update --image), so a deploy leaves
# `terraform plan` clean.

# Runs the service. No roles: replay mode reads only files baked into the image. WU-23 grants it
# read access to the one API key secret.
resource "google_service_account" "runtime" {
  account_id   = "api-runtime"
  display_name = "api-nextjs runtime"

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "api" {
  name                = local.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.runtime.email
    timeout         = "${var.request_timeout_seconds}s"

    scaling {
      min_instance_count = 0
      # One instance caps compute spend and keeps WU-22's in-memory rate limiter correct (ADR 0005 §4).
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

      env {
        name  = "LLM_MODE"
        value = "replay"
      }
      env {
        name  = "WEB_ORIGIN"
        value = var.web_origin
      }
      # Must equal CONTRACT_TEST_ENV (backends/api-nextjs/tests/support/api-server.ts): cassette
      # keys hash the model request, model ID included, so the contract suite's cassettes replay
      # only with these. They're the CLAUDE.md §8.1 IDs, which live mode (WU-23) uses too.
      env {
        name  = "MODEL_FAST"
        value = "claude-haiku-5-5"
      }
      env {
        name  = "MODEL_REASONING"
        value = "claude-sonnet-5-5"
      }
      env {
        name  = "MODEL_CRITIC"
        value = "claude-sonnet-5-5"
      }

      # Cloud Run holds the first request until this passes, so a cold start has up to a minute.
      startup_probe {
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
        http_get {
          path = "/v1/health"
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

# Public, so the contract suite (and later the browser) can call it. Unadvertised, replay-only and
# capped at one instance (WU-21 plan D3, R5).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
