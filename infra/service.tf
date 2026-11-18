# The API service users reach (WU-21 plan D1-D3). Terraform owns everything about it except the
# running image, which the deploy workflow's promote job sets (gcloud run services update --image),
# so a deploy leaves `terraform plan` clean. Merges check their image on the replay twin first
# (replay.tf; WU-23b plan D4).

# Runs the service. Its one role is Firestore in the default database (firestore.tf), for the
# gate's usage counts, and it may read the one API key secret (secrets.tf; WU-23c plan D2).
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
      # One instance caps compute spend (ADR 0005 §4). Counts are in Firestore, so more would stay correct.
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

      # Live: real model calls, paid from the Anthropic workspace whose hard spend limit bounds the
      # demo's cost (ADR 0005, WU-23c addendum). The replay twin (replay.tf) still replays.
      env {
        name  = "LLM_MODE"
        value = "live"
      }
      # From Secret Manager, at a pinned version: a new version reaches the service only when
      # var.anthropic_api_key_version changes and Terraform starts a new revision.
      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = var.anthropic_api_key_version
          }
        }
      }
      # The web service's URL (web.tf), the one origin CORS allows (WU-23b plan D3).
      env {
        name  = "WEB_ORIGIN"
        value = google_cloud_run_v2_service.web.uri
      }
      # The access gate (WU-22, WU-23a). Live limits from the cost arithmetic in ADR 0005's WU-23c
      # addendum: each code's lifetime quotas bound what it can spend (about $0.20 measured), the
      # daily window bounds the owner's unquota'd code and a leaked one, and the Anthropic spend
      # limit bounds the month. Entry options override all but the daily window. No CI caller
      # reaches this service, so the limits leave no room for one.
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
        value = "40"
      }
      env {
        name  = "QUOTA_RECOMMEND"
        value = "5"
      }
      env {
        name  = "QUOTA_PRESENT"
        value = "5"
      }
      env {
        name  = "RATE_LIMIT_PER_HOUR"
        value = "30"
      }
      env {
        name  = "RATE_LIMIT_GLOBAL_PER_DAY"
        value = "60"
      }
      # Counts persist in Firestore, so hosted live mode can start (WU-23a plan D1). A variable only
      # for staging a rollout over an image that refuses `firestore` (ADR 0005, WU-23a addendum).
      env {
        name  = "USAGE_STORE"
        value = var.usage_store
      }
      # Saves a metadata server call for the Firestore store.
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      # The CLAUDE.md §8.1 model IDs. The twin pins its own (replay.tf), so these may change.
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

  # A revision needs its Firestore and secret grants before it starts.
  depends_on = [
    google_project_service.apis,
    google_project_iam_member.runtime_firestore,
    google_secret_manager_secret_iam_member.runtime_api_key,
  ]
}

# Public, so the browser can call it; the access gate decides who may. Unadvertised and capped at one
# instance (WU-21 plan D3, R5).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
