# The API's replay twin (WU-23b plan D4). Every merge deploys its API image here and runs the
# provider contract suite against it, so the check never calls the model, even once `api` is live
# (WU-23c). Only CI calls it: no invite codes, and the one trusted caller is the build identity's ID
# token. It runs the same image as `api`; scripts/infra-config.test.ts keeps its model IDs equal to
# the contract runner's (CONTRACT_TEST_ENV) and its WEB_ORIGIN equal to `api`'s (service.tf).

# Runs the twin. No roles: replay needs no key, and the memory store needs no Firestore.
resource "google_service_account" "replay_runtime" {
  account_id   = "api-replay-runtime"
  display_name = "api-nextjs replay twin runtime"

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "api_replay" {
  name                = "api-replay"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.replay_runtime.email
    timeout         = "${var.request_timeout_seconds}s"

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
        cpu_idle = true
      }

      # Always replay, whatever `api` runs.
      env {
        name  = "LLM_MODE"
        value = "replay"
      }
      # The real web origin, so the contract suite's CORS checks run against it.
      env {
        name  = "WEB_ORIGIN"
        value = google_cloud_run_v2_service.web.uri
      }
      # Memory counts: allowed with replay on a hosted server (WU-22), and they never touch `api`'s
      # Firestore counters or its global daily window.
      env {
        name  = "USAGE_STORE"
        value = "memory"
      }
      # High enough to stay out of the contract suite's way; the trusted account is counted only here.
      env {
        name  = "RATE_LIMIT_GLOBAL_PER_DAY"
        value = "10000"
      }
      env {
        name  = "TRUSTED_SERVICE_ACCOUNTS"
        value = "ci-deploy:${google_service_account.deploy.email}"
      }
      env {
        name  = "ID_TOKEN_AUDIENCE"
        value = var.id_token_audience
      }
      # Must equal CONTRACT_TEST_ENV: cassette keys hash the model ID. Pinned here rather than
      # taken from `api`, so `api`'s live models may change (WU-23c plan D5).
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
      # Set by the deploy workflow's twin-check job.
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

# Public like `api`, so the contract suite can reach it; unadvertised, replay-only, one instance.
resource "google_cloud_run_v2_service_iam_member" "replay_public" {
  name     = google_cloud_run_v2_service.api_replay.name
  location = google_cloud_run_v2_service.api_replay.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
