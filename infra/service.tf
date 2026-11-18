# The API service (WU-21 plan D1-D3). Terraform owns everything about it except the running image,
# which the deploy workflow sets (gcloud run services update --image), so a deploy leaves
# `terraform plan` clean.

# Runs the service. Its one role is Firestore in the default database (firestore.tf), for the
# gate's usage counts. WU-23c grants it read access to the one API key secret.
resource "google_service_account" "runtime" {
  account_id   = "api-runtime"
  display_name = "api-nextjs runtime"

  depends_on = [google_project_service.apis]
}

locals {
  invite_codes         = join(",", var.invite_codes)
  revoked_invite_codes = join(",", var.revoked_invite_codes)
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
      # The access gate (WU-22, WU-23a). Replay costs nothing, so the limits only need to stay out
      # of the way of the post-deploy contract check. WU-23c sets the live values.
      env {
        name  = "INVITE_CODES"
        value = local.invite_codes
      }
      env {
        name  = "REVOKED_INVITE_CODES"
        value = local.revoked_invite_codes
      }
      env {
        name  = "QUOTA_EXTRACT"
        value = "1000000"
      }
      env {
        name  = "QUOTA_RECOMMEND"
        value = "1000000"
      }
      env {
        name  = "QUOTA_PRESENT"
        value = "1000000"
      }
      env {
        name  = "RATE_LIMIT_PER_HOUR"
        value = "1000"
      }
      env {
        name  = "RATE_LIMIT_GLOBAL_PER_DAY"
        value = "10000"
      }
      # Counts persist in Firestore, so hosted live mode can start (WU-23a plan D1). A variable only
      # for the rollout: an image from before WU-23a refuses `firestore` (infra/README.md).
      env {
        name  = "USAGE_STORE"
        value = var.usage_store
      }
      # Saves a metadata server call for the Firestore store.
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      # The post-deploy contract check sends a Google ID token of the deploy identity, not a stored
      # code (WU-23a plan D4). The gate counts it only in the global daily window. The audience must
      # equal id_token_audience in .github/workflows/deploy.yml (a test checks). The label must differ
      # from every invite entry's, or the server refuses to start; `ci-contract` was the old CI code's.
      env {
        name  = "TRUSTED_SERVICE_ACCOUNTS"
        value = "ci-deploy:${google_service_account.deploy.email}"
      }
      env {
        name  = "ID_TOKEN_AUDIENCE"
        value = var.id_token_audience
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

  # A revision on the Firestore store needs its grant before it starts.
  depends_on = [google_project_service.apis, google_project_iam_member.runtime_firestore]
}

# Public, so the contract suite (and later the browser) can call it. Unadvertised, replay-only and
# capped at one instance (WU-21 plan D3, R5).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
